import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileMailerAdapter } from "./file-adapter";

const TEST_DIR = "./.data/mail-test";

describe("mailer port — file adapter", () => {
  beforeEach(() => {
    process.env.MAIL_DIR = TEST_DIR;
  });
  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.MAIL_DIR;
  });

  it("writes a .eml with To/Subject/html/text", async () => {
    const mailer = createFileMailerAdapter();
    await mailer.send({
      to: "karthik@example.com",
      subject: "Your booking amount receipt",
      html: "<p>Receipt for ₹12,00,000</p>",
      text: "Receipt for Rs 12,00,000",
    });

    const [file] = readdirSync(TEST_DIR);
    expect(file).toMatch(/\.eml$/);
    const content = readFileSync(join(TEST_DIR, file), "utf8");
    expect(content).toContain("To: karthik@example.com");
    expect(content).toContain("Subject: Your booking amount receipt");
    expect(content).toContain("Receipt for ₹12,00,000");
    expect(content).toContain("Receipt for Rs 12,00,000");
  });
});
