import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LogOut,
  Search as SearchIcon,
  User as UserIcon,
  ChevronRight,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

import { NAV_ITEMS } from "@/lib/constants";
import { useAuth, isSuperAdmin } from "@/lib/auth";
import { usePermissions } from "@/context/PermissionsContext";
import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { entityPath } from "@/lib/collab";
import NotificationsBell from "@/components/NotificationsBell";
import BrandMark from "@/components/BrandMark";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/format";

function useDebounced(value, delay = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 200);
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const boxRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancel = false;
    if (!debounced || debounced.trim().length < 1) {
      setResults(null);
      return;
    }
    setLoading(true);
    api
      .get(`/search`, { params: { q: debounced.trim() } })
      .then((r) => {
        if (!cancel) {
          setResults(r.data);
          setActiveIdx(-1);
        }
      })
      .catch((e) => {
        if (!cancel) apiErrorToast(e);
      })
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, [debounced]);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Flatten results in display order for keyboard navigation
  const flat = useMemo(() => {
    if (!results) return [];
    const out = [];
    for (const c of results.customers) out.push({ kind: "customer", id: c.id, code: c.code });
    for (const b of results.bookings) out.push({ kind: "booking", id: b.id, code: b.code });
    for (const u of results.units) out.push({ kind: "unit", id: u.id, code: u.code });
    for (const p of results.projects) out.push({ kind: "project", id: p.id, code: p.code });
    return out;
  }, [results]);

  const go = (kind, id) => {
    setOpen(false);
    setQ("");
    navigate(entityPath(kind, id));
  };

  const onKeyDown = (e) => {
    if (!open || flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const item = flat[Math.max(0, activeIdx)];
      if (item) {
        e.preventDefault();
        go(item.kind, item.id);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const total = flat.length;
  const isActive = (kind, id) => flat[activeIdx]?.kind === kind && flat[activeIdx]?.id === id;

  return (
    <div ref={boxRef} className="relative w-[420px] max-w-full" data-testid="global-search">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search customers, units, projects, bookings…"
          className="h-9 pl-8 text-sm bg-white border-warm-100 focus-visible:border-brand-500"
          data-testid="global-search-input"
        />
      </div>
      {open && q && (
        <div className="absolute left-0 right-0 top-11 z-50 rounded-lg border border-warm-100 bg-white shadow-lg max-h-[70vh] overflow-y-auto" data-testid="global-search-results">
          {loading && <div className="p-3 text-xs text-slate-500">Searching…</div>}
          {!loading && results && total === 0 && (
            <div className="p-4 text-sm text-slate-500">No results for “{q}”.</div>
          )}
          {!loading && results && (
            <div className="divide-y divide-warm-100">
              {results.customers.length > 0 && (
                <SearchGroup title="Customers" count={results.customers.length}>
                  {results.customers.map((c) => (
                    <SearchRow
                      key={c.id}
                      code={c.code}
                      title={c.primary_name}
                      subtitle={[c.email, c.phone, c.city].filter(Boolean).join(" • ")}
                      active={isActive("customer", c.id)}
                      onClick={() => go("customer", c.id)}
                      testId={`search-customer-${c.code}`}
                    />
                  ))}
                </SearchGroup>
              )}
              {results.bookings.length > 0 && (
                <SearchGroup title="Bookings" count={results.bookings.length}>
                  {results.bookings.map((b) => (
                    <SearchRow
                      key={b.id}
                      code={b.code}
                      title={`Booking ${b.code}`}
                      subtitle={`${b.status} • ${formatINR(b.agreement_value_inr)}`}
                      active={isActive("booking", b.id)}
                      onClick={() => go("booking", b.id)}
                      testId={`search-booking-${b.code}`}
                    />
                  ))}
                </SearchGroup>
              )}
              {results.units.length > 0 && (
                <SearchGroup title="Units" count={results.units.length}>
                  {results.units.map((u) => (
                    <SearchRow
                      key={u.id}
                      code={u.code}
                      title={`Unit ${u.code}`}
                      subtitle={`${u.unit_type || ""} • ${u.status}`}
                      active={isActive("unit", u.id)}
                      onClick={() => go("unit", u.id)}
                      testId={`search-unit-${u.code}`}
                    />
                  ))}
                </SearchGroup>
              )}
              {results.projects.length > 0 && (
                <SearchGroup title="Projects" count={results.projects.length}>
                  {results.projects.map((p) => (
                    <SearchRow
                      key={p.id}
                      code={p.code}
                      title={p.name}
                      subtitle={`${p.type} • ${p.location}`}
                      active={isActive("project", p.id)}
                      onClick={() => go("project", p.id)}
                      testId={`search-project-${p.code}`}
                    />
                  ))}
                </SearchGroup>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({ title, count, children }) {
  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1.5 bg-warm-50 border-b border-warm-100">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</span>
        <span className="text-[11px] text-slate-400">{count}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function SearchRow({ code, title, subtitle, onClick, active, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full flex items-center justify-between gap-3 px-3 py-2 text-left",
        active ? "bg-brand-50" : "hover:bg-warm-50",
      ].join(" ")}
      data-testid={testId}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-slate-500">{code}</span>
          <span className="text-sm text-slate-900 truncate">{title}</span>
        </div>
        {subtitle && <div className="text-xs text-slate-500 truncate">{subtitle}</div>}
      </div>
      <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
    </button>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { perms } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();

  const visibleNav = useMemo(() => {
    if (!user) return [];
    const roleCode = (user?.role?.code || "").toUpperCase();
    const isSA = isSuperAdmin(user);
    const modules = perms?.modules || {};
    return NAV_ITEMS.filter((n) => {
      if (n.superAdminOnly && !isSA) return false;
      if (n.allowedRoleCodes && n.allowedRoleCodes.length > 0) {
        if (!isSA && !n.allowedRoleCodes.includes(roleCode)) return false;
      }
      // Matrix gate (Phase B): hide items whose module resolves to 'none'
      if (!isSA && n.module && n.module !== "dashboard") {
        const perm = modules[n.module];
        if (!perm || perm === "none") return false;
      }
      return true;
    });
  }, [user, perms]);

  // "Portal unavailable" — matrix returned empty for a legitimate signed-in user
  // (e.g. the disabled `customer` role). Super admin always has access.
  const portalUnavailable = useMemo(() => {
    if (!user || !perms) return false;
    if (perms.isSuperAdmin) return false;
    const modules = perms.modules || {};
    // If every module (except dashboard) is 'none', treat portal as unavailable.
    return Object.entries(modules).every(([k, v]) => k === "dashboard" || v === "none");
  }, [user, perms]);

  const onLogout = async () => {
    await logout();
    navigate("/login");
  };

  // Portal-unavailable full-screen empty state (no sidebar, no topbar)
  if (portalUnavailable) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "var(--content-bg)" }} data-testid="portal-unavailable">
        <div className="text-xl font-heading font-semibold text-gray-900 mb-3">Portal unavailable</div>
        <p className="text-sm text-gray-500 max-w-md mb-6">
          Your account is not yet configured for the Pranava HomeFlow portal.
          Please contact your Pranava admin.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onLogout}
          data-testid="portal-unavailable-logout"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--content-bg)" }}>
      {/* Sidebar — deep navy */}
      <aside
        className="fixed inset-y-0 left-0 z-40 w-64 flex flex-col border-r border-navy-800"
        style={{ background: "var(--sidebar-bg)", color: "var(--sidebar-fg)" }}
        data-testid="app-sidebar"
      >
        <div className="h-16 flex items-center px-4 border-b border-navy-800/60">
          <Link to="/dashboard" className="flex items-center gap-2.5" data-testid="sidebar-brand">
            <img
              src="/assets/pranava-group-logo.png"
              alt="Pranava Group"
              className="rounded-md bg-white p-1 shadow-sm"
              style={{ height: 40, width: "auto", display: "block" }}
              data-testid="sidebar-pranava-logo"
            />
            <span
              className="uppercase font-semibold text-white"
              style={{ fontSize: 12, letterSpacing: "0.22em" }}
              data-testid="sidebar-homeflow-label"
            >
              HomeFlow
            </span>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.key}
                to={item.to}
                data-testid={`sidebar-nav-${item.key}`}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-2.5 rounded-md py-2.5 pr-2.5 text-sm transition-colors",
                    isActive
                      ? "border-l-4 border-brand-500 bg-navy-800 pl-[calc(0.75rem-4px)] font-bold text-white shadow-inner"
                      : "border-l-4 border-transparent pl-[calc(0.75rem-4px)] font-medium text-slate-300 hover:bg-navy-800/60 hover:text-white",
                  ].join(" ")
                }
                end={item.to === "/dashboard"}
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-white" : "text-slate-400"}`} />
                    <span className="truncate">{item.label}</span>
                    {!item.phase1 && (
                      <Lock className="ml-auto h-3 w-3 text-slate-500" aria-label="Coming later" />
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-navy-800/60 px-4 py-3 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-slate-400">Phase 8 · v0.8.0</span>
          <span
            className="inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--brand)" }}
            aria-hidden
          />
        </div>
      </aside>

      {/* Topbar — white with brand orange accent line */}
      <header
        className="fixed top-0 left-64 right-0 z-30 h-16 bg-white flex items-center justify-between px-6 border-b-2 border-brand-500"
        data-testid="app-topbar"
      >
        <div className="flex items-center gap-5 min-w-0">
          <Link to="/dashboard" className="hidden md:flex items-center" data-testid="topbar-brand">
            <BrandMark variant="dark" size="sm" />
          </Link>
          <GlobalSearch />
        </div>
        <div className="flex items-center gap-3">
          <NotificationsBell />
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-warm-100 bg-warm-50 pl-1.5 pr-3 py-1" data-testid="user-badge">
            <div
              className="h-7 w-7 rounded-full text-white flex items-center justify-center"
              style={{ background: "var(--sidebar-bg)" }}
            >
              <UserIcon className="h-3.5 w-3.5" />
            </div>
            <div className="leading-tight">
              <div className="text-xs font-medium text-slate-900" data-testid="user-badge-name">{user?.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500" data-testid="user-badge-role">{user?.role?.name}</div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            className="h-9 text-slate-600 hover:text-brand-600 hover:bg-brand-50"
            data-testid="logout-button"
          >
            <LogOut className="h-4 w-4" /> Logout
          </Button>
        </div>
      </header>

      {/* Main */}
      <main className="pl-64 pt-16 min-h-screen">
        <div className="px-8 py-6 max-w-[1400px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
