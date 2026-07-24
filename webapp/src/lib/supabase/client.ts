"use client";

import { createBrowserClient } from "@supabase/ssr";

import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
