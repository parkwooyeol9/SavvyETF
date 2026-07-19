import type { Metadata } from "next";
import { DM_Sans, Instrument_Serif } from "next/font/google";

import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SavvyETF — Market briefs",
  description:
    "국내·미국·ETF·ESG 시황 대시보드. Telegram bot 스케줄 결과를 실시간으로 표시합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${dmSans.variable} ${instrument.variable}`}>
        <div className="mesh" aria-hidden />
        {children}
      </body>
    </html>
  );
}
