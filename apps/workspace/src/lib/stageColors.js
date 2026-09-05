/**
 * Stage / Department colour helper (Feb 2026 theme).
 *
 * Maps each of the 8 seeded Villa + Apartment stages to a distinct
 * department-derived palette. Consumers pass either a stage NAME
 * (recommended when journey.stages[i].name is available) or a
 * department CODE (SALES, CRM, LEGAL, ACCOUNTS, REGISTRATION, SITE,
 * QA, HANDOVER).
 *
 * A lightweight module-level cache of `/api/departments` lets task
 * rows (which carry only department_id) look up the code without
 * every component fetching separately.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Per-code palette — saturated bg + white text (Feb 2026 high-contrast repalette)
// Every stage renders as a solid coloured band; white text meets WCAG-AA at 14px on
// every bg listed here (all bg L* < 40, white L* = 100).
export const STAGE_PALETTE = {
  SALES:        { bg: "#1565C0", border: "#1565C0", text: "#FFFFFF", dot: "#1565C0" }, // Deep Blue
  CRM:          { bg: "#2E7D32", border: "#2E7D32", text: "#FFFFFF", dot: "#2E7D32" }, // Deep Green
  LEGAL:        { bg: "#6A1B9A", border: "#6A1B9A", text: "#FFFFFF", dot: "#6A1B9A" }, // Deep Purple
  ACCOUNTS:     { bg: "#37474F", border: "#37474F", text: "#FFFFFF", dot: "#37474F" }, // Deep Slate
  REGISTRATION: { bg: "#E65100", border: "#E65100", text: "#FFFFFF", dot: "#E65100" }, // Deep Orange
  SITE:         { bg: "#4E342E", border: "#4E342E", text: "#FFFFFF", dot: "#4E342E" }, // Deep Brown
  // Seed uses "PROJECTS" as the Site department code — same deep brown
  PROJECTS:     { bg: "#4E342E", border: "#4E342E", text: "#FFFFFF", dot: "#4E342E" },
  QA:           { bg: "#B71C1C", border: "#B71C1C", text: "#FFFFFF", dot: "#B71C1C" }, // Deep Red
  HANDOVER:     { bg: "#00695C", border: "#00695C", text: "#FFFFFF", dot: "#00695C" }, // Deep Teal
};

// Fallback for any future / unseeded stage — deep slate (matches saturated aesthetic)
export const DEFAULT_STAGE_COLOR = {
  bg: "#475569",
  border: "#475569",
  text: "#FFFFFF",
  dot: "#475569",
};

// Well-known seeded stage names → department code
const NAME_TO_CODE = {
  "Sales Handover": "SALES",
  "Documentation": "CRM",
  "Legal": "LEGAL",
  "Payments": "ACCOUNTS",
  "Registration": "REGISTRATION",
  "Unit Readiness": "SITE",
  "Snagging": "QA",
  "Handover": "HANDOVER",
};

export function stageCodeForName(name) {
  if (!name) return null;
  return NAME_TO_CODE[name] || null;
}

export function stageColorForCode(code) {
  return STAGE_PALETTE[code] || DEFAULT_STAGE_COLOR;
}

export function stageColorForName(name) {
  const code = stageCodeForName(name);
  return code ? STAGE_PALETTE[code] : DEFAULT_STAGE_COLOR;
}

// -------- Department id → code cache --------
// One in-flight fetch shared across the app.
let _deptMap = null; // Map<string, string>
let _deptPromise = null;

async function _fetchDepts() {
  try {
    const r = await api.get("/departments");
    _deptMap = new Map((r.data || []).map((d) => [d.id, d.code]));
  } catch {
    _deptMap = new Map();
  }
  return _deptMap;
}

export function loadDepartments() {
  if (_deptMap) return Promise.resolve(_deptMap);
  if (_deptPromise) return _deptPromise;
  _deptPromise = _fetchDepts().finally(() => {
    _deptPromise = null;
  });
  return _deptPromise;
}

export function stageColorForDepartmentId(id) {
  if (!id || !_deptMap) return DEFAULT_STAGE_COLOR;
  const code = _deptMap.get(id);
  return code ? stageColorForCode(code) : DEFAULT_STAGE_COLOR;
}

/**
 * React hook — resolves department_id → color when the cache is warm.
 * Returns { ready, colorFor(departmentId), codeFor(departmentId) }.
 */
export function useDepartmentColors() {
  const [ready, setReady] = useState(!!_deptMap);
  useEffect(() => {
    if (_deptMap) {
      setReady(true);
      return;
    }
    let alive = true;
    loadDepartments().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return {
    ready,
    codeFor: (id) => (_deptMap ? _deptMap.get(id) : null) || null,
    colorFor: (id) => stageColorForDepartmentId(id),
  };
}
