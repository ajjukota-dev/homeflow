import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Building2, Store, Users, Plus, Moon, Sun, Banknote, Scale, ClipboardCheck, HeartHandshake, Landmark } from "lucide-react";
import { SiteProgress } from "./pages/SiteProgress";
import { SalesInventory } from "./pages/SalesInventory";
import { CrmQueue } from "./pages/CrmQueue";
import { BookingWizard } from "./pages/BookingWizard";
import { Collections } from "./pages/Collections";
import { LegalFactory } from "./pages/LegalFactory";
import { QaHandover } from "./pages/QaHandover";
import { PostHandover } from "./pages/PostHandover";
import { ControlTower } from "./pages/ControlTower";
import { api, type Project, type Unit } from "./api";
import { Button } from "./ui/Button";
import { cn } from "./lib/utils";

type View = "site" | "sales" | "crm" | "accounts" | "legal" | "qa" | "after" | "tower";

const NAV: { id: View; label: string; role: string; short: string; Icon: typeof Building2 }[] = [
  { id: "site", label: "Project / Site", role: "Owns unit progress", short: "Site", Icon: Building2 },
  { id: "sales", label: "Sales", role: "Books, reads gates", short: "Sales", Icon: Store },
  { id: "crm", label: "CRM / RM", role: "Accepts, owns customers", short: "CRM", Icon: Users },
  { id: "accounts", label: "Accounts", role: "True-risk collections", short: "Cash", Icon: Banknote },
  { id: "legal", label: "Legal", role: "Documents & registration", short: "Legal", Icon: Scale },
  { id: "qa", label: "QA / Handover", role: "Evidence, then keys", short: "QA", Icon: ClipboardCheck },
  { id: "after", label: "After keys", role: "Warranty & DLP", short: "After", Icon: HeartHandshake },
  { id: "tower", label: "Management", role: "Five interventions", short: "Tower", Icon: Landmark },
];

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-subhead outline-none focus:border-accent";

export function App() {
  const [view, setView] = useState<View>("site");
  const [bookingUnit, setBookingUnit] = useState<Unit | null>(null);
  const [dark, setDark] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [npCode, setNpCode] = useState("");
  const [npName, setNpName] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    api.listProjects().then((ps) => {
      setProjects(ps);
      if (ps[0]) setProjectId((cur) => cur || ps[0].id);
    });
  }, []);

  async function createProject() {
    if (!npCode.trim() || !npName.trim()) return;
    const p = await api.createProject({ code: npCode, name: npName });
    setProjects((prev) => [...prev, p]);
    setProjectId(p.id);
    setNpCode("");
    setNpName("");
    setNewProjectOpen(false);
    go("site");
  }

  function go(v: View) {
    setBookingUnit(null);
    setView(v);
  }

  const themeBtn = (
    <button
      onClick={() => setDark((d) => !d)}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-subhead font-medium text-fg-muted hover:bg-surface-2"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span className="hidden md:inline">{dark ? "Light" : "Dark"}</span>
    </button>
  );

  const pages: Record<View, ReactNode> = {
    site: <SiteProgress projectId={projectId} />,
    sales: <SalesInventory projectId={projectId} onBook={setBookingUnit} />,
    crm: <CrmQueue />,
    accounts: <Collections projectId={projectId} />,
    legal: <LegalFactory projectId={projectId} />,
    qa: <QaHandover projectId={projectId} />,
    after: <PostHandover projectId={projectId} />,
    tower: <ControlTower projectId={projectId} />,
  };

  const content = bookingUnit ? (
    <BookingWizard
      unit={bookingUnit}
      onCancel={() => setBookingUnit(null)}
      onBooked={() => {
        setBookingUnit(null);
        setView("crm");
      }}
    />
  ) : (
    pages[view]
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="sticky top-0 hidden h-screen w-64 flex-none flex-col gap-1 border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="px-2 pb-2 text-title3 font-bold tracking-tight">HomeFlow</div>

        <div className="mb-3 rounded-lg bg-surface-2 p-2">
          <div className="px-1 pb-1 text-caption text-fg-subtle">Project</div>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-subhead font-semibold outline-none focus:border-accent"
            aria-label="Select project"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {newProjectOpen ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <input className={inputCls} placeholder="Code (e.g. WESTPARK)" value={npCode} onChange={(e) => setNpCode(e.target.value)} />
              <input className={inputCls} placeholder="Name (e.g. West Park)" value={npName} onChange={(e) => setNpName(e.target.value)} />
              <div className="flex gap-1.5">
                <Button size="sm" className="flex-1" onClick={createProject}>Create</Button>
                <Button size="sm" variant="ghost" onClick={() => setNewProjectOpen(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setNewProjectOpen(true)} className="mt-1.5 flex items-center gap-1 px-1 text-footnote font-medium text-accent">
              <Plus className="h-3.5 w-3.5" /> New project
            </button>
          )}
        </div>

        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={view === n.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                view === n.id ? "bg-surface-2" : "hover:bg-surface-2"
              )}
            >
              <n.Icon className={cn("h-5 w-5", view === n.id ? "text-accent" : "text-fg-muted")} />
              <span>
                <span className={cn("block text-subhead font-semibold", view === n.id && "text-accent")}>{n.label}</span>
                <span className="block text-caption text-fg-subtle">{n.role}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        {themeBtn}
      </aside>

      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface px-4 py-3 md:hidden">
        <span className="text-title3 font-bold tracking-tight">HomeFlow</span>
        <div className="flex-1" />
        <nav className="flex max-w-[70%] gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={view === n.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-footnote font-semibold transition-colors",
                view === n.id ? "bg-fg text-surface" : "bg-surface-2 text-fg-muted"
              )}
            >
              <n.Icon className="h-4 w-4" />
              {n.short}
            </button>
          ))}
        </nav>
        {themeBtn}
      </header>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-10">
        <div className="mx-auto max-w-5xl">{content}</div>
      </main>
    </div>
  );
}
