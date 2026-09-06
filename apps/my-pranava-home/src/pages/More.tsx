import { ChevronRight, Home as HomeIcon, KeyRound, ClipboardCheck, Wrench, HeartHandshake, BookOpen, User, Bell } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import type { MoreKey } from "../nav";

const ITEMS: { key: MoreKey | "updates"; label: string; icon: typeof HomeIcon }[] = [
  { key: "myhome", label: "My Home", icon: HomeIcon },
  { key: "registration", label: "Registration", icon: ClipboardCheck },
  { key: "handover", label: "Handover", icon: KeyRound },
  { key: "requests", label: "Requests", icon: Wrench },
  { key: "commitments", label: "Commitments", icon: HeartHandshake },
  { key: "passport", label: "Home Passport", icon: BookOpen },
  { key: "updates", label: "Updates", icon: Bell },
  { key: "profile", label: "Profile", icon: User },
];

/** Landing spot for the 6 areas that don't fit on the bottom tab bar (see nav.ts). */
export function More({ onOpen }: { onOpen: (key: MoreKey | "updates") => void }) {
  const { me } = useAuth();
  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-5 pb-24">
      <header className="pt-10 pb-2">
        <h1 className="text-large font-bold">More</h1>
        {me && <p className="mt-1 text-footnote text-fg-muted">{me.user.display_name}</p>}
      </header>
      <div className="mt-4 rounded-xl border border-line bg-surface p-2 shadow-card">
        {ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onOpen(item.key)}
            className="flex w-full items-center justify-between border-b border-line px-3 py-3.5 text-left last:border-b-0"
          >
            <span className="flex items-center gap-3 text-body">
              <item.icon className="h-5 w-5 text-accent" /> {item.label}
            </span>
            <ChevronRight className="h-4 w-4 text-fg-subtle" />
          </button>
        ))}
      </div>
    </div>
  );
}
