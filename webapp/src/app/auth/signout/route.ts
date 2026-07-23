import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  if (supabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(`${origin}/community`, { status: 303 });
}
