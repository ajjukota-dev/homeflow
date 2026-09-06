import { Building2, Store, Users, Banknote, Scale, ClipboardCheck, HeartHandshake, Landmark, Map, Settings2, CalendarClock } from "lucide-react";
import { ROLE_CODES } from "./pages/admin/roles";

export type View =
  | "myday"
  | "site"
  | "sales"
  | "crm"
  | "accounts"
  | "legal"
  | "qa"
  | "after"
  | "tower"
  | "roadmap"
  | "studio"
  | "admin-users"
  | "admin-teams"
  | "admin-permissions"
  | "admin-data";

// Rule 3: read access is any staff role; per-tab edit eligibility is enforced server-side
// (studio/registry.ts's tabsForRoles/can_edit) — every seeded staff role except CUSTOMER sees
// the nav entry.
const STAFF_ROLES_CLIENT = ROLE_CODES.filter((r) => r !== "CUSTOMER");

// Rule 7 / p44 §33.6 t3: which roles see which workspace. Site's write controls
// (unit_progress) never render for roles without WRITE there — hiding the nav
// entry is the simplest correct gate until per-control checks land with 07/08.
export const NAV: { id: View; label: string; role: string; short: string; Icon: typeof Building2; roles: string[] }[] = [
  // 11-my-day-ranking.md: "workspace home after login" — kept additive rather than replacing
  // ROLE_HOME below (every role already has an established department landing page); every
  // staff role gets My Day as its own nav entry instead, a judgment call flagged in the spec's
  // own Build note.
  { id: "myday", label: "My Day", role: "What's due, at risk, waiting on you", short: "My Day", Icon: CalendarClock, roles: [...STAFF_ROLES_CLIENT] },
  { id: "site", label: "Project / Site", role: "Owns unit progress", short: "Site", Icon: Building2, roles: ["SITE", "QA", "MANAGEMENT", "SUPER_ADMIN"] },
  { id: "sales", label: "Sales", role: "Books, reads gates", short: "Sales", Icon: Store, roles: ["SALES", "MANAGEMENT", "SUPER_ADMIN"] },
  { id: "crm", label: "CRM / RM", role: "Accepts, owns customers", short: "CRM", Icon: Users, roles: ["CRM", "CUSTOMISATION", "MANAGEMENT", "SUPER_ADMIN"] },
  { id: "accounts", label: "Accounts", role: "True-risk collections", short: "Cash", Icon: Banknote, roles: ["ACCOUNTS", "BANKING", "MANAGEMENT", "SUPER_ADMIN"] },
  { id: "legal", label: "Legal", role: "Documents & registration", short: "Legal", Icon: Scale, roles: ["LEGAL", "REGISTRATION", "MANAGEMENT", "SUPER_ADMIN"] },
  { id: "qa", label: "QA / Handover", role: "Evidence, then keys", short: "QA", Icon: ClipboardCheck, roles: ["QA", "SITE", "MANAGEMENT", "SUPER_ADMIN"] },
  { id: "after", label: "After keys", role: "Warranty & DLP", short: "After", Icon: HeartHandshake, roles: ["FM", "MANAGEMENT", "SUPER_ADMIN"] },
  { id: "tower", label: "Management", role: "Five interventions", short: "Tower", Icon: Landmark, roles: ["MANAGEMENT", "SUPER_ADMIN"] },
  // Spec 27: "ships in R1, before anything else here" — the honest not-yet-merged-specs
  // list, removed once every spec is merged.
  { id: "roadmap", label: "Roadmap", role: "What's built, what's next", short: "Roadmap", Icon: Map, roles: ["MANAGEMENT", "SUPER_ADMIN"] },
  { id: "studio", label: "Policy Studio", role: "Every configurable thing, as data", short: "Studio", Icon: Settings2, roles: [...STAFF_ROLES_CLIENT] },
];

export const ADMIN_NAV: { id: View; label: string }[] = [
  { id: "admin-users", label: "Users" },
  { id: "admin-teams", label: "Teams & assignments" },
  { id: "admin-permissions", label: "Permission matrix" },
  { id: "admin-data", label: "Projects, units & customers" },
];

// Rule 9: "workspace opens in the user's default Project" implies the role's
// own home view, not just the first visible tab — MANAGEMENT's home is the
// control tower ("lands in Management"). Every seeded role has an explicit
// entry; a role with none falls through to the first visible tab.
export const ROLE_HOME: Record<string, View> = {
  MANAGEMENT: "tower",
  SALES: "sales",
  CRM: "crm",
  ACCOUNTS: "accounts",
  BANKING: "accounts",
  LEGAL: "legal",
  REGISTRATION: "legal",
  SITE: "site",
  QA: "qa",
  // CUSTOMISATION is seeded READ-only on customer_overview/customer_journey
  // (see seed/permissions.ts CUSTOMISATION_MODULES) — CRM's customer-record
  // view fits that footprint; Site carries unit-progress write controls the
  // role has no grant for.
  CUSTOMISATION: "crm",
  FM: "after",
  // Was an accident of array order (SUPER_ADMIN previously fell through to `visible[0]`, which
  // happened to be "site") until My Day was added as the new first NAV entry — made explicit here
  // so a future nav reorder can't silently change SUPER_ADMIN's landing page again (caught by the
  // pre-existing "lands on Unit Progress Control" e2e test failing when My Day landed first).
  SUPER_ADMIN: "site",
};

export function defaultViewFor(roles: string[], visible: View[]): View {
  for (const role of roles) {
    const home = ROLE_HOME[role];
    if (home && visible.includes(home)) return home;
  }
  return visible[0] ?? "tower";
}
