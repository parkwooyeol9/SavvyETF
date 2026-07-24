import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { supabaseAnonKey, supabaseConfigured, supabaseUrl } from "@/lib/supabase/env";

/** Refresh Supabase auth cookies on each request when configured. */
export async function updateSession(request: NextRequest, response: NextResponse) {
  if (!supabaseConfigured()) return response;

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touches auth cookies so Server Components see a fresh session.
  await supabase.auth.getUser();
  return response;
}
