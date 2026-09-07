import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardBody, Badge } from "@homeflow/ui";
import { FileStack } from "lucide-react";
import { documentsApi, type DocumentRow, type DocumentStatus } from "./api";
import { DOCUMENT_STATUS_ORDER, DOCUMENT_STATUS_LABEL, documentStatusTone, prettifyCode } from "./labels";
import { GenerateWizard } from "./GenerateWizard";
import { DocumentDrawer } from "./DocumentDrawer";

// 22-document-factory.md Screens: "Legal Factory: queue by status ... archive search with checksum
// display". This is the doc_factory_document system (the other 12 document families) — a separate
// screen from LegalFactory.tsx's own AOS/registration workbench (legacy legal-docs.ts path), since
// this spec's own backend Build note says the two systems share no rows.
function DocumentCard({ doc, onOpen }: { doc: DocumentRow; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-accent">
      <div className="text-caption font-medium uppercase tracking-wide text-fg-subtle">{doc.code}</div>
      <div className="mt-1 text-subhead font-semibold text-fg">{prettifyCode(doc.family_code)}</div>
      <div className="mt-1 text-footnote text-fg-muted">
        Villa {doc.unit_number ?? "—"} · {doc.customer_name ?? "—"} · v{doc.version}
      </div>
      {doc.is_draft_watermarked && <Badge className="mt-2 bg-overdue/10 text-overdue">DRAFT</Badge>}
    </button>
  );
}

export function DocumentFactory({ projectId, roles }: { projectId: string; roles: string[] }) {
  const [items, setItems] = useState<DocumentRow[] | null>(null);
  const [error, setError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    if (!projectId) return;
    setError(false);
    documentsApi.list({ project_id: projectId }).then(setItems).catch(() => setError(true));
  }, [projectId]);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    if (!items) return items;
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((d) => d.code.toLowerCase().includes(q) || (d.customer_name ?? "").toLowerCase().includes(q) || (d.unit_number ?? "").toLowerCase().includes(q));
  }, [items, search]);

  const byStatus = useMemo(() => {
    const map = new Map<DocumentStatus, DocumentRow[]>();
    for (const it of filtered ?? []) {
      if (!map.has(it.status)) map.set(it.status, []);
      map.get(it.status)!.push(it);
    }
    return map;
  }, [filtered]);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-large font-bold">Legal Document Factory</h1>
          <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
            Allotment letters, demand letters, receipts, NOCs, possession letters, customisation agreements and more — generated only from an approved template, every revision immutable.
          </p>
        </div>
        <GenerateWizard projectId={projectId} onGenerated={load} />
      </header>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
        </Card>
      )}
      {!error && items === null && (
        <div className="flex gap-3 overflow-x-auto" aria-busy="true" aria-label="Loading documents">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 w-64 shrink-0 animate-pulse rounded-xl border border-line bg-surface-2" />
          ))}
        </div>
      )}
      {!error && items !== null && items.length === 0 && (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-10 text-center">
            <FileStack className="h-8 w-8 text-fg-subtle" />
            <p className="text-subhead text-fg-muted">No documents generated yet for this project.</p>
          </CardBody>
        </Card>
      )}
      {!error && items !== null && items.length > 0 && (
        <>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search archive by code, customer or unit…"
            aria-label="Search document archive"
            className="mb-4 w-full max-w-sm rounded-lg border border-line bg-surface px-3 py-2 text-body"
          />
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3">
              {DOCUMENT_STATUS_ORDER.filter((s) => (byStatus.get(s)?.length ?? 0) > 0).map((status) => (
                <div key={status} className="w-72 shrink-0">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <h2 className="text-footnote font-semibold uppercase tracking-wide text-fg-subtle">{DOCUMENT_STATUS_LABEL[status]}</h2>
                    <Badge className={documentStatusTone(status)}>{byStatus.get(status)!.length}</Badge>
                  </div>
                  <div className="flex flex-col gap-2">
                    {byStatus.get(status)!.map((doc) => (
                      <DocumentCard key={doc.id} doc={doc} onOpen={() => setOpenId(doc.id)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <DocumentDrawer documentId={openId} roles={roles} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  );
}
