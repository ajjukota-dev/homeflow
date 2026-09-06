import { describe, it, expect, beforeAll } from "vitest";
import { db, initDb } from "../db";
import { randomUUID } from "node:crypto";
import { logCommunication, sendCommunicationEmail, publishCommunicationToPortal, listCustomerCommunications } from "./core";
import { createCommunicationTemplate, submitTemplateForLegalReview, approveCommunicationTemplate, renderTemplateBody } from "./templates";
import { createInternalNote, listInternalNotes } from "./notes";
import { scanEscalations } from "../escalations/core";
import { ctxWithRoles, customerCtx } from "../authz/test-helpers";
import type { Ctx } from "../authz/types";

// 29-communications.md rules 1-8.

beforeAll(async () => {
  await initDb();
});

// Real seeded "user" ids (seed/users.ts) — `communication_template.created_by`, `internal_note.
// author_user_id` and `communication.logged_by` all FK to "user", so the synthetic `test_user` id
// ctxWithRoles() builds would violate the FK; every ctx below is real, same convention 27/28's own
// tests already established.
const crm: Ctx = { actor: { ...ctxWithRoles(["CRM"]).actor, user_id: "user_crm" } };
const sales: Ctx = { actor: { ...ctxWithRoles(["SALES"]).actor, user_id: "user_sales" } };
const legal: Ctx = { actor: { ...ctxWithRoles(["LEGAL"]).actor, user_id: "user_legal" } };
const accounts: Ctx = ctxWithRoles(["ACCOUNTS"]); // never reaches an FK'd insert (blocked earlier)
const realCrmCtx = crm;

describe("29 rule 1 — logging every customer touch", () => {
  it("logs a manual call with channel/direction/visibility, defaulting INTERNAL", async () => {
    const row = await logCommunication({ customer_id: "c_karthik", channel: "CALL", direction: "OUTBOUND", body: "Called about the structure milestone" }, realCrmCtx);
    expect(row.code).toMatch(/^COM-/);
    expect(row.visibility).toBe("INTERNAL");
    expect(row.channel).toBe("CALL");
    const ev = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'communication' AND entity_id = $1`, [row.id]);
    expect(ev.rows[0]?.type).toBe("customer_contact.sent");
  });

  it("a role with no communications access is blocked", async () => {
    await expect(logCommunication({ customer_id: "c_karthik", channel: "CALL", direction: "OUTBOUND", body: "x" }, accounts)).rejects.toThrow(/requires|forbidden/);
  });

  it("lists a customer's logged communications", async () => {
    const list = await listCustomerCommunications("c_karthik", {}, crm);
    expect(list.length).toBeGreaterThan(0);
  });
});

describe("29 rule 6 — inbound follow-up creates a real, SLA-clocked action", () => {
  it("creates a follow-up action with a due date ~48h out, and the escalation eventually fires", async () => {
    const row = await logCommunication(
      { customer_id: "c_karthik", booking_id: "b_v110", channel: "WHATSAPP", direction: "INBOUND", body: "When will my flat be ready?", follow_up_required: true },
      realCrmCtx
    );
    expect(row.follow_up_action_id).toBeTruthy();
    expect(row.follow_up_due).toBeTruthy();
    const hoursOut = (Date.parse(row.follow_up_due!) - Date.parse(row.occurred_at)) / (60 * 60 * 1000);
    expect(hoursOut).toBeGreaterThan(40);
    expect(hoursOut).toBeLessThan(56);
    const ev = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'communication' AND entity_id = $1`, [row.id]);
    expect(ev.rows[0]?.type).toBe("customer_contact.response_received");

    // 49h later the 48h clock is OVERDUE — escalation_rule.customer_query_48h (seeded wired:true
    // by this build) must actually raise a real escalation, not just carry a due date nobody reads.
    const asOf = new Date(Date.parse(row.occurred_at) + 49 * 60 * 60 * 1000).toISOString();
    const result = await scanEscalations(asOf);
    expect(result.raised.length + result.updated.length).toBeGreaterThan(0);
    const esc = await db.query<{ rule_key: string; category: string }>(
      `SELECT rule_key, category FROM escalation WHERE action_id = $1`,
      [row.follow_up_action_id]
    );
    expect(esc.rows[0]?.rule_key).toBe("customer_query_48h");
    expect(esc.rows[0]?.category).toBe("REPUTATION");
  });
});

describe("29 rule 3 — communication template lifecycle", () => {
  it("DRAFT -> LEGAL_REVIEW -> APPROVED requires LEGAL for a legal-bearing purpose (payment reminders)", async () => {
    const code = "PAYMENT_REMINDER_TEST_" + randomUUID().slice(0, 6);
    const draft = await createCommunicationTemplate({ code, channel: "EMAIL", purpose: "PAYMENT_REMINDER", subject: "Reminder", body: "Dear {{customer_name}}, payment due." }, crm);
    expect(draft.status).toBe("DRAFT");
    const review = await submitTemplateForLegalReview(draft.id, crm);
    expect(review.status).toBe("LEGAL_REVIEW");
    await expect(approveCommunicationTemplate(review.id, crm)).rejects.toThrow(/requires one of/);
    const approved = await approveCommunicationTemplate(review.id, legal);
    expect(approved.status).toBe("APPROVED");
    const ev = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'communication_template' AND entity_id = $1`, [approved.id]);
    expect(ev.rows[0]?.type).toBe("template.approved");
  });

  it("a non-legal-bearing purpose (GENERAL) is approved by CRM, not Legal", async () => {
    const code = "GENERAL_TEST_" + randomUUID().slice(0, 6);
    const draft = await createCommunicationTemplate({ code, channel: "EMAIL", purpose: "GENERAL", subject: "Hi", body: "Hello there." }, crm);
    const review = await submitTemplateForLegalReview(draft.id, crm);
    const approved = await approveCommunicationTemplate(review.id, crm);
    expect(approved.status).toBe("APPROVED");
  });

  it("retires the previously APPROVED version of the same code/scope on a new approval", async () => {
    const code = "RETIRE_TEST_" + randomUUID().slice(0, 6);
    const v1 = await approveCommunicationTemplate((await submitTemplateForLegalReview((await createCommunicationTemplate({ code, channel: "EMAIL", purpose: "GENERAL", body: "v1" }, crm)).id, crm)).id, crm);
    const v2 = await approveCommunicationTemplate((await submitTemplateForLegalReview((await createCommunicationTemplate({ code, channel: "EMAIL", purpose: "GENERAL", body: "v2" }, crm)).id, crm)).id, crm);
    expect(v2.version).toBe(v1.version + 1);
    const reloaded = await db.query<{ status: string }>(`SELECT status FROM communication_template WHERE id = $1`, [v1.id]);
    expect(reloaded.rows[0]!.status).toBe("RETIRED");
  });
});

describe("29 rule 3 — merge-field rendering (reuses 22's merge_field_definition)", () => {
  it("substitutes a known merge field and leaves an unknown one literal", async () => {
    await db.query(
      `INSERT INTO merge_field_definition (code, source_path, type, format, required, sensitivity) VALUES ('booking_number_test','booking.code','STRING',NULL,false,NULL) ON CONFLICT (code) DO NOTHING`
    );
    const { text, unresolved } = await renderTemplateBody("Booking {{booking_number_test}}, ref {{not_a_real_field}}", "b_v110");
    expect(text).toContain("Booking BK-V110");
    expect(text).toContain("{{not_a_real_field}}");
    expect(unresolved).toEqual(["not_a_real_field"]);
  });
});

describe("29 rule 4 — frequency guardrails", () => {
  it("blocks a reminder past the configured cap, then allows it with a CRM-lead override reason", async () => {
    const code = "GUARDRAIL_TEST_" + randomUUID().slice(0, 6);
    const approved = await approveCommunicationTemplate(
      (await submitTemplateForLegalReview((await createCommunicationTemplate({ code, channel: "EMAIL", purpose: "PAYMENT_REMINDER", subject: "Reminder", body: "Please pay." }, crm)).id, crm)).id,
      legal
    );
    // frequency_guardrail seeded PAYMENT_REMINDER at max 3 per 7 days (see seed/communications.ts)
    for (let i = 0; i < 3; i++) {
      await sendCommunicationEmail({ customer_id: "c_karthik", to: "karthik@example.com", template_id: approved.id }, realCrmCtx);
    }
    await expect(sendCommunicationEmail({ customer_id: "c_karthik", to: "karthik@example.com", template_id: approved.id }, realCrmCtx)).rejects.toThrow(/frequency guardrail/);

    const { checkFrequencyGuardrail } = await import("./core");
    await expect(checkFrequencyGuardrail("c_karthik", approved.id, realCrmCtx, "customer escalated, sending anyway")).resolves.toBeUndefined();
    await expect(checkFrequencyGuardrail("c_karthik", approved.id, sales, "trying to bypass")).rejects.toThrow(/requires one of/);
  });
});

describe("29 rule 2 — publish-to-portal (only CRM, reuses 26's customer_update feed)", () => {
  it("flips visibility to CUSTOMER_VISIBLE and creates a PUBLISHED customer_update row", async () => {
    const logged = await logCommunication({ customer_id: "c_karthik", booking_id: "b_v110", channel: "EMAIL", direction: "OUTBOUND", subject: "Great news", body: "Your structure milestone is complete." }, realCrmCtx);
    const published = await publishCommunicationToPortal(logged.id, realCrmCtx);
    expect(published.visibility).toBe("CUSTOMER_VISIBLE");
    expect(published.customer_update_id).toBeTruthy();
    const cu = await db.query<{ status: string; kind: string }>(`SELECT status, kind FROM customer_update WHERE id = $1`, [published.customer_update_id]);
    expect(cu.rows[0]).toEqual({ status: "PUBLISHED", kind: "MESSAGE" });
    const ev = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'communication' AND entity_id = $1 AND type = 'communication.published'`, [logged.id]);
    expect(ev.rows[0]?.type).toBe("communication.published");
    await expect(publishCommunicationToPortal(logged.id, realCrmCtx)).rejects.toThrow(/already published/);
  });

  it("SALES cannot publish to the portal — only CRM/MANAGEMENT/SUPER_ADMIN", async () => {
    const logged = await logCommunication({ customer_id: "c_karthik", booking_id: "b_v110", channel: "EMAIL", direction: "OUTBOUND", body: "x" }, realCrmCtx);
    await expect(publishCommunicationToPortal(logged.id, sales)).rejects.toThrow(/requires one of/);
  });

  it("refuses to publish a communication with no booking — nowhere in the portal to appear", async () => {
    const logged = await logCommunication({ customer_id: "c_karthik", channel: "EMAIL", direction: "OUTBOUND", body: "x" }, realCrmCtx);
    await expect(publishCommunicationToPortal(logged.id, realCrmCtx)).rejects.toThrow(/booking_id/);
  });
});

describe("29 rule 7 — internal notes are never customer-visible; mentions notify (12)", () => {
  it("creates a note, notifies a mentioned user (not the author), and lists it back", async () => {
    const mentioned = "user_superadmin";
    const note = await createInternalNote({ entity_type: "customer", entity_id: "c_karthik", body: "Flag: sensitive escalation history", mentions: [mentioned] }, crm);
    expect(note.mentions).toEqual([mentioned]);
    const list = await listInternalNotes("customer", "c_karthik", crm);
    expect(list.some((n) => n.id === note.id)).toBe(true);
    const ntf = await db.query<{ type: string }>(`SELECT type FROM notification WHERE user_id = $1 AND type = 'internal_note.mentioned' ORDER BY created_at DESC LIMIT 1`, [mentioned]);
    expect(ntf.rows[0]?.type).toBe("internal_note.mentioned");
  });

  it("a customer actor cannot read or write internal notes", async () => {
    await expect(listInternalNotes("customer", "c_karthik", customerCtx())).rejects.toThrow(/requires one of/);
  });
});
