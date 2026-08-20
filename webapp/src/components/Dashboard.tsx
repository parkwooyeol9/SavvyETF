"use client";

import { useCallback, useEffect, useState } from "react";

import AiGovTab from "@/components/AiGovTab";
import AiInfraTab from "@/components/AiInfraTab";
import EsgRegTab from "@/components/EsgRegTab";
import GreenMineralsTab from "@/components/GreenMineralsTab";
import MainTab from "@/components/MainTab";
import EducationTab from "@/components/EducationTab";
import EventStudyTab from "@/components/EventStudyTab";
import BriefSlotView from "@/components/BriefSlotView";
import EsgTabShell from "@/components/EsgTabShell";
import EsgThemesTab from "@/components/EsgThemesTab";
import EtfDbTab from "@/components/EtfDbTab";
import EtfDbUsTab from "@/components/EtfDbUsTab";
import EtfKor15Tab from "@/components/EtfKor15Tab";
import EtfNewTab from "@/components/EtfNewTab";
import EtfWeightMonitorTab from "@/components/EtfWeightMonitorTab";
import KosdaqActiveTab from "@/components/KosdaqActiveTab";
import CountryEtfTab from "@/components/CountryEtfTab";
import GeoTab from "@/components/GeoTab";
import KrMarketTab from "@/components/KrMarketTab";
import LeverageEtfTab from "@/components/LeverageEtfTab";
import MacroTab from "@/components/MacroTab";
import YenCarryTab from "@/components/YenCarryTab";
import CftcTab from "@/components/CftcTab";
import PreciousMetalsTab from "@/components/PreciousMetalsTab";
import CryptoAssetsTab from "@/components/CryptoAssetsTab";
import VolatilityMonitorTab from "@/components/VolatilityMonitorTab";
import DerivativesTab from "@/components/DerivativesTab";
import TradingIdeasTab from "@/components/TradingIdeasTab";
import WallStreetGurusTab from "@/components/WallStreetGurusTab";
import TradingSignalsTab from "@/components/TradingSignalsTab";
import Kosdaq100Tab from "@/components/Kosdaq100Tab";
import MoneyFlowTab from "@/components/MoneyFlowTab";
import SimulateTab from "@/components/SimulateTab";
import UsPortfolioTab from "@/components/UsPortfolioTab";
import AiPortTab from "@/components/AiPortTab";
import CorridorTab from "@/components/CorridorTab";
import UsMarketTab from "@/components/UsMarketTab";
import UsMidtermTab from "@/components/UsMidtermTab";
import { formatBriefWhen } from "@/lib/briefUtils";
import {
  type AllBriefs,
  type BriefSlot,
  type NavGroupId,
  type ShellTabId,
  NAV_GROUPS,
  SHELL_TAB_LABELS,
  TAB_LABELS,
  TAB_SLOT_HIDDEN,
  TAB_SLOT_ORDER,
  emptyAllBriefs,
  isBriefTabId,
  isShellTabId,
  navGroupForTab,
  type TabId,
} from "@/lib/types";

type BriefsResponse = {
  ok: boolean;
  configured?: boolean;
  briefs?: AllBriefs;
  error?: string;
  warning?: string;
  source?: string;
};

function orderedSlots(tab: TabId, slots: Record<string, BriefSlot>): BriefSlot[] {
  const order = TAB_SLOT_ORDER[tab];
  const hidden = new Set(TAB_SLOT_HIDDEN[tab] || []);
  const seen = new Set<string>();
  const out: BriefSlot[] = [];
  for (const key of order) {
    if (hidden.has(key)) continue;
    if (slots[key]) {
      out.push(slots[key]);
      seen.add(key);
    }
  }
  const rest = Object.keys(slots)
    .filter((k) => !seen.has(k) && !hidden.has(k))
    .sort()
    .map((k) => slots[k]);
  return [...out, ...rest];
}

function formatWhen(value?: string | null): string {
  return formatBriefWhen(value);
}

function BriefSlotsPanel({
  title,
  note,
  emptyText,
  slots,
}: {
  title: string;
  note?: string;
  emptyText: string;
  slots: BriefSlot[];
}) {
  return (
    <section className="panel kr-briefs">
      <h2 className="kr-briefs-title">{title}</h2>
      {note ? <p className="kr-note">{note}</p> : null}
      {!slots.length ? (
        <p className="empty">{emptyText}</p>
      ) : (
        slots.map((slot) => <BriefSlotView key={slot.slot} slot={slot} />)
      )}
    </section>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState<ShellTabId>("main");
  const [briefs, setBriefs] = useState<AllBriefs>(emptyAllBriefs());
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const groupId: NavGroupId = navGroupForTab(tab);
  const activeGroup = NAV_GROUPS.find((g) => g.id === groupId) || NAV_GROUPS[0];
  const showSubNav = activeGroup.tabs.length > 1 || activeGroup.id === "politics";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/briefs");
      const data = (await res.json()) as BriefsResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setBriefs(data.briefs || emptyAllBriefs());
      setConfigured(Boolean(data.configured));
      setWarning(data.warning || null);
      setError(null);
      setFetchedAt(new Date().toISOString());
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    void load();
    // Poll every 3 minutes while the tab is visible (was 60s) to cut origin transfer.
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void load();
    }, 180_000);
    const onFocus = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const onNav = (e: Event) => {
      const detail = (e as CustomEvent<ShellTabId | { tab?: string }>).detail;
      const next =
        typeof detail === "string"
          ? detail
          : detail && typeof detail === "object"
            ? detail.tab
            : undefined;
      if (next && isShellTabId(next)) setTab(next);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("savvyetf-nav-tab", onNav);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("savvyetf-nav-tab", onNav);
    };
  }, [load]);

  const briefTab = isBriefTabId(tab) ? tab : null;
  const current = briefTab ? briefs[briefTab] : null;
  const slots = briefTab ? orderedSlots(briefTab, current?.slots || {}) : [];
  const esgSlots = orderedSlots("esg", briefs.esg?.slots || {});

  const metaText = (() => {
    if (
      tab === "main" ||
      tab === "simulate" ||
      tab === "usportfolio" ||
      tab === "education" ||
      tab === "geo" ||
      tab === "aigov" ||
      tab === "aiinfra" ||
      tab === "esgreg" ||
      tab === "greenmin" ||
      tab === "esg" ||
      tab === "economy" ||
      tab === "yencarry" ||
      tab === "cftc" ||
      tab === "metals" ||
      tab === "crypto" ||
      tab === "volmonitor" ||
      tab === "derivatives" ||
      tab === "ideas" ||
      tab === "gurus" ||
      tab === "signals" ||
      tab === "eventstudy" ||
      tab === "kosdaq100" ||
      tab === "moneyflow" ||
      tab === "etfdb" ||
      tab === "etfdbus" ||
      tab === "leverage" ||
      tab === "etfweights" ||
      tab === "kosdaqactive" ||
      tab === "countryetf" ||
      tab === "etf" ||
      tab === "aiport" ||
      tab === "corridor" ||
      tab === "usmidterm"
    ) {
      return error
        ? `시황 동기화 참고: ${error}`
        : warning
          ? warning
          : `시황 갱신 ${formatWhen(fetchedAt)}`;
    }
    if (error) return `동기화 오류: ${error}`;
    if (warning) return warning;
    if (configured === false) {
      return "원격 스토어 미설정 — R2 또는 봇 로컬 publish 후 표시됩니다";
    }
    return `갱신 ${formatWhen(fetchedAt)} · 탭 ${formatWhen(current?.updated_at)}`;
  })();

  function selectGroup(nextGroup: NavGroupId) {
    const group = NAV_GROUPS.find((g) => g.id === nextGroup);
    if (!group) return;
    if (group.tabs.includes(tab)) return;
    setTab(group.tabs[0]);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-dot" aria-hidden />
          SavvyETF
        </a>
        <div className="meta-line">
          <span
            className={`status-dot ${error ? "err" : configured ? "ok" : ""}`}
            aria-hidden
          />
          {metaText}
        </div>
      </header>

      <nav className="tabs tabs-primary" aria-label="대시보드 대분류">
        {NAV_GROUPS.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`tab-btn ${groupId === group.id ? "active" : ""}`}
            onClick={() => selectGroup(group.id)}
          >
            {group.label}
          </button>
        ))}
      </nav>

      {showSubNav ? (
        <nav className="tabs tabs-secondary" aria-label={`${activeGroup.label} 하위 탭`}>
          {activeGroup.tabs.map((id) => (
            <button
              key={id}
              type="button"
              className={`tab-btn sub ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {SHELL_TAB_LABELS[id]}
            </button>
          ))}
        </nav>
      ) : null}

      {tab === "main" ? (
        <MainTab />
      ) : tab === "simulate" ? (
        <SimulateTab />
      ) : tab === "usportfolio" ? (
        <UsPortfolioTab />
      ) : tab === "signals" ? (
        <TradingSignalsTab />
      ) : tab === "ideas" ? (
        <TradingIdeasTab />
      ) : tab === "aiport" ? (
        <AiPortTab />
      ) : tab === "corridor" ? (
        <CorridorTab />
      ) : tab === "usmidterm" ? (
        <UsMidtermTab />
      ) : tab === "education" ? (
        <EducationTab />
      ) : tab === "etfdb" ? (
        <EtfDbTab />
      ) : tab === "etfdbus" ? (
        <EtfDbUsTab />
      ) : tab === "etfweights" ? (
        <EtfWeightMonitorTab />
      ) : tab === "kosdaqactive" ? (
        <KosdaqActiveTab />
      ) : tab === "countryetf" ? (
        <CountryEtfTab />
      ) : tab === "leverage" ? (
        <LeverageEtfTab />
      ) : tab === "geo" ? (
        <EsgTabShell tab="geo" allSlots={esgSlots}>
          <GeoTab />
        </EsgTabShell>
      ) : tab === "aigov" ? (
        <EsgTabShell tab="aigov" allSlots={esgSlots}>
          <AiGovTab />
        </EsgTabShell>
      ) : tab === "aiinfra" ? (
        <EsgTabShell tab="aiinfra" allSlots={esgSlots}>
          <AiInfraTab />
        </EsgTabShell>
      ) : tab === "esgreg" ? (
        <EsgTabShell tab="esgreg" allSlots={esgSlots}>
          <EsgRegTab />
        </EsgTabShell>
      ) : tab === "greenmin" ? (
        <EsgTabShell tab="greenmin" allSlots={esgSlots}>
          <GreenMineralsTab />
        </EsgTabShell>
      ) : tab === "economy" ? (
        <MacroTab />
      ) : tab === "yencarry" ? (
        <YenCarryTab />
      ) : tab === "cftc" ? (
        <CftcTab />
      ) : tab === "metals" ? (
        <PreciousMetalsTab />
      ) : tab === "crypto" ? (
        <CryptoAssetsTab />
      ) : tab === "volmonitor" ? (
        <VolatilityMonitorTab />
      ) : tab === "derivatives" ? (
        <DerivativesTab />
      ) : tab === "gurus" ? (
        <WallStreetGurusTab />
      ) : tab === "eventstudy" ? (
        <EventStudyTab />
      ) : tab === "kosdaq100" ? (
        <Kosdaq100Tab />
      ) : tab === "moneyflow" ? (
        <MoneyFlowTab />
      ) : tab === "kr" ? (
        <>
          <KrMarketTab variant="market" />
          <BriefSlotsPanel
            title="시황 브리프"
            emptyText="국내 브리프 스냅샷이 아직 없습니다. 텔레그램 봇 스케줄 또는 수동 명령 후 자동으로 채워집니다."
            slots={slots}
          />
        </>
      ) : tab === "us" ? (
        <>
          <UsMarketTab />
          <BriefSlotsPanel
            title="시황 브리프"
            emptyText="미국 브리프 스냅샷이 아직 없습니다. 텔레그램 봇 스케줄 또는 수동 명령 후 자동으로 채워집니다."
            slots={slots}
          />
        </>
      ) : tab === "esg" ? (
        <EsgTabShell tab="esg" allSlots={esgSlots}>
          <EsgThemesTab />
        </EsgTabShell>
      ) : tab === "etf" ? (
        <>
          <EtfKor15Tab />
          <EtfNewTab initialDelayMs={2000} />
          <BriefSlotsPanel
            title="ETF 시황 브리프"
            note="라이브: KOR15(편입비/편입액) · 신규상장. 아래 슬롯: /etf_kor15 · /etfcheck · /etf_us_new · /etf_sector · etf_memb."
            emptyText="ETF 브리프 스냅샷이 아직 없습니다. 텔레그램 봇 스케줄 또는 수동 명령 후 자동으로 채워집니다."
            slots={slots}
          />
        </>
      ) : briefTab ? (
        <section className="panel">
          {!slots.length ? (
            <p className="empty">
              {TAB_LABELS[briefTab]} 스냅샷이 아직 없습니다. 텔레그램 봇 스케줄 또는
              수동 명령 후 자동으로 채워집니다.
            </p>
          ) : (
            slots.map((slot) => <BriefSlotView key={slot.slot} slot={slot} />)
          )}
        </section>
      ) : (
        <section className="panel">
          <p className="empty">
            이 탭({SHELL_TAB_LABELS[tab]})은 아직 연결되지 않았습니다. 기존 탭은
            그대로 유지됩니다.
          </p>
        </section>
      )}
    </div>
  );
}
