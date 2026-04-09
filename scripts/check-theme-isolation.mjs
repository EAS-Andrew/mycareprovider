#!/usr/bin/env node
/*
 * Structural guard: route groups (receiver), (provider), and (admin) must
 * not import from each other. Shared UI lives in components/ and lib/.
 *
 * Also scans shared components for hardcoded blue or purple Tailwind classes
 * that bypass the --brand-* variables.
 *
 * Exit code 0 on success, 1 on violation.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP_DIR = join(ROOT, "app");
const COMPONENTS_DIR = join(ROOT, "components");

const GROUPS = ["(receiver)", "(provider)", "(admin)"];
const FORBIDDEN_HARDCODED = [
  // Bare color utilities that would hardcode a side.
  /\bbg-(blue|sky|indigo|purple|violet|fuchsia)-\d{2,3}\b/,
  /\btext-(blue|sky|indigo|purple|violet|fuchsia)-\d{2,3}\b/,
  /\bborder-(blue|sky|indigo|purple|violet|fuchsia)-\d{2,3}\b/,
  /\bring-(blue|sky|indigo|purple|violet|fuchsia)-\d{2,3}\b/,
];

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (/\.(tsx?|jsx?|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function groupOf(path) {
  for (const g of GROUPS) {
    if (path.includes(`/app/${g}/`)) return g;
  }
  return null;
}

const violations = [];

const appFiles = await walk(APP_DIR);
for (const file of appFiles) {
  const group = groupOf(file);
  if (!group) continue;
  const src = await readFile(file, "utf8");
  const importRe = /from\s+["']([^"']+)["']/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const spec = m[1];
    for (const other of GROUPS) {
      if (other === group) continue;
      if (spec.includes(other)) {
        violations.push(
          `${relative(ROOT, file)} imports from ${other} (must not cross route groups)`,
        );
      }
    }
  }
}

const sharedFiles = await walk(COMPONENTS_DIR);
for (const file of sharedFiles) {
  const src = await readFile(file, "utf8");
  for (const re of FORBIDDEN_HARDCODED) {
    const hit = src.match(re);
    if (hit) {
      violations.push(
        `${relative(ROOT, file)} hardcodes a side color (${hit[0]}); use bg-brand / text-brand / ring-brand instead`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Theme isolation check failed:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}

console.log("Theme isolation check passed.");
