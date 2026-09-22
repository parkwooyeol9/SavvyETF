"use client";

import { useCallback, useEffect, useState } from "react";

import MainTab from "@/components/MainTab";
import BriefSlotView from "@/components/BriefSlotView";
import EsgTabShell from "@/components/EsgTabShell";
import {
  InfraTab,
  EsgRegTab,
  GreenMineralsTab,
  BookClubTab,
  EducationTab,
  ResearchTab,
  CardNewsTab,
  ChartTradeTab,
  EventStudyTab,
  EsgThemesTab,
  EtfHoldingsTab,
  EtfKor15Tab,
  EtfNewTab,
  EtfSupplyPanel,
  EtfWeightMonitorTab,
  KosdaqActiveTab,
  CountryEtfTab,
  GeoTab,
  KrMarketTab,
  LeverageEtfTab,
  MacroTab,
  YenCarryTab,
  CftcTab,
  PreciousMetalsTab,
  CryptoAssetsTab,
  VolatilityMonitorTab,
  DerivativesTab,
  MarketGammaTab,
  QuantTab,
  TradingIdeasTab,
  WeightOptimizeTab,
  NlpPulseTab,
  GraphTab,
  WallStreetGurusTab,
  TradingSignalsTab,
  MoneyFlowTab,
  SimulateTab,
  UsPortfolioTab,
  AiPortTab,
  MinuteForecastTab,
  CorridorTab,
  UsMarketTab,
  UsMidtermTab,
  MidtermStudyTab,
  PoliThemesTab,
  ThemeEtfTab,
  AiEtfTab,
  EtfDbTab,
  EtfDbUsTab,
  DataCatalogTab,
} from "@/components/lazyTabs";
import {
  AdminLoginControl,
  AdminSessionProvider,
  useAdminSession,
} from "@/components/AdminSession";
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
  isAdminOnlyTab,
  isBriefTabId,
  isShellTabId,
  navPlacement,
  canonicalShellTab,
  parseShellTab,
  visibleShellTabs,
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

export default function Dashboard({
  initialTab = "main",
}: {
  initialTab?: ShellTabId;
}) {
  return (
    <AdminSessionProvider>
      <DashboardInner initialTab={initialTab} />
    </AdminSessionProvider>
  );
}

function DashboardInner({
  initialTab = "main",
}: {
  initialTab?: ShellTabId;
}) {
  const [tab, setTab] = useState<ShellTabId>(() => canonicalShellTab(initialTab));
  const [briefs, setBriefs] = useState<AllBriefs>(emptyAllBriefs());
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const { unlocked, ready } = useAdminSession();

  const { groupId, nestedId } = navPlacement(tab);
  const activeGroup = NAV_GROUPS.find((g) => g.id === groupId) || NAV_GROUPS[0];
  const activeNested =
    activeGroup.nested?.find((item) => item.id === nestedId) || null;
  const visibleGroupTabs = visibleShellTabs(activeGroup.tabs, unlocked);
  const visibleNestedTabs = activeNested
    ? visibleShellTabs(activeNested.tabs, unlocked)
    : [];
  const showSubNav =
    visibleGroupTabs.length + (activeGroup.nested?.length || 0) > 1;
  const showTertiary = Boolean(activeNested && visibleNestedTabs.length > 1);

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
    if (tab === "kosdaq100") setTab("kosdaqactive");
    if (tab === "aigov" || tab === "aiinfra") setTab("infra");
    if (tab === "round") setTab("heatpick");
    if (tab === "derivedu") setTab("derivatives");
    if (tab === "bookclubboard") setTab("bookclub");
  }, [tab]);

  useEffect(() => {
    if (!ready) return;
    if (!isAdminOnlyTab(tab) || unlocked) return;
    // AI포트 stays next to AI Pick; 나머지는 같은 대분류의 첫 공개 탭으로.
    if (tab === "aiport" || tab === "minutepred") {
      setTab("ideas");
      return;
    }
    if (tab === "datacatalog") {
      setTab("etfdb");
      return;
    }
    const group = NAV_GROUPS.find((g) => g.id === navPlacement(tab).groupId);
    setTab(
      (group ? visibleShellTabs(group.tabs, false)[0] : undefined) || "main",
    );
  }, [tab, unlocked, ready]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    if (tab === "heatpick") {
      if (path !== "/play") window.history.replaceState(null, "", "/play");
      return;
    }
    const prev = new URLSearchParams(window.location.search);
    const nextParams = new URLSearchParams();
    if (tab !== "main") nextParams.set("tab", tab);
    if (tab === "nlp" || tab === "nlphistory") {
      const code = prev.get("code");
      if (code && /^\d{6}$/.test(code)) nextParams.set("code", code);
    }
    if (tab === "midtermstudy") {
      const sc = prev.get("scenario");
      const g = prev.get("grouping");
      if (sc) nextParams.set("scenario", sc);
      if (g) nextParams.set("grouping", g);
    }
    const qs = nextParams.toString();
    const next = qs ? `/?${qs}` : "/";
    const current = `${path}${window.location.search}`;
    if (current !== next) window.history.replaceState(null, "", next);
  }, [tab]);

  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname === "/play") {
        setTab("heatpick");
        return;
      }
      const next = parseShellTab(new URLSearchParams(window.location.search).get("tab")) || "main";
      setTab(canonicalShellTab(next));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
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
      const detail = (
        e as CustomEvent<ShellTabId | { tab?: string; scenario?: string; grouping?: string }>
      ).detail;
      const extra = typeof detail === "object" && detail ? detail : null;
      const raw =
        typeof detail === "string"
          ? detail
          : extra
            ? extra.tab
            : undefined;
      const next =
        raw === "ripple" || raw === "chain"
          ? "graph"
          : raw === "kosdaq100"
            ? "kosdaqactive"
            : raw === "aigov" || raw === "aiinfra"
              ? "infra"
              : raw === "round"
                ? "heatpick"
                : raw === "derivedu"
                  ? "derivatives"
                  : raw === "bookclubboard"
                    ? "bookclub"
                    : raw;
      if (next && isShellTabId(next)) {
        if (isAdminOnlyTab(next) && !unlocked) return;
        if (next === "midtermstudy" && extra && (extra.scenario || extra.grouping)) {
          const params = new URLSearchParams();
          params.set("tab", "midtermstudy");
          if (extra.scenario) params.set("scenario", extra.scenario);
          if (extra.grouping) params.set("grouping", extra.grouping);
          window.history.replaceState(null, "", `/?${params.toString()}`);
        }
        setTab(next);
      }
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
  }, [load, unlocked]);

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
      tab === "research" ||
      tab === "heatpick" ||
      tab === "cardnews" ||
      tab === "derivedu" ||
      tab === "geo" ||
      tab === "infra" ||
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
      tab === "gamma" ||
      tab === "quant" ||
      tab === "ideas" ||
      tab === "weightopt" ||
      tab === "gurus" ||
      tab === "signals" ||
      tab === "eventstudy" ||
      tab === "moneyflow" ||
      tab === "etfdb" ||
      tab === "etfdbus" ||
      tab === "datacatalog" ||
      tab === "aietf" ||
      tab === "leverage" ||
      tab === "etfweights" ||
      tab === "etfholdings" ||
      tab === "kosdaqactive" ||
      tab === "countryetf" ||
      tab === "etf" ||
      tab === "aiport" ||
      tab === "minutepred" ||
      tab === "nlp" ||
      tab === "nlphistory" ||
      tab === "graph" ||
      tab === "corridor" ||
      tab === "usmidterm" ||
      tab === "midtermstudy" ||
      tab === "polithemes" ||
      tab === "themeetf" ||
      tab === "bookclub" ||
      tab === "bookclubboard"
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
    if (navPlacement(tab).groupId === nextGroup) return;
    const first =
      visibleShellTabs(group.tabs, unlocked)[0] || group.nested?.[0]?.tabs[0];
    if (first) setTab(first);
  }

  function selectNested(nestedId: NavGroupId) {
    const nested = activeGroup.nested?.find((item) => item.id === nestedId);
    if (!nested?.tabs[0]) return;
    if (activeNested?.id === nestedId) return;
    setTab(nested.tabs[0]);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-dot" aria-hidden />
          SavvyETF
        </a>
        <div className="topbar-end">
          <div className="meta-line">
            <span
              className={`status-dot ${error ? "err" : configured ? "ok" : ""}`}
              aria-hidden
            />
            {metaText}
          </div>
          <AdminLoginControl />
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
        <nav
          className={`tabs tabs-secondary ${showTertiary ? "has-tertiary" : ""}`}
          aria-label={`${activeGroup.label} 하위 탭`}
        >
          {visibleGroupTabs.map((id) => (
            <button
              key={id}
              type="button"
              className={`tab-btn sub ${!activeNested && tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {SHELL_TAB_LABELS[id]}
            </button>
          ))}
          {(activeGroup.nested || []).map((nested) => (
            <button
              key={nested.id}
              type="button"
              className={`tab-btn sub ${activeNested?.id === nested.id ? "active" : ""}`}
              onClick={() => selectNested(nested.id)}
            >
              {nested.label}
            </button>
          ))}
        </nav>
      ) : null}

      {showTertiary && activeNested ? (
        <nav
          className="tabs tabs-tertiary"
          aria-label={`${activeNested.label} 세부 탭`}
        >
          {visibleNestedTabs.map((id) => (
            <button
              key={id}
              type="button"
              className={`tab-btn sub leaf ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {SHELL_TAB_LABELS[id]}
            </button>
          ))}
        </nav>
      ) : null}

      {tab === "main" ? (
        <MainTab />
      ) : tab === "bookclub" ? (
        unlocked ? <BookClubTab /> : null
      ) : tab === "simulate" ? (
        <SimulateTab />
      ) : tab === "usportfolio" ? (
        <UsPortfolioTab />
      ) : tab === "signals" ? (
        unlocked ? <TradingSignalsTab /> : null
      ) : tab === "graph" ? (
        <GraphTab />
      ) : tab === "nlp" || tab === "nlphistory" ? (
        <NlpPulseTab />
      ) : tab === "ideas" ? (
        <TradingIdeasTab />
      ) : tab === "weightopt" ? (
        <WeightOptimizeTab />
      ) : tab === "aiport" ? (
        unlocked ? <AiPortTab /> : null
      ) : tab === "minutepred" ? (
        unlocked ? <MinuteForecastTab /> : null
      ) : tab === "corridor" ? (
        <CorridorTab />
      ) : tab === "usmidterm" ? (
        <UsMidtermTab />
      ) : tab === "midtermstudy" ? (
        <MidtermStudyTab />
      ) : tab === "polithemes" ? (
        <PoliThemesTab />
      ) : tab === "heatpick" ? (
        unlocked ? <ChartTradeTab /> : null
      ) : tab === "cardnews" ? (
        <CardNewsTab />
      ) : tab === "education" ? (
        <EducationTab />
      ) : tab === "research" ? (
        <ResearchTab />
      ) : tab === "etfdb" ? (
        <EtfDbTab />
      ) : tab === "etfdbus" ? (
        <EtfDbUsTab />
      ) : tab === "datacatalog" ? (
        <DataCatalogTab />
      ) : tab === "etfholdings" ? (
        <EtfHoldingsTab />
      ) : tab === "etfweights" ? (
        <EtfWeightMonitorTab />
      ) : tab === "kosdaqactive" ? (
        <KosdaqActiveTab />
      ) : tab === "countryetf" ? (
        <CountryEtfTab />
      ) : tab === "themeetf" ? (
        <ThemeEtfTab />
      ) : tab === "aietf" ? (
        <AiEtfTab />
      ) : tab === "leverage" ? (
        <LeverageEtfTab />
      ) : tab === "geo" ? (
        <EsgTabShell tab="geo" allSlots={esgSlots}>
          <GeoTab />
        </EsgTabShell>
      ) : tab === "infra" ? (
        <EsgTabShell tab="infra" allSlots={esgSlots}>
          <InfraTab />
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
      ) : tab === "gamma" ? (
        <MarketGammaTab />
      ) : tab === "quant" ? (
        <QuantTab />
      ) : tab === "gurus" ? (
        <WallStreetGurusTab />
      ) : tab === "eventstudy" ? (
        <EventStudyTab />
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
          <EtfSupplyPanel />
          <EtfNewTab />
          <EtfKor15Tab />
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
