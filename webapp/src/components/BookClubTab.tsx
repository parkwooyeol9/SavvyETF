"use client";

const BOOKCLUB_URL = "https://savvybookclub.vercel.app/";

export default function BookClubTab() {
  return (
    <div className="bookclub-tab">
      <section className="feature-block">
        <div className="feature-head bookclub-embed-head">
          <div>
            <h2 className="feature-title">북클럽</h2>
            <p className="feature-lead">
              오늘 읽을 경제·경영·과학 책을 데이터로 고르는 SavvyBookClub입니다.
            </p>
          </div>
          <a
            className="bookclub-open"
            href={BOOKCLUB_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            새 창에서 열기 →
          </a>
        </div>
        <iframe
          className="bookclub-frame"
          src={BOOKCLUB_URL}
          title="SavvyBookClub"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </section>
    </div>
  );
}
