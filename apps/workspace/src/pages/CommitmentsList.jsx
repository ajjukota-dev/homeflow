import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import CommitmentsTab from "@/components/customer/CommitmentsTab";
import CommitmentDetail from "@/components/customer/CommitmentDetail";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const TABS = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "awaiting", label: "Awaiting Approval" },
  { key: "inprogress", label: "In Progress" },
  { key: "completed", label: "Completed" },
];

export default function CommitmentsList() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = useMemo(() => {
    const q = new URLSearchParams(location.search).get("t") || "all";
    return TABS.some((t) => t.key === q) ? q : "all";
  }, [location.search]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (currentTab === "overdue") params.overdue = true;
      if (currentTab === "awaiting") params.status = "Awaiting Approval";
      if (currentTab === "inprogress") params.status = "In Progress";
      if (currentTab === "completed") params.status = "Completed";
      const r = await api.get("/commitments", { params });
      setRows(r.data || []);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [currentTab]);

  const setTab = (v) => {
    if (v === currentTab) return;
    const next = new URLSearchParams(location.search);
    if (v === "all") next.delete("t"); else next.set("t", v);
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  };

  return (
    <div className="space-y-6" data-testid="commitments-list-page">
      <PageHeader title="Customer Commitments" subtitle="Every promise made to a customer — tracked, approved, delivered, confirmed." />
      <Tabs value={currentTab} onValueChange={setTab}>
        <TabsList data-testid="commitments-tabs">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} data-testid={`commit-tab-${t.key}`}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            <CommitmentsTab rows={rows} loading={loading} tabKey={t.key} showCustomerColumn onOpen={setOpen} />
          </TabsContent>
        ))}
      </Tabs>
      <CommitmentDetail
        cid={open?.id}
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        onChanged={load}
      />
    </div>
  );
}
