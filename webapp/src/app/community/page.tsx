import { SimpleCommunityHome } from "@/components/SimpleCommunityBoard";
import SiteChrome from "@/components/SiteChrome";
import { isCommunityCategory } from "@/lib/community";
import { communityBoardConfigured } from "@/lib/communityStore";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ category?: string }>;

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const category =
    sp.category && isCommunityCategory(sp.category) ? sp.category : null;

  return (
    <SiteChrome
      active="community"
      meta={
        communityBoardConfigured()
          ? "닉네임 게시판 · 로그인 불필요"
          : "저장소 미설정"
      }
      showCommunityNav={false}
    >
      {communityBoardConfigured() ? (
        <SimpleCommunityHome initialCategory={category} />
      ) : (
        <section className="panel community-panel">
          <h1 className="community-title">커뮤니티</h1>
          <p className="community-lead">
            R2 저장소가 없어 게시판을 열 수 없습니다. Vercel에 R2 환경 변수가
            있는지 확인해 주세요.
          </p>
        </section>
      )}
    </SiteChrome>
  );
}
