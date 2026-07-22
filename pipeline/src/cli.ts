/**
 * Aone 파이프라인 CLI (일반화_설계.md §4).
 *
 *   npx tsx src/cli.ts run --subject 데이터통신 --unit 3주차 [--engine stub] [--tier standard|deep] [--model <name>] [--goldset <dir>] [--db <file>] [--no-extract]
 *   npx tsx src/cli.ts run --subject 데이터통신 --all-units [--engine …]
 *   npx tsx src/cli.ts export [--subject 데이터통신] [--unit 3주차] --out <dir> [--db <file>]
 *   npx tsx src/cli.ts summarize-slides --subject 데이터통신 --unit 3주차 --doc <tag> [--engine claude-cli] [--model <m>] [--concurrency 2]
 *
 * run: unit 자료 투입 이벤트 처리 (누적은 DB가 앎 — wipe 없음, 재실행 시 upsert)
 * export: concept_scores가 존재하는 unit들의 스냅샷을 out/{subject}__{unit}.json으로 기록
 * summarize-slides: doc 태그 하나의 페이지별 요약 카드 생성 → aone-app/public/slides/{subject}__{unit}.json에 병합
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AoneDb } from "./db.js";
import { makeConfig, Tier, EngineName } from "./config.js";
import {
  createEngine,
  buildPrompt,
  ComposeSlideSummariesOutput,
  ComposeSlideSummariesPayload,
  EngineUsage,
  TimetableOutput,
} from "./adapters/llm.js";
import { extractUnitPdfs } from "./layers/l0-extract.js";
import { parseSlides, parseExtractedSlides, SlidePage } from "./layers/l1-normalize.js";
import { handleUnitEvent } from "./orchestrator.js";
import { composeGuide } from "./layers/l4-artifacts.js";
import { exportSnapshots } from "./snapshot.js";
import { exportDocsSnapshots } from "./docs-snapshot.js";
import { nfc, slugOf, folderKeyOf, listUnits, resolveUnit, type UnitKey } from "./folders.js";
import {
  goldsetDir as resolveGoldsetDir,
  dbPath as resolveDbPath,
  extractedDir as resolveExtractedDir,
  outDir as resolveOutDir,
  usagePath as resolveUsagePath,
  appSlidesDir,
  appSnapshotsDir,
  exportFilePath,
  guideFilePath,
} from "./paths.js";

// 경로 결정은 env 우선, 없으면 개발 폴백 (paths.ts).
const DEFAULT_GOLDSET = resolveGoldsetDir();
const DEFAULT_DB = resolveDbPath();
const DEFAULT_EXTRACTED = resolveExtractedDir();
const DEFAULT_OUT = resolveOutDir();

/** 엔진별 모델 해석 — 명시 --model > env(AONE_CLAUDE_MODEL 등) > CLI 기본값(undefined).
 * 일반 사용자는 Opus 요금제가 아니므로 Claude 기본을 Sonnet으로 두는 게 접근성이 좋다. */
function resolveModel(opts: Map<string, string>, engineName: string): string | undefined {
  const explicit = opts.get("model");
  if (explicit && explicit !== "true") return explicit;
  if (engineName.startsWith("claude")) return process.env.AONE_CLAUDE_MODEL || undefined;
  if (engineName.startsWith("codex")) return process.env.AONE_CODEX_MODEL || undefined;
  if (engineName.startsWith("gemini")) return process.env.GEMINI_MODEL || undefined;
  return undefined;
}

function parseArgs(argv: string[]): { cmd: string; opts: Map<string, string> } {
  const [cmd, ...rest] = argv;
  const opts = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      const key = rest[i].slice(2);
      const val = i + 1 < rest.length && !rest[i + 1].startsWith("--") ? rest[++i] : "true";
      opts.set(key, val);
    }
  }
  return { cmd: cmd ?? "", opts };
}

/** --subject 필수 + --unit 또는 --all-units 로 분석 대상 unit 목록 해석 (NFC 정규화) */
function resolveTargetUnits(opts: Map<string, string>, goldsetDir: string): UnitKey[] {
  const subject = opts.get("subject");
  if (!subject || subject === "true") throw new Error("--subject 필요 (예: --subject 데이터통신)");
  if (opts.get("all-units") === "true") return listUnits(goldsetDir, nfc(subject));
  const unit = opts.get("unit");
  if (!unit || unit === "true") throw new Error("--unit 또는 --all-units 필요 (예: --unit 3주차)");
  return [resolveUnit(goldsetDir, nfc(subject), nfc(unit))];
}

async function cmdRun(opts: Map<string, string>): Promise<void> {
  const engineName = (opts.get("engine") ?? "stub") as EngineName;
  const tier = (opts.get("tier") ?? "standard") as Tier;
  const dbPath = opts.get("db") ?? DEFAULT_DB;
  const goldsetDir = opts.get("goldset") ?? DEFAULT_GOLDSET;
  // L0 PDF 추출: 기본 활성, --no-extract로 비활성 (extractedDir 미지정 → DAG에서 L0 제외)
  const extractedDir = opts.get("no-extract") === "true" ? undefined : DEFAULT_EXTRACTED;

  const units = resolveTargetUnits(opts, goldsetDir);

  // --concurrency 미지정 시 undefined를 넘겨 엔진별 기본값(codex=1, gemini=2, claude=4)을 쓰게 한다.
  // (예전엔 여기서 무조건 4로 고정해 codex의 낮은 기본값이 무시됐다 → codex 동시 세션 실패 원인)
  const concurrency = opts.has("concurrency") ? parseInt(opts.get("concurrency")!, 10) : undefined;
  const model = resolveModel(opts, engineName);
  const cfg = makeConfig({ tier, engine: engineName, goldsetDir, dbPath, outDir: DEFAULT_OUT, extractedDir });
  const engine = createEngine(engineName, { concurrency, model });
  const db = new AoneDb(dbPath);

  console.log(
    `Aone pipeline run — [${units.map((u) => folderKeyOf(u)).join(", ")}], engine=${engineName}, tier=${tier}, concurrency=${concurrency ?? "엔진기본"}` +
      (model ? `, model=${model}` : ""),
  );
  console.log(`goldset: ${goldsetDir}`);
  console.log(`db:      ${dbPath}\n`);

  try {
    for (const key of units) {
      const callsBefore = engine.usage?.calls ?? 0;
      await handleUnitEvent(db, engine, cfg, { kind: "unit_ingest", key });
      const unitCalls = (engine.usage?.calls ?? 0) - callsBefore;
      const c = db.countsForUnit(key);
      const proactive = db.proactiveAtUnit(key).length;
      console.log(
        `${folderKeyOf(key)}: 누적 개념 ${c.concepts} | 신호 ${c.signals} | 활동로그 ${c.activities} | 검증 통과 문항 ${c.questions} | 능동 제안 ${proactive}` +
          (engine.usage ? ` | 이번 unit LLM 호출 ${unitCalls}회` : ""),
      );
      if (engine.usage) {
        const u = engine.usage;
        console.log(
          `  [usage 누적] 호출 ${u.calls}회 | in ${u.inputTokens} + cacheW ${u.cacheCreationTokens} + cacheR ${u.cacheReadTokens} tok | out ${u.outputTokens} tok | $${u.costUsd.toFixed(4)}`,
        );
      }
    }
  } finally {
    db.close();
  }
  if (engine.usage) {
    const u = engine.usage;
    console.log(
      `\nLLM 총 사용량 — 호출 ${u.calls}회, input ${u.inputTokens} tok, cache 생성 ${u.cacheCreationTokens} tok, cache 읽기 ${u.cacheReadTokens} tok, output ${u.outputTokens} tok, 비용 $${u.costUsd.toFixed(4)}`,
    );
    recordUsageLog(engineName, units.map((k) => folderKeyOf(k)), u);
  }
  console.log("\n완료. 스냅샷 생성: npx tsx src/cli.ts export --out out");
}

/** 사용량 미터(앱 설정 화면)용 — 실행할 때마다 usage.json에 이력 누적 */
function recordUsageLog(engineName: string, folders: string[], u: EngineUsage): void {
  try {
    const usagePath = resolveUsagePath(); // 새 레이아웃=AONE_DATA/usage.json, 폴백=public/snapshots/usage.json
    type UsageLog = {
      totals: { calls: number; inputTokens: number; outputTokens: number; cacheTokens: number; costUsd: number };
      runs: {
        ts: string;
        engine: string;
        /** folderKey("{subject}/{unit}") 목록 — 구 이력 항목은 weeks: number[] */
        folders?: string[];
        weeks?: number[];
        calls: number;
        outputTokens: number;
        costUsd: number;
      }[];
    };
    const log: UsageLog = fs.existsSync(usagePath)
      ? (JSON.parse(fs.readFileSync(usagePath, "utf8")) as UsageLog)
      : { totals: { calls: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0 }, runs: [] };
    log.totals.calls += u.calls;
    log.totals.inputTokens += u.inputTokens;
    log.totals.outputTokens += u.outputTokens;
    log.totals.cacheTokens += u.cacheCreationTokens + u.cacheReadTokens;
    log.totals.costUsd = Number((log.totals.costUsd + u.costUsd).toFixed(4));
    log.runs.push({
      ts: new Date().toISOString(),
      engine: engineName,
      folders,
      calls: u.calls,
      outputTokens: u.outputTokens,
      costUsd: Number(u.costUsd.toFixed(4)),
    });
    if (log.runs.length > 50) log.runs = log.runs.slice(-50);
    fs.mkdirSync(path.dirname(usagePath), { recursive: true });
    fs.writeFileSync(usagePath, JSON.stringify(log, null, 2));
    console.log(`사용량 기록 → ${usagePath}`);
  } catch (e) {
    console.warn("사용량 기록 실패:", e);
  }
}

// ─────────────────────────────────────────────────────────────
// summarize-slides — doc 태그 하나의 페이지별 요약 카드 생성 → 앱 슬라이드 JSON에 병합
// ─────────────────────────────────────────────────────────────

/** 앱 public/slides/{slug}.json 항목 스키마 (기존 파일과 동일 형태) */
const AppSlideEntrySchema = z.object({
  slide_id: z.string().min(1),
  doc: z.string().min(1),
  page: z.number().int().positive(),
  title_ko: z.string().min(1),
  summary_ko: z.string().min(1),
  key_points_ko: z.array(z.string()),
  diagram_ko: z.string(),
  exam_tip: z.string(),
  lecture_ref: z.string(),
});
type AppSlideEntry = z.infer<typeof AppSlideEntrySchema>;

/**
 * doc 태그의 페이지별 텍스트 적재.
 * 우선순위: goldset unit 폴더의 `*_<tag>.txt`/`<tag>.txt` → (PDF면 L0 캐시, 없거나 낡았으면 즉석 추출) .extracted/{subject}/{unit}/<tag>.txt
 */
async function loadDocPages(goldsetDir: string, key: UnitKey, tag: string, extractedDir: string): Promise<SlidePage[]> {
  const unitDir = path.join(goldsetDir, key.subject, key.unit);
  if (fs.existsSync(unitDir)) {
    const goldTxt = fs
      .readdirSync(unitDir)
      .find((f) => nfc(f) === nfc(`${tag}.txt`) || nfc(f).endsWith(nfc(`_${tag}.txt`)));
    if (goldTxt) return parseSlides(fs.readFileSync(path.join(unitDir, goldTxt), "utf8"));
  }

  const cached = path.join(extractedDir, key.subject, key.unit, `${tag}.txt`);
  const hasExtractableDoc =
    fs.existsSync(unitDir) &&
    fs.readdirSync(unitDir).some((f) => {
      const m = nfc(f).match(/^(.*)\.(pdf|pptx)$/i);
      return m != null && m[1] === tag;
    });
  if (hasExtractableDoc) {
    // L0 즉석 추출 (mtime 동일하면 내부에서 스킵) — PDF·PPTX 모두
    await extractUnitPdfs(goldsetDir, key, extractedDir);
  }
  if (fs.existsSync(cached)) return parseExtractedSlides(fs.readFileSync(cached, "utf8"));

  throw new Error(
    `doc을 찾을 수 없음: ${folderKeyOf(key)} '${tag}' — ${path.join(unitDir, `*_${tag}.txt`)}, ${cached}, ${path.join(unitDir, `${tag}.pdf|.pptx`)} 모두 없음`,
  );
}

/** 원본 PDF 절대경로를 찾는다 (B안 첨부용). 없으면 null. */
function findDocPdf(goldsetDir: string, key: UnitKey, tag: string): string | null {
  const unitDir = path.join(goldsetDir, key.subject, key.unit);
  if (!fs.existsSync(unitDir)) return null;
  const pdf = fs
    .readdirSync(unitDir)
    .find((f) => nfc(f) === nfc(`${tag}.pdf`) || nfc(f).endsWith(nfc(`_${tag}.pdf`)));
  return pdf ? path.join(unitDir, pdf) : null;
}

async function cmdSummarizeSlides(opts: Map<string, string>): Promise<void> {
  const goldsetDir = opts.get("goldset") ?? DEFAULT_GOLDSET;
  const [key] = resolveTargetUnits(opts, goldsetDir);
  const rawTag = opts.get("doc");
  if (!rawTag || rawTag === "true") throw new Error("--doc 필요 (예: --doc theory_01 또는 업로드 PDF 원본명 기반 태그)");
  const tag = nfc(rawTag);
  const engineName = (opts.get("engine") ?? "stub") as EngineName;
  const model = resolveModel(opts, engineName);
  // --concurrency 미지정 시 엔진별 기본값(codex=1 등)을 쓰게 undefined 전달.
  const concurrency = opts.has("concurrency") ? parseInt(opts.get("concurrency")!, 10) : undefined;

  // B안: --attach-pdf (또는 env AONE_ATTACH_PDF=1) + vision 지원 엔진이면 원본 PDF를 첨부.
  // 실제 LLM을 쓰는 세 엔진 모두 PDF를 직접 본다 (codex는 exec -i). stub만 텍스트다.
  const wantPdf = opts.has("attach-pdf") || process.env.AONE_ATTACH_PDF === "1";
  const visionEngine =
    engineName === "claude-cli" || engineName === "gemini-api" || engineName === "codex-cli";
  const pdfPath = wantPdf && visionEngine ? findDocPdf(goldsetDir, key, tag) : null;

  const pages = await loadDocPages(goldsetDir, key, tag, DEFAULT_EXTRACTED);
  if (pages.length === 0) throw new Error(`${folderKeyOf(key)} '${tag}': 추출된 페이지가 없음`);

  const engine = createEngine(engineName, { concurrency, model });
  const PAGES_PER_CALL = 15;
  const chunks: SlidePage[][] = [];
  for (let i = 0; i < pages.length; i += PAGES_PER_CALL) chunks.push(pages.slice(i, i + PAGES_PER_CALL));
  console.log(
    `summarize-slides — ${folderKeyOf(key)} doc=${tag}: ${pages.length}페이지 → ${chunks.length}회 호출 (engine=${engineName}${model ? `, model=${model}` : ""}${pdfPath ? ", PDF첨부(그림·도식)" : ""})`,
  );

  const settled = await Promise.allSettled(
    chunks.map((chunk) => {
      const payload: ComposeSlideSummariesPayload = { subject: key.subject, unit: key.unit, tag, pages: chunk };
      const prompt = buildPrompt(
        "compose_slide_summaries",
        [
          `아래는 대학 '${key.subject}' 강의 ${key.unit} 슬라이드 문서(${tag})의 페이지별 추출 텍스트다.`,
          `각 페이지마다 학생용 복습 카드(한국어)를 만들어라. 입력의 모든 페이지를 누락 없이, 페이지 순서대로 출력하라.`,
          `- slide_id: 정확히 "${tag}_p<2자리 페이지번호>" 형식 (예: "${tag}_p01") — 입력의 page 번호 사용`,
          `- title_ko: 슬라이드 제목 (간결하게, 표지는 "표지: …" 형태 가능)`,
          `- summary_ko: 2~5문장 요약. 항목 나열은 "- " 목록 줄로, 문단 구분은 빈 줄로. 교수의 강의 톤(예: "~다", 구어 인용)을 살려라`,
          `- key_points_ko: 핵심 포인트 3~6개 (짧은 명사구/문장)`,
          pdfPath
            ? `- diagram_ko: 첨부된 PDF 원본을 보고 그림·다이어그램·그래프·표의 내용을 구체적으로 1~2문장 설명(무엇을 나타내는 도식인지). 없으면 빈 문자열 ""`
            : `- diagram_ko: 페이지에 그림·다이어그램·코드 화면이 있으면 1문장 설명, 없으면 빈 문자열 ""`,
          `- exam_tip: 텍스트에 실제 시험 단서(시험/출제/중요/암기/반드시 등)가 있을 때만 채우고, 없으면 빈 문자열 "" (지어내지 말 것)`,
          `- lecture_ref: 근거를 특정할 수 없으면 빈 문자열 "" (녹음본 타임스탬프를 지어내지 말 것)`,
        ].join("\n"),
        payload,
        `{"slides":[{"slide_id":"${tag}_p01","title_ko":"...","summary_ko":"...","key_points_ko":["..."],"diagram_ko":"","exam_tip":"","lecture_ref":""}]}`,
      );
      return engine.call({
        task: "compose_slide_summaries",
        prompt: pdfPath
          ? `${prompt}\n\n첨부된 PDF 원본 파일이 있다. 텍스트만으로 부족한 그림·도식·그래프·표는 PDF를 직접 보고 반영하라.`
          : prompt,
        payload,
        schema: ComposeSlideSummariesOutput,
        ...(pdfPath ? { pdfPath } : {}),
      });
    }),
  );

  // slide_id → 앱 항목 변환 (doc/page 부여, 원본 페이지 순서 유지)
  // macOS 한글 파일명은 NFD, LLM 응답은 NFC — 정규화해서 매칭하고 저장 ID는 입력 tag 기준으로 재조립
  const validIds = new Map(
    pages.map((p) => [`${tag}_p${String(p.page).padStart(2, "0")}`.normalize("NFC"), p.page]),
  );
  // allSettled: 일부 청크가 실패해도 성공한 청크의 슬라이드는 살린다.
  const results = settled.flatMap((s, i) => {
    if (s.status === "rejected") {
      const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      console.warn(`  경고: 슬라이드 요약 청크 ${i + 1}/${chunks.length} 실패 — 건너뜁니다 (${msg.slice(0, 160)}).`);
      return [];
    }
    return [s.value];
  });
  const entries: AppSlideEntry[] = [];
  for (const r of results) {
    for (const s of r.slides ?? []) {
      const page = validIds.get(s.slide_id.normalize("NFC"));
      if (page === undefined) {
        console.warn(`  경고: 입력에 없는 slide_id 무시 — ${s.slide_id}`);
        continue;
      }
      entries.push({
        slide_id: `${tag}_p${String(page).padStart(2, "0")}`,
        doc: tag,
        page,
        title_ko: s.title_ko,
        summary_ko: s.summary_ko,
        key_points_ko: s.key_points_ko,
        diagram_ko: s.diagram_ko ?? "",
        exam_tip: s.exam_tip ?? "",
        lecture_ref: s.lecture_ref ?? "",
      });
    }
  }
  entries.sort((a, b) => a.page - b.page);
  if (entries.length < pages.length) {
    console.warn(`  경고: ${pages.length}페이지 중 ${entries.length}개만 생성됨 (누락 페이지 존재)`);
  }

  // 앱 슬라이드 JSON 병합: 같은 slide_id 교체, 다른 doc 항목 보존
  // 새 레이아웃=AONE_ROOT/<과목>/<폴더>/.aone/slides.json, 폴백=public/slides/{slug}.json
  const outFile = exportFilePath("slides", key, appSlidesDir());
  // 기존 파일이 손상됐어도(JSON 파싱 실패 등) 이번에 생성한 카드를 잃지 않도록 빈 배열로 폴백.
  let existing: AppSlideEntry[] = [];
  if (fs.existsSync(outFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(outFile, "utf8")) as AppSlideEntry[];
    } catch (e) {
      console.warn(`  경고: 기존 슬라이드 파일이 손상돼 무시하고 새로 작성합니다 (${outFile}):`, e);
    }
  }
  const newIds = new Set(entries.map((e) => e.slide_id));
  const merged = [...existing.filter((e) => !newIds.has(e.slide_id)), ...entries];
  merged.sort((a, b) => (a.doc === b.doc ? a.page - b.page : a.doc.localeCompare(b.doc)));
  z.array(AppSlideEntrySchema).parse(merged); // 스키마 자검증 (기존 파일 형태와 동일)

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 1));
  console.log(
    `병합 완료 → ${outFile} (신규/교체 ${entries.length}개, 보존 ${merged.length - entries.length}개, 총 ${merged.length}개 항목)`,
  );

  if (engine.usage) recordUsageLog(engineName, [folderKeyOf(key)], engine.usage);
}

// ─────────────────────────────────────────────────────────────
// recognize-timetable — 시간표 캡처 이미지 → 계약 JSON (부록 A2)
// stdout 마지막 줄에 {"lectures":[…],"untimed":[…]} 만 출력한다 (Rust가 파싱).
// ─────────────────────────────────────────────────────────────

const TIMETABLE_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg"]);

async function cmdRecognizeTimetable(opts: Map<string, string>): Promise<void> {
  const image = opts.get("image");
  if (!image || image === "true") throw new Error("--image <절대경로> 필요");
  const imagePath = path.resolve(image);
  if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
    throw new Error(`이미지 파일 없음: ${imagePath}`);
  }
  const ext = path.extname(imagePath).toLowerCase();
  if (!TIMETABLE_IMAGE_EXTS.has(ext)) {
    throw new Error(`지원하지 않는 이미지 형식: ${ext} (png/jpg/jpeg만)`);
  }
  const engineName = opts.get("engine") ?? "claude-cli";
  if (engineName !== "claude-cli" && engineName !== "gemini-api") {
    throw new Error(`recognize-timetable 지원 엔진: claude-cli | gemini-api (받음: ${engineName})`);
  }

  const schemaHint =
    '{"lectures":[{"subject":"과목명","weekday":"월|화|수|목|금","start":"HH:MM","end":"HH:MM","room":"강의실"}],"untimed":["시간 미지정 과목명"]}';
  const instructions = [
    "대학 시간표(에브리타임 등) 캡처 이미지에서 강의 목록을 추출하라.",
    "- weekday는 월/화/수/목/금 중 하나 (토/일 강의는 무시).",
    '- start/end는 24시간 "HH:MM" (예: "09:00", "13:30"). 격자 눈금과 블록 경계를 정확히 읽어라.',
    "- 같은 과목이 여러 요일·시간에 있으면 각각 별도 항목으로.",
    '- 강의실이 안 보이면 room은 빈 문자열 "".',
    '- 시간 격자 밖에 이름만 나열된 과목(온라인 강의 등)은 untimed 배열에 과목명만 넣어라.',
    "",
    "다음 JSON 형태로만 응답하라 (설명 텍스트·코드펜스 금지):",
    schemaHint,
  ].join("\n");
  const prompt =
    engineName === "claude-cli"
      ? `Read 도구로 이 이미지 파일을 읽어라: ${imagePath}\n\n${instructions}`
      : instructions;

  // claude-cli: -p 모드에서 이미지 Read를 허용 (이미지 폴더 --add-dir + Read 화이트리스트)
  const engine = createEngine(engineName, {
    concurrency: 1,
    model: resolveModel(opts, engineName),
    extraCliArgs:
      engineName === "claude-cli" ? ["--add-dir", path.dirname(imagePath), "--allowedTools", "Read"] : undefined,
  });

  const out = await engine.call({
    task: "recognize_timetable",
    prompt,
    payload: { imagePath },
    schema: TimetableOutput,
    imagePath: engineName === "gemini-api" ? imagePath : undefined,
  });
  console.log(JSON.stringify(out));
}

// ─────────────────────────────────────────────────────────────
// compose-guide — 시험대비 학습 가이드(과목/범위) 1회 생성 → guide.json export
//   새 레이아웃: AONE_ROOT/<과목>/.aone/guide.json
//   폴백:        public/snapshots/guide_<과목slug>.json
// ─────────────────────────────────────────────────────────────

/** compose-guide 산출물 JSON 스키마 (앱 소비용) */
const GuideSnapshotSchema = z.object({
  subject: z.string().min(1),
  scope: z.string().min(1),
  units: z.array(z.string()),
  generatedAt: z.string(),
  concepts: z.number().int(),
  pastExams: z.number().int(),
  markdown: z.string().min(1),
});

async function cmdComposeGuide(opts: Map<string, string>): Promise<void> {
  const rawSubject = opts.get("subject");
  if (!rawSubject || rawSubject === "true") throw new Error("--subject 필요 (예: --subject 데이터통신)");
  const subject = nfc(rawSubject);
  const unitsOpt = opts.get("units");
  const units =
    unitsOpt && unitsOpt !== "true"
      ? unitsOpt.split(",").map((u) => nfc(u.trim())).filter((u) => u.length > 0)
      : undefined;
  const engineName = (opts.get("engine") ?? "stub") as EngineName;
  const model = resolveModel(opts, engineName);
  const dbPath = opts.get("db") ?? DEFAULT_DB;
  if (!fs.existsSync(dbPath)) throw new Error(`DB 없음: ${dbPath} — 먼저 run을 실행하세요`);

  const engine = createEngine(engineName, { concurrency: 1, model });
  const db = new AoneDb(dbPath);
  try {
    console.log(
      `compose-guide — ${subject} (범위: ${units ? units.join(", ") : "전체"}), engine=${engineName}${model ? `, model=${model}` : ""}`,
    );
    const r = await composeGuide(db, engine, subject, units);

    const snapshot = GuideSnapshotSchema.parse({
      subject,
      scope: units ? units.join(", ") : "전체",
      units: units ?? db.unitsWithScores(subject).map((u) => u.unit),
      generatedAt: new Date().toISOString(),
      concepts: r.concepts,
      pastExams: r.pastExams,
      markdown: r.markdown,
    });

    const outFile = guideFilePath(subject, appSnapshotsDir());
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    console.log(
      `학습 가이드 생성 → ${outFile} (개념 ${r.concepts}개, 기출 ${r.pastExams}건, 마크다운 ${r.markdownChars}자, zod 통과)`,
    );
  } finally {
    db.close();
  }
  if (engine.usage) recordUsageLog(engineName, [subject], engine.usage);
}

function cmdExport(opts: Map<string, string>): void {
  const dbPath = opts.get("db") ?? DEFAULT_DB;
  const outDir = opts.get("out") ?? DEFAULT_OUT;
  const subjectOpt = opts.get("subject");
  const unitOpt = opts.get("unit");
  const filter = {
    subject: subjectOpt && subjectOpt !== "true" ? nfc(subjectOpt) : undefined,
    unit: unitOpt && unitOpt !== "true" ? nfc(unitOpt) : undefined,
  };
  if (!fs.existsSync(dbPath)) throw new Error(`DB 없음: ${dbPath} — 먼저 run을 실행하세요`);
  const db = new AoneDb(dbPath);
  try {
    const written = exportSnapshots(db, outDir, filter);
    for (const w of written) console.log(`${slugOf(w.key)} → ${w.file}`);
    const docs = exportDocsSnapshots(db, outDir, filter);
    for (const d of docs) console.log(`docs_${slugOf(d.key)} → ${d.file}`);
    console.log(`\n${written.length}개 스냅샷 + ${docs.length}개 문서 상세 export 완료 (zod 스키마 자검증 통과)`);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case "run":
      await cmdRun(opts);
      break;
    case "export":
      cmdExport(opts);
      break;
    case "compose-guide":
      await cmdComposeGuide(opts);
      break;
    case "summarize-slides":
      await cmdSummarizeSlides(opts);
      break;
    case "recognize-timetable":
      await cmdRecognizeTimetable(opts);
      break;
    default:
      console.log(
        [
          "사용법:",
          "  npx tsx src/cli.ts run --subject <과목> --unit <수업폴더> [--engine stub] [--tier standard|deep] [--model <name>] [--goldset <dir>] [--db <file>] [--no-extract]",
          "  npx tsx src/cli.ts run --subject <과목> --all-units [--engine …]",
          "  npx tsx src/cli.ts export [--subject <과목>] [--unit <수업폴더>] --out <dir> [--db <file>]",
          "  npx tsx src/cli.ts compose-guide --subject <과목> [--units 1주차,2주차] [--engine stub] [--model <m>] [--db <file>]",
          "  npx tsx src/cli.ts summarize-slides --subject <과목> --unit <수업폴더> --doc <tag> [--engine claude-cli] [--model <m>] [--concurrency 2] [--goldset <dir>]",
          "  npx tsx src/cli.ts recognize-timetable --image <절대경로> [--engine claude-cli|gemini-api] [--model <m>]",
        ].join("\n"),
      );
      process.exitCode = cmd === "" ? 0 : 1;
  }
}

main().catch((err) => {
  console.error("오류:", err instanceof Error ? err.message : err);
  process.exit(1);
});
