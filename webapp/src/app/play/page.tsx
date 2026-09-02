import type { Metadata } from "next";

import Dashboard from "@/components/Dashboard";

export const metadata: Metadata = {
  title: "모의투자 — SavvyETF",
  description:
    "원금 1억, 이름 없는 캔들 다섯 장. 레버리지 −200%~+200%로 사고 팔아 랭킹에 도전하세요.",
};

export default function PlayPage() {
  return <Dashboard initialTab="heatpick" />;
}
