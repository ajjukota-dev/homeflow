// 29-communications.md rule 7 — internal notes, reusable on any entity (Customer 360 first;
// same props shape lets Booking/Unit 360 adopt it later without change). Never customer-visible —
// no CUSTOMER_VISIBLE toggle exists here at all, unlike Communications' visibility field.
import { useEffect, useState } from "react";
import { StickyNote, CircleAlert } from "lucide-react";
import { Button, Textarea, EmptyState, Skeleton, Avatar } from "@homeflow/ui";
import { communicationsApi, type InternalNoteRow } from "./api";

export function InternalNotesPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [notes, setNotes] = useState<InternalNoteRow[] | null>(null);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setError(false);
    communicationsApi.notes(entityType, entityId).then(setNotes).catch(() => setError(true));
  }
  useEffect(load, [entityType, entityId]);

  async function submit() {
    if (!draft.trim()) return;
    setBusy(true);
    setSaveError(null);
    try {
      await communicationsApi.createNote({ entity_type: entityType, entity_id: entityId, body: draft.trim() });
      setDraft("");
      load();
    } catch {
      setSaveError("Couldn't save that note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
        <label htmlFor="new-note" className="text-footnote font-medium text-fg-muted">
          Add an internal note — visible to staff only, never shown to the customer
        </label>
        <Textarea id="new-note" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} placeholder="Add context for the team…" />
        {saveError && (
          <p role="alert" className="text-footnote text-overdue">{saveError}</p>
        )}
        <div>
          <Button size="sm" onClick={submit} disabled={busy || !draft.trim()}>{busy ? "Saving…" : "Add note"}</Button>
        </div>
      </div>

      {error && <EmptyState icon={CircleAlert} message="Couldn't load notes." action={{ label: "Retry", onClick: load }} />}
      {!error && notes === null && (
        <div className="flex flex-col gap-2">
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {!error && notes !== null && notes.length === 0 && <EmptyState icon={StickyNote} message="No internal notes yet." />}
      {!error && notes !== null && notes.length > 0 && (
        <ul className="flex flex-col gap-3">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-3">
              <Avatar name={n.author_name ?? "Staff"} size="sm" />
              <div className="flex-1 rounded-lg border border-line bg-surface p-3">
                <p className="text-caption font-medium text-fg-muted">{n.author_name ?? "Staff"}</p>
                <p className="whitespace-pre-wrap text-footnote text-fg">{n.body}</p>
                <p className="mt-1 text-caption text-fg-subtle">{new Date(n.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
