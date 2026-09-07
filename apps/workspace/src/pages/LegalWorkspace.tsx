import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@homeflow/ui";
import { LegalFactory } from "./LegalFactory";
import { DocumentFactory } from "./documents/DocumentFactory";

type Tab = "aos" | "factory";

/** Two document systems coexist here, sharing no rows (22-document-factory.md's own backend Build
 *  note): LegalFactory.tsx is the legacy AOS/registration workbench (legal-docs.ts); DocumentFactory
 *  is spec 22's own doc_factory_template/doc_factory_document system for the other 12 families. */
export function LegalWorkspace({ projectId, roles }: { projectId: string; roles: string[] }) {
  const [tab, setTab] = useState<Tab>("aos");

  return (
    <div>
      {/* shrink-0/whitespace-nowrap: without it a flex child inside overflow-x-auto wraps its own
          text instead of the row scrolling (ControlTower.tsx's own fix, same class of bug). */}
      <div className="mb-6 overflow-x-auto">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="flex-nowrap">
            <TabsTrigger value="aos" className="shrink-0 whitespace-nowrap">AOS & Registration</TabsTrigger>
            <TabsTrigger value="factory" className="shrink-0 whitespace-nowrap">Document Factory</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "aos" && <LegalFactory projectId={projectId} />}
      {tab === "factory" && <DocumentFactory projectId={projectId} roles={roles} />}
    </div>
  );
}
