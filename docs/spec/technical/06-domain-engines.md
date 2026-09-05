# 06 · Domain engines

`services/api/domain/` — pure Python, no I/O, `mypy --strict`, ≥ 80 % coverage, TDD. Ported from this repo's TypeScript engines (`services/api/src/*.ts`) and v1's rule code where it existed. Services load rows, build the dataclasses below, call the engine, persist the result. An engine never knows a table exists.

Shared: `domain/types.py` — `GateState = Literal["OPEN","CLOSING","CONDITIONAL","EXCEPTION_ONLY","HARD_CLOSED"]` with `GATE_ORDER`, `ProgressState`, `Money = Decimal`, frozen dataclasses throughout. Every engine returns a result that carries its **explanation** (drivers/blockers/reasons) — the UI never shows a bare number ([`../foundation/customer-twin.md`](../foundation/customer-twin.md) §3).

---

## 1. `gates.py` — changeability (from `gates.ts`, [`../foundation/gates.md`](../foundation/gates.md) A)

```python
@dataclass(frozen=True)
class ComponentProgress: component_id: UUID; state: ProgressState; updated_at: datetime; expected_next_at: datetime | None; planned_next_event: str | None
@dataclass(frozen=True)
class GateRule: id: UUID; category_id: UUID; trigger_component_id: UUID; min_state: ProgressState; resulting_state: GateState; classification: Literal["soft","hard"]; reason_code: str
@dataclass(frozen=True)
class Hold: category_id: UUID; expires_at: datetime
@dataclass(frozen=True)
class GateResult: category_id: UUID; state: GateState; reason_code: str; source_component_id: UUID | None; expected_close_at: datetime | None; closing_event: str | None; freshness: Literal["fresh","stale","verification_required"]

def progress_at_least(current: ProgressState, minimum: ProgressState) -> bool
def derive_gate(category_id, rules: Sequence[GateRule], progress: Mapping[UUID, ComponentProgress], holds: Sequence[Hold],
                now: datetime, stale_after: timedelta, verify_after: timedelta) -> GateResult
    # most restrictive matching rule wins (GATE_ORDER); an active Hold caps a CLOSING result at CLOSING;
    # a hard rule can never be capped; CLOSING carries expected_close_at from the trigger component's expected_next_at;
    # freshness from the oldest contributing component's updated_at
def derive_all(categories, rules, progress, holds, now, policy) -> list[GateResult]
def transitions(before: Mapping[UUID, GateState], after: Sequence[GateResult]) -> list[Transition]   # for events + affected-workflow flagging
def changeability_score(states: Sequence[GateState], must_have: Collection[UUID] = ()) -> Score       # 0–100 + per-category contribution
```

Invariants tested: same category OPEN on one unit and EXCEPTION_ONLY on another from progress alone (#20); HARD_CLOSED never reduced by a hold or override (#27); stale → `verification_required` (§30); a CR release re-evaluates competing rules.

## 2. `collections.py` — true-risk (from `collections.ts`, `roles/accounts` §2.3)

```python
RiskBucket = Literal["not_yet_due","due_soon","overdue_recoverable","overdue_at_risk","loan_pending","disputed","default_watch"]
@dataclass(frozen=True)
class OpenDemand: demand_id: UUID; amount_open: Money; due_date: date; ptp_date: date | None; ptp_confidence: Decimal | None; loan_linked: bool; loan_expected_release: date | None; disputed: bool; overdue_reason_code: str | None
@dataclass(frozen=True)
class Classified: demand_id: UUID; bucket: RiskBucket; days_overdue: int; recovery_probability: Decimal; why_now: str; drivers: list[str]

def days_overdue(due: date, as_of: date) -> int
def recovery_probability(days: int, ptp_confidence: Decimal | None, loan_linked: bool, policy: ProbabilityPolicy) -> Decimal
def classify(d: OpenDemand, as_of: date, policy: CollectionsPolicy) -> Classified
def bucketise(demands: Sequence[OpenDemand], as_of, policy) -> dict[RiskBucket, list[Classified]]
def why_now(d: OpenDemand, milestone_label: str, as_of) -> str                    # customer-safe phrase for T2 and internal phrase for My Day
def forecast_lines(demands, as_of, horizon_months, policy) -> list[ForecastLine]  # probability-weighted expected receipts per period (§31.4)
def cashflow(period, lines, actuals, revised) -> CashflowPeriod                   # actual vs forecast vs revised
```

## 3. `clearance.py` — financial clearance (H7, from `clearance.ts`)

```python
@dataclass(frozen=True)
class ClearanceInput: total_consideration: Money; received: Money; threshold_pct: Decimal; tds_verified: bool; unapproved_dues: Money; approved_waivers: Money; loan_pending: Money; disputed: Money
@dataclass(frozen=True)
class Clearance: cleared: bool; outstanding: dict[str, Money]; blockers: list[str]; tds_status: str
def financial_clearance(i: ClearanceInput) -> Clearance
```

## 4. `readiness.py` — unit readiness (from `readiness.ts`, `roles/qa`)

```python
def readiness_score(components: Sequence[ComponentVerification], weights: Mapping[str, Decimal], critical_snags: int, minor_snags: int, minor_policy_max: int) -> Readiness
    # Readiness: score 0–100, drivers[(name, contribution)], blockers[], utilities_ready
```
Score derives from **verified component evidence**, never a typed percentage (the v1 anti-pattern PDF §8.8 forbids).

## 5. `handover.py` — handover gates (from `handover.ts`, [`gates.md`](../foundation/gates.md) B)

```python
GateType = Literal["financial","legal","registration","physical","quality","commitments","customer","fm"]
@dataclass(frozen=True)
class HandoverInput: clearance: Clearance; legal_executed: bool; registered: bool; readiness: Readiness; critical_commitments_open: int; customer_ready: bool; fm_ready: bool; safety_items_open: int; existing_overrides: Sequence[Override]
@dataclass(frozen=True)
class GateView: gate_type: GateType; classification: Literal["hard","soft"]; state: Literal["open","passed","overridden"]; blockers: list[str]; override: Override | None
@dataclass(frozen=True)
class HandoverEval: gates: list[GateView]; eligible: bool; lifecycle: Literal["not_eligible","at_risk","eligible"]; readiness_score: Decimal; predicted_window: tuple[date, date] | None; confidence: str

def evaluate(i: HandoverInput, now: date) -> HandoverEval
def apply_override(gate: GateView, authority: Authority, reason_code: str, evidence_ids: Sequence[UUID]) -> GateView
    # raises OverrideNotAllowed for safety/statutory blockers or missing reason/evidence/authority (B.4)
```

## 6. `tower.py` — Control Tower (from `tower.ts`, `roles/management`)

```python
TowerCategory = Literal["customer","cash","handover","reputation","margin"]
@dataclass(frozen=True)
class Candidate: escalation_id: UUID; category: TowerCategory; tier: str; rupee_impact: Money; customers_affected: int; days_open: int; recommended_decision: str | None
def pick_five(candidates: Sequence[Candidate], weights: TowerWeights) -> list[Intervention]     # exactly one per category, highest impact; empty category → "nothing needs you here"
def build_pack(events: Sequence[EventView], impact: Impact, deps: Sequence[ActionRef], taken: Sequence[EventView], owner, next_deadline, evidence) -> DecisionPack
```

## 7. `legal.py` — Document Factory rules (from `legal.ts`, `roles/legal` §1.3)

```python
@dataclass(frozen=True)
class MergeField: key: str; source_path: str; required: bool; validator: str | None      # "pan", "date", "money", "name"
def readiness_check(fields: Sequence[MergeField], source: Mapping[str, object]) -> list[FieldError]      # each error carries source_ref for "fix at source"
def freeze_snapshot(fields, source) -> dict[str, str]                                                    # the immutable data snapshot
def render_context(snapshot, clauses: Sequence[Clause], deviations: Sequence[Deviation]) -> dict            # what Jinja receives
def auto_validate(snapshot, rendered_text: str, rules: Sequence[ValidationRule]) -> list[FieldError]       # cross-field, amount/date consistency, applicant names, PAN format
def compare(a: str, b: str) -> list[Change]                                                                # substantive diff (ignores whitespace/pagination)
```

## 8. `ranking.py` and `journey_rules.py`

Defined in [`05-action-and-journey.md`](05-action-and-journey.md) §2, §5.

## 9. `completeness.py` — H2 gate (`roles/sales` + `roles/crm-rm` §2.3)

```python
def evaluate(booking: BookingView, docs: Sequence[DocStatus], checklist: Checklist, threshold: Decimal) -> Completeness   # score, missing[], passed
```

## 10. `matching.py` — requirement-to-unit (`roles/sales` §2.3)

```python
def match(needs: Sequence[Need], units: Sequence[UnitGateView], weights) -> list[Match]   # ranked, each with explanation per Must-Have/Preferred; HARD_CLOSED Must-Have → excluded with reason
def pitch_angle(unit: UnitGateView, progress_pct_coarse: Decimal) -> PitchAngle           # customisation-scope vs fast-possession
```

---

## Test layout

`domain/test_<engine>.py`, pytest + hypothesis for the monotonic properties (more progress never opens a gate; more receipts never lowers clearance; adding a critical snag never raises readiness). Fixtures are plain dataclass literals; no DB. The TS test files in `services/api/src/*.test.ts` are the porting checklist: every case there exists in the Python file before the TS file is deleted.
