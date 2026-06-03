#!/usr/bin/env node
// BRAND-06 regression guard: fail if the retired brand name leaks back into source.
// Cross-platform (no grep/findstr) so it runs identically in local + CI/Docker (Phase 3).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// Build the needle without writing the literal, so this file never trips its own check.
const NEEDLE = ["pyx", "is"].join("");
const rx = new RegExp(NEEDLE, "i");

const ROOT = process.cwd();
const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", ".planning", "dist", "build", ".next", "coverage", ".vscode",
]);
// Gitignored local config (real account values, not branding) — out of scope.
const EXCLUDE_FILES = new Set([".env"]);
// Only scan text-ish source files; skip binaries/assets.
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".pdf", ".zip",
  ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mov", ".lock",
]);

const hits = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(full);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      if (entry.name.startsWith(".env")) continue;
      if (BINARY_EXT.has(extname(entry.name).toLowerCase())) continue;
      let text;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      text.split("\n").forEach((line, i) => {
        if (rx.test(line)) {
          hits.push(`${full.replace(ROOT + "/", "")}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
  }
}

walk(ROOT);

if (hits.length > 0) {
  console.error(`✗ Brand check failed: found ${hits.length} reference(s) to the retired brand:\n`);
  for (const h of hits) console.error("  " + h);
  console.error("\nReplace these with the current brand (ChemBench) and re-run `npm run test:brand`.");
  process.exit(1);
}

console.log("✓ Brand check passed: no retired-brand references in source.");
