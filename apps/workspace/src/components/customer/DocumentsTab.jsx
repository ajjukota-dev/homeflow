import { Link } from "react-router-dom";
import StatusPill from "@/components/StatusPill";
import { DOC_STATUS_TONE } from "@/lib/documents";
import { formatDate } from "@/lib/format";

export default function DocumentsTab({ documents, loading, onOpen, showCustomerColumn = false }) {
  if (loading) return <div className="text-sm text-gray-500">Loading documents…</div>;
  if (!documents || documents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500" data-testid="documents-empty">
        No documents in this view.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden" data-testid="documents-table">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Category</Th>
            <Th>Title</Th>
            {showCustomerColumn && <Th>Customer</Th>}
            <Th>Required</Th>
            <Th>Version</Th>
            <Th>Uploaded</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <tr key={d.id} className="h-11 border-t border-gray-100 hover:bg-brand-50/30 cursor-pointer" onClick={() => onOpen?.(d)} data-testid={`docs-row-${d.category.replace(/\s+/g,'-')}-${d.id.slice(0,4)}`}>
              <td className="px-3 text-sm text-gray-900">{d.category}</td>
              <td className="px-3 text-sm text-gray-700 truncate max-w-[240px]">{d.title}</td>
              {showCustomerColumn && (
                <td className="px-3 text-sm">
                  <Link to={`/customers/${d._customer?.id}?tab=documents`} className="text-navy-900 hover:underline" onClick={(e) => e.stopPropagation()}>
                    <span className="font-mono text-gray-500 mr-1">{d._customer?.code}</span>{d._customer?.primary_name}
                  </Link>
                </td>
              )}
              <td className="px-3 text-sm">{d.required ? <span className="text-red-600 font-medium">Yes</span> : <span className="text-gray-500">No</span>}</td>
              <td className="px-3 text-sm tabular-nums">{d.latest_version || "—"}</td>
              <td className="px-3 text-sm text-gray-600">{d.latest_attachment?.uploaded_at ? formatDate(d.latest_attachment.uploaded_at) : "—"}</td>
              <td className="px-3"><StatusPill status={d.status} tone={DOC_STATUS_TONE[d.status]} /></td>
              <td className="px-3 text-[11px] text-navy-900">Open</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }) {
  return <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">{children}</th>;
}
