import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@homeflow/ui";
import { salesApi, type InventoryUnit, type Prospect } from "./api";
import { InventoryGrid } from "./InventoryGrid";
import { ProspectsPanel } from "./ProspectsPanel";
import { HoldsPanel } from "./HoldsPanel";

/** 24-sales-inventory-discovery.md's primary Screens, additive next to the pre-24 Sales tab
 *  (SalesInventory.tsx/BookingWizard, unchanged — 6 e2e files depend on it). Loads the shared
 *  unit/prospect lists once so Compare/Book/Holds/Needs never show a raw id where a real label
 *  (villa number, prospect name) is available. */
export function SalesDesk({ projectId, roles }: { projectId: string; roles: string[] }) {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);

  const loadShared = useCallback(() => {
    if (!projectId) return;
    salesApi.inventory(projectId).then(setUnits).catch(() => setUnits([]));
    salesApi.listProspects(projectId).then(setProspects).catch(() => setProspects([]));
  }, [projectId]);
  useEffect(loadShared, [loadShared]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-large font-bold">Sales Desk</h1>
        <p className="mt-1 max-w-2xl text-subhead text-fg-muted">
          Inventory discovery, requirement match, Change Window Holds and booking — spec 08's changeability matrix, Sales-facing.
        </p>
      </header>

      <Tabs defaultValue="inventory">
        <TabsList aria-label="Sales Desk sections">
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="prospects">Prospects</TabsTrigger>
          <TabsTrigger value="holds">Holds</TabsTrigger>
        </TabsList>
        <TabsContent value="inventory">
          <InventoryGrid projectId={projectId} roles={roles} prospects={prospects} />
        </TabsContent>
        <TabsContent value="prospects">
          <ProspectsPanel projectId={projectId} roles={roles} units={units} />
        </TabsContent>
        <TabsContent value="holds">
          <HoldsPanel projectId={projectId} units={units} roles={roles} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
