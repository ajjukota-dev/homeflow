// pdf port (03-platform-deploy.md): render(html) → Buffer, Playwright
// Chromium in-container. Document Factory (spec 22) builds the HTML;
// this port only turns it into an A4 PDF.

export interface PdfPort {
  render(html: string): Promise<Buffer>;
}
