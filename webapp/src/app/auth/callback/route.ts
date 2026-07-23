import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/community";

  if (!supabaseConfigured()) {
    return NextResponse.redirect(`${origin}/community?error=not_configured`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/community"}`);
    }
  }

  return NextResponse.redirect(`${origin}/community?error=auth`);
}
