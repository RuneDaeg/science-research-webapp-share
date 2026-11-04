import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "과학과제연구 탐구 도우미";
const DESCRIPTION =
  "과학과제연구 산출물을 올리면 AI 탐구 조력자가 넛지 피드백을 주고, 선생님이 이어서 지도하는 도구";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    locale: "ko_KR",
    siteName: TITLE,
  },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
  robots: { index: false, follow: false }, // 학교 내부용 — 검색엔진 노출 방지
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
