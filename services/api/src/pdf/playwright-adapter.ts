import { chromium } from "playwright";
import type { PdfPort } from "./types";

// A fresh browser per render is simpler and safer than pooling for the
// document volumes this product has (a handful of AOS/registration docs
// per booking, not a high-throughput print service).
export function createPlaywrightPdfAdapter(): PdfPort {
  return {
    async render(html: string): Promise<Buffer> {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });
        const pdf = await page.pdf({ format: "A4", printBackground: true });
        return Buffer.from(pdf);
      } finally {
        await browser.close();
      }
    },
  };
}
