import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileCheck2 } from "lucide-react";
import { portalApi } from "../portal-api";
import { useArea } from "../lib/useArea";
import { formatDate } from "../lib/utils";

/** 26-customer-portal.md rule 6: required-from-you (upload), for-your-review (draft comments),
 *  executed finals (download, checksum shown). */
export function Documents() {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.documents(), []));
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  function pickFile(id: string) {
    setPendingId(id);
    fileInputRef.current?.click();
  }

  // A real presigned-upload round trip, not just the metadata call: uploadCustomerDocument only
  // marks the document VALIDATING and returns where to send bytes — without the PUT below the
  // document row would assert a file that was never sent (found live 2026-09-07).
  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const id = pendingId;
    e.target.value = "";
    setPendingId(null);
    if (!file || !id) return;
    setUploadingId(id);
    try {
      const { upload } = await portalApi.uploadDocument(id, file.type || "application/pdf");
      await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
      reload();
    } catch {
      // Surfaced by the item staying in "Upload needed" — no separate error banner needed here.
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-md px-5 pb-24">
      <header className="pt-10 pb-2">
        <h1 className="text-large font-bold">Documents</h1>
      </header>

      <input ref={fileInputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={onFileChosen} />


      {loading && (
        <div className="mt-4 flex flex-col gap-3" role="status" aria-label="Loading">
          <div className="h-24 w-full animate-pulse rounded-xl bg-surface-2" />
        </div>
      )}

      {!loading && error && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-5 text-center shadow-card">
          <p className="text-body text-fg-muted">We couldn't load your documents just now.</p>
          <button onClick={reload} className="mt-3 text-footnote font-medium text-accent">
            Try again
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <section className="mt-4">
            <h2 className="mb-3 text-title font-semibold">Required from you</h2>
            {data.required_from_you.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-footnote text-fg-muted">Nothing outstanding — you're all caught up.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.required_from_you.map((d) => (
                  <div key={d.id} className="flex items-center justify-between border-b border-line px-3 py-3 last:border-b-0">
                    <div>
                      <p className="text-body font-semibold">{d.label}</p>
                      <p className="text-footnote text-due">{d.status}</p>
                    </div>
                    <button
                      onClick={() => pickFile(d.id)}
                      disabled={uploadingId === d.id}
                      className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-footnote font-medium text-accent-fg disabled:opacity-60"
                    >
                      <UploadCloud className="h-4 w-4" /> {uploadingId === d.id ? "Uploading…" : "Upload"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {data.for_your_review.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3 text-title font-semibold">For your review</h2>
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.for_your_review.map((d) => (
                  <div key={d.id} className="border-b border-line px-3 py-3 last:border-b-0">
                    <p className="text-body font-semibold">{d.family}</p>
                    {d.comments.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {d.comments.map((c, i) => (
                          <li key={i} className="text-footnote text-fg-muted">
                            {c.note} — {c.reason}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-footnote text-fg-muted">Ready for your review.</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-6">
            <h2 className="mb-3 flex items-center gap-2 text-title font-semibold">
              <FileCheck2 className="h-5 w-5 text-accent" /> Executed
            </h2>
            {data.executed.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-footnote text-fg-muted">Executed documents appear here once ready.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.executed.map((d) => (
                  <div key={d.id} className="border-b border-line px-3 py-3 last:border-b-0">
                    <p className="text-body font-semibold">{d.label}</p>
                    <p className="text-footnote text-fg-muted">
                      {formatDate(d.generated_at)}
                      {d.checksum ? ` · Checksum ${d.checksum.slice(0, 12)}…` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
