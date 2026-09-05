// Phase 8 shared constants + tones.
export const ESC_SEVERITIES = ["Low", "Medium", "High", "Critical"];
export const ESC_STATUSES = ["Open", "Acknowledged", "In Progress", "Resolved", "Closed"];

export const ESC_SEVERITY_TONE = { Critical: "darkred", High: "red", Medium: "amber", Low: "grey" };
export const ESC_STATUS_TONE = {
  Open: "red",
  Acknowledged: "amber",
  "In Progress": "blue",
  Resolved: "green",
  Closed: "grey",
};

export const COMM_CHANNELS = ["Phone", "Email", "WhatsApp", "SMS", "Meeting", "In-person", "Portal"];
export const COMM_DIRECTIONS = ["Inbound", "Outbound"];

export const REPORT_TYPES = [
  { key: "handover-forecast", label: "Handover Forecast", supportsWindow: true, description: "Bookings with planned handover within 30/60/90 days." },
  { key: "registration-pipeline", label: "Registration Pipeline", description: "Every registration row with readiness gates + days since availability confirmed." },
  { key: "collections-ageing", label: "Collections Ageing", description: "Overdue milestones bucketed by age." },
  { key: "escalations", label: "Escalations", description: "All rule-fired + manual escalations with age." },
  { key: "commitments", label: "Commitments", description: "Commitment status with days-overdue." },
  { key: "department-sla", label: "Department SLA", description: "Open escalations per department + SLA breach + median age." },
  { key: "handover-delay", label: "Handover Delay", description: "Handovers with revised final dates + total slippage." },
  { key: "tds-pending", label: "TDS Pending", description: "TDS records not verified + days open." },
];
