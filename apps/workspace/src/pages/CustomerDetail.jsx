import { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Users2, Mail, Phone, MapPin, CreditCard } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import StatusPill from "@/components/StatusPill";
import CollaborationPanel from "@/components/CollaborationPanel";
import { formatDate, formatINR } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { usePermissions, useCan } from "@/context/PermissionsContext";
import RestrictedField from "@/components/rbac/RestrictedField";
import JourneyTab from "@/components/journey/JourneyTab";
import DocumentsTab from "@/components/customer/DocumentsTab";
import DocumentDetail from "@/components/customer/DocumentDetail";
import CommitmentsTab from "@/components/customer/CommitmentsTab";
import CommitmentDetail from "@/components/customer/CommitmentDetail";
import FinancialsTab from "@/components/customer/FinancialsTab";
import LoanTab from "@/components/customer/LoanTab";
import LegalTab from "@/components/customer/LegalTab";
import RegistrationTab from "@/components/customer/RegistrationTab";
import UnitReadinessTab from "@/components/customer/UnitReadinessTab";
import SnagsTab from "@/components/customer/SnagsTab";
import HandoverTab from "@/components/customer/HandoverTab";
import CommunicationsTab from "@/components/customer/CommunicationsTab";
import EscalationsTab from "@/components/customer/EscalationsTab";

const TABS = [
  { key: "overview", label: "Overview", module: "customer_overview" },
  { key: "journey", label: "Journey", module: "customer_journey" },
  { key: "documents", label: "Documents", module: "customer_documents" },
  { key: "commitments", label: "Commitments", module: "customer_commitments" },
  { key: "financials", label: "Financials", module: "customer_financials" },
  { key: "loan", label: "Loan", module: "customer_loan" },
  { key: "legal", label: "Legal", module: "customer_legal" },
  { key: "registration", label: "Registration", module: "customer_registration" },
  { key: "unit-readiness", label: "Unit Readiness", module: "customer_unit_readiness" },
  { key: "snags", label: "Snags", module: "customer_snags" },
  { key: "handover", label: "Handover", module: "customer_handover" },
  { key: "communications", label: "Communications", module: "customer_communications" },
  { key: "escalations", label: "Escalations", module: "escalations" },
];

export default function CustomerDetail() {
  const { id } = useParams();
  const { perms } = usePermissions();
  const [customer, setCustomer] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDoc, setOpenDoc] = useState(null);
  const [openCommit, setOpenCommit] = useState(null);
  const [openEscCount, setOpenEscCount] = useState(0);

  // Matrix-driven tab visibility (Phase B).
  const visibleTabs = (() => {
    if (!perms) return TABS; // don't hide while loading
    if (perms.isSuperAdmin) return TABS;
    const modules = perms.modules || {};
    return TABS.filter((t) => {
      const p = modules[t.module];
      return p && p !== "none";
    });
  })();

  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = (() => {
    const q = searchParams.get("tab") || "overview";
    // If the requested tab is not in the visible set, silently switch to the first visible one.
    const isVisible = visibleTabs.some((t) => t.key === q);
    if (isVisible) return q;
    return visibleTabs[0]?.key || "overview";
  })();

  // Auto-switch URL param if role can't see the current tab
  useEffect(() => {
    if (!perms || perms.isSuperAdmin) return;
    const q = searchParams.get("tab");
    if (!q) return;
    const inVisible = visibleTabs.some((t) => t.key === q);
    if (!inVisible && visibleTabs[0]) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", visibleTabs[0].key);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms, id]);

  const setTab = (v) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", v);
    setSearchParams(next, { replace: true });
  };

  const loadDocsCommits = async () => {
    try {
      const [d, c] = await Promise.all([
        api.get(`/documents`, { params: { customer_id: id } }),
        api.get(`/commitments`, { params: { customer_id: id } }),
      ]);
      setDocuments(d.data || []);
      setCommitments(c.data || []);
    } catch (e) {
      apiErrorToast(e);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [c, b, esc] = await Promise.all([
          api.get(`/customers/${id}`),
          api.get(`/bookings`, { params: { customer_id: id } }),
          api.get(`/escalations`, { params: { customer_id: id, status: "open" } }).catch(() => ({ data: [] })),
        ]);
        if (!alive) return;
        setCustomer(c.data);
        setBookings(b.data || []);
        setOpenEscCount((esc.data || []).length);
        await loadDocsCommits();
      } catch (e) {
        apiErrorToast(e);
      } finally {
        alive && setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="text-sm text-gray-500">Loading customer…</div>;
  if (!customer) return <div className="text-sm text-gray-500">Customer not found.</div>;

  return (
    <div className="flex flex-col xl:flex-row gap-6" data-testid="customer-detail-page">
      <div className="flex-1 min-w-0 space-y-6">
        <div className="flex items-center gap-2 text-xs">
          <Link to="/admin/customers" className="text-gray-500 hover:text-navy-900 inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Customers
          </Link>
        </div>

        <PageHeader
          title={customer.primary_name}
          subtitle={<span className="font-mono text-xs">{customer.code}</span>}
          actions={
            <div className="flex items-center gap-2">
              {openEscCount > 0 && (
                <button
                  type="button"
                  onClick={() => setTab("escalations")}
                  className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 border border-red-200 px-2 py-0.5 text-[11px] font-medium hover:bg-red-200"
                  data-testid="customer-open-escalations-badge"
                  title="Jump to Escalations tab"
                >
                  {openEscCount} Open Escalation{openEscCount === 1 ? "" : "s"}
                </button>
              )}
              <StatusPill status={customer.nri_status} testId="customer-detail-nri" />
            </div>
          }
        />

        {/* Sticky header — Email / Phone / PAN always rendered, gated via RestrictedField for read_limited/none roles */}
        <div className="rounded-md border border-gray-200 bg-white p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <InfoCell icon={Mail} label="Email" value={<RestrictedField value={customer.email} module="customer_overview" testId="customer-detail-email" />} />
          <InfoCell icon={Phone} label="Phone" value={<RestrictedField value={customer.phone} module="customer_overview" testId="customer-detail-phone" />} />
          <InfoCell icon={CreditCard} label="PAN" value={<RestrictedField value={customer.pan} module="customer_overview" testId="customer-detail-pan" />} />
          <InfoCell icon={MapPin} label="Location" value={
            (customer.city == null && customer.state == null)
              ? <RestrictedField value={null} module="customer_overview" empty="—" />
              : ([customer.city, customer.state].filter(Boolean).join(", ") || "—")
          } />
          <InfoCell icon={Users2} label="Applicants" value={String((customer.applicants || []).length)} />
        </div>

        {visibleTabs.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-white p-10 text-center" data-testid="customer-no-access">
            <div className="text-sm font-semibold text-gray-900 mb-1">No access to this customer profile</div>
            <p className="text-xs text-gray-500">Your role has no tabs enabled on the Customer 360 view.</p>
          </div>
        ) : (
        <Tabs value={currentTab} onValueChange={setTab}>
          <TabsList data-testid="customer-detail-tabs">
            {visibleTabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key} data-testid={`customer-tab-${t.key}`}>{t.label}</TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-6">
            <section>
              <h2 className="font-heading text-sm font-semibold text-gray-900 mb-2">Applicants</h2>
              <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">Name</th>
                      <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">Relation</th>
                      <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">PAN</th>
                      <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">KYC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(customer.applicants || []).map((a) => (
                      <tr key={a.id} className="h-10 border-t border-gray-100" data-testid={`applicant-row-${a.name}`}>
                        <td className="px-3 text-sm text-gray-900">{a.name}</td>
                        <td className="px-3 text-sm text-gray-600">{a.relation || "—"}</td>
                        <td className="px-3 text-sm font-mono text-gray-700">{a.pan || "—"}</td>
                        <td className="px-3"><StatusPill status={a.kyc_status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="font-heading text-sm font-semibold text-gray-900 mb-2">Bookings</h2>
              <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
                {bookings.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No bookings yet.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">Code</th>
                        <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">Booking date</th>
                        <th className="h-9 px-3 text-right text-xs uppercase tracking-wide text-slate-600 font-semibold">Agreement</th>
                        <th className="h-9 px-3 text-left text-xs uppercase tracking-wide text-slate-600 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.map((b) => (
                        <tr key={b.id} className="h-10 border-t border-gray-100">
                          <td className="px-3 font-mono text-xs">
                            <Link to={`/bookings/${b.id}`} className="text-navy-900 hover:underline" data-testid={`customer-booking-link-${b.code}`}>
                              {b.code}
                            </Link>
                          </td>
                          <td className="px-3 text-sm text-gray-600">{formatDate(b.booking_date)}</td>
                          <td className="px-3 text-sm text-right tabular-nums">{formatINR(b.agreement_value_inr)}</td>
                          <td className="px-3"><StatusPill status={b.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>
          </TabsContent>

          <TabsContent value="journey" className="mt-4">
            <JourneyTab customerId={id} />
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <DocumentsTab documents={documents} loading={false} onOpen={setOpenDoc} />
          </TabsContent>

          <TabsContent value="commitments" className="mt-4">
            <CommitmentsTab rows={commitments} loading={false} onOpen={setOpenCommit} />
          </TabsContent>

          <TabsContent value="financials" className="mt-4">
            <FinancialsTab customerId={id} bookings={bookings} />
          </TabsContent>

          <TabsContent value="loan" className="mt-4">
            <LoanTab customerId={id} bookings={bookings} />
          </TabsContent>

          <TabsContent value="legal" className="mt-4">
            <LegalTab customerId={id} bookings={bookings} />
          </TabsContent>

          <TabsContent value="registration" className="mt-4">
            <RegistrationTab customerId={id} bookings={bookings} />
          </TabsContent>

          <TabsContent value="unit-readiness" className="mt-4">
            <UnitReadinessTab customerId={id} bookings={bookings} />
          </TabsContent>

          <TabsContent value="snags" className="mt-4">
            <SnagsTab customerId={id} bookings={bookings} />
          </TabsContent>

          <TabsContent value="handover" className="mt-4">
            <HandoverTab customerId={id} bookings={bookings} />
          </TabsContent>

          <TabsContent value="communications" className="mt-4">
            <CommunicationsTab customerId={id} />
          </TabsContent>

          <TabsContent value="escalations" className="mt-4">
            <EscalationsTab customerId={id} />
          </TabsContent>
        </Tabs>
        )}
      </div>

      <CollaborationPanel entityType="customer" entityId={id} entityTitle={`${customer.code} · ${customer.primary_name}`} />

      <DocumentDetail
        docId={openDoc?.id}
        open={Boolean(openDoc)}
        onClose={() => setOpenDoc(null)}
        onChanged={loadDocsCommits}
      />
      <CommitmentDetail
        cid={openCommit?.id}
        open={Boolean(openCommit)}
        onClose={() => setOpenCommit(null)}
        onChanged={loadDocsCommits}
      />
    </div>
  );
}

function InfoCell({ icon: Icon, label, value, testId }) {
  const titleAttr = typeof value === "string" ? value : undefined;
  return (
    <div data-testid={testId}>
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-600 font-semibold"><Icon className="h-3 w-3" /> {label}</div>
      <div className="text-sm text-gray-900 mt-0.5 truncate" title={titleAttr}>{value}</div>
    </div>
  );
}
