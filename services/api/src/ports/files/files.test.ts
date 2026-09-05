import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertAllowedContentType, assertSafeKey } from "./types";
import { createLocalFilesAdapter, localFilePath } from "./local-adapter";

const TEST_DIR = "./.data/files-test";

describe("files port — contract guards", () => {
  it("rejects a content type outside the allow-list", () => {
    expect(() => assertAllowedContentType("application/x-msdownload")).toThrow(
      /content_type_not_allowed/
    );
  });

  it("accepts images and PDF", () => {
    expect(() => assertAllowedContentType("image/jpeg")).not.toThrow();
    expect(() => assertAllowedContentType("application/pdf")).not.toThrow();
  });

  it("rejects a key that escapes the data directory", () => {
    expect(() => assertSafeKey("../../etc/passwd")).toThrow(/unsafe_key/);
    expect(() => assertSafeKey("/etc/passwd")).toThrow(/unsafe_key/);
  });

  it("accepts a well-formed project-scoped key", () => {
    expect(() => assertSafeKey("project/p1/qa_evidence/e1/photo.jpg")).not.toThrow();
  });
});

describe("files port — local-disk adapter", () => {
  const key = "project/p1/qa_evidence/e1/photo.jpg";

  beforeEach(() => {
    process.env.FILES_DIR = TEST_DIR;
  });
  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.FILES_DIR;
  });

  it("putPresigned/getPresigned point at the same-origin /api/files route", async () => {
    const adapter = createLocalFilesAdapter();
    const put = await adapter.putPresigned(key, "image/jpeg");
    expect(put).toEqual({ url: `/api/files/${key}`, method: "PUT", headers: { "content-type": "image/jpeg" } });
    expect(await adapter.getPresigned(key)).toBe(`/api/files/${key}`);
  });

  it("delete removes a file written directly at its local path", async () => {
    const adapter = createLocalFilesAdapter();
    const path = localFilePath(key);
    const fs = await import("node:fs");
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, "binary-content");
    expect(readFileSync(path, "utf8")).toBe("binary-content");

    await adapter.delete(key);
    expect(existsSync(path)).toBe(false);
  });
});
