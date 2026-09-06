import { useState } from "react";
import { TABS, type TabKey, type MoreKey } from "./nav";
import { cn } from "./lib/utils";
import { Home } from "./pages/Home";
import { Journey } from "./pages/Journey";
import { Payments } from "./pages/Payments";
import { Documents } from "./pages/Documents";
import { More } from "./pages/More";
import { MyHome } from "./pages/MyHome";
import { Registration } from "./pages/Registration";
import { Handover } from "./pages/Handover";
import { Requests } from "./pages/Requests";
import { Commitments } from "./pages/Commitments";
import { Passport } from "./pages/Passport";
import { Profile } from "./pages/Profile";
import { Updates } from "./pages/Updates";

const TAB_SCREENS: Record<Exclude<TabKey, "more">, () => JSX.Element> = {
  home: Home,
  journey: Journey,
  payments: Payments,
  documents: Documents,
};

/** Root shell — bottom tab bar for the 4 most-visited areas + "More" for the rest
 *  (26-customer-portal.md Screens; see nav.ts for why they're split this way). */
export function App() {
  const [tab, setTab] = useState<TabKey>("home");
  const [moreScreen, setMoreScreen] = useState<MoreKey | "updates" | null>(null);

  if (moreScreen) {
    const back = () => setMoreScreen(null);
    switch (moreScreen) {
      case "myhome":
        return <MyHome onBack={back} />;
      case "registration":
        return <Registration onBack={back} />;
      case "handover":
        return <Handover onBack={back} />;
      case "requests":
        return <Requests onBack={back} />;
      case "commitments":
        return <Commitments onBack={back} />;
      case "passport":
        return <Passport onBack={back} />;
      case "profile":
        return <Profile onBack={back} />;
      case "updates":
        return <Updates onBack={back} />;
    }
  }

  const Screen = tab === "more" ? () => <More onOpen={setMoreScreen} /> : TAB_SCREENS[tab];

  return (
    <div className="min-h-screen bg-bg">
      <Screen />
      <nav className="fixed inset-x-0 bottom-0 border-t border-line bg-surface">
        <div className="mx-auto flex max-w-md items-stretch justify-between px-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn("flex flex-1 flex-col items-center gap-1 py-2.5 text-caption font-medium", tab === t.key ? "text-accent" : "text-fg-subtle")}
            >
              <t.icon className="h-5 w-5" />
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
