import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_TYPES, APPENDIX_B_NAMES } from "./registry";

// 02 §Acceptance: "Appendix B coverage test: every type in the list is emitted by at least
// one handler test (a registry test fails when a name has no emitter once its feature is
// built)." Source-based on purpose: an in-memory recorder would only see what the current
// test *file* emitted (vitest module isolation) and pass vacuously. `built: true` is the
// "feature is built" flag — Appendix B names whose workstream isn't merged yet (commitments,
// escalations, loans, ...) stay built:false and are exempt until someone flips that flag,
// which is exactly when they must also add the emit site and a test.

const srcDir = dirname(dirname(fileURLToPath(import.meta.url))); // services/api/src

function allSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) allSourceFiles(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && full !== join(srcDir, "events", "registry.ts"))
      out.push(full);
  }
  return out;
}

function allTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) allTestFiles(full, out);
    else if (entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("event registry coverage (02 §Appendix B, §Acceptance)", () => {
  const sourceText = allSourceFiles(srcDir).map((f) => readFileSync(f, "utf8")).join("\n");
  const testText = allTestFiles(srcDir).map((f) => readFileSync(f, "utf8")).join("\n");

  it("every built Appendix B type has a literal emit site in source", () => {
    const missing = EVENT_TYPES.filter(
      (t) => t.built && APPENDIX_B_NAMES.has(t.name) && !sourceText.includes(t.name)
    ).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("every built event type is asserted by at least one test", () => {
    const missing = EVENT_TYPES.filter((t) => t.built && !testText.includes(t.name)).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("every Appendix B name from p42 is present in the registry, built or not", () => {
    const registered = new Set(EVENT_TYPES.map((t) => t.name));
    const missing = [...APPENDIX_B_NAMES].filter((n) => !registered.has(n));
    expect(missing).toEqual([]);
  });
});
