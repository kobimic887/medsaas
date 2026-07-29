#!/usr/bin/env node
// Brand regression guard: fail if a retired brand name leaks into user-facing source.
// Cross-platform (no grep/findstr) so it runs identically in local + CI/Docker.
//
// History, because this file has flipped once and will read as a mistake otherwise:
// v1 ("ChemBench Cleanup") renamed Pyxis -> ChemBench and this guard banned "pyxis".
// docs/PYXIS-ONLY.md reverses that decision — the product is Pyxis Discovery, one
// product for one company — so the retired names are now ChemBench and MedSaaS.
// If the brand ever moves again, change RETIRED and the message, not the walker.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

// Build the needles without writing the literals, so this file never trips its own check.
const RETIRED = [
  { label: ["Chem", "Bench"].join(""), rx: new RegExp(["chem", "bench"].join(""), "i") },
  { label: ["Med", "SaaS"].join(""), rx: new RegExp(["med", "saas"].join(""), "i") },
];

const ROOT = process.cwd();

// Only what a user can actually see. Docs, plans and commit history deliberately
// name the old brands to explain the rename; scanning them would ban the word
// from the very files whose job is to record it.
const SCAN_ROOTS = ["client/src", "client/index.html", "client/public", "server"];

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", ".vscode",
  "graphify-out", "test", "ketcher", "molstar",
]);

// Deliberate, documented exceptions — path prefixes that keep a retired name on purpose.
// `chembench-mcp` is a published MCP server name: renaming it is a client-visible
// contract change for no benefit (docs/PYXIS-ONLY.md section 2).
const ALLOW_PREFIXES = ["services/mcp-server"];

// The git repo is still called `medsaas`, and nothing proposes renaming it. Package
// identities and database names derived from it are identifiers, not brand text — no
// user ever sees them. Brand text is what renders in the UI or an email.
const EXCLUDE_FILES = new Set(["package.json", "package-lock.json", "bun.lock"]);
// Same reasoning for persisted keys: THEME_STORAGE_KEY keeps its old name because
// renaming it resets every existing user's light/dark preference for no visible gain.
const ALLOW_LINE = /mongodb(\+srv)?:\/\/|THEME_STORAGE_KEY/;

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".pdf", ".zip",
  ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mov", ".lock", ".map",
]);

const hits = [];

function scanFile(full) {
  const rel = relative(ROOT, full);
  if (ALLOW_PREFIXES.some((p) => rel.startsWith(p))) return;
  if (BINARY_EXT.has(extname(full).toLowerCase())) return;
  let text;
  try {
    text = readFileSync(full, "utf8");
  } catch {
    return;
  }
  text.split("\n").forEach((line, i) => {
    if (ALLOW_LINE.test(line)) return;
    for (const { label, rx } of RETIRED) {
      if (rx.test(line)) {
        hits.push(`${rel}:${i + 1}: [${label}] ${line.trim().slice(0, 110)}`);
        break;
      }
    }
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      if (entry.name.startsWith(".env")) continue;
      if (EXCLUDE_FILES.has(entry.name)) continue;
      scanFile(join(dir, entry.name));
    }
  }
}

for (const root of SCAN_ROOTS) {
  const full = join(ROOT, root);
  let st;
  try {
    st = statSync(full);
  } catch {
    continue; // a scan root may not exist yet, or may have been removed on purpose
  }
  if (st.isDirectory()) walk(full);
  else scanFile(full);
}

if (hits.length > 0) {
  console.error(`✗ Brand check failed: ${hits.length} user-facing reference(s) to a retired brand:\n`);
  for (const h of hits) console.error("  " + h);
  console.error("\nThe product is Pyxis Discovery (docs/PYXIS-ONLY.md). Replace these, or add a");
  console.error("documented exception to ALLOW_PREFIXES if the name is a published contract.");
  process.exit(1);
}

console.log("✓ Brand check passed: no retired-brand references in user-facing source.");
