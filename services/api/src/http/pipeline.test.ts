import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function readRepo(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

describe("CI and deploy pipelines", () => {
  const ci = readRepo(".github/workflows/ci.yml");
  const deploy = readRepo(".github/workflows/deploy.yml");
  const dockerfile = readRepo("Dockerfile");

  it("installs the npm workspaces from the root lockfile, not per-app ci without a lockfile", () => {
    expect(ci).toMatch(/^\s+- run: npm ci$/m);
    expect(ci).toContain("npm ci --prefix services/api");
    expect(ci).not.toContain("npm ci --prefix apps/workspace");
    expect(ci).not.toContain("npm ci --prefix apps/my-pranava-home");
  });

  it("runs typecheck, test, and build, and installs Chromium for the API PDF tests", () => {
    expect(ci).toContain("npm run typecheck");
    expect(ci).toContain("npm --prefix services/api test");
    expect(ci).toContain("npm --prefix apps/workspace test");
    expect(ci).toContain("npm run build");
    expect(ci).toContain("playwright install --with-deps chromium");
    expect(ci).not.toMatch(/vitest run.*--exclude/);
    expect(ci).not.toContain("PLAYWRIGHT_BROWSERS_PATH=");
  });

  it("does not deploy: no AWS credentials step and no deploy script", () => {
    expect(deploy).not.toContain("configure-aws-credentials");
    expect(deploy).not.toContain("infra/scripts/deploy.sh");
    expect(deploy).not.toContain("cdk deploy");
    expect(deploy).not.toContain("AWS_ACCESS_KEY_ID");
    expect(deploy).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  it("builds the container from the monorepo lockfile and stamps GIT_SHA", () => {
    expect(dockerfile).not.toContain("apps/workspace/package-lock.json");
    expect(dockerfile).not.toContain("apps/my-pranava-home/package-lock.json");
    expect(dockerfile).toMatch(/COPY (package\.json )?package-lock\.json/);
    expect(dockerfile).toContain("packages/ui");
    expect(dockerfile).toContain("ARG GIT_SHA");
    expect(dockerfile).toContain("ENV GIT_SHA");
    expect(ci).toContain("--build-arg GIT_SHA");
  });
});
