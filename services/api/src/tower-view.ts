import { db } from "./db";
import { pickFive, type TowerCandidate } from "./tower";
import { projectCollections } from "./collections-view";
import { projectHandover } from "./qa";

// Control Tower — five ranked interventions from live exceptions (management/spec.md, H11).

export async function controlTower(projectId: string) {
  const candidates: TowerCandidate[] = [];
  const collections = await projectCollections(projectId);
  const trueRisk = collections.buckets.TRUE_RISK;
  if (trueRisk.amount > 0 && trueRisk.items[0]) {
    const item = trueRisk.items[0];
    candidates.push({
      category: "cash",
      headline: `${item.customer_name}, Villa ${item.unit_number} — true-risk cash sitting unpaid`,
      what_happened: `${item.milestone_label} has been unpaid for ${item.ageing_days} days with recovery below policy.`,
      impact_rupee: trueRisk.amount,
      impact_customer: item.customer_name,
      owner: "Accounts",
      recommended_decision: "Escalate recovery and keep the RM in the loop",
      evidence_links: [`demand:${item.demand_id}`],
      booking_id: item.booking_id,
      dependencies: ["collections"],
    });
    if (item.overdue_reason_code === "unresponsive") {
      candidates.push({
        category: "customer",
        headline: `${item.customer_name}, Villa ${item.unit_number} — no response on a long-overdue instalment`,
        what_happened: "Reminders have gone unanswered. The relationship is at risk as well as the cash.",
        impact_rupee: item.amount,
        impact_customer: item.customer_name,
        owner: "Priya Nair",
        recommended_decision: "RM to call today with a structured recovery plan",
        evidence_links: [`demand:${item.demand_id}`],
        booking_id: item.booking_id,
        dependencies: ["crm-rm", "collections"],
      });
    }
  }

  const disputed = collections.buckets.DISPUTED;
  if (disputed.amount > 0 && disputed.items[0]) {
    const item = disputed.items[0];
    candidates.push({
      category: "margin",
      headline: `${item.customer_name}, Villa ${item.unit_number} — disputed dues tying up margin`,
      what_happened: `${item.milestone_label} is disputed. Until it is resolved the rupee cannot be recognised.`,
      impact_rupee: disputed.amount,
      impact_customer: item.customer_name,
      owner: "Accounts",
      recommended_decision: "Resolve the dispute or post an approved waiver",
      evidence_links: [`demand:${item.demand_id}`],
      booking_id: item.booking_id,
      dependencies: ["accounts", "crm-rm"],
    });
  }

  const handovers = await projectHandover(projectId);
  const blocked = handovers.find((h) => h.lifecycle !== "completed" && !h.eligible);
  if (blocked) {
    candidates.push({
      category: "handover",
      headline: `${blocked.customer_name}, Villa ${blocked.unit_number} — keys blocked on hard gates`,
      what_happened: blocked.blockers.map((b) => b.reason).join("; ") || "Handover hard gates are still open.",
      impact_rupee: 0,
      impact_customer: blocked.customer_name,
      owner: "QA",
      recommended_decision: "Clear the listed blockers before offering an appointment",
      evidence_links: [`booking:${blocked.booking_id}`],
      booking_id: blocked.booking_id,
      unit_id: blocked.unit_id,
      dependencies: ["qa", "legal", "accounts"],
    });
  }

  const snag = await db.query<{
    id: string;
    unit_id: string;
    description: string;
    unit_number: string;
    customer_name: string;
    booking_id: string;
  }>(
    `SELECT s.id, s.unit_id, s.description, u.unit_number, a.display_name AS customer_name, b.id AS booking_id
       FROM snag s JOIN unit u ON u.id = s.unit_id
       LEFT JOIN booking b ON b.unit_id = u.id AND b.status = 'active'
       LEFT JOIN booking_applicant a ON a.booking_id = b.id AND a.role = 'primary'
      WHERE s.project_id = $1 AND s.severity = 'critical' AND s.status NOT IN ('closed','verified')
      LIMIT 1`,
    [projectId]
  );
  if (snag.rows[0]) {
    const s = snag.rows[0];
    candidates.push({
      category: "reputation",
      headline: `${s.customer_name ?? "Villa " + s.unit_number}, Villa ${s.unit_number} — a critical snag is still open`,
      what_happened: s.description,
      impact_rupee: 0,
      impact_customer: s.customer_name ?? s.unit_number,
      owner: "QA lead",
      recommended_decision: "Rectify and QA-verify before any keys conversation",
      evidence_links: [`snag:${s.id}`],
      booking_id: s.booking_id,
      unit_id: s.unit_id,
      dependencies: ["qa"],
    });
  }

  const five = pickFive(candidates);
  const out = [];
  for (const row of five) {
    const id = `tw_${projectId}_${row.category}`;
    const prev = await db.query<{ status: string }>(`SELECT status FROM intervention WHERE id = $1`, [id]);
    const status = prev.rows[0]?.status ?? "open";
    await db.query(
      `INSERT INTO intervention (id, project_id, category, rank, headline, decision_pack, owner_name, booking_id, unit_id, status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET rank = $4, headline = $5, decision_pack = $6::jsonb, owner_name = $7`,
      [
        id,
        projectId,
        row.category,
        row.rank,
        row.headline,
        JSON.stringify(row.decision_pack),
        row.owner,
        row.booking_id ?? null,
        row.unit_id ?? null,
        status,
      ]
    );
    out.push({ id, status, ...row });
  }
  return { interventions: out };
}

export async function actIntervention(id: string) {
  const r = await db.query<{ id: string }>(`SELECT id FROM intervention WHERE id = $1`, [id]);
  if (r.rows.length === 0) throw new Error("not_found");
  await db.query(`UPDATE intervention SET status = 'acted' WHERE id = $1`, [id]);
  return db
    .query<{ id: string; status: string; category: string; headline: string }>(
      `SELECT * FROM intervention WHERE id = $1`,
      [id]
    )
    .then((x) => x.rows[0]);
}
