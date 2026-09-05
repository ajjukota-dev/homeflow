import { useEffect, useState } from "react";

/**
 * BrandMark — Pranava HomeFlow logotype.
 *
 * Renders a text logotype: "Pranava" (brand orange) with a small "HOMEFLOW"
 * caption underneath. If `/pranava-logo.svg` exists in /public, it is used
 * instead — so the real logo can be dropped in later without a code change.
 *
 * Variants:
 *   - `light`  : for dark backgrounds (navy sidebar / login left panel)
 *   - `dark`   : for light backgrounds (top nav / warm content)
 *
 * Sizes:
 *   - `sm`  ~ sidebar header  (Pranava 18px / HOMEFLOW 10px)
 *   - `md`  ~ top nav         (Pranava 20px / HOMEFLOW 10px)
 *   - `lg`  ~ login left      (Pranava 40px / HOMEFLOW 14px)
 */
export default function BrandMark({ variant = "dark", size = "md", className = "", testId = "brand-mark" }) {
  const [hasSvg, setHasSvg] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // HEAD request to detect a user-supplied SVG. Falls back silently.
    fetch("/pranava-logo.svg", { method: "HEAD" })
      .then((r) => {
        if (!cancelled && r.ok) {
          const ct = r.headers.get("content-type") || "";
          // Guard against SPA index.html being served for missing files.
          if (ct.includes("svg") || ct.includes("xml")) setHasSvg(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (hasSvg) {
    const svgH = size === "lg" ? "h-16" : size === "md" ? "h-9" : "h-8";
    return (
      <div className={`inline-flex items-center ${className}`} data-testid={testId}>
        <img src="/pranava-logo.svg" alt="Pranava HomeFlow" className={svgH} />
      </div>
    );
  }

  const wordCls =
    size === "lg"
      ? "text-[40px] leading-[1] font-heading font-semibold tracking-tight"
      : size === "md"
      ? "text-[22px] leading-[1] font-heading font-semibold tracking-tight"
      : "text-[19px] leading-[1] font-heading font-semibold tracking-tight";

  const capCls =
    size === "lg"
      ? "text-[13px] tracking-[0.32em] mt-2"
      : size === "md"
      ? "text-[10px] tracking-[0.28em] mt-1"
      : "text-[10px] tracking-[0.28em] mt-1";

  const captionColor = variant === "light" ? "text-slate-300" : "text-slate-500";

  return (
    <div className={`inline-flex flex-col items-start select-none ${className}`} data-testid={testId}>
      <span className={wordCls} style={{ color: "#E8431A" }}>
        Pranava
      </span>
      <span className={`${capCls} font-semibold ${captionColor}`}>HOMEFLOW</span>
    </div>
  );
}
