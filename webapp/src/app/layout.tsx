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
  title: "SavvyETF — ETF dashboard",
  description:
    "ETF 히트맵·배분·한국 투자자 세금/환율 교육과 국내·미국·ETF·ESG 시황을 한곳에서 확인합니다.",
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
