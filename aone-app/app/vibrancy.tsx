"use client";

import { useEffect } from "react";

/** Tauri 창에서만 body에 vibrancy 클래스를 붙여
 *  네이티브 반투명(바탕화면 블러) 위에 앉는 스타일로 전환한다. */
export default function Vibrancy() {
  useEffect(() => {
    const isTauri =
      typeof window !== "undefined" &&
      "__TAURI_INTERNALS__" in window;
    if (!isTauri) return;
    document.body.classList.add("tauri-vibrancy");

    // Tauri 창엔 브라우저 새로고침 단축키가 없으므로 Cmd+R을 직접 배선
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        location.reload();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
