import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@homeflow/ui";
import { LegalFactory } from "./LegalFactory";
import { DocumentFactory } from "./documents/DocumentFactory";
import { RegistrationDesk } from "./registration/RegistrationDesk";

type Tab = "aos" | "factory" | "registration";

/** Three systems coexist here, sharing no rows (22-document-factory.md's own backend Build note,
 *  extended by 23-registration.md): LegalFactory.tsx is the legacy AOS/registration workbench
 *  (legal-docs.ts, including its own simple "Complete registration" button, untouched by this new
 *  tab); DocumentFactory is spec 22's own doc_factory_template/doc_factory_document system;
 *  RegistrationDesk is spec 23's own richer registration_case pipeline — both write the same
 *  terminal registration_case.status='completed' value (core.ts's own double-fire guard). */
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
            <TabsTrigger value="registration" className="shrink-0 whitespace-nowrap">Registration Desk</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "aos" && <LegalFactory projectId={projectId} />}
      {tab === "factory" && <DocumentFactory projectId={projectId} roles={roles} />}
      {tab === "registration" && <RegistrationDesk projectId={projectId} roles={roles} />}
    </div>
  );
}
