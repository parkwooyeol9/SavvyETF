import Link from "next/link";

export default function SiteChrome({
  active,
  children,
  meta,
  showCommunityNav = false,
}: {
  active: "dashboard" | "community";
  children: React.ReactNode;
  meta?: string;
  /** Keep false on public homepage; community is reached by direct URL for now. */
  showCommunityNav?: boolean;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-dot" aria-hidden />
          SavvyETF
        </Link>
        {meta ? (
          <div className="meta-line">
            <span className="status-dot ok" aria-hidden />
            {meta}
          </div>
        ) : null}
      </header>

      <nav className="tabs community-site-nav" aria-label="사이트 메뉴">
        <Link
          href="/"
          className={`tab-btn ${active === "dashboard" ? "active" : ""}`}
        >
          대시보드
        </Link>
        {showCommunityNav ? (
          <Link
            href="/community"
            className={`tab-btn ${active === "community" ? "active" : ""}`}
          >
            커뮤니티
          </Link>
        ) : null}
      </nav>

      {children}
    </div>
  );
}
