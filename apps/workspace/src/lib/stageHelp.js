/**
 * Stage self-help copy — keyed by the exact seeded workflow stage name.
 * Consumed by `<StageInfoPopover />` on Customer 360 → Journey.
 */
export const STAGE_HELP = {
  "Sales Handover": {
    description:
      "Formal handover of the confirmed booking from Sales to CRM, capturing all commercial commitments and customer expectations.",
    actions: [
      "Complete the 5-section handover checklist (Customer, Commercial, Unit, Documents, Commitments).",
      "Upload the booking form and cost sheet as attachments.",
      "Log every promise made to the customer as a Commitment for downstream tracking.",
    ],
    responsible: "Sales Team → CRM Team",
  },
  Documentation: {
    description:
      "Collect and verify the customer's KYC, identity, and statutory documents required for the sale.",
    actions: [
      "Collect PAN, address proof, and photo ID from the primary customer.",
      "Verify each document in the Documents tab and mark as Verified once authentic.",
      "For NRI or OCI customers, capture passport and OCI declaration in addition.",
    ],
    responsible: "CRM Team",
  },
  Legal: {
    description:
      "Prepare, review, and approve the sale agreement between the customer and the developer.",
    actions: [
      "Upload the sale agreement draft in the Legal tab. Each upload increments a version.",
      "Circulate for internal review and address deviations raised via the Deviation notes.",
      "Approve the final agreement to unlock downstream Registration workflows.",
    ],
    responsible: "Legal Team",
  },
  Payments: {
    description:
      "Track the booking amount, milestone-linked receipts, TDS deductions, and issue financial clearance for registration.",
    actions: [
      "Record the booking amount receipt and verify it against the bank statement.",
      "Capture the TDS challan (if applicable) and verify amount + PAN + challan number.",
      "Approve the Financial Clearance checklist once all dues and TDS are reconciled.",
    ],
    responsible: "Accounts Team",
  },
  Registration: {
    description:
      "Book the SRO slot, execute the sale deed at the sub-registrar office, and file the registered document.",
    actions: [
      "Confirm customer availability with preferred dates once Legal is approved.",
      "Book the SRO slot only after Legal, TDS, and Financial Clearance are all green.",
      "Upload the registered sale deed after execution to close the stage.",
    ],
    responsible: "Registration Team",
  },
  "Unit Readiness": {
    description:
      "Track the physical construction and finish status of the unit; declare it ready for QA inspection.",
    actions: [
      "Update the 14 component completion percentages as work progresses on site.",
      "Upload readiness photographs for QA record and the customer's assurance.",
      "Declare Ready for QA once overall score is ≥ 85% and at least 2 photos are uploaded.",
    ],
    responsible: "Site / Projects Team",
  },
  Snagging: {
    description:
      "Inspect the unit, log defects with severity, assign contractors for rectification, and verify closure before handover.",
    actions: [
      "Log every snag per room with severity (Critical / Major / Minor) and a before-photo.",
      "Assign contractors and track rectification through the state machine.",
      "Verify each snag closure with an after-photo before signing off the inspection.",
    ],
    responsible: "QA Team",
  },
  Handover: {
    description:
      "Schedule the handover, complete the property / keys / access / utilities / documents checklist, and capture the customer's acknowledgement.",
    actions: [
      "Confirm handover readiness — Finance + Registration + Unit Readiness + zero critical snags + Documents + Commitments.",
      "Set the final handover date; every revision must be captured with a reason.",
      "Record customer acknowledgement with the completed handover kit — this closes the journey.",
    ],
    responsible: "Handover Team → Facility Team",
  },
};

export function stageHelpForName(name) {
  if (!name) return null;
  return STAGE_HELP[name] || null;
}
