import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import DocumentsTab from "@/components/customer/DocumentsTab";
import DocumentDetail from "@/components/customer/DocumentDetail";
import { DOC_CATEGORIES } from "@/lib/documents";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const STATUS_OPTIONS = ["All", "Required", "Received", "Under Review", "Verified", "Rejected", "Expired", "Not Applicable"];

export default function DocumentsList() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDoc, setOpenDoc] = useState(null);
  const [query, setQuery] = useState("");

  const status = new URLSearchParams(location.search).get("status") || "All";
  const category = new URLSearchParams(location.search).get("category") || "All";

  const setParam = (k, v) => {
    const next = new URLSearchParams(location.search);
    if (!v || v === "All") next.delete(k); else next.set(k, v);
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (status !== "All") params.status = status;
      if (category !== "All") params.category = category;
      const r = await api.get("/documents", { params });
      setDocuments(r.data || []);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, category]);

  const filtered = useMemo(() => {
    if (!query) return documents;
    const q = query.toLowerCase();
    return documents.filter((d) =>
      (d.title || "").toLowerCase().includes(q) ||
      (d._customer?.primary_name || "").toLowerCase().includes(q) ||
      (d._customer?.code || "").toLowerCase().includes(q)
    );
  }, [documents, query]);

  return (
    <div className="space-y-6" data-testid="documents-list-page">
      <PageHeader
        title="Documents"
        subtitle="Global document queue across all customers. Filter by status or category."
      />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-[11px] text-gray-500 mb-1">Status</div>
          <Select value={status} onValueChange={(v) => setParam("status", v)}>
            <SelectTrigger className="h-8 w-44 text-xs" data-testid="doc-filter-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-[11px] text-gray-500 mb-1">Category</div>
          <Select value={category} onValueChange={(v) => setParam("category", v)}>
            <SelectTrigger className="h-8 w-52 text-xs" data-testid="doc-filter-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All categories</SelectItem>
              {DOC_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[220px]">
          <div className="text-[11px] text-gray-500 mb-1">Search</div>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title or customer…" className="h-8 text-sm" data-testid="doc-filter-search" />
        </div>
      </div>

      <DocumentsTab documents={filtered} loading={loading} showCustomerColumn onOpen={setOpenDoc} />

      <DocumentDetail
        docId={openDoc?.id}
        open={Boolean(openDoc)}
        onClose={() => setOpenDoc(null)}
        onChanged={load}
      />
    </div>
  );
}
