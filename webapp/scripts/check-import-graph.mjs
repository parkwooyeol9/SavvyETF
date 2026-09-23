#!/usr/bin/env node
/**
 * Fail if a .ts/.tsx file under src/ imports @/... that does not exist on disk.
 * Catches the "works locally / Module not found on Vercel" class of deploy breaks
 * when a new file was never committed.
 *
 * Usage: node scripts/check-import-graph.mjs
 * Exit 0 = ok, 1 = missing modules listed on stderr.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

const IMPORT_RE =
  /(?:from\s+|import\()\s*["'](@\/[^"']+)["']/g;

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(ent.name)) out.push(full);
  }
  return out;
}

function resolveAtImport(spec) {
  // @/foo/bar → src/foo/bar
  const rel = spec.replace(/^@\//, "");
  const base = path.join(SRC, rel);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.json`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

const files = walk(SRC);
const missing = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const specs = new Set();
  for (const m of text.matchAll(IMPORT_RE)) specs.add(m[1]);
  for (const spec of specs) {
    if (!spec.startsWith("@/")) continue;
    if (!resolveAtImport(spec)) {
      missing.push({
        file: path.relative(ROOT, file),
        spec,
      });
    }
  }
}

if (missing.length) {
  console.error(
    `check-import-graph: ${missing.length} unresolved @/ import(s). Commit the missing files or drop the imports.\n`,
  );
  for (const { file, spec } of missing) {
    console.error(`  ${file}\n    → ${spec}`);
  }
  process.exit(1);
}

console.log(
  `check-import-graph: ok (${files.length} files, all @/ imports resolve)`,
);
