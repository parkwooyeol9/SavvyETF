import { listAlertFires, listAlerts, listWatchlists } from "@/lib/tvMcp/operator";
import { withTvSession } from "@/lib/tvMcp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return withTvSession(request, async (tv) => {
    const watchlists = await listWatchlists(tv);
    const errors: string[] = [];
    const alerts = await listAlerts(tv).catch((exc: Error) => {
      errors.push(exc.message);
      return [];
    });
    const fires = await listAlertFires(tv).catch((exc: Error) => {
      errors.push(exc.message);
      return [];
    });
    return { watchlists, alerts, fires, errors, fetchedAt: new Date().toISOString() };
  });
}
