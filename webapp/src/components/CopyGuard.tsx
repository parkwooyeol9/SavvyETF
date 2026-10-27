"use client";

import { useEffect } from "react";

import { loadAdminSecret } from "@/lib/adminSession";

/** Form fields and opt-in areas (`data-allow-copy`) keep normal select/copy/paste. */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-allow-copy]"));
}

/**
 * Deters casual drag-select / copy / right-click saving of page data.
 * Admins (session unlocked) are exempt. View-source and devtools still work —
 * the API gate in middleware is what keeps scripts out.
 */
export default function CopyGuard() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.classList.toggle("copy-ok", Boolean(loadAdminSecret()));
    sync();

    const block = (event: Event) => {
      sync();
      if (root.classList.contains("copy-ok") || editable(event.target)) return;
      if (event.type === "contextmenu" && event.target instanceof Element && event.target.closest("a[href]")) return;
      event.preventDefault();
    };

    const events = ["copy", "cut", "selectstart", "dragstart", "contextmenu"] as const;
    for (const name of events) document.addEventListener(name, block, true);
    return () => {
      for (const name of events) document.removeEventListener(name, block, true);
    };
  }, []);

  return null;
}
