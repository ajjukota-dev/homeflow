import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StatusPill from "@/components/StatusPill";

export default function AdminRoles() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api
      .get("/roles")
      .then((r) => {
        if (mounted) setRoles(r.data);
      })
      .catch((e) => apiErrorToast(e))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-4" data-testid="admin-roles">
      <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-xs px-3 py-2">
        Roles are seeded and cannot be edited in Phase 1. Role-permission editing arrives in a later phase.
      </div>
      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Code</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Name</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Description</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-gray-500">Loading…</TableCell></TableRow>
            ) : (
              roles.map((r) => (
                <TableRow key={r.id} className="h-10" data-testid={`role-row-${r.code}`}>
                  <TableCell className="px-3 font-mono text-xs text-gray-700">{r.code}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-900 font-medium">{r.name}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-600">{r.description || "—"}</TableCell>
                  <TableCell className="px-3">
                    {r.is_super_admin ? (
                      <StatusPill status="Super Admin" tone="purple" />
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600"><ShieldCheck className="h-3 w-3" /> Standard</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
