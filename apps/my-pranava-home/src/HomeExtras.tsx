import { FileCheck, KeyRound, BookOpen } from "lucide-react";
import type { Home as HomeData } from "./api";

/** T4 Home Passport, T5 legal-safety corner, T6 keys window — customer-transparency.md. */

export function Passport({ items }: { items: HomeData["passport"] }) {
  if (!items?.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-title font-semibold">
        <BookOpen className="h-5 w-5 text-accent" /> Your home passport
      </h2>
      <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
        {items.map((item) => (
          <div key={item.name} className="border-b border-line px-3 py-3 last:border-b-0">
            <div className="text-body font-semibold">{item.name}</div>
            <p className="text-footnote text-fg-muted">
              {[item.brand_model, item.paint_tile_code, item.warranty_months ? `${item.warranty_months}-month warranty` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LegalCorner({ legal }: { legal: HomeData["legal"] }) {
  if (!legal) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-title font-semibold">
        <FileCheck className="h-5 w-5 text-accent" /> Your paperwork
      </h2>
      <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
        {legal.rera_reg_no && (
          <p className="text-body">
            RERA <span className="font-semibold">{legal.rera_reg_no}</span>
          </p>
        )}
        {legal.escrow_note && <p className="mt-2 text-footnote text-fg-muted">{legal.escrow_note}</p>}
        <ul className="mt-4 divide-y divide-line">
          {legal.my_documents.map((d) => (
            <li key={d.name} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
              <span className="text-body">{d.name}</span>
              <span className="text-footnote font-medium text-ontrack">{d.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Keys({ keys }: { keys: HomeData["keys"] }) {
  if (!keys) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-title font-semibold">
        <KeyRound className="h-5 w-5 text-accent" /> Your keys
      </h2>
      <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <p className="text-title font-semibold">{keys.expected_window}</p>
        <p className="mt-1 text-footnote text-fg-muted">{keys.confidence_label}</p>
        {keys.my_todos.length > 0 && (
          <ul className="mt-4 space-y-2">
            {keys.my_todos.map((t) => (
              <li key={t.label} className="text-body">
                {t.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
