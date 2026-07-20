import type { Metadata } from "next";
import "./globals.css";
import Vibrancy from "./vibrancy";

export const metadata: Metadata = {
  title: "Aone",
  description: "대학생 학습 에이전트",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <Vibrancy />
        <div className="tauri-drag-strip" data-tauri-drag-region aria-hidden />
        <div className="liquid-bg-container" aria-hidden>
          <div className="liquid-blob"></div>
          <div className="liquid-blob"></div>
          <div className="liquid-blob"></div>
          <div className="liquid-blob"></div>
        </div>
        {children}
      </body>
    </html>
  );
}
