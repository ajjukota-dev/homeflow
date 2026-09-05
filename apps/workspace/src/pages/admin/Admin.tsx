import { useState } from "react";
import { Segmented } from "../../ui/Segmented";
import { AdminProjects } from "./AdminProjects";
import { AdminUnits } from "./AdminUnits";
import { AdminCustomers } from "./AdminCustomers";

type Tab = "projects" | "units" | "customers";

// Admin area (04 §Screens): Projects (master + hierarchy), Units (bulk range create),
// Customers (search + merge preview). One container so the top nav stays a single "Admin"
// entry; each sub-screen still renders its own h1 (CLAUDE.md "one h1 per page").
export function Admin() {
  const [tab, setTab] = useState<Tab>("projects");

  return (
    <div>
      <Segmented
        ariaLabel="Admin section"
        value={tab}
        onChange={setTab}
        options={[
          { value: "projects", label: "Projects" },
          { value: "units", label: "Units" },
          { value: "customers", label: "Customers" },
        ]}
      />
      <div className="mt-6">
        {tab === "projects" && <AdminProjects />}
        {tab === "units" && <AdminUnits />}
        {tab === "customers" && <AdminCustomers />}
      </div>
    </div>
  );
}
