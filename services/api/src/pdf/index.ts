import { createPlaywrightPdfAdapter } from "./playwright-adapter";
import type { PdfPort } from "./types";

export type { PdfPort } from "./types";

// One real adapter (Playwright Chromium) — there's no meaningful "fake"
// PDF to fall back to; the container always carries Chromium (Dockerfile).
export const pdf: PdfPort = createPlaywrightPdfAdapter();
