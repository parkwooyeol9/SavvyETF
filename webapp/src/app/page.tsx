import Dashboard from "@/components/Dashboard";
import { parseShellTab } from "@/lib/types";

type SearchParams = Promise<{ tab?: string }>;

export default async function HomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const initialTab = parseShellTab(sp.tab) || "main";
  return <Dashboard initialTab={initialTab} />;
}
