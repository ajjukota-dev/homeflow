import { Home as HomeIcon, Map, Wallet, FileText, MoreHorizontal } from "lucide-react";

// 26-customer-portal.md Screens: 10 areas is too many for a bottom tab bar (rule 11 is
// mobile-first) — the 4 areas customers open most often get their own tab, the rest live one tap
// away under "More". Registration/Handover only matter for a few months of a multi-year journey,
// which is exactly what "More" is for.
export type TabKey = "home" | "journey" | "payments" | "documents" | "more";

export const TABS: { key: TabKey; label: string; icon: typeof HomeIcon }[] = [
  { key: "home", label: "Home", icon: HomeIcon },
  { key: "journey", label: "Journey", icon: Map },
  { key: "payments", label: "Payments", icon: Wallet },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "more", label: "More", icon: MoreHorizontal },
];

export type MoreKey = "registration" | "handover" | "requests" | "commitments" | "passport" | "myhome" | "profile";
