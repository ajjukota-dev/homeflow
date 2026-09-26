import { describe, expect, it } from "vitest";
import { healthPayload, liveCommitSha } from "./build-info";

describe("live commit sha", () => {
  it("prefers GIT_SHA, then GITHUB_SHA, and does not invent one", () => {
    expect(liveCommitSha({ GIT_SHA: "abc123def", GITHUB_SHA: "other" })).toBe("abc123def");
    expect(liveCommitSha({ GITHUB_SHA: "deadbeef" })).toBe("deadbeef");
    expect(liveCommitSha({})).toBeNull();
    expect(liveCommitSha({ GIT_SHA: "", GITHUB_SHA: "" })).toBeNull();
  });

  it("puts the sha on the health payload so a live process can show which commit is running", () => {
    const body = healthPayload(true, { GIT_SHA: "4168311cafe" });
    expect(body).toEqual({ ok: true, db: true, commit: "4168311cafe" });
    expect(healthPayload(false, {}).commit).toBeNull();
    expect(healthPayload(false, {}).ok).toBe(false);
  });
});
