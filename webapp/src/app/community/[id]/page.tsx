import { SimpleCommunityDetail } from "@/components/SimpleCommunityBoard";
import SiteChrome from "@/components/SiteChrome";
import { communityBoardConfigured } from "@/lib/communityStore";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function CommunityPostPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;

  return (
    <SiteChrome
      active="community"
      meta="커뮤니티"
      showCommunityNav={false}
    >
      {communityBoardConfigured() ? (
        <SimpleCommunityDetail id={id} />
      ) : (
        <section className="panel community-panel">
          <p className="empty warn">게시판 저장소가 설정되지 않았습니다.</p>
        </section>
      )}
    </SiteChrome>
  );
}
