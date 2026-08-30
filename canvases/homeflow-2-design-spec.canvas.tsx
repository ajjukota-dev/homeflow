import {
  BarChart,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CollapsibleSection,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  PieChart,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  computeDAGLayout,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

type View =
  | "story"
  | "grasp"
  | "anatomy"
  | "journey"
  | "change"
  | "modules"
  | "operate"
  | "money"
  | "experience"
  | "ship"
  | "build"
  | "reference";

const VIEWS: { id: View; label: string }[] = [
  { id: "story", label: "Plain English" },
  { id: "grasp", label: "Grasp" },
  { id: "anatomy", label: "Anatomy" },
  { id: "journey", label: "Journey" },
  { id: "change", label: "Changeability" },
  { id: "modules", label: "14 modules" },
  { id: "operate", label: "Operate" },
  { id: "money", label: "Money" },
  { id: "experience", label: "CX + AI" },
  { id: "ship", label: "Ship" },
  { id: "build", label: "Emergent build" },
  { id: "reference", label: "Reference" },
];

const KEYWORDS: { word: string; meaning: string; view: View }[] = [
  { word: "Project-first", meaning: "Every booking, unit, collection, CR, handover, task and forecast resolves to a Project.", view: "anatomy" },
  { word: "Unit Digital Twin", meaning: "Live physical truth of a unit — even before it is sold. Progress, gates, as-built, passport.", view: "anatomy" },
  { word: "Customer Digital Twin", meaning: "Relationship record: money, docs, commitments, comms, sentiment, consent.", view: "anatomy" },
  { word: "Booking", meaning: "The bridge. Attach commercial/lifecycle facts here so cancel/transfer/resale does not corrupt history.", view: "anatomy" },
  { word: "System independence", meaning: "HomeFlow must run standalone. External CRM/ERP/construction systems are optional adapters.", view: "grasp" },
  { word: "Changeability", meaning: "Per-category gate derived from live unit physics, not booking date or a project-wide cutoff.", view: "change" },
  { word: "OPEN / CLOSING / CONDITIONAL / EXCEPTION / HARD CLOSED", meaning: "The five gate states Sales and CRM may read but never edit.", view: "change" },
  { word: "Change Window Hold", meaning: "Time-boxed, Project-approved pause so a serious sale can keep a closing option open.", view: "change" },
  { word: "Universal Action", meaning: "Every task, snag, approval, gap, delay and AI rec normalizes into one Action object.", view: "operate" },
  { word: "My Day", meaning: "Employees do not search for work. HomeFlow ranks what matters today and why.", view: "operate" },
  { word: "Promise Ledger", meaning: "Every Pranava promise and every customer promise-to-pay, with owner, due date, evidence.", view: "operate" },
  { word: "Hard gates", meaning: "Handover cannot proceed without named authority + reason. Safety/statutory gates never override.", view: "operate" },
  { word: "Explainable scores", meaning: "Unit / Customer / Handover / Health / Financial — each answers a different question, with drivers.", view: "operate" },
  { word: "Legal Document Factory", meaning: "Governed generation from approved templates + clause library. Not free-form mail merge.", view: "modules" },
  { word: "True-risk collections", meaning: "Split outstanding vs due vs overdue vs disputed vs loan-dependent vs promise-to-pay vs true risk.", view: "money" },
  { word: "Forecast snapshot", meaning: "Month-start forecast is immutable. Revisions are new versions. Never overwrite history.", view: "money" },
  { word: "My Pranava Home", meaning: "Customer sees a calm journey. Never internal blame, vendor disputes, or unapproved forecasts.", view: "experience" },
  { word: "Control Tower", meaning: "Management sees five ranked interventions, not fifty charts.", view: "operate" },
  { word: "Journey Template", meaning: "Generic Pranava lifecycle each Project inherits. Durations, SLAs, wording are data — never code.", view: "journey" },
  { word: "SLA ≠ Plan", meaning: "SLA is allowed service time. Plan is when this record should occur. Both are calculated independently.", view: "operate" },
  { word: "Digital Home Passport", meaning: "Equipment, serials, warranties, paint/tile codes, service history — lives with the unit forever.", view: "modules" },
  { word: "Five feature tests", meaning: "Trust? Less chasing? Accountability? Earlier prediction? Margin? If none, do not build.", view: "ship" },
];

export default function HomeFlowDesignSpec() {
  const [view, setView] = useCanvasState<View>("view", "story");
  const [kw, setKw] = useCanvasState<string>("keyword", "");

  return (
    <Stack gap={24} style={{ padding: 24 }}>
      <Stack gap={8}>
        <Text tone="secondary" size="small" weight="medium">
          Pranava HomeFlow 2.0 · Full Design Spec v8 · Project-first, unit-aware, configurable journey, system-independent
        </Text>
        <H1>World-class post-sales customer and unit OS</H1>
        <Text tone="secondary">
          Every customer knows what is happening. Every employee knows what they own. Every manager knows where risk lies. Every commitment has accountability. Every unit has a permanent digital history. Every rupee and margin leak is visible.
        </Text>
        <Text size="small" tone="tertiary">
          Source: Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf · 48 pages · 35 sections + 2 appendices. This canvas is the full spec, not a skim.
        </Text>
      </Stack>

      <Grid columns={6} gap={12}>
        <Stat value="2 twins" label="Customer + Unit" />
        <Stat value="11 stages" label="Generic lifecycle" />
        <Stat value="14" label="Functional modules" />
        <Stat value="5 gates" label="Changeability states" />
        <Stat value="9 P0" label="0–90 day foundation" tone="info" />
        <Stat value="5 tests" label="Before any feature ships" />
      </Grid>

      <Callout tone="warning" title="System independence">
        HomeFlow must be fully operable alone. No construction, ERP, CRM, finance, DMS or FM platform is assumed. Project teams maintain physical truth inside HomeFlow. Later connectors are optional accelerators — they must never dictate the domain model.
      </Callout>

      <Row gap={8} wrap>
        {VIEWS.map((v) => (
          <span key={v.id}>
            <Pill active={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
            </Pill>
          </span>
        ))}
      </Row>

      {view === "story" && <StoryView />}
      {view === "grasp" && <GraspView onJump={setView} selected={kw} onSelect={setKw} />}
      {view === "anatomy" && <AnatomyView />}
      {view === "journey" && <JourneyView />}
      {view === "change" && <ChangeView />}
      {view === "modules" && <ModulesView />}
      {view === "operate" && <OperateView />}
      {view === "money" && <MoneyView />}
      {view === "experience" && <ExperienceView />}
      {view === "ship" && <ShipView />}
      {view === "build" && <BuildView />}
      {view === "reference" && <ReferenceView />}

      <Divider />
      <Text tone="tertiary" size="small">
        Design target: premium customer experience + disciplined execution + controlled transparency + profitable growth. East Crest SOPs map into the generic engine — they are configuration, not code.
      </Text>
    </Stack>
  );
}

function StoryView() {
  return (
    <Stack gap={20}>
      <H2>What this is, in one sentence</H2>
      <Text>
        HomeFlow is the software Pranava uses after a villa or apartment is booked — to collect money, do papers, track construction of that exact unit, handle customer changes (kitchen, flooring), register the sale, hand over keys, and support the home after move-in.
      </Text>
      <Callout tone="info" title="Yes — this is for the villa / home projects">
        Pranava takes a project (example in the spec: East Crest), builds villas or apartments, and sells units. HomeFlow is not the construction drawing tool and not the accounting ledger. It is the operating system that keeps the customer, the unit, and the money in one story until keys and after.
      </Callout>

      <H2>The three things that never mix</H2>
      <Grid columns={3} gap={12}>
        <Card>
          <CardHeader>Project</CardHeader>
          <CardBody>
            <Text size="small">East Crest, or any other site. Land + towers/villas + teams. All reporting rolls up here.</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Unit (the home)</CardHeader>
          <CardBody>
            <Text size="small">Villa V104 or Flat 8-12. Exists before anyone buys it. Has walls, wiring, flooring progress. Keeps a permanent history even if the buyer changes.</Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Customer + Booking</CardHeader>
          <CardBody>
            <Text size="small">The person/family. Booking is the marriage of this customer to this unit for this ownership period. Cancel or transfer? Booking closes. Unit stays.</Text>
          </CardBody>
        </Card>
      </Grid>

      <H2>How a villa actually moves — the story</H2>
      <Table
        headers={["When", "What happens in real life", "What HomeFlow does"]}
        rows={[
          ["Before anyone buys", "Site is building. Some villas are only foundation. Some already have flooring.", "Project team updates the Unit Twin. Sales can see: this villa can still change kitchen; that one cannot. No customer yet."],
          ["A family likes a villa", "Sales compares units: early-stage = lots of customisation; nearly done = faster possession.", "Inventory shows changeability gates. Must Have / Preferred needs are matched. Sales cannot promise a closed change."],
          ["They book", "Token / booking amount. Applicants captured. Sales hands the file to CRM.", "Booking created. Customer Twin linked to existing Unit Twin. Completeness gate before CRM accepts the file."],
          ["They arrange money", "Bank loan, or self-pay. KYC. Payment schedule.", "Funding stream runs in parallel with papers. Loan gaps are flagged before the next demand becomes overdue."],
          ["Papers", "Agreement of Sale, later Sale Deed. Names, PAN, price, schedules.", "Legal Document Factory fills from trusted data. Legal approves. Customer eSigns. Nothing typed twice."],
          ["Construction continues", "Masonry, MEP first-fix, flooring PO, paint.", "Each physical event can close a customisation gate. Kitchen open yesterday can become Exception Only after walls close."],
          ["They want a change", "Move a wall, upgrade flooring, extra electrical points.", "Change Request — not a WhatsApp promise. Feasibility, cost, schedule, customer quote, payment, then site gets the released drawing only."],
          ["Pranava asks for money", "Milestone demand. Sometimes bank should release. Sometimes customer promised Friday.", "Collections splits due / overdue / disputed / loan-stuck / promise-to-pay / true risk. Forecast by project, not a single outstanding number."],
          ["Registration", "SRO slot, challan, sale deed, registered copy.", "Registration readiness gate. Forecasted date + blockers. Evidence archived on the Booking."],
          ["Almost ready to give keys", "QA, snags, meters, last dues, pending promises.", "Handover Readiness = physical ready + customer ready + hard gates. Keys do not go out if money/legal/safety is open — unless a named person overrides with a reason."],
          ["Handover day", "Walkthrough, keys, manuals, FM orientation.", "Digital checklist + Home Passport. Appointment-led, not a surprise."],
          ["They live there", "Warranty leak, paint touch-up, referral.", "Post-handover on the same Unit. Service history stays with the villa forever."],
        ]}
        striped
        stickyHeader
      />

      <H2>Who does what on a normal day</H2>
      <Table
        headers={["Person", "They open HomeFlow and should immediately know"]}
        rows={[
          ["Customer (My Pranava Home)", "What is happening to my villa, what I must pay/sign, when keys are likely. Not internal fights or vendor prices."],
          ["Sales", "Which unsold villas still allow kitchen/electrical/flooring changes, and when that window dies."],
          ["CRM / RM", "Who to call today and why — overdue, missing PAN, closing gate, broken promise."],
          ["Project / site", "What physical progress to record, which units that changes, which sales holds to approve."],
          ["Accounts", "What cash is truly coming this month vs stuck in bank/dispute/empty promise."],
          ["Legal / registration", "Which agreements or SRO slots are blocked."],
          ["QA / handover team", "Which villas are actually eligible for keys, and which snag is still critical."],
          ["Management", "Five problems only: a customer, cash, a handover, reputation, margin — not fifty charts."],
        ]}
        striped
      />

      <H2>Why they need software for this</H2>
      <Text>
        A villa project is not one job. It is many jobs at once: collect crores, keep the bank moving, generate legal documents, let the customer change a kitchen only while it is still possible, prove the flat is actually ready, and not hand over keys if dues or critical snags remain. Without one system, that lives in Excel, WhatsApp, and “someone said yes.” HomeFlow’s job is: one truth for the unit, one truth for the customer, every promise owned, every rupee leak visible.
      </Text>

      <Callout tone="warning" title="Not the same as the office-leasing portal in this repo">
        This workspace also has Pranava Portal / FMWork — that is commercial office occupants, fit-out gates, CAM. HomeFlow 2.0 is the residential sell-and-deliver-the-home product. Same company, different product.
      </Callout>
    </Stack>
  );
}

function GraspView({
  onJump,
  selected,
  onSelect,
}: {
  onJump: (v: View) => void;
  selected: string;
  onSelect: (w: string) => void;
}) {
  const active = KEYWORDS.find((k) => k.word === selected) ?? KEYWORDS[0];

  return (
    <Stack gap={20}>
      <H2>Start here — the whole spec in keywords</H2>
      <Text tone="secondary">
        Click a keyword. Read the one-line meaning. Jump to the tab that holds the full rule. Nothing in v8 is dropped — later tabs hold every field, status, test and event.
      </Text>

      <Row gap={8} wrap>
        {KEYWORDS.map((k) => (
          <span key={k.word}>
            <Pill
              active={active.word === k.word}
              onClick={() => onSelect(k.word)}
            >
              {k.word}
            </Pill>
          </span>
        ))}
      </Row>

      <Card>
        <CardHeader trailing={<Pill onClick={() => onJump(active.view)}>Open {VIEWS.find((v) => v.id === active.view)?.label}</Pill>}>
          {active.word}
        </CardHeader>
        <CardBody>
          <Text>{active.meaning}</Text>
        </CardBody>
      </Card>

      <H2>What 2.0 must achieve</H2>
      <Grid columns={3} gap={12}>
        <Outcome title="Experience" body="Premium, proactive, predictable journey from booking through post-handover." />
        <Outcome title="Efficiency" body="Employees work from prioritized actions instead of searching modules and chasing colleagues." />
        <Outcome title="Openness" body="Customers and stakeholders see the right information, at the right level, with ownership and timelines." />
        <Outcome title="Control" body="Every promise, approval, SLA, blocker and exception is traceable." />
        <Outcome title="Profitability" body="Collection risk, concessions, rework, delay cost and cost-to-serve are measurable by customer and unit." />
        <Outcome title="Learning" body="Snags, delays, complaints and leakage feed root-cause analysis and process improvement." />
      </Grid>

      <H2>Design principles</H2>
      <Table
        headers={["Principle", "Meaning"]}
        rows={[
          ["One truth, many views", "Same customer/unit state powers customer, employee, vendor and management experiences."],
          ["Customer + Unit, not module-first", "Screens organize around lifecycle outcomes, not departmental silos."],
          ["Project → Phase/Tower/Block → Unit", "Primary physical hierarchy. Every analysis rolls up Unit → Project → portfolio."],
          ["Manage by exception", "Management sees risks, breached commitments and forecast slippage — not raw task lists."],
          ["Predict before failure", "Detect conditions that create delay, default, escalation, rework or margin leakage."],
          ["Human judgment where it matters", "Automate routine steps. Preserve human approval for consequential decisions."],
          ["Evidence over opinion", "Readiness, quality and handover come from checklists, photos, tests — not typed percentages."],
          ["Configurable, not hardcoded", "Stage durations, SLAs, gates, owners and customer wording are data. East Crest is a mapping, not a branch."],
        ]}
        striped
      />

      <H2>The five tests for every future feature</H2>
      <Grid columns={5} gap={12}>
        <Stat value="1" label="Improve customer trust?" />
        <Stat value="2" label="Eliminate chasing?" />
        <Stat value="3" label="Expose accountability?" />
        <Stat value="4" label="Predict earlier?" />
        <Stat value="5" label="Protect / improve margin?" />
      </Grid>
      <Text tone="secondary" size="small">
        If the answer to none is yes, it should not be built. For unit customisations add a sixth: does this preserve the permanent as-built truth while protecting schedule and margin?
      </Text>

      <Callout tone="info" title="HomeFlow is the orchestration brain">
        It should not duplicate deep construction management, accounting, banking or document-storage when those systems already exist. It consumes authoritative data, converts it into lifecycle state, triggers actions, exposes controlled transparency, and keeps the customer/unit audit trail. If those systems do not exist, HomeFlow still operates natively.
      </Callout>
    </Stack>
  );
}

function Outcome({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <CardBody>
        <Text size="small">{body}</Text>
      </CardBody>
    </Card>
  );
}

function AnatomyView() {
  return (
    <Stack gap={20}>
      <H2>Core data model — four independent persistents</H2>
      <Text tone="secondary">
        Do not attach all commercial and lifecycle data directly to the customer or the unit. Attach it to the Booking wherever the fact belongs to a particular customer–unit ownership relationship. That is what survives cancellation, transfer, joint-ownership change and resale.
      </Text>

      <TwinDiagram />

      <Table
        headers={["Entity", "Purpose", "Must persist independently?"]}
        rows={[
          ["Project / Phase / Tower", "Physical and commercial hierarchy; policies, milestones, common metadata.", "Yes"],
          ["Unit", "Permanent property identity and physical lifecycle.", "Yes"],
          ["Booking", "Commercial relationship connecting one unit to one or more customers for a defined ownership period.", "Yes"],
          ["Customer", "Person/entity relationship, preferences, communication and experience history.", "Yes"],
          ["Applicant / Co-owner", "Party participating in a booking.", "Yes"],
          ["Lifecycle Event", "Dated event that changes state or records evidence.", "Yes"],
          ["Action", "Universal work item generated manually, by workflow, rule or AI.", "Yes"],
        ]}
        striped
      />

      <Grid columns="1fr 1fr" gap={16}>
        <Stack gap={8}>
          <H3>Unit Digital Twin</H3>
          <Table
            headers={["Layer", "What it holds"]}
            rows={[
              ["Identity", "Project, phase, tower/block, floor, unit number, type, area, facing, parking, UDS/land share."],
              ["Specification baseline", "Standard finish schedule, brands, fixtures, approved drawings, CRs, approved variations, superseded versions, as-built deviations."],
              ["Construction state", "Milestone progress — native in HomeFlow; optional import later."],
              ["Component progress", "Room / trade / system state used to decide if a change is still practical."],
              ["Live changeability", "Open, Closing, Conditional, Exception Only, Hard Closed — by category/component."],
              ["Gate-expiry forecast", "Expected closure date/time and the event that will close or restrict each category."],
              ["Changeability score", "Customisation flexibility index for sales inventory. Always explainable by underlying gates."],
              ["Released configuration", "Baseline + approved variations + latest controlled drawing/spec revision."],
              ["QA/QC evidence", "Component checklists, inspections, photographs, tests, certificates, approvals."],
              ["Snag history", "Defect, severity, trade, contractor, root cause, cost, before/after evidence, repeat flag."],
              ["Handover evidence", "Readiness gates, meter readings, keys, manuals, final photographs, signatures."],
              ["Digital Home Passport", "Equipment, serials, warranties, manuals, paint/tile codes, service history."],
              ["Permanent history", "Survives ownership changes, cancellations, transfers and future resale."],
            ]}
            striped
          />
        </Stack>
        <Stack gap={8}>
          <H3>Customer Digital Twin</H3>
          <Table
            headers={["Layer", "What it holds"]}
            rows={[
              ["Profile", "Applicants, contact preferences, language, NRI/resident flags, relationship history."],
              ["Bookings", "Unit relationships including historical / cancelled / transfer records."],
              ["Financial behaviour", "Demands, receipts, overdue history, payment promises, disputes, TDS, loan dependence."],
              ["Documents", "KYC, agreements, loan docs, registration docs, missing/discrepant information."],
              ["Commitments", "Every promise by Pranava and every promise-to-pay by the customer."],
              ["Communications", "Call notes, WhatsApp/email/SMS, meetings, notices — customer-facing and internal."],
              ["Experience signals", "CSAT/NPS, sentiment trend, complaints, escalations, referral/advocacy."],
              ["Consent", "Privacy preferences."],
            ]}
            striped
          />
        </Stack>
      </Grid>

      <H2>Project is the operating partition</H2>
      <Table
        headers={["Rule", "Detail"]}
        rows={[
          ["Unit belongs to exactly one Project", "Plus Phase, Tower/Block, Floor or Villa Cluster where applicable. Hierarchy keys are mandatory on Unit master."],
          ["Downstream inherits Project", "Booking, Demand, Receipt, Loan Case, CR, Snag, Handover, Commitment, Escalation and every Action inherit Project from Unit/Booking. Do not ask users to pick Project when it can be derived."],
          ["Universal filter + security", "Dashboards, reports, queues, forecasts, cockpits. Drill Portfolio → Project → Unit → Customer/Booking."],
          ["Team assignments", "Dedicated to one Project, shared across selected Projects, or centralized. Effective dates, roles, workload, escalation routes."],
          ["Project config overrides", "Workflows, SLAs, customisation policies, approval matrices, templates, handover gates, reporting targets — without breaking the enterprise model."],
          ["Project on Unit is immutable", "After controlled master creation, except audited master-data correction. Downstream project_id is derived and validated against the Unit/Booking source of truth."],
        ]}
        striped
      />
    </Stack>
  );
}

function TwinDiagram() {
  const theme = useHostTheme();
  const box = {
    border: `1px solid ${theme.stroke.secondary}`,
    background: theme.fill.tertiary,
    padding: "10px 12px",
    borderRadius: 6,
  };
  const accent = {
    ...box,
    border: `1px solid ${theme.accent.primary}`,
    background: theme.fill.secondary,
  };
  return (
    <Stack gap={8}>
      <Text size="small" tone="tertiary">
        Source: spec §4 · Customer + Unit persist independently; Booking is the only commercial bridge
      </Text>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr auto 1fr",
          gap: 8,
          alignItems: "center",
        }}
      >
        <div style={box}>
          <Text size="small" weight="semibold">Customer Twin</Text>
          <Text size="small" tone="secondary">profile · money · docs · promises · comms</Text>
        </div>
        <Text size="small" tone="tertiary">—</Text>
        <div style={accent}>
          <Text size="small" weight="semibold">Booking</Text>
          <Text size="small" tone="secondary">this ownership period only</Text>
        </div>
        <Text size="small" tone="tertiary">—</Text>
        <div style={box}>
          <Text size="small" weight="semibold">Unit Twin</Text>
          <Text size="small" tone="secondary">physics · gates · QA · as-built · passport</Text>
        </div>
      </div>
      <div style={{ ...box, textAlign: "center" }}>
        <Text size="small" weight="semibold">Project → Phase / Tower / Block → Floor → Unit</Text>
        <Text size="small" tone="secondary">
          Portfolio rolls up. Users work in one Project or a shared team. Reporting always supports Project as first-class.
        </Text>
      </div>
    </Stack>
  );
}

function JourneyView() {
  return (
    <Stack gap={20}>
      <H2>Generic lifecycle — 11 stages, parallel streams</H2>
      <Text tone="secondary">
        Numbering is for customer and management comprehension. Dependencies and gates govern actual execution. Finance, construction, legal, customisation, commitments and communication can run at the same time and only converge when a gate says so.
      </Text>

      <LifecycleStrip />

      <Table
        headers={["Stage", "Primary outcome", "Typical parallel streams / exit logic"]}
        rows={[
          ["0. Unit / Pre-Sales Readiness", "Sales has reliable unit truth before booking. No customer required.", "Project-owned physical progress, expected readiness and changeability visible to Sales/CRM."],
          ["1. Booking & Allotment", "Commercial booking accepted; relationship initiated.", "Booking amount, application, allotment, applicants, commercial approvals, sales-to-CRM handover."],
          ["2. Funding & Financial Setup", "Funding route established.", "Loan sanction or self-funding, KYC/funding evidence, payment schedule — may continue in parallel with documentation."],
          ["3. Agreement & Documentation", "Contractual package complete.", "KYC, AOS/agreement generation, legal/commercial approvals, TDS/document obligations, execution and archival."],
          ["4. Construction & Unit Journey", "Unit progresses against Project-owned physical truth.", "Unit Twin, component progress, evidence, customer updates, approved changes and future changeability gates."],
          ["5. Demands & Collections", "Milestone-linked receivables generated, collected, forecast.", "Demand, loan disbursement, TDS, receipts, overdue recovery, promise-to-pay, project cash-flow forecast."],
          ["6. Pre-Registration Readiness", "All registration prerequisites converge.", "Financial clearance, legal/document verification, statutory items, customer availability, approvals, registration gate."],
          ["7. Registration", "Legal transfer completed and evidence archived.", "Sale deed generation, challans, slot scheduling, execution, registered copy, status updates."],
          ["8. Pre-Handover Readiness", "Physical, commercial and customer readiness converge.", "Unit readiness, QA, snags, financial/legal closure, commitments, inspection scheduling, hard/soft handover gates."],
          ["9. Handover & Possession", "Property and required information formally handed over.", "Keys, possession docs, readings, manuals/warranties, acknowledgement, FM orientation, final evidence."],
          ["10. Post-Handover / Facilities", "Living/occupancy and support.", "Move-in, DLP/warranty, service requests, FM onboarding, home passport, satisfaction and advocacy."],
        ]}
        striped
        stickyHeader
      />

      <H2>Moments that matter</H2>
      <Table
        headers={["Moment", "Designed experience"]}
        rows={[
          ["Booking + 24 hours", "Premium welcome, RM introduction, journey map, payment/doc checklist, communication preference capture."],
          ["Construction milestone", "Curated progress update with project-specific photo/video and what happens next."],
          ["75–80% completion", "Home readiness preview, finance/registration readiness check, personal concierge introduction."],
          ["Pre-handover", "Guided preparation, document/finance closure plan, snag/QA visibility at the appropriate level."],
          ["Handover day", "Appointment-led homecoming, guided walkthrough, digital home passport, keys, utilities/FM orientation, family moment."],
          ["7 / 30 / 90 days", "Structured check-in, service support and satisfaction capture."],
          ["Positive closure", "Referral, testimonial and advocacy request at the right emotional moment."],
        ]}
        striped
      />

      <H2>East Crest is configuration, not code</H2>
      <Callout tone="info" title="Governance">
        Project teams may propose Project-specific template changes, but the standard Pranava lifecycle vocabulary should stay stable so portfolio analytics and cross-project benchmarking remain meaningful.
      </Callout>
      <Table
        headers={["Current East Crest concept", "Generic HomeFlow mapping", "Optimization in HomeFlow"]}
        rows={[
          ["Flat Selection & Booking Allotment", "1 Booking & Allotment", "Add Unit pre-sales truth before booking; structured sales-to-CRM handover, plan/actual dates, evidence."],
          ["Financial Sanction & Loan Approval", "2 Funding & Financial Setup", "Loan/self-funding in parallel; track forecast disbursement and blockers."],
          ["Agreement of Sale", "3 Agreement & Documentation", "Document Factory, approvals, versioning, TDS/document checklist, configurable SLA/plan."],
          ["Construction Stage Demands & Bank Funds", "4 Construction + 5 Demands & Collections", "Separate physical progress from financial demand; link milestone events; improve project cash forecast."],
          ["Pre-Registration Financial Clearance", "6 Pre-Registration Readiness", "Gate combines finance, documents, legal/statutory and customer readiness."],
          ["Sale Deed & Sub-Registrar Slot", "7 Registration", "Document generation, validation, challan/slot, execution and evidence with configurable plan/SLA."],
          ["Pre-Handover Inspection & Key Takeover", "8 Pre-Handover + 9 Handover", "Unit Readiness, QA/snags, commitments, handover gate, scheduling, possession evidence, FM transition."],
          ["Not explicit in current SOP", "0 Unit / Pre-Sales + 10 Post-Handover", "Add pre-sale unit/changeability intelligence and post-handover DLP/warranty/facilities lifecycle."],
        ]}
        striped
      />
    </Stack>
  );
}

function LifecycleStrip() {
  const theme = useHostTheme();
  const stages = [
    "0 Pre-sales",
    "1 Booking",
    "2 Funding",
    "3 Agreement",
    "4 Construction",
    "5 Collections",
    "6 Pre-reg",
    "7 Registration",
    "8 Pre-HO",
    "9 Handover",
    "10 Post-HO",
  ];
  return (
    <Stack gap={6}>
      <Text size="small" tone="tertiary">
        Source: spec §5 / §34.2 · parallel streams may skip numbered order unless a gate blocks
      </Text>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {stages.map((s, i) => (
          <div
            key={s}
            style={{
              padding: "6px 10px",
              background: i === 0 || i === 10 ? theme.fill.secondary : theme.fill.tertiary,
              border: `1px solid ${theme.stroke.tertiary}`,
              borderRadius: 6,
            }}
          >
            <Text size="small" weight="medium">{s}</Text>
          </div>
        ))}
      </div>
    </Stack>
  );
}

function ChangeView() {
  const layout = computeDAGLayout({
    nodes: [
      { id: "draft" },
      { id: "feas" },
      { id: "cost" },
      { id: "intap" },
      { id: "custap" },
      { id: "pay" },
      { id: "exec" },
      { id: "site" },
      { id: "prog" },
      { id: "qa" },
      { id: "qav" },
      { id: "accept" },
      { id: "closed" },
    ],
    edges: [
      { from: "draft", to: "feas" },
      { from: "feas", to: "cost" },
      { from: "cost", to: "intap" },
      { from: "intap", to: "custap" },
      { from: "custap", to: "pay" },
      { from: "pay", to: "exec" },
      { from: "exec", to: "site" },
      { from: "site", to: "prog" },
      { from: "prog", to: "qa" },
      { from: "qa", to: "qav" },
      { from: "qav", to: "accept" },
      { from: "accept", to: "closed" },
    ],
    direction: "horizontal",
    nodeWidth: 88,
    nodeHeight: 36,
    rankGap: 20,
    nodeGap: 16,
    padding: 8,
  });
  const labels: Record<string, string> = {
    draft: "Requested",
    feas: "Feasibility",
    cost: "Costing",
    intap: "Internal appr.",
    custap: "Customer appr.",
    pay: "Payment",
    exec: "Approved",
    site: "Released",
    prog: "In progress",
    qa: "Ready QA",
    qav: "QA verified",
    accept: "Accepted",
    closed: "As-built",
  };
  const theme = useHostTheme();

  return (
    <Stack gap={20}>
      <H2>Changeability — construction and sales run in parallel</H2>
      <Text tone="secondary">
        Units may be sold before construction, during it, near completion, or after. Customisation availability cannot come from booking date or one project-wide cutoff. It is derived from the live physical state of each Unit Twin and governed by configurable gates.
      </Text>
      <Callout tone="warning" title="Operating principle">
        A Change Request may be raised at almost any point. Gates govern feasibility, approval, execution, commercial treatment and authority — they should not suppress request creation. Sales/CRM read gates. Project/Design own physics and rules. Safety/statutory hard gates are never overridden.
      </Callout>

      <H3>Five gate states</H3>
      <Table
        headers={["State", "Meaning", "Sales / CRM treatment"]}
        rowTone={["success", "warning", "info", "warning", "danger"]}
        rows={[
          ["OPEN", "Can normally be evaluated and executed without rework if technically feasible.", "Show as available; customer may shortlist on this capability."],
          ["CLOSING", "Still open, but a known construction/procurement event will close it soon.", "Show expected closure date/event and remaining window."],
          ["CONDITIONAL", "Possible, but adds technical, procurement, cost or schedule conditions.", "Show conditions; no promise until feasibility/quotation is approved."],
          ["EXCEPTION ONLY", "Normal window closed; execution may need rework or senior approval.", "May be requested; flag as exception with likely cost/time impact."],
          ["HARD CLOSED", "Not permissible — structural, statutory, fire/life-safety, sanctioned-plan.", "Do not offer as available. Explain reason category. Never reopen via Sales/CRM/ordinary override."],
        ]}
        striped
      />

      <H3>How a gate is derived — examples</H3>
      <Table
        headers={["Physical / procurement event", "Illustrative automated gate"]}
        rows={[
          ["MEP first-fix not started", "Electrical / plumbing point relocation = OPEN"],
          ["MEP first-fix commenced", "Relevant MEP changes = CLOSING or CONDITIONAL"],
          ["MEP first-fix completed / wall closed", "MEP relocation = EXCEPTION ONLY (or HARD CLOSED by policy)"],
          ["Flooring selection not frozen and PO not released", "Flooring selection = OPEN"],
          ["Flooring PO released", "Flooring selection = CONDITIONAL"],
          ["Flooring installed", "Flooring replacement = EXCEPTION ONLY"],
          ["Structural element cast / approved structural stage passed", "Structural alteration = HARD CLOSED"],
          ["Customer change approved and released", "Affected configuration becomes current revision; competing rules re-evaluated"],
        ]}
        striped
      />

      <H3>Requirement-to-unit matching (sales guidance, not engineering approval)</H3>
      <Table
        headers={["", "Unit V101", "Unit V104"]}
        rows={[
          ["Construction state", "Early construction", "Near completion"],
          ["Customisation flexibility", "92/100 — High", "12/100 — Minimal"],
          ["Kitchen layout", "Open", "Exception Only"],
          ["Electrical additions", "Open", "Conditional"],
          ["Flooring selection", "Open", "Hard / commercially closed per policy"],
          ["Sales interpretation", "Fit for a customer seeking personalisation", "Fit for a customer prioritising early possession"],
        ]}
        striped
      />

      <H2>Change Request is a controlled variation — not a comment or snag</H2>
      <Text size="small" tone="tertiary">
        Source: spec §8.7 · Rejected, Withdrawn and Cancelled remain auditable side states
      </Text>
      <svg width={layout.width} height={layout.height} style={{ maxWidth: "100%" }}>
        {layout.edges.map((e) => (
          <line
            key={`${e.from}-${e.to}`}
            x1={e.sourceX}
            y1={e.sourceY}
            x2={e.targetX}
            y2={e.targetY}
            stroke={theme.stroke.primary}
            strokeWidth={1}
          />
        ))}
        {layout.nodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width={88}
              height={36}
              rx={4}
              fill={n.id === "closed" ? theme.fill.secondary : theme.fill.tertiary}
              stroke={theme.stroke.secondary}
            />
            <text
              x={n.x + 44}
              y={n.y + 22}
              textAnchor="middle"
              fill={theme.text.primary}
              fontSize={9}
            >
              {labels[n.id]}
            </text>
          </g>
        ))}
      </svg>

      <CollapsibleSection title="Core control model — why each control exists" count={10} defaultOpen>
        <Table
          headers={["Control", "HomeFlow requirement", "Why it matters"]}
          rows={[
            ["Request definition", "One CR, multiple line items by room/trade, with intent, drawings/photos, priority, desired date.", "Stops informal messages becoming uncontrolled site instructions."],
            ["Feasibility", "Feasible / Feasible with conditions / Rejected, with reason and dependencies.", "Protects structural, MEP, statutory, waterproofing, fire/life-safety, maintainability."],
            ["Commercial control", "Customer price, incremental internal/vendor cost, tax, discount/waiver, payment terms, gross contribution — before approval.", "Protects margin. No execution before commercial closure."],
            ["Schedule impact", "Lead time, procurement, construction, critical-path and handover-date impact.", "Stops a small-looking change silently creating a large delay."],
            ["Approval matrix", "Depends on change type, technical risk, value, margin, schedule impact, before/after freeze.", "Controlled flexibility instead of ad-hoc exceptions."],
            ["Customer acceptance", "Scope, drawings/spec, price, tax, exclusions, schedule impact, validity date. Explicit acceptance captured.", "Informed consent. Fewer future disputes."],
            ["Payment gate", "Configured advance/full payment before release, unless authorized exception recorded.", "Prevents unfunded variations and receivable leakage."],
            ["Drawing / spec control", "Approved revision gets a version. Superseded drawings locked. Site/QA/Procurement consume only released revision.", "Prevents execution from the wrong drawing."],
            ["Execution + QA", "Released change generates site/procurement/vendor actions, evidence, inspection, QA verification.", "Connects customer request to physical delivery."],
            ["As-built closure", "Updates Unit Twin, final drawings/specs, asset/warranty records and handover pack.", "Permanent truth of what was actually delivered."],
          ]}
          striped
        />
      </CollapsibleSection>

      <H3>Who owns what</H3>
      <Table
        headers={["Role", "Authority"]}
        rows={[
          ["Project / Construction", "Own actual physical progress and planned activity dates; approve schedule-impacting holds."],
          ["Design / Engineering", "Own technical change rules, hard constraints and feasibility decisions."],
          ["Procurement", "PO / order / material status that can restrict changeability."],
          ["Sales", "Read changeability, capture prospect needs, compare units, request holds. No gate editing."],
          ["CRM / CX", "Raise/manage booked-customer CRs and customer communication. No physical-state editing."],
          ["Commercial / Finance", "Variation pricing, discount/waiver authority, payment gate, contribution view."],
          ["QA", "Inspection / verification states used for readiness and closure."],
          ["Management / Named Authority", "Configured exception overrides. Cannot override hard safety/statutory gates."],
        ]}
        striped
      />

      <CollapsibleSection title="Change Window Hold + freshness + bulk progress" count={8}>
        <Stack gap={8}>
          <Text>
            For every Closing gate, show expected closure date/time, closing event and source schedule. A hold must specify Unit, gate/category, prospect/opportunity, requested duration, construction impact and approver. It auto-expires and releases. Project approval is mandatory if planned execution changes. Sales cannot create a binding hold unilaterally. Configure max duration, concurrent holds, value/role thresholds and blackout activities.
          </Text>
          <Text>
            Project Progress Control: Project → Phase/Tower/Block → Floor/Zone → Unit. Bulk updates by tower/floor/zone/work package with preview of affected units and gate transitions before commit. Unit-level exceptions when actual progress differs from bulk. Source + timestamp on every state. Reopening a previously closed gate requires reason and audit. If data is stale past policy, Sales/CRM see “Verification Required” — never a falsely precise open/closed promise.
          </Text>
          <Text>
            Sales inventory exposes Construction %, expected possession window, Customisation Flexibility score and gate summary. Filters: Highly Customisable, Layout Flexible, Kitchen Changes Open, Electrical Changes Open, Flooring Selection Open, Bathroom Specification Open, Ready-to-Move. CRM sees the same state for booked customers and cannot promise a change that is not Open without the feasibility/exception workflow.
          </Text>
          <Text>
            Customer experience rule: the customer sees what was requested, what Pranava approved, what it costs, whether it affects handover, the latest approved drawing/spec, what is being executed and what has been delivered — without vendor pricing or internal deliberations.
          </Text>
        </Stack>
      </CollapsibleSection>
    </Stack>
  );
}

function ModulesView() {
  return (
    <Stack gap={16}>
      <H2>Module-level specification — retain existing modules, connect them</H2>
      <Text tone="secondary">
        Existing modules are a valuable base. 2.0 connects them through the common data model, Action engine, twins, predictive risk, customer transparency, evidence-based quality and profitability controls.
      </Text>

      <Module
        id="8.1"
        title="Sales Handover"
        punch="CRM acceptance is a controlled quality gate."
        bullets={[
          "Completeness score before Sales can submit.",
          "Mandatory vs conditional document checklist by project / product / customer type.",
          "Commercial approvals and deviations attached to booking.",
          "First-time-right metric by salesperson / team.",
          "Return reason taxonomy and repeat-error analytics.",
          "Automatic CRM task generation on acceptance.",
        ]}
      />
      <Module
        id="8.2"
        title="Documents & Legal Document Factory"
        punch="Repository work becomes an intelligent pipeline."
        bullets={[
          "Auto-classification and metadata extraction from uploads.",
          "Name / PAN / address / unit / value cross-checks against master data.",
          "Discrepancy flags with confidence score and review queue.",
          "Data-driven generation with minimal re-entry.",
          "Version comparison highlighting only substantive changes.",
          "Generate → validate → legal approve → customer approve → eSign → archive.",
          "Expiry / renewal alerts.",
          "Families: AOS, Sale Deed, Lease, Addenda, Possession/Handover, declarations, NOCs, letters, variation agreements, cancellation/transfer.",
          "Clause Library with conditional logic by project, property type, customer type, transaction type, payment plan, jurisdiction, approved deviation.",
          "Pre-generation validation: completeness, cross-field consistency, amounts/dates, unit identity, applicant names, PAN/address, commercial approval state.",
          "Every generated document stays linked Project → Unit → Booking → Customer and is visible from both twins.",
        ]}
      />
      <Module
        id="8.3"
        title="Collections"
        punch="Move from reporting outstanding to predicting cash realization."
        bullets={[
          "Separate outstanding, due, overdue, disputed, loan-dependent, promise-to-pay and true risk.",
          "Reason codes for every overdue amount.",
          "Collection forecast by 7 / 30 / 60 / 90 days.",
          "Promise-to-pay tracking with breach prediction.",
          "Interest / penalty waiver approval and leakage tracking.",
          "Reconciliation exceptions and TDS verification.",
          "Portfolio heatmap by project, RM, ageing and risk.",
          "Project-wise cash-flow forecast: current month, next month, weekly, monthly, quarterly, custom range.",
          "Actual vs Forecast vs Revised Forecast by Project and portfolio, including last-period actual and variance.",
          "Forecast waterfall: contractual demands, overdue recoveries, PTP, expected loan disbursements, registration/final-demand, approved reschedules.",
          "Probability-weighted expected date and amount at Booking/Unit; roll up without losing drill-down.",
          "Never silently mix booked receivables with speculative new-sales inflows.",
          "Cash-flow plan: opening receivable, demands becoming due, expected receipts, overdue recovery, loan inflows, likely shortfall, closing receivable, confidence.",
          "Forecast accuracy KPI: original vs revised vs actual by Project, team, reason, horizon.",
          "Scenarios: Base / Conservative / Stretch — transparent assumptions, no overwrite of baseline.",
        ]}
      />
      <Module
        id="8.4"
        title="Loans"
        punch="Prevent future overdue by managing disbursement readiness."
        bullets={[
          "Sanctioned, disbursed, available balance and next demand.",
          "Expected bank release date and missing documentation.",
          "Days-to-demand vs days-to-disbursement gap.",
          "Lender contact and case history.",
          "Risk score and automated actions before demand becomes overdue.",
        ]}
      />
      <Module
        id="8.5"
        title="Legal"
        punch="Exception-driven and traceable."
        bullets={[
          "Agreement template and clause library by project / entity / customer type.",
          "Deviation register with approval authority matrix.",
          "Version comparison and material-change summary.",
          "Legal query / response SLA and blocker ownership.",
          "Approval evidence and immutable audit trail.",
        ]}
      />
      <Module
        id="8.6"
        title="Registration"
        punch="Readiness explicit and forecastable."
        bullets={[
          "Readiness checklist: documents, payments, TDS, appointments, signatures.",
          "SRO slot scheduling and change history.",
          "Pre-registration gate with hard blockers.",
          "Day-of-registration checklist and live exception handling.",
          "Registered document receipt, validation and archive.",
          "Forecasted registration date with confidence and critical path.",
        ]}
      />
      <Module
        id="8.7"
        title="Customer Change Requests & Unit Customisations"
        punch="Controlled variations to the Unit Twin — see the Changeability tab for the full engine."
        bullets={[
          "Single CR ID linked to Customer, Booking, Unit, Project and affected room/trade/system.",
          "Multiple line items: wall relocation, flooring, electrical, sanitaryware, kitchen, landscape.",
          "Standard catalogue vs bespoke. Standard options use pre-approved scope, price, lead time.",
          "Feasibility: Requested → Under Feasibility → Feasible / Feasible with Conditions / Rejected.",
          "Mandatory impact: Cost, Schedule, Technical/Design, Handover — before customer approval.",
          "Change-freeze date by project, tower/villa, trade, milestone, with post-freeze exception approval.",
          "Customer quotation/version: scope, inclusions, exclusions, drawings/spec, tax, payment terms, lead time, validity.",
          "Execution release only after approvals and configured payment gate.",
          "Drawing/spec version control with superseded lockout and controlled release to Site, QA, Procurement, Vendor.",
          "Auto-generate site/procurement/vendor actions from the approved variation.",
          "QA + before/after evidence before customer acceptance and closure.",
          "Completed change updates Unit Twin and Home Passport permanently.",
          "Cancellation/reversal: cutoff rules, abortive-work cost, refund/credit, approval trail.",
          "Profitability: customer price, vendor cost, internal incremental cost, tax, discount/waiver, contribution, leakage.",
        ]}
      />
      <Module
        id="8.8"
        title="Unit Readiness & QA/QC"
        punch="Replace subjective percentages with evidence-based completion."
        bullets={[
          "Component hierarchy by room / trade / system.",
          "Checklist completion with mandatory photographs / tests / certificates.",
          "Site declaration and independent QA verification as separate states.",
          "Common-area / utility / statutory dependencies linked to unit eligibility.",
          "Readiness score derived from evidence, not manual entry.",
          "Exception queue for failed inspections and repeat failures.",
        ]}
      />
      <Module
        id="8.9"
        title="Snagging"
        punch="Discovery → verified closure → root cause."
        bullets={[
          "Category, severity, location, trade, vendor/contractor, root cause.",
          "SLA by severity and customer impact.",
          "Before/after evidence and QA verification.",
          "Customer verification where appropriate.",
          "Repeat defect flag and cost of rectification.",
          "Analytics by contractor, trade, project, root cause and cost.",
        ]}
      />
      <Module
        id="8.10"
        title="Handover"
        punch="A gated readiness event — not an appointment alone."
        bullets={[
          "Unified Handover Readiness Score.",
          "Mandatory hard gates: financial, legal, registration, QA, critical snags, commitments, FM/utilities.",
          "Predicted handover date and confidence.",
          "Appointment workflow and customer confirmation.",
          "Digital checklist: keys, meters, manuals, warranties, signatures, photographs.",
          "No override of hard gates without named authority and recorded reason.",
        ]}
      />
      <Module
        id="8.11"
        title="Customer Commitments — Promise Ledger"
        punch="Permanent ledger of every promise."
        bullets={[
          "Promise, owner, beneficiary, due date, financial impact, approval, evidence.",
          "Internal vs customer-facing commitment distinction.",
          "AI-assisted promise detection from logged communication.",
          "Confidence score based on dependencies.",
          "Pre-breach alerts and recovery plan.",
          "Broken-promise rate by team and root cause.",
        ]}
      />
      <Module
        id="8.12"
        title="Communications"
        punch="One auditable history. No internal chatter leaked."
        bullets={[
          "Omnichannel: call, email, WhatsApp, SMS, meeting, notices.",
          "Strict separation of internal and customer-visible content.",
          "Templates with project / legal / compliance approval.",
          "AI conversation summary and open-decision extraction.",
          "Sentiment trend and unanswered-question detection.",
          "Frequency guardrails to prevent spam.",
        ]}
      />
      <Module
        id="8.13"
        title="Escalations"
        punch="Exception-management engine, not a noise channel."
        bullets={[
          "Rule-based by SLA breach, severity, financial impact, commitment risk, sentiment.",
          "Tiered path with owner and backup.",
          "Auto-generated case summary: what happened, impact, dependencies, decisions needed.",
          "Recovery plan with accountable actions.",
          "Executive escalation only for genuine exceptions.",
          "Root-cause closure required for repeat / high-severity events.",
        ]}
      />
      <Module
        id="8.14"
        title="Post-Handover / Warranty / Service"
        punch="The relationship continues after keys."
        bullets={[
          "Move-in support and utility / FM onboarding.",
          "Defect liability and warranty case management.",
          "Digital Home Passport: equipment, serials, manuals, warranties.",
          "Service history retained against the unit.",
          "Satisfaction checkpoints after 7 / 30 / 90 days and DLP closure.",
          "Referral / testimonial / advocacy after positive outcomes.",
        ]}
      />
    </Stack>
  );
}

function Module({
  id,
  title,
  punch,
  bullets,
}: {
  id: string;
  title: string;
  punch: string;
  bullets: string[];
}) {
  return (
    <CollapsibleSection title={`${id}  ${title}`} trailing={<Text size="small" tone="tertiary">{punch}</Text>}>
      <Stack gap={4}>
        {bullets.map((b) => (
          <div key={b}>
            <Text size="small">• {b}</Text>
          </div>
        ))}
      </Stack>
    </CollapsibleSection>
  );
}

function OperateView() {
  return (
    <Stack gap={20}>
      <H2>Five scores — each answers a different question</H2>
      <Text tone="secondary">
        Avoid one ambiguous percentage. Every score must show current value, trend, top three drivers, confidence, and recommended actions. Scores must not become decorative badges.
      </Text>
      <Table
        headers={["Score", "Question answered", "Illustrative dimensions"]}
        rows={[
          ["Unit Readiness", "Is the physical flat/villa genuinely ready?", "Construction completion, QA checks, utilities, common-area dependencies, snags."],
          ["Customer / Booking Readiness", "Is the customer-side relationship ready?", "Payments, loan, KYC, legal, registration, commitments, scheduling."],
          ["Handover Readiness", "Can we safely and successfully hand over now?", "Weighted physical + customer readiness + mandatory gates."],
          ["Customer Health", "How healthy is the relationship?", "Sentiment, SLA, commitments, complaints, payment behaviour, communication pattern."],
          ["Financial Health", "How likely are collections to occur on plan?", "Overdue, PTP, loan gaps, disputes, ageing, behavioural risk."],
        ]}
        striped
      />

      <H2>Handover hard / soft gates</H2>
      <Table
        headers={["Gate", "Illustrative mandatory conditions", "Override?"]}
        rowTone={["danger", "danger", "warning", "danger", "warning", "warning", "info", "info"]}
        rows={[
          ["Financial", "Required consideration received; TDS verified; approved waivers posted; no unapproved dues.", "Authority-controlled only"],
          ["Legal", "Executed agreement / required legal approvals complete.", "Normally no"],
          ["Registration", "Registration complete or policy-approved exception.", "Authority-controlled"],
          ["Physical", "Construction readiness threshold met; utilities available.", "No for safety-critical items"],
          ["Quality", "QA approved; zero critical snags; minor snags within policy.", "Limited"],
          ["Commitments", "Critical customer commitments closed or explicitly accepted.", "Authority-controlled"],
          ["Customer", "Appointment, identity, nominees/representatives and orientation ready.", "Operational"],
          ["FM / Community", "Access, meters, keys, manuals, emergency contacts and onboarding ready.", "Operational"],
        ]}
        striped
      />

      <H2>Universal Action Engine — the operating backbone</H2>
      <Table
        headers={["Field", "Requirement"]}
        rows={[
          ["Action ID / type", "Unique and typed: Task, Approval, Document, Payment, Snag, Commitment, Customer Contact, etc."],
          ["Related objects", "Customer, Booking, Unit, Project and originating record."],
          ["Owner / backup", "Named person and department, plus re-assignment history."],
          ["Priority", "Operational priority plus customer / financial / reputation severity."],
          ["SLA / due date", "Policy-driven. Pausable only with approved reason."],
          ["Dependencies", "Explicit upstream blockers and downstream impact."],
          ["Business impact", "Customer impact, rupee exposure, milestone impact, reputation risk."],
          ["Evidence", "Attachment, photo, approval, transaction or structured proof required for closure."],
          ["State", "New, In progress, Waiting internal, Waiting customer, Blocked, Ready for approval, Closed, Cancelled."],
          ["Audit trail", "Every change, comment, reassignment, breach and approval timestamped."],
        ]}
        striped
      />

      <H3>My Day</H3>
      <Text>
        Behavioral goal: employees should not search HomeFlow for work. Top actions ranked by deadline, customer impact, revenue impact, dependency impact and escalation risk. Plain-language “Why now?”. One-click: call, WhatsApp, request document, approve, assign, escalate, create recovery plan. Focus modes by customer, project or functional queue. Daily closure summary and carry-forward reasons.
      </Text>

      <H2>SLA ladder — L0 to L4</H2>
      <Table
        headers={["Level", "Trigger", "Response"]}
        rows={[
          ["L0", "Normal action within SLA", "Owner executes; dashboard only."],
          ["L1", "Approaching SLA / forecast risk", "Owner + backup notified; recommended recovery action."],
          ["L2", "SLA breached / customer milestone impacted", "Department manager owns recovery plan."],
          ["L3", "Repeated breach / material financial or customer impact", "Functional head intervention."],
          ["L4", "Critical customer / reputation / legal / safety impact", "CX / COO / management alert with decision pack."],
        ]}
        striped
      />
      <Callout tone="info" title="SLA and plan are related but separate">
        A task may be within SLA but late to the Project plan, or vice versa. Changing a planned date must not erase history. Store baseline, revisions, actor, timestamp, reason and approval. Planned duration may be working days or calendar days, inherited from Pranava default, Project override, process/stage override or record-level exception. Derived statuses: On Track, Due Soon, At Risk, Overdue, Completed On Time, Completed Late, Paused/Waiting.
      </Callout>
      <Text size="small">
        Every escalation includes a system-generated decision pack: what happened, current impact, critical dependencies, actions already taken, owner, next deadline, recommended decision, evidence links. Analytics roll up by Project, stage, department, role, owner, unit and customer/booking.
      </Text>

      <H2>Role workspaces — one question each</H2>
      <Text size="small" tone="secondary">
        Every workspace opens in the user’s assigned Project by default, with a visible Project selector when authorized for more. A person may belong to Project-dedicated and shared teams at once. Ownership and escalations resolve through Project Team Assignment.
      </Text>
      <Table
        headers={["Stakeholder", "HomeFlow must answer"]}
        rows={[
          ["Customer", "What is happening with my home and what do I need to do?"],
          ["CRM / RM", "Who needs attention today, why, and what should I do next?"],
          ["Sales", "Which available units best fit this prospect, which customisation gates are open/closing, and when do those windows expire?"],
          ["Accounts / Collections", "What is due, truly at risk, disputed or loan-dependent?"],
          ["Loan Coordinator", "Which future demands are at risk due to disbursement readiness?"],
          ["Legal", "Which cases require legal judgment, approval or deviation handling?"],
          ["Registration", "Which customers can register, when, and what is blocking them?"],
          ["Site Engineer", "Which unit-level tasks and evidence must be completed?"],
          ["QA", "What needs inspection, reinspection or systemic intervention?"],
          ["Vendor / Contractor", "What defects/actions belong to me, with evidence and SLA?"],
          ["Handover Team", "Which units are truly eligible and which blockers must be cleared?"],
          ["Department Head", "Where is my team missing SLA, creating rework or breaking commitments?"],
          ["Management", "Where must I intervene to protect customers, cash, schedule, reputation and margin?"],
          ["Design / Technical / Customisation", "Which CRs need feasibility, costing, drawing release, approval or closure, and what is the schedule/margin impact?"],
          ["Project / Construction", "What physical progress changed today, which units/gates are affected, and which holds or exceptions require my decision?"],
          ["Design / Engineering", "Which requested changes require feasibility judgment and which technical rules/gates must be maintained?"],
          ["Procurement", "Which material/order events will close or restrict unit changeability and which approved variations require procurement action?"],
        ]}
        striped
        stickyHeader
      />

      <H2>Executive Control Tower</H2>
      <Callout tone="warning" title="Design principle">
        Management should see five problems that need intervention, not fifty charts. The five interventions are system-generated, ranked, with owner, rupee/customer impact and the decision required.
      </Callout>
      <Table
        headers={["Lens", "What it shows"]}
        rows={[
          ["Portfolio", "Active customers, bookings, units in pre-handover, next 30/60/90-day handovers."],
          ["Cash", "Due, overdue, true collection risk, forecast, disputes, loan-dependent exposure."],
          ["Project Cash Flow", "Current-month actual, next-month forecast, 90-day forecast, prior-period actual, variance and confidence — with portfolio roll-up."],
          ["Project Performance", "Customer health, handover risk, collections, SLA, customisation impact, rework/leakage, team workload — drill to Unit/Booking."],
          ["Experience", "Customer Health distribution, sentiment deterioration, commitment breaches, NPS/CSAT."],
          ["Execution", "SLA compliance, critical-path delays, handovers at risk, critical snags, registration slippage."],
          ["Profitability", "Rework cost, concessions/waivers, compensation, cost-to-serve, leakage by project/root cause."],
        ]}
        striped
      />

      <H2>Controlled openness</H2>
      <Table
        headers={["Principle", "Design requirement"]}
        rows={[
          ["Need-to-know", "Users see information required to perform their role."],
          ["Customer transparency", "Customers see approved milestones, responsibilities, commitments and evidence relevant to them."],
          ["Internal confidentiality", "Internal notes, staff performance, vendor disputes and unapproved forecasts remain internal."],
          ["Financial sensitivity", "Discounts, margins, concessions and cost-to-serve restricted by role."],
          ["Immutable audit", "Changes to commercial terms, commitments, approvals and closures remain traceable."],
          ["Explicit overrides", "Hard-gate overrides require named authority, reason and evidence."],
        ]}
        striped
      />
    </Stack>
  );
}

function MoneyView() {
  return (
    <Stack gap={20}>
      <H2>Collections forecast — explainable, versioned, drillable</H2>
      <Text tone="secondary">
        Probability weighting is rule-based first: ageing, payment behaviour, PTP quality, bank disbursement stage, missing documents, dispute status, milestone readiness, recent interaction. AI may refine later but cannot hide the drivers. Finance/Collections own forecast overrides. CRM may update promise signals but cannot silently change finance-owned amounts.
      </Text>

      <Grid columns="1.2fr 1fr" gap={16}>
        <Stack gap={8}>
          <H3>Forecast line sources</H3>
          <Table
            headers={["Source type", "In committed post-sales forecast?"]}
            rowTone={["success", "success", "warning", "success", "success", "success", "info", "danger"]}
            rows={[
              ["Contractual Due", "Yes"],
              ["Overdue Recovery", "Yes"],
              ["Promise-to-Pay", "Yes — expected date/confidence only. Not Actual until reconciled receipt."],
              ["Loan Disbursement", "Yes — one canonical line, no double count with the demand."],
              ["Registration / Final Demand", "Yes"],
              ["Approved Reschedule", "Yes"],
              ["Manual Finance Override", "Yes — reason, actor, evidence required."],
              ["Scenario-only Future Sales", "Never mixed into booked receivable forecast by default."],
            ]}
            striped
          />
        </Stack>
        <Stack gap={8}>
          <H3>Current-month plan stack</H3>
          <BarChart
            categories={["Plan", "Month-start Fcst", "Latest Fcst", "Actual-to-date", "Projected EOM"]}
            series={[{ name: "Illustrative rupee index (spec shape, not live data)", data: [100, 100, 92, 61, 88] }]}
            height={220}
            showValues
          />
          <Text size="small" tone="tertiary">
            Source: spec §31.4 · shape of the five current-month views. Values are illustrative of the comparison the UI must show, not production numbers.
          </Text>
        </Stack>
      </Grid>

      <H3>Project cash-flow math (every period)</H3>
      <Text size="small">
        Opening outstanding → demands due in period → overdue at start → expected contractual collection → expected overdue recovery → expected loan disbursement → expected rescheduled amount → total expected receipts → actual receipts → forecast variance → closing expected outstanding + confidence. Project total equals the sum of its forecast lines. Portfolio total equals the sum of authorized Projects, subject to explicit elimination rules.
      </Text>

      <H2>Profitability and margin protection</H2>
      <Table
        headers={["Economic object", "Examples"]}
        rows={[
          ["Revenue / receivable", "Sale value, upgrades, services, scheduled collections, realized collections."],
          ["Commercial leakage", "Discounts, free items, unapproved promises, waivers, interest reversals."],
          ["Service leakage", "Compensation, hospitality, special transport, repeated manual interventions."],
          ["Quality cost", "Rework labor/material, vendor back-charges, repeat snag cost."],
          ["Delay cost", "Extended staffing, holding cost, interest implications, customer compensation."],
          ["Cost-to-serve", "CRM effort, visits, escalations, legal effort, exceptional processing."],
          ["Unit / booking contribution", "Original planned margin vs current margin after leakage."],
          ["Customisation economics", "Variation selling price, incremental vendor/internal cost, taxes, discounts/waivers, abortive work, contribution and margin."],
        ]}
        striped
      />

      <H2>KPI framework — Project is a mandatory dimension</H2>
      <Text size="small" tone="secondary">
        Hierarchy: Portfolio → Project → Phase/Tower/Block → Unit. Org view: Portfolio → Project Team / Shared Team → Role → Owner.
      </Text>
      <Table
        headers={["Domain", "Core KPIs"]}
        rows={[
          ["Customer experience", "NPS, CSAT, response SLA, sentiment trend, escalation rate, referral rate."],
          ["Commitments", "On-time commitment %, pre-breach recovery %, broken promises by root cause."],
          ["Finance", "Collection efficiency, overdue %, true-risk amount, forecast accuracy, PTP conversion."],
          ["Legal / registration", "Agreement TAT, deviation TAT, registration readiness, registration predictability."],
          ["Quality", "First-pass QA, critical snag rate, repeat snag rate, snag closure TAT, rework cost."],
          ["Handover", "Handover predictability, on-time %, first-time-right %, hard-gate overrides."],
          ["Operations", "SLA compliance, action ageing, reassignments, dependency delay, queue health."],
          ["Profitability", "Concession leakage, rework, delay cost, compensation, cost-to-serve, margin erosion."],
          ["Customer changes", "Request-to-feasibility TAT, quote TAT, approval conversion, on-time execution, post-freeze change %, variation margin, rework due to wrong revision, change-driven handover delay."],
          ["Changeability", "% units with fresh gate data, gate forecast accuracy, requirement-to-unit match conversion, hold conversion, post-gate exception rate, change margin and schedule impact."],
          ["Journey health", "On Track / At Risk / Overdue journeys, bottleneck stages, median/percentile cycle time, plan-vs-forecast-vs-actual variance."],
        ]}
        striped
      />
    </Stack>
  );
}

function ExperienceView() {
  return (
    <Stack gap={20}>
      <H2>AI sits on disciplined workflow — not a chatbot first</H2>
      <Table
        headers={["Engine", "Purpose", "Example output"]}
        rows={[
          ["Journey Risk", "Predict milestone delay and identify drivers.", "Handover 19 Aug: 42% confidence; registration + QA are critical path."],
          ["Next Best Action", "Prioritize the most valuable action now.", "Secure SRO slot today; improves handover probability by 18 points."],
          ["Collection Risk", "Predict cash realization and causes of slippage.", "₹48L likely delayed due to bank documentation; customer default risk low."],
          ["Commitment Risk", "Predict broken promises before due date.", "Customer-facing commitment likely to miss by 4–6 days."],
          ["Sentiment / Escalation", "Detect deteriorating relationship before formal complaint.", "Negative trend across 3 interactions; proactive RM call recommended."],
          ["Document Intelligence", "Classify, extract and validate documents.", "PAN valid; name match; address differs from booking record."],
          ["Quality Root-Cause", "Find recurring defects and operational patterns.", "Waterproofing repeat rate concentrated with contractor X."],
          ["Profitability Leakage", "Connect service failures to cost/margin.", "₹12.4L quarterly leakage from rework + concessions."],
        ]}
        striped
      />

      <H3>Copilot questions by role (after the engines exist)</H3>
      <Table
        headers={["Role", "Asks"]}
        rows={[
          ["Management", "What requires my attention today and why?"],
          ["CRM", "Which customers should I contact today?"],
          ["Collections", "Which ₹2 Cr is most likely to close this week?"],
          ["Projects", "Which units are blocking next month’s handovers?"],
          ["Legal", "Which agreements are beyond SLA and what is the blocker?"],
          ["QA", "Which repeat defects need contractor-level intervention?"],
          ["Customer service", "Summarize this customer’s history before I call."],
          ["Document Copilot", "What data is missing? Why is this deed blocked? What changed from v2 to v3? Which clauses differ from the approved project standard?"],
        ]}
        striped
      />
      <Callout tone="danger" title="AI limits">
        AI may summarize redlines, suggest a known approved clause, flag anomalies, extract data and draft communications. Final legal wording comes from the approved library or an explicit Legal-approved deviation. AI cannot autonomously approve legal deviations or auto-send consequential customer communication.
      </Callout>

      <H2>My Pranava Home — the customer never sees the OS</H2>
      <Table
        headers={["Customer area", "Experience"]}
        rows={[
          ["Journey", "Clear lifecycle timeline, achieved milestones, next milestone and expected date."],
          ["My Home", "Unit details, approved specifications, progress imagery and important updates."],
          ["Payments", "Demand schedule, receipts, outstanding, TDS guidance and secure payment links."],
          ["Documents", "Required, received, approved and downloadable customer documents."],
          ["Registration", "Readiness status, document checklist, appointment details and final documents."],
          ["Handover", "Readiness, appointment, orientation, checklists and signed handover pack."],
          ["Requests", "One place for questions/service requests and to submit/approve customisations, quotations, drawings and status."],
          ["Commitments", "Customer-visible commitments and current status."],
          ["Home Passport", "Manuals, warranties, product details and service history after handover."],
        ]}
        striped
      />
      <Text>
        Visibility rule: show commitments, milestones, actions required from the customer, approved dates and final evidence. Do not show internal blame, employee performance, vendor disputes, internal notes or unapproved forecasts.
      </Text>

      <H2>Notification rules — avoid fatigue</H2>
      <Table
        headers={["Type", "Rule"]}
        rows={[
          ["Employee action", "In-app by default; email/WhatsApp only for urgent or opted-in categories."],
          ["Daily digest", "Prioritized My Day with overdue, due today, at-risk and approvals."],
          ["Customer update", "Event-driven and value-adding; avoid repetitive status noise."],
          ["Pre-breach alert", "Before commitment / SLA / milestone failure when recovery is still possible."],
          ["Management alert", "Only material exception thresholds; include concise decision pack."],
          ["Quiet hours / preferences", "Respect customer and employee communication windows and channel preferences."],
        ]}
        striped
      />
    </Stack>
  );
}

function ShipView() {
  return (
    <Stack gap={20}>
      <H2>Priority roadmap — architecture first, copilots last</H2>
      <Text size="small" tone="tertiary">
        Source: spec §24 · counts of named capabilities by horizon. P0 includes items listed both at the top and after the P2 block in the PDF.
      </Text>
      <Grid columns="1fr 1fr" gap={16}>
        <BarChart
          categories={["P0 0–90d", "P1 3–6m", "P2 6–12m"]}
          series={[{ name: "Named capabilities in §24", data: [9, 8, 4] }]}
          height={200}
          showValues
        />
        <PieChart
          data={[
            { label: "P0 foundation", value: 9, tone: "danger" },
            { label: "P1 twins + CX", value: 8, tone: "warning" },
            { label: "P2 intelligence", value: 4, tone: "info" },
          ]}
          donut
          size={180}
        />
      </Grid>

      <Table
        headers={["Priority", "Capability", "Why now", "Indicative outcome"]}
        rows={[
          ["P0", "Canonical data model: Project / Unit / Booking / Customer + universal Action", "Foundation for every later intelligence layer.", "Removes fragmented records and duplicate logic."],
          ["P0", "Separate Unit, Customer and Handover Readiness", "Current percentages can be ambiguous.", "Clear, explainable operational control."],
          ["P0", "Hard handover gates + blocker/dependency model", "Protects experience and operational integrity.", "Fewer preventable bad handovers."],
          ["P0", "Promise Ledger + pre-breach rules", "Broken promises are a major trust leak.", "Higher commitment reliability."],
          ["P0", "My Day + universal action prioritization", "Immediate employee productivity.", "Less chasing; clearer accountability."],
          ["P0", "Collections reason codes + true-risk view", "Outstanding alone is not risk.", "Better cash focus and forecast."],
          ["P0", "CR / customisation workflow + freeze + approval/payment controls", "Informal changes hide schedule and margin risk.", "Controlled flexibility, fewer disputes, clear site instructions."],
          ["P0", "Unit Progress + Changeability Engine v1", "Sales needs live physical truth before and after booking.", "Project-owned progress derives open/closed/conditional gates."],
          ["P0", "Configurable Project Journey + Universal Timeline/SLA Engine", "Avoid hardcoded project SOPs.", "One generic operating model with controlled Project variation."],
          ["P1", "Customer 360 + Unit 360 + Booking 360 around digital twins", "Creates one truth for all stakeholders.", "Faster decisions, fewer handoffs."],
          ["P1", "Evidence-based QA / snag closure", "Makes readiness trustworthy.", "Lower rework and repeat defects."],
          ["P1", "Customer portal My Pranava Home", "Creates experiential transparency.", "Fewer status calls; higher confidence."],
          ["P1", "Document intelligence", "Cuts manual review and errors.", "Faster legal/registration processing."],
          ["P1", "Predictive journey / handover / collection risk", "Moves from reporting to prevention.", "Earlier intervention and better forecasts."],
          ["P1", "Variation catalogue, drawing/version, as-built Twin, profitability analytics", "Turns one-off change handling into a product capability.", "Faster quotations, safer execution, permanent unit history."],
          ["P1", "Sales requirement-to-unit matching + gate-expiry forecast", "Turn personalisation into a controlled sales advantage.", "Higher-fit selection, fewer invalid promises."],
          ["P1", "Controlled Change Window Hold", "Protect legitimate sales without construction chaos.", "Time-boxed, approved holds with auto-expiry."],
          ["P2", "AI copilots by role", "Useful only after data/workflow foundation.", "Natural-language access and action preparation."],
          ["P2", "Digital Home Passport + post-handover warranty", "Extends lifecycle and brand relationship.", "Better service and long-term asset history."],
          ["P2", "Profitability leakage + cost-to-serve analytics", "Connects CX to economics.", "Margin protection and root-cause investment."],
          ["P2", "Vendor/contractor performance learning", "Closes loop from post-sales to construction.", "Lower defects, stronger vendor accountability."],
        ]}
        striped
        stickyHeader
      />

      <H2>90-day implementation plan</H2>
      <BarChart
        categories={["W1–2 model", "W3–4 gates", "W5–6 Action", "W7–8 Ledger", "W9–10 Cash", "W11–12 Tower"]}
        series={[{ name: "Foundation sprints (equal weight — sequence, not effort hours)", data: [1, 1, 1, 1, 1, 1] }]}
        height={160}
      />
      <Table
        headers={["Sprint", "Primary deliverables"]}
        rows={[
          ["Weeks 1–2", "Freeze terminology, canonical IDs, Customer/Unit/Booking schemas, lifecycle stages, action states, ownership. Define component taxonomy and physical-state ownership. Define Pranava Standard Journey Template, inheritance/override, universal date model (baseline/current/forecast/actual), SLA calendars and trigger logic. Also: Project dimension migration, team assignment, Project selector, forecast snapshots, Actual vs Forecast dashboards, drill-down, first production document templates."],
          ["Weeks 3–4", "Readiness score separation, hard/soft gates, dependency model, blocker explanation. Change-request taxonomy, freeze rules, feasibility/impact, approval matrix. Unit Progress Control v1 and rule-derived changeability states."],
          ["Weeks 5–6", "Universal Action object, My Day cockpit, departmental queue normalization."],
          ["Weeks 7–8", "Promise Ledger, pre-breach alerts, escalation decision packs, reason-code taxonomy. Customisation quotation / customer approval / payment-release + variation audit. Live changeability on Sales/CRM inventory + stale-data warnings."],
          ["Weeks 9–10", "Collections true-risk model, promise-to-pay, loan dependency, management cash view."],
          ["Weeks 11–12", "Executive control tower v1, KPI baselines, audit checks, pilot project UAT. Pilot controlled unit changes on one project and baseline variation margin/TAT. Pilot requirement-to-unit matching and gate-expiry forecasts on one project/unit type."],
        ]}
        striped
      />

      <H2>Acceptance criteria — HomeFlow 2.0 foundation</H2>
      <CollapsibleSection title="All foundation acceptance tests from §26" count={32} defaultOpen>
        <Stack gap={4}>
          {[
            "Every active booking resolves to exactly one current unit and one or more valid applicants/customers.",
            "Unit history remains intact when booking/customer changes.",
            "Every actionable record appears in the universal action engine with owner, SLA and evidence requirement.",
            "Every readiness score is explainable down to component/blocker level.",
            "Hard handover gates cannot be bypassed without configured authority and audit reason.",
            "Every customer-facing commitment has owner, due date, status, dependencies and evidence.",
            "Every overdue collection has a structured reason and next action.",
            "Management can identify the top five portfolio interventions without navigating multiple reports.",
            "Every financial and operational record traces Portfolio → Project → Unit → Booking/Customer without duplicate manual project tagging.",
            "A user assigned to one Project sees that Project by default; a shared-team user switches only among authorized Projects and keeps correct task/escalation context.",
            "Management can view last-period actual collections, current-period actual-to-date, next-month forecast and 30/60/90-day forecast by Project and portfolio.",
            "Every forecast value drills to contributing Booking/Unit records and shows source, expected date, probability/confidence and last update.",
            "The system retains forecast snapshots and calculates forecast-to-actual variance without overwriting prior forecasts.",
            "Customer-facing information never exposes internal notes or unapproved assumptions.",
            "Critical workflows and edits have a complete audit trail.",
            "Every customer-requested unit change has a unique request ID, structured scope, impact assessment, approval state and auditable disposition.",
            "No change can be released to Site before configured feasibility, commercial approval, customer acceptance and payment gates are satisfied.",
            "Site, QA and Procurement can identify the current released drawing/specification revision; superseded revisions are visibly locked.",
            "Every completed customisation updates the permanent Unit Twin / as-built record and preserves variation economics.",
            "Every saleable unit has a current physical-progress record and an explainable changeability state by configured change category.",
            "Sales and CRM can view but cannot directly edit physical progress or technical gate states.",
            "When a configured construction/procurement event changes, affected gates are automatically re-evaluated and the event is audited.",
            "Sales can filter/compare available units by changeability and see source timestamp/freshness before discussing personalisation.",
            "A prospect’s Must Have / Preferred personalisation requirements can be compared with available units without implying technical approval.",
            "Closing gates display an expected expiry date/event; stale forecasts are clearly identified.",
            "Any Change Window Hold is time-bound, Project-approved when construction is affected, automatically expires, and leaves a complete audit trail.",
            "Hard Closed gates cannot be reopened by Sales, CRM or ordinary management override.",
            "Unit-level exceptions remain possible when actual unit progress differs from tower/floor bulk progress, with reason and audit.",
            "Approved users can generate an AOS, Sale Deed or Lease Agreement only from an approved template version valid for the Project/transaction context.",
            "Generated documents auto-populate authoritative fields and prevent release when mandatory source data is missing or inconsistent.",
            "Every generated document records template version, data snapshot, clause selections, overrides/deviations, creator, reviewers, approvals, timestamps and final executed artifact.",
            "Any manual change to a protected commercial/legal field requires configured authority and an auditable reason; ordinary users cannot silently edit generated legal text or values.",
            "Legal can compare revisions and identify substantive clause/value changes before approval; superseded drafts remain accessible but cannot be mistaken for the current executable version.",
            "Final executed/registered documents are locked, checksum/version identified, and visible from Project, Unit, Booking and Customer records according to permissions.",
          ].map((t) => (
            <div key={t}>
              <Text size="small">• {t}</Text>
            </div>
          ))}
        </Stack>
      </CollapsibleSection>

      <H2>What not to build yet</H2>
      <Table
        headers={["Do not build", "Why"]}
        rowTone={["danger", "danger", "danger", "danger", "danger", "danger", "warning", "warning"]}
        rows={[
          ["A generic chatbot first", "Underlying data, rules and actions are not yet trustworthy."],
          ["Dozens of unexplained scores", "Nobody can act on a badge."],
          ["Another standalone chat stream", "Duplicates comments, email and WhatsApp."],
          ["Manual progress percentages", "Evidence can derive the state."],
          ["Executive dashboards of fifty charts", "Management needs ranked exceptions."],
          ["AI auto-sending consequential customer communication", "No approval controls."],
          ["Duplicated accounting/construction masters", "Authoritative systems already exist — or HomeFlow native is enough."],
          ["One-project custom features", "They weaken the common operating model."],
        ]}
        striped
      />

      <H2>North-star operating rhythm</H2>
      <Table
        headers={["Cadence", "Operating rhythm"]}
        rows={[
          ["Daily employee", "My Day: execute prioritized actions, resolve blockers, capture evidence and commitments."],
          ["Daily department head", "Queue health, SLA risks, blocked items, capacity and recovery plans."],
          ["Daily management", "Five interventions: customer, cash, handover, reputation, profitability."],
          ["Weekly project / CX review", "Upcoming 30/60-day handovers, customer health, collection risk, repeat defects, broken commitments."],
          ["Monthly operating review", "KPI trend, root causes, vendor/team performance, policy changes and margin leakage."],
          ["Quarterly product review", "Workflow simplification, model accuracy, automation opportunities and customer feedback."],
        ]}
        striped
      />

      <Callout tone="success" title="Final target state (§29)">
        A customer opens My Pranava Home and immediately understands their journey. An employee opens My Day and immediately knows what matters. A project or functional head sees where the process is failing. Management sees only material exceptions. The unit retains a permanent digital history. AI predicts slippage before it becomes a complaint. Every operational failure traces to its customer, schedule and margin impact.
      </Callout>
    </Stack>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <Stack gap={4}>
      {items.map((item) => (
        <div key={item}>
          <Text size="small">• {item}</Text>
        </div>
      ))}
    </Stack>
  );
}

function BuildView() {
  return (
    <Stack gap={20}>
      <H2>Emergent build instructions — platform, not one-off screens</H2>
      <Text tone="secondary">
        Sections 30–35 are implementation contracts. Build these as shared infrastructure. Do not hardcode East Crest days, charges, stage names or wording. Do not make any external construction platform a prerequisite.
      </Text>

      <CollapsibleSection title="§30 Unit Progress, Configuration and Changeability" count={7} defaultOpen>
        <Stack gap={12}>
          <H3>Required objects</H3>
          <Table
            headers={["Object", "Minimum fields / relationships"]}
            rows={[
              ["UnitProgressState", "unit_id; component_id; state_code; progress_pct if applicable; actual_date; planned_next_event; source_system; source_record_id; updated_by; updated_at; confidence/freshness."],
              ["ChangeCategory", "category_id; project/product applicability; room/trade/system; customer-facing label; technical owner; default policy."],
              ["ChangeGateRule", "rule_id; category_id; trigger component/event; condition; resulting state; hard/soft classification; effective dates; exception authority."],
              ["UnitChangeGate", "unit_id; category_id; current_state; reason_code; source_event; expected_close_at; closing_event; last_evaluated_at; freshness_status."],
              ["ProspectPersonalisationNeed", "opportunity/lead_id; requirement; importance (Must Have/Preferred); category mapping; notes."],
              ["UnitRequirementMatch", "opportunity_id; unit_id; compatibility_score; matched/open items; conditional items; closed items; generated_at."],
              ["ChangeWindowHold", "hold_id; opportunity_id/customer_id; unit_id; category/gate; requested_from/to; reason; project impact; approver; status; expires_at; release_reason."],
            ]}
            striped
          />
          <H3>Required screens</H3>
          <BulletList
            items={[
              "Project > Unit Progress Control: hierarchy filters, bulk update, unit exception, affected-gate preview, save with audit reason.",
              "Unit 360 > Changeability: visual matrix by room/trade/change category with state, reason, expected closure, source, last update.",
              "Sales > Inventory: changeability score, gate chips, closing-soon, filters, side-by-side comparison.",
              "Sales > Personalisation Discovery: Must Have/Preferred needs → ranked units with compatibility explanation.",
              "CRM > Customer Change Request: show live gate at creation; never block capture solely because a gate is closed; route to feasibility/exception.",
              "Project > Change Window Holds: pending holds, planned activity conflict, approve/reject, expiry, release.",
              "Management > Exceptions: stale gate data, high-value exceptions, holds affecting schedule, post-gate changes, margin/schedule impact.",
            ]}
          />
          <H3>Rule execution</H3>
          <BulletList
            items={[
              "Re-evaluate UnitChangeGate whenever UnitProgressState, planned activity date, procurement status, approved variation or policy rule changes.",
              "Event-driven recalculation where integrations exist; otherwise scheduled reconciliation plus stale-state warnings.",
              "Do not derive technical feasibility from overall construction percentage. Use mapped component/trade events.",
              "Stale beyond threshold → Sales/CRM see Verification Required, not a precise open/closed promise.",
              "Gate moving Open → Conditional/Exception/Hard Closed: log previous state, new state, source event and affected prospects/CRs.",
              "If an approved Hold conflicts with incoming progress, warn Project before commit and require explicit resolution.",
              "No Sales/CRM API or UI path may mutate UnitProgressState, ChangeGateRule or technical hard-gate state.",
            ]}
          />
          <H3>Key workflow logic</H3>
          <Table
            headers={["Scenario", "System behaviour"]}
            rows={[
              ["Unsold early-stage unit", "Maintain progress/gates independent of customer. Sales sees high customisation flexibility and can match prospect needs."],
              ["Prospect requests feature before booking", "Show live gate + fit; optionally request time-boxed hold. Do not create a site instruction."],
              ["Customer books unit", "Booking links Customer Twin to existing Unit Twin; existing gate state continues unchanged."],
              ["Customer raises late request", "Capture request; evaluate current gate; route normal/conditional/exception/reject."],
              ["Project updates progress in bulk", "Preview affected units/gates; commit; re-evaluate; notify only affected active workflows."],
              ["Unit differs from tower state", "Authorized unit exception overrides bulk state for that unit, with reason/source/evidence."],
              ["Gate closes while quote pending", "Re-evaluate feasibility and require quote/version refresh if impact changes. Do not silently execute obsolete assumptions."],
            ]}
            striped
          />
          <H3>§30 acceptance tests</H3>
          <BulletList
            items={[
              "Two units in the same project with different physical progress: same change category shows Open for one and Exception Only for the other.",
              "Project marks electrical first-fix commenced → mapped electrical gates change by rule without Sales editing anything.",
              "Tower-level bulk update of 40 units: UI previews affected units/gates and allows an authorized unit-level exception.",
              "Sales can filter inventory to Kitchen Layout + Electrical Changes Open and compare at least three units side by side.",
              "A Closing gate displays predicted closure date/event and becomes stale/verification-required when schedule data exceeds freshness policy.",
              "A Must Have that is Hard Closed materially reduces the Unit Requirement Match score and is explicitly explained.",
              "A CR can still be created after Registration/Handover scheduling; system routes to exception or post-handover treatment.",
              "An approved Change Window Hold expires automatically and can no longer block project progress after expiry.",
              "Every gate transition and override contains timestamp, actor/source, previous state, new state and reason/event.",
              "Hard Closed technical/statutory gates cannot be reopened by ordinary override APIs or UI permissions.",
            ]}
          />
        </Stack>
      </CollapsibleSection>

      <CollapsibleSection title="§31 Project architecture and collections forecasting" count={5}>
        <Stack gap={12}>
          <Text>
            Build Project as a platform-level partition and analytical dimension, not an optional filter. All new features must work at Unit/Booking detail and roll up to Project and portfolio. Canonical hierarchy: Portfolio → Project → Phase/Tower/Block/Cluster → Floor → Unit → Booking → Customer/Applicant.
          </Text>
          <H3>Ownership model</H3>
          <BulletList
            items={[
              "Required entities: Project, ProjectHierarchyNode, Unit, Booking, Team, ProjectTeamAssignment, UserRoleAssignment, ForecastSnapshot, CollectionForecastLine, ForecastScenario, ForecastAssumption.",
              "ProjectTeamAssignment: project_id, team_id, department, role_scope, assignment_type [Dedicated/Shared/Central], primary_owner, backup_owner, effective_from, effective_to, capacity/weight, escalation_manager, permissions.",
              "Every downstream record carries a derived project_id for query and RLS, validated against the linked Unit/Booking source of truth.",
              "One team may serve multiple Projects; one Project may use multiple specialist/shared teams. Do not hard-code one CRM team = one Project.",
            ]}
          />
          <H3>Forecast screens</H3>
          <BulletList
            items={[
              "Executive / Finance > Project Cash Flow Planner: Project cards + portfolio total, period selector, Actual vs Forecast vs Revised, confidence, variance, receivables waterfall.",
              "Project > Collections Forecast: timeline/table of lines with Unit, Customer, expected date, due amount, expected amount, source, probability, owner, blocker, next action.",
              "Portfolio > Project Comparison: current-month collections, next-month forecast, overdue, forecast accuracy, collection efficiency, risk.",
              "Project 360 header: name, phase/tower filters, active units, bookings, receivables, next-30-day handovers, customer health, assigned teams.",
              "Every major module retains Project context when navigating Collections, CRM, Readiness, Snags, Handover, Commitments, Escalations, Reports.",
              "Default period views: Previous Month Actual, Current Month Plan vs Actual-to-Date, Next Month Forecast, Next 90 Days, Quarter, Custom Range.",
            ]}
          />
          <H3>§31 acceptance tests</H3>
          <BulletList
            items={[
              "Project-dedicated CRM user sees only assigned Project work by default; shared CRM manager switches among authorized Projects and views a portfolio roll-up.",
              "A receipt posted against a Booking appears under the correct Project without the user selecting Project.",
              "Finance can select Previous Month (Project-wise actuals) then Next Month (forecast with Unit/Booking drill-down).",
              "Project total equals sum of forecast lines; portfolio total equals sum of authorized Projects, subject to elimination rules.",
              "Month-start forecast stays unchanged after a mid-month revision; Latest Forecast changes; variance vs both Month-start and Actual.",
              "A partially disbursed loan updates expected receipt timing without double counting the same demand.",
              "Promise-to-Pay changes forecast confidence/expected date by rule, but does not become Actual until a reconciled receipt is posted.",
              "Future-sales scenario cash is visible only in scenario mode and is never mixed into committed post-sales receivable forecast.",
              "Project/team assignments are effective-dated: changing the CRM team next month does not rewrite historic ownership.",
              "All Project dashboards drill to Unit and Booking; all Unit/Booking records navigate back to Project 360.",
            ]}
          />
        </Stack>
      </CollapsibleSection>

      <CollapsibleSection title="§32 Legal Document Factory" count={11}>
        <Stack gap={12}>
          <Text>
            Governed transaction/document platform — not free-form mail merge. Approved templates, authoritative HomeFlow data, controlled clause logic, validation, approvals, versioning, immutable execution records.
          </Text>
          <H3>Core objects</H3>
          <Table
            headers={["Object", "Purpose"]}
            rows={[
              ["DocumentTemplate", "template_id, document_family, name, project_scope, legal_entity, property_type, transaction_type, jurisdiction, effective dates, version, status, owner, approver, source file, checksum."],
              ["MergeFieldDefinition", "field_key, label, source_object, source_path, data_type, mandatory/optional, formatting, fallback, editable flag, validation, sensitivity."],
              ["ClauseLibrary", "clause_id, clause_type, approved text, applicability, mandatory/optional, precedence, legal owner, effective dates, version."],
              ["ClauseSelectionRule", "template_id, clause_id, conditions (Project/property/customer/payment plan/loan/customisation/jurisdiction), default action, exception approver."],
              ["GeneratedDocument", "id, template_version, Project, Unit, Booking, Customer/applicants, timestamp, data snapshot ID, selected clauses, status, current version, owner, final artifact."],
              ["DocumentDeviation", "field/clause, original vs proposed, reason, commercial/legal impact, requested_by, approval chain, outcome, timestamp."],
              ["DocumentApproval", "reviewer, role, stage, decision, comments, timestamp, evidence. Parallel or sequential review."],
              ["ExecutionRecord", "method [wet-sign/eSign/registered], signatories, execution date, SRO reference, final checksum, final file, stamping, archive status."],
            ]}
            striped
          />
          <H3>Workflow and rules</H3>
          <BulletList
            items={[
              "Canonical flow: Select Document → Readiness Check → Generate Draft → Automated Validation → Internal Review → Legal/Commercial Approval → Customer Review → Approved-for-Execution → eSign/Wet Sign/Registration → Final Executed Copy → Archive.",
              "At generation time freeze a data snapshot so Version 1 can be reconstructed even if master data later changes.",
              "Do not ask users to retype a trusted source value. Correction goes to the source record or a governed override.",
              "Readiness panel: Ready / Warning / Blocked. Block only on configured legal/commercial mandatory failures.",
              "Cross-check numbers in words vs numeric amounts, totals, dates, percentages, schedule references. Zero unresolved placeholders.",
              "Clauses are Locked, Parameterized or Negotiable-with-Approval. Locked clauses cannot be edited by Sales/CRM.",
              "AI may summarize, suggest a known approved clause, flag anomalies — final wording from library or Legal-approved deviation.",
              "Every revision is a new immutable version. Never overwrite a previously reviewed or customer-shared version.",
              "Draft watermark. Customers/staff must not mistake Draft/For Review for executable.",
              "No user both creates an unapproved deviation and self-approves it when SoD requires independent review.",
              "External edit imported = External Revision; requires full comparison and reapproval. Not treated as an approved executable copy.",
              "Final executed documents are read-only. Corrections after execution require a formal addendum workflow.",
              "Bulk generation only for low-risk standardized notices. Legal agreements/deeds require record-level validation and approvals.",
              "Families are configurable. Do not hard-code one universal AOS or Sale Deed across Projects, entities, property types or jurisdictions.",
            ]}
          />
          <H3>§32 acceptance tests</H3>
          <BulletList
            items={[
              "CRM selects AOS for an eligible booked Unit and is offered only currently approved templates for that Project/property/transaction.",
              "Generation is blocked when a mandatory applicant/commercial/unit field is missing; user can click the error and navigate to the source record.",
              "A valid AOS is generated with applicant names, Unit details, consideration, schedules and clauses — no manual re-entry, zero unresolved merge tokens.",
              "Changing approved consideration after Draft v1 does not mutate v1; v2 uses a new snapshot; comparison shows the change.",
              "CRM cannot edit a Locked legal clause. A Legal-approved deviation creates a new version and retains the original in audit history.",
              "A Sale Deed cannot move to Approved-for-Execution until configured legal/commercial/registration prerequisites and approvals are complete.",
              "Final executed/registered document is checksum-identified, locked and visible from Project, Unit, Booking and Customer to authorized users.",
              "A retired template cannot be used for new generation after its effective end date; historic documents remain viewable and auditable.",
              "Project-specific and central Legal users see the correct queues according to Project Team Assignment and document permissions.",
              "Lease Agreement uses the same governed model with lease-specific parties, commercial terms, schedules and approval rules.",
            ]}
          />
        </Stack>
      </CollapsibleSection>

      <CollapsibleSection title="§33 Project-owned live unit status for Sales and CRM" count={6}>
        <Stack gap={12}>
          <Callout tone="warning" title="R1/R2 implementation rule">
            Build the Project Unit Status Console and Unit Twin so Project/Construction users operate them directly in HomeFlow. Generic integration primitives may be added later. Sales/CRM must never directly edit construction progress, QA truth, technical feasibility or hard changeability gates.
          </Callout>
          <Text>
            Closed loop: HomeFlow Project update → Unit Digital Twin → component/trade state → changeability rule evaluation → Sales/CRM inventory visibility → affected prospect/customer warnings → Change Request routing. Example: electrical first-fix starts for Floors 8–12 → mapped electrical gates move Open to Conditional/Exception; Sales sees it immediately; prospects with electrical Must Have are flagged.
          </Text>
          <H3>§33 acceptance tests</H3>
          <BulletList
            items={[
              "A Project user updates a unit component once and the new status is visible on Sales and CRM views without duplicate entry.",
              "A bulk Project update can affect many units while preserving authorized unit exceptions.",
              "Sales cannot edit Project-owned physical status or technical gates.",
              "Sales can compare available units by live customisation/changeability and prospect requirements.",
              "Stale Project data displays Verification Required before Sales/CRM relies on it.",
              "A mapped construction event automatically recalculates relevant gates and records the source event.",
              "Active prospects/customers affected by a gate transition can be identified and routed for follow-up.",
              "Every physical-status correction records actor, timestamp, prior value, new value and reason.",
            ]}
          />
        </Stack>
      </CollapsibleSection>

      <CollapsibleSection title="§34 Configurable Project Journey and Universal Timeline/SLA Engine" count={7}>
        <Stack gap={12}>
          <Text>
            Do not hardcode any Project-specific number of days, dates, charges, milestones, stage names or customer wording. Existing Project SOPs are inputs to configuration — not software source code.
          </Text>
          <H3>Configuration hierarchy</H3>
          <Table
            headers={["Layer", "Rule"]}
            rows={[
              ["Pranava Standard Journey Template", "Enterprise default lifecycle and common terminology."],
              ["Project Template", "Inherits the standard. Applies authorized Project-specific stages, tasks, durations, gates, documents, owners, communications, visibility."],
              ["Unit / Booking instantiation", "On booking confirm, create the applicable journey version linked to Unit Twin and Project template version."],
              ["Exceptional override", "Authorized record-level change to plan, owner, gate or sequence with reason, approver, audit. Never silently mutate the template."],
            ]}
            striped
          />
          <H3>Universal date model</H3>
          <Table
            headers={["Field", "Requirement"]}
            rows={[
              ["Planned duration", "Configurable working/calendar-day duration inherited from policy; optional where milestone/event-based."],
              ["Baseline planned start/end", "Original approved plan captured when the journey/task is instantiated. Immutable except controlled baseline reset."],
              ["Current planned start/end", "Latest approved operational plan after authorized revisions."],
              ["Forecast start/end", "Best current expectation based on progress, blockers and owner input / system calculation."],
              ["Actual start/end", "System/manual evidence of real commencement and completion."],
              ["Variance", "Forecast vs current plan, actual vs baseline/current plan, and SLA variance."],
              ["Calendar", "Project/company calendar, weekends, holidays, configured working hours."],
              ["Pause / hold", "Only for configured reasons with start/end, owner and evidence."],
              ["Delay reason", "Structured root-cause code plus optional narrative; mandatory beyond configured tolerance."],
              ["Confidence", "Optional for forecast dates/windows; explain source/driver when system-generated."],
            ]}
            striped
          />
          <H3>Required objects and screens</H3>
          <BulletList
            items={[
              "Objects: JourneyTemplate, JourneyTemplateVersion, JourneyStageTemplate, JourneyTaskTemplate, dependency/gate definitions, JourneyInstance, StageInstance, TimelinePlanRevision, TimelineForecastRevision, SlaPolicy, SlaClockEvent, ProjectCalendar / WorkingCalendar, DelayReason taxonomy.",
              "Admin > Journey Template Studio: create/version Standard and Project templates, stages, sub-stages, dependencies, gates, durations, owners, customer visibility, notifications.",
              "Project Journey Control: active journeys with current stage/milestone, next planned event, forecast variance, SLA health, blockers.",
              "Customer/Booking Journey Timeline: customer-friendly milestone layer plus internal detailed layer with plan/current/forecast/actual.",
              "Stage/Task Detail: owner, plan, forecast, actual, SLA clock, dependencies, blockers, documents, comments, evidence, change history.",
              "Management Analytics: Project/stage bottlenecks, plan vs actual, forecast accuracy, SLA performance, root-cause trends.",
            ]}
          />
          <H3>§34 acceptance tests</H3>
          <BulletList
            items={[
              "A Project can inherit the Pranava Standard Journey and override a configured duration without code change.",
              "Two Projects can use different planned durations/SLAs for the same generic stage while using the same application code.",
              "A journey displays baseline, current plan, forecast and actual dates without overwriting prior revisions.",
              "SLA health can differ from Project plan health and both are explained correctly.",
              "Changing a Project template version does not silently alter already active journeys unless an approved migration rule is executed.",
              "Construction, collections and customisation can run in parallel; only explicit dependencies/gates block progression.",
              "A delayed forecast marks the journey At Risk before the planned end date and identifies the responsible blocker/owner.",
              "Plan and SLA analytics roll up by Project, stage, department, role and owner.",
              "Customer-facing journey hides internal-only tasks but shows approved milestone/status/timeline information.",
              "All overrides, date revisions, pauses, template changes and completion events are auditable.",
            ]}
          />
        </Stack>
      </CollapsibleSection>

      <H3>§35.1 Additional mandatory audit events</H3>
      <BulletList
        items={[
          "Journey template/version created, approved, activated, superseded.",
          "Project template inherited/overridden; override approved/rejected.",
          "Baseline plan created/reset; current plan revised.",
          "Forecast revised; confidence/source changed.",
          "SLA clock started/paused/resumed/warned/breached/completed.",
          "Dependency/gate opened/closed/waived/overridden.",
          "Delay reason recorded/changed; customer-visible milestone/date changed.",
        ]}
      />
    </Stack>
  );
}

function ReferenceView() {
  return (
    <Stack gap={20}>
      <H2>Appendix A — core status taxonomy</H2>
      <Table
        headers={["Object", "Recommended statuses"]}
        rows={[
          ["Action", "New; In Progress; Waiting Internal; Waiting Customer; Blocked; Ready for Approval; Closed; Cancelled"],
          ["Commitment", "Draft; Approved; Active; At Risk; Fulfilled; Breached; Waived/Cancelled"],
          ["Document", "Required; Requested; Received; Validating; Accepted; Rejected; Superseded; Expired"],
          ["Snag", "Open; Assigned; In Progress; Ready for QA; Reopened; Verified; Closed"],
          ["Registration", "Not Ready; Readiness In Progress; Ready; Slot Booked; Completed; Document Pending"],
          ["Handover", "Not Eligible; At Risk; Eligible; Appointment Booked; In Progress; Completed; Reopened"],
          ["Customer Health", "Healthy; Watch; At Risk; Critical"],
          ["Financial Risk", "Low; Watch; At Risk; Disputed; Default/Legal"],
          ["Unit Change / Customisation", "Draft; Requested; Feasibility Review; Costing; Awaiting Approval; Awaiting Customer; Awaiting Payment; Approved; Released; In Progress; Ready for QA; QA Verified; Customer Accepted; As-Built Closed; Rejected; Withdrawn; Cancelled"],
          ["Changeability Gate", "Open; Closing; Conditional; Exception Only; Hard Closed"],
          ["Change Window Hold", "Requested; Project Review; Approved; Active; Expired; Released; Rejected; Cancelled"],
        ]}
        striped
      />

      <H2>Appendix B — minimum event log</H2>
      <CollapsibleSection title="Every consequential event that must be logged" count={28} defaultOpen>
        <BulletList
          items={[
            "Booking created / revised / cancelled / transferred.",
            "Sales handover submitted / returned / accepted.",
            "Demand raised / receipt posted / reversal / waiver / TDS verified.",
            "Collection forecast created / revised / snapshot locked / probability changed / expected date changed / scenario changed.",
            "Project team assigned / reassigned / shared scope changed / effective-dated ownership changed.",
            "Document requested / received / accepted / rejected / superseded.",
            "Agreement generated / revised / approved / executed.",
            "Registration readiness achieved / slot booked / completed.",
            "Unit readiness component passed / failed / reverified.",
            "Snag created / assigned / rectified / verified / reopened / closed.",
            "Commitment created / approved / at risk / fulfilled / breached.",
            "Customer contact sent / response received / sentiment changed.",
            "Escalation created / upgraded / recovery plan / closed.",
            "Handover eligibility reached / blocked / appointment / completed.",
            "Unit change requested / feasibility assessed / quote issued / customer approved / payment cleared / drawing released / execution started / QA verified / customer accepted / as-built closed.",
            "Unit physical progress updated / bulk-applied / unit exception recorded / corrected / published to Sales-CRM / freshness threshold breached / verification requested.",
            "Changeability gate opened / closing forecast changed / restricted / exception-only / hard closed / reopened by authorized physical correction.",
            "Change Window Hold requested / approved / activated / expired / released / rejected.",
            "Prospect personalisation requirements captured / unit-match generated / unit compared / selected.",
            "Warranty/service case opened / resolved / reopened.",
            "Document template created / approved / activated / retired.",
            "Generated document created / validation failed / revised / superseded.",
            "Clause selected / deviation requested / deviation approved or rejected.",
            "Document shared with customer / customer comments received / customer accepted.",
            "Document approved for execution / eSigned / wet-signed / registered / archived.",
            "External revision imported / compared / reapproved or rejected.",
          ]}
        />
      </CollapsibleSection>

      <H2>Primary screens (§20)</H2>
      <Table
        headers={["Screen", "Purpose"]}
        rows={[
          ["Home / My Day", "Personal action cockpit, upcoming risks, approvals and customer contacts."],
          ["Customer 360", "Relationship twin: bookings, financials, docs, communication, commitments, experience."],
          ["Unit 360", "Property twin: specs, construction, QA, snags, evidence, assets, warranty."],
          ["Booking 360", "Commercial/lifecycle bridge and readiness convergence view."],
          ["Portfolio Control Tower", "Project/portfolio risk, cash, handover, experience and profitability."],
          ["Functional Queues", "Collections, legal, registration, QA, snag, handover, documents."],
          ["Journey Timeline", "Milestones, critical path, blockers, events and next forecast. Baseline / Current Plan / Forecast / Actual toggles."],
          ["Customer Portal / App", "Approved customer-facing journey and home experience."],
          ["Admin / Policy Studio", "Workflow templates, SLAs, gates, approval matrix, roles and notifications."],
          ["Unit Changes & Customisations", "Intake, feasibility, quotation, approvals, payment, drawing/spec, execution, QA, acceptance, as-built."],
          ["Unit Progress & Changeability Control", "Project-owned bulk/unit update; component progress, gate transitions, source/freshness, impact preview."],
          ["Sales Inventory Changeability View", "Available-unit comparison with construction state, score, open/closing gates, expiry forecast, requirement-fit."],
          ["Personalisation Discovery & Unit Match", "Capture Must Have/Preferred needs and rank units by live requirement compatibility."],
          ["Project Journey Control", "Active journeys, bottleneck stages, upcoming milestones, at-risk/overdue items."],
          ["Project Journey Designer", "Visual template: stages, parallel streams, dependencies, gates, planned duration, customer-visible milestones."],
        ]}
        striped
      />

      <H2>Integration blueprint (§18) — optional, system-agnostic</H2>
      <Table
        headers={["System / channel", "HomeFlow relationship"]}
        rows={[
          ["Sales CRM (e.g. Tranquil)", "Booking/customer source, sales handover, source/channel history."],
          ["Optional Construction / Project System", "Optional future connector only. HomeFlow natively supports progress, component status, evidence, readiness, changeability."],
          ["ERP / Accounting", "Demand, receipt, ledger, TDS, waivers, credit notes, financial clearance."],
          ["Bank / payment gateway", "Payment status and reconciliation where APIs are available."],
          ["Loan partners / coordinators", "Sanction/disbursement status; document readiness."],
          ["DMS / storage", "Authoritative document files, versions and retention."],
          ["WhatsApp / Email / SMS", "Approved outbound communication and interaction logging."],
          ["eSign / eStamp / registration services", "Execution workflow and evidence where technically/legal available."],
          ["Facility Management", "Post-handover service and unit asset history."],
          ["BI / Data warehouse", "Portfolio analytics, historic benchmarking and model training."],
        ]}
        striped
      />
      <Text size="small">
        Integration rule: when a connector is configured, each data domain has a defined system-of-record owner and reconciliation rule. HomeFlow must not silently overwrite authoritative facts, and the same business process must work when the connector is unavailable or absent.
      </Text>

      <H2>Admin / Policy Studio (§21) — everything configurable</H2>
      <CollapsibleSection title="Full policy surface" count={24} defaultOpen>
        <BulletList
          items={[
            "Project-level workflow templates and product variations (apartment, villa, office, plotted development).",
            "Conditional task rules based on customer type, loan status, NRI status, project, unit, commercial scheme and exceptions.",
            "SLA policies and calendars including holidays and pause reasons.",
            "Approval authority matrix by amount, deviation type, project and role.",
            "Handover gate configuration with hard/soft conditions.",
            "Communication templates, approval and version control.",
            "Score weights, thresholds and model governance.",
            "Role/permission matrix and field-level sensitivity.",
            "Escalation routing and management thresholds.",
            "Customisation policy by project/product: catalogue, freeze dates, technical constraints, quotation validity, payment gates, cancellation rules.",
            "Variation approval matrix by change type, value, margin, schedule impact and post-freeze exception severity.",
            "Change log and effective-dated policy versions.",
            "Change-gate rule studio by project/product/unit type/component with trigger, state transition, hard/soft, customer-facing explanation.",
            "Gate-expiry forecast source mapping: construction schedule, procurement milestone, manual approved date or integration event.",
            "Change Window Hold policy: eligible gates, max duration, approvers, blackout activities, concurrent-hold limits, automatic expiry.",
            "Data freshness thresholds and stale-state warnings for Sales/CRM.",
            "Project master and hierarchy: Phase, Tower/Block, Floor/Cluster and Unit inheritance rules.",
            "Project Team Assignment matrix: dedicated vs shared, departments/roles, effective dates, primary/backup, capacity, escalation manager, permitted Projects.",
            "Forecast policy studio: horizons, probability rules, source precedence, reschedule treatment, overdue recovery assumptions, confidence thresholds, scenarios.",
            "Period calendar: financial month, week, quarter, custom periods and project-specific milestone calendars.",
            "Project-specific cash-flow targets and collection plans with portfolio aggregation.",
            "Template versioning: effective date, version, approver, impacted active journeys, migration rule, audit. Existing journeys must not be silently reshaped.",
            "Parallel stream configuration: Finance, Construction, Legal/Documentation, Customisation, Commitments, Communication run concurrently and converge through gates.",
            "Stage-level customer visibility: what the customer sees, wording, and whether forecast dates show as date, window or milestone.",
            "Timeline policy: planned duration, working/calendar day basis, start trigger, baseline/current plan, forecast rules, actual capture, variance tolerance.",
            "Project Journey Template inheritance: copy/inherit Pranava Standard, then controlled Project-specific overrides without changing code.",
            "Pranava Standard Journey Template: enterprise default stages, sub-stages, tasks, gates, dependencies and customer-visible milestone labels.",
          ]}
        />
      </CollapsibleSection>

      <H2>Data quality, audit and governance (§22)</H2>
      <BulletList
        items={[
          "Single master identifiers for Project, Unit, Booking, Customer and Applicant.",
          "Project is immutable on a Unit after controlled master creation except through audited master-data correction.",
          "Forecast snapshots versioned by as-of date so month-start, revisions and actuals can be compared.",
          "Deduplication and merge for customers without losing history.",
          "Effective dating for ownership changes, commercial revisions and policy changes.",
          "No deletion of material financial/legal/commitment history; use superseded/cancelled states.",
          "Mandatory structured reason codes for returns, delays, overrides, waivers, cancellations and escalations.",
          "Immutable event/audit log for consequential changes.",
          "Role-based export control and sensitive-field masking.",
          "Immutable linkage from original unit specification to every approved change and final as-built revision.",
          "No deletion of superseded drawings, rejected CRs or commercial variation history.",
          "AI output logging: model/version, confidence, user action and eventual outcome for continuous learning.",
        ]}
      />
    </Stack>
  );
}
