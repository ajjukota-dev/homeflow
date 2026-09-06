// Shared tab-manifest shape for the three 360 views (28-360-views.md's own boundary: "content of
// tabs is owned by their specs" — a 360 endpoint returns the Overview payload plus a manifest
// pointing at each tab's own feature endpoint, not the tabs' full content inline (rule 6's ≤3
// API-calls-per-load). A tab whose owning spec isn't built yet degrades to a named placeholder.
export interface TabManifestEntry {
  key: string;
  label: string;
  available: boolean;
  api: string | null;
  unavailable_reason?: string;
}

export function tab(key: string, label: string, api: string): TabManifestEntry {
  return { key, label, available: true, api };
}

export function notYetAvailable(key: string, label: string, owningSpec: string): TabManifestEntry {
  return { key, label, available: false, api: null, unavailable_reason: `Not yet available — owned by ${owningSpec}` };
}
