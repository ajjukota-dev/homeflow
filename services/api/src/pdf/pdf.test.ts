import { describe, expect, it } from "vitest";
import { createPlaywrightPdfAdapter } from "./playwright-adapter";

// S4 acceptance spike (03-platform-deploy.md): a sample AOS with a ₹ amount
// and an Indian name renders to A4 in-container.
describe("pdf port — playwright adapter", () => {
  it("renders a sample AOS with ₹ and an Indian name to an A4 PDF buffer", async () => {
    const adapter = createPlaywrightPdfAdapter();
    const html = `
      <html><body style="font-family: sans-serif;">
        <h1>Agreement for Sale</h1>
        <p>Purchaser: Karthik Iyer (PAN ABCDE1234F)</p>
        <p>Total consideration: ₹1,20,00,000</p>
      </body></html>
    `;
    const buffer = await adapter.render(html);

    expect(buffer.length).toBeGreaterThan(0);
    // PDF magic header.
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 20_000);
});
