/**
 * L0 — 추출 계층.
 * unit 폴더(goldset/{subject}/{unit})의 *.pdf / *.pptx를 감지해 텍스트를 추출하고
 * 파이프라인 내부 캐시(.extracted/{subject}/{unit}/<원본명>.txt)에 저장한다.
 * - 페이지(=PPT의 슬라이드) 구분은 폼피드(\f) 줄로 유지 → L1 parseExtractedSlides가 페이지 단위로 복원
 * - PDF는 pdfjs, PPTX는 officeparser(순수 JS, 외부 도구 불필요)로 추출 — 둘 다 1-based 페이지/슬라이드
 * - 캐시 파일 mtime을 원본 mtime과 동일하게 맞춰, 원본이 안 바뀌었으면 스킵
 * - 사용자 폴더(goldset)에는 아무것도 쓰지 않는다
 */
import fs from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { OfficeParser } from "officeparser";
import type { UnitKey } from "../folders.js";

/** L0가 텍스트를 뽑을 수 있는 문서 확장자 (소문자, 점 제외) */
const EXTRACTABLE_EXTS = ["pdf", "pptx"] as const;

export interface ExtractResult {
  /** 이번에 새로 추출한 원본 파일명 (pdf/pptx) */
  extracted: string[];
  /** 캐시가 최신이라 스킵한 원본 파일명 */
  skipped: string[];
}

/** PDF → 페이지별 텍스트 배열 (1-based 순서 유지) */
export async function extractPdfPages(pdfPath: string): Promise<string[]> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = getDocument({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) {
        const it = item as { str?: string; hasEOL?: boolean };
        if (typeof it.str === "string") text += it.str;
        if (it.hasEOL) text += "\n";
      }
      pages.push(text.trimEnd());
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}

/**
 * PPTX → 슬라이드별 텍스트 배열 (1-based 순서 유지).
 * officeparser AST(ast.content)에서 slide 노드를 순서대로 뽑고,
 * 각 슬라이드는 문단/제목/리스트 등 블록 단위 텍스트를 줄바꿈으로 합친다.
 * (개별 텍스트런까지 내려가면 조각나므로 블록 노드의 consolidated text를 쓴다.)
 */
export async function extractPptxSlides(pptxPath: string): Promise<string[]> {
  const ast = await OfficeParser.parseOffice(pptxPath, { ignoreSlideMasters: true });
  const slides = ast.content.filter((n) => n.type === "slide");
  // slide 노드가 하나도 없으면 최선으로 전체 텍스트를 1장으로 반환 (구제책)
  if (slides.length === 0) {
    const text = ast.toText().trim();
    return text ? [text] : [];
  }
  return slides.map((s) => collectBlockText(s).join("\n"));
}

/** 블록 단위(문단/제목/리스트/표셀/노트/코드)에서 consolidated text를 수집. */
const BLOCK_TEXT_TYPES = new Set([
  "paragraph",
  "heading",
  "list",
  "code",
  "note",
  "comment",
  "cell",
  "definitionTerm",
  "definitionDescription",
]);
type AstNode = { type: string; text?: string; children?: AstNode[] };
function collectBlockText(node: AstNode, acc: string[] = []): string[] {
  if (BLOCK_TEXT_TYPES.has(node.type)) {
    const t = typeof node.text === "string" ? node.text.trim() : "";
    if (t) acc.push(t);
    return acc;
  }
  if (Array.isArray(node.children) && node.children.length > 0) {
    for (const c of node.children) collectBlockText(c, acc);
  } else if (typeof node.text === "string" && node.text.trim()) {
    acc.push(node.text.trim());
  }
  return acc;
}

/** 확장자(소문자, 점 제외) 반환 */
function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * goldset/{subject}/{unit}의 모든 추출 대상 문서(PDF·PPTX)를
 * extractedDir/{subject}/{unit}/<원본명>.txt로 추출(캐시)한다.
 * 출력 형식은 확장자와 무관하게 동일: 페이지(슬라이드)별 텍스트를 \f로 구분 → L1이 페이지 단위 복원.
 * (함수명은 하위 호환을 위해 유지: 이제 PDF뿐 아니라 PPTX도 처리)
 */
export async function extractUnitPdfs(
  goldsetDir: string,
  key: UnitKey,
  extractedDir: string,
): Promise<ExtractResult> {
  const srcDir = path.join(goldsetDir, key.subject, key.unit);
  const outDir = path.join(extractedDir, key.subject, key.unit);
  const result: ExtractResult = { extracted: [], skipped: [] };
  if (!fs.existsSync(srcDir)) return result;

  const docs = fs
    .readdirSync(srcDir)
    .filter((f) => (EXTRACTABLE_EXTS as readonly string[]).includes(extOf(f)))
    .sort();

  for (const f of docs) {
    const src = path.join(srcDir, f);
    const dst = path.join(outDir, f.replace(/\.[^.]+$/, "") + ".txt");
    const srcMtime = fs.statSync(src).mtime;
    if (fs.existsSync(dst) && fs.statSync(dst).mtime.getTime() === srcMtime.getTime()) {
      result.skipped.push(f);
      continue;
    }
    // 파일별 try/catch: 암호걸린·잘린·손상 문서 하나가 전체 추출을 막지 않게
    // 실패 파일은 경고 후 건너뛰고 나머지를 계속 처리한다.
    try {
      const pages = extOf(f) === "pptx" ? await extractPptxSlides(src) : await extractPdfPages(src);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(dst, pages.join("\n\f\n"), "utf8");
      fs.utimesSync(dst, srcMtime, srcMtime); // 캐시 mtime = 원본 mtime → 다음 실행 시 스킵 판정
      result.extracted.push(f);
    } catch (e) {
      console.warn(
        `  경고: '${f}' 추출 실패로 건너뜁니다 (${e instanceof Error ? e.message : String(e)}). 나머지 자료로 분석을 계속합니다.`,
      );
    }
  }
  return result;
}
