"use client";

import { findNavGroup, SHELL_TAB_LABELS, type ShellTabId } from "@/lib/types";

const ESG_TABS: ShellTabId[] = ["esg", "geo", "infra", "esgreg", "greenmin"];

export function navigateDashboardTab(tab: ShellTabId) {
  window.dispatchEvent(new CustomEvent("savvyetf-nav-tab", { detail: tab }));
}

export default function EsgSubNav({ active }: { active: ShellTabId }) {
  const group = findNavGroup("esg");
  const tabs = group?.tabs || ESG_TABS;

  return (
    <nav className="esg-subnav" aria-label="ESG 하위 탭 바로가기">
      {tabs.map((id) => (
        <button
          key={id}
          type="button"
          className={`esg-subnav-btn ${id === active ? "active" : ""}`}
          onClick={() => navigateDashboardTab(id)}
        >
          {SHELL_TAB_LABELS[id]}
        </button>
      ))}
    </nav>
  );
}
