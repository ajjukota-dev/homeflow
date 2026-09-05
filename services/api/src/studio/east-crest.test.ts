import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// 25-policy-studio.md §Acceptance: "East Crest grep test: no East Crest literal (durations,
// charges, stage names) outside seed/demo-east-crest.ts." Premise-checked against the real repo
// before writing this (advisor review) — the spec names one file, but East Crest demo fixtures
// actually live in four: seed.ts, seed-lifecycle.ts, seed/demo-east-crest.ts (all pre-date this
// spec), and seed/users.ts. Verified (advisor review, second pass) that seed/users.ts's East
// Crest project-id literal is safe to allow-list, not a real violation: seedUsers() is called
// from db/index.ts only inside the same `seedAllowed` (NODE_ENV !== "production" || SEED_DEMO ===
// "1") gate as seed(db) itself — it never runs in production. Durations/charges/stage names can't
// be reliably grepped as generic literals (a duration is just an int), so this checks for the one
// unambiguous, reliable proxy: the project's own name/id literal appearing in CODE (not comments —
// several files already have a comment explicitly saying they avoided hardcoding East Crest,
// which would be a false positive on a naive grep).

const srcDir = dirname(dirname(fileURLToPath(import.meta.url))); // services/api/src

const ALLOWED_FILES = new Set([
  "seed.ts", // East Crest project + inventory fixtures
  "seed-lifecycle.ts", // East Crest legal/QA/handover/warranty fixtures
  "seed/demo-east-crest.ts", // the file the spec names directly
  "seed/users.ts", // demo account login scoped to the East Crest project
]);

function allSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) allSourceFiles(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const EAST_CREST = /east.?crest/i;

function codeOnly(line: string): string {
  const i = line.indexOf("//");
  return i === -1 ? line : line.slice(0, i);
}

describe("East Crest grep test (25-policy-studio.md §Acceptance)", () => {
  it("no East Crest literal in code (comments excluded) outside the known demo-seed files", () => {
    const violations: string[] = [];
    for (const file of allSourceFiles(srcDir)) {
      const relPath = relative(srcDir, file).replace(/\\/g, "/");
      if (ALLOWED_FILES.has(relPath)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (EAST_CREST.test(codeOnly(line))) violations.push(`${relPath}:${i + 1}`);
      });
    }
    expect(violations).toEqual([]);
  });
});
