"use client";

const ECON_URL = "https://savvyecon.vercel.app/";

export default function EconResearchTab() {
  return (
    <div className="bookclub-tab">
      <section className="feature-block">
        <div className="feature-head bookclub-embed-head">
          <div>
            <h2 className="feature-title">경제연구소</h2>
            <p className="feature-lead">
              국가의 경제 무게와 증시 무게를 비교하고, 책에서 나온 질문을 장기 데이터로 점검합니다.
            </p>
          </div>
          <a
            className="bookclub-open"
            href={ECON_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            새 창에서 열기 →
          </a>
        </div>
        <iframe
          className="bookclub-frame"
          src={ECON_URL}
          title="경제연구소"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </section>
    </div>
  );
}
