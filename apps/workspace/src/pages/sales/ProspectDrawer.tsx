import { useEffect, useState } from "react";
import { Drawer, DrawerContent, Button, Select, SelectTrigger, SelectOptions, Input, Skeleton, EmptyState } from "@homeflow/ui";
import { Users2 } from "lucide-react";
import { ApiError } from "../../auth/api";
import { salesApi, type Prospect, type ProspectNeed, type StoredMatch, type Importance, type InventoryUnit } from "./api";
import { CHANGE_CATEGORIES, CATEGORY_LABEL, IMPORTANCE_LABEL } from "./labels";

const IMPORTANCES: Importance[] = ["MUST_HAVE", "PREFERRED", "NOT_IMPORTANT"];

/** 24-sales-inventory-discovery.md rule 4/5/9 Screen "Prospect discovery" — needs capture (the
 *  match engine's own real inputs, sales/match.ts) and stored matches, per prospect. */
export function ProspectDrawer({
  prospect,
  units,
  onClose,
  onChanged,
}: {
  prospect: Prospect | null;
  units: InventoryUnit[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [needs, setNeeds] = useState<Record<string, ProspectNeed> | null>(null);
  const [matches, setMatches] = useState<StoredMatch[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");

  useEffect(() => {
    if (!prospect) return;
    setNeeds(null);
    setMatches(null);
    setError(null);
    setLostReason("");
    salesApi.getProspect(prospect.id).then((p) => {
      const map: Record<string, ProspectNeed> = {};
      for (const n of p.needs) map[n.category_code] = n;
      setNeeds(map);
    });
    salesApi.getMatches(prospect.id).then(setMatches).catch(() => setMatches([]));
  }, [prospect]);

  async function saveNeeds() {
    if (!prospect || !needs) return;
    setSaving(true);
    setError(null);
    try {
      const list = CHANGE_CATEGORIES.filter((c) => needs[c]).map((c) => needs[c]);
      await salesApi.putNeeds(prospect.id, list);
      const m = await salesApi.getMatches(prospect.id, units.slice(0, 20).map((u) => u.unit_id));
      setMatches(m);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save needs.");
    } finally {
      setSaving(false);
    }
  }

  async function markLost() {
    if (!prospect || !lostReason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await salesApi.markLost(prospect.id, lostReason.trim());
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't mark lost.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={!!prospect} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent open={!!prospect} title={prospect ? `${prospect.name} (${prospect.code})` : "Prospect"}>
        {!prospect ? null : (
          <div className="flex flex-col gap-6">
            <p className="-mt-2 text-footnote text-fg-muted">Requirement needs feed rule 4's compatibility score directly — no free text scoring.</p>
            <section>
              <h3 className="mb-2 text-subhead font-semibold text-fg">Personalisation needs</h3>
              {!needs ? (
                <div className="flex flex-col gap-2">
                  <Skeleton variant="text" />
                  <Skeleton variant="text" />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {CHANGE_CATEGORIES.map((c) => (
                    <div key={c} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                      <span className="text-footnote text-fg">{CATEGORY_LABEL[c]}</span>
                      <Select
                        value={needs[c]?.importance ?? ""}
                        onValueChange={(v) => setNeeds((cur) => ({ ...cur, [c]: { category_code: c, importance: v as Importance } }))}
                      >
                        <SelectTrigger placeholder="Not captured" className="w-40" />
                        <SelectOptions options={IMPORTANCES.map((i) => ({ value: i, label: IMPORTANCE_LABEL[i] }))} />
                      </Select>
                    </div>
                  ))}
                  <Button size="sm" className="mt-1 self-start" onClick={saveNeeds} disabled={saving}>
                    {saving ? "Saving…" : "Save needs & rescore"}
                  </Button>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-subhead font-semibold text-fg">Requirement matches</h3>
              {matches === null ? (
                <Skeleton variant="text" />
              ) : matches.length === 0 ? (
                <EmptyState icon={Users2} message="No units scored yet — save needs above, then compare units from Inventory." />
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {matches.map((m) => {
                    const u = units.find((x) => x.unit_id === m.unit_id);
                    return (
                      <li key={m.unit_id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                        <span className="text-footnote text-fg">Villa {u?.unit_number ?? m.unit_id.slice(0, 8)}</span>
                        <span className="flex items-center gap-2">
                          {m.freshness !== "FRESH" && <span className="text-caption text-atrisk">{m.freshness === "STALE" ? "stale" : "verify"}</span>}
                          <span className="font-mono text-subhead font-semibold text-accent">{Math.round(m.score)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {prospect.status === "ACTIVE" && (
              <section className="border-t border-line pt-4">
                <h3 className="mb-2 text-subhead font-semibold text-fg">Mark lost</h3>
                <div className="flex gap-2">
                  <Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Reason (e.g. chose a competitor project)" />
                  <Button variant="secondary" onClick={markLost} disabled={saving || !lostReason.trim()}>Mark lost</Button>
                </div>
              </section>
            )}

            {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
