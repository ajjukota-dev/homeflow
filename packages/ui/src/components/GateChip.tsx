/**
 * The five change-gate states (foundation/data-model.md; domain enums are
 * SCREAMING_SNAKE and mirror the spec exactly). Human label + icon, never colour alone.
 */
import { StatusChip, type Tone } from "./StatusChip";

export const GATE_STATES = ["OPEN", "CLOSING_SOON", "CONDITIONAL", "CLOSED", "HARD_CLOSED"] as const;
export type GateState = (typeof GATE_STATES)[number];

const LABEL: Record<GateState, string> = {
  OPEN: "Open",
  CLOSING_SOON: "Closing soon",
  CONDITIONAL: "Conditional",
  CLOSED: "Closed",
  HARD_CLOSED: "Hard closed",
};

const TONE: Record<GateState, Tone> = {
  OPEN: "ok",
  CLOSING_SOON: "warn",
  CONDITIONAL: "warn",
  CLOSED: "risk",
  HARD_CLOSED: "blocked",
};

const HELP: Record<GateState, string> = {
  OPEN: "Changes can still be made.",
  CLOSING_SOON: "Changes close shortly — decide now.",
  CONDITIONAL: "Changes are possible with conditions and a cost.",
  CLOSED: "Changes need an authorised override.",
  HARD_CLOSED: "Changes are physically impossible.",
};

export function GateChip({ state }: { state: GateState }) {
  return <StatusChip tone={TONE[state]} label={LABEL[state]} title={HELP[state]} />;
}
