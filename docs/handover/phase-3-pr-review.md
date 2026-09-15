# Exam-week PR review (Phase 3.3)

You cannot watch GitHub all week. Once a day, about 15 minutes:

1. Seed: reject any PR that adds `INSERT INTO booking` for occupants — bookings go through handlers.
2. Product: reject chatbot, WhatsApp runtime, vendor portal, Google OIDC, or AWS spend.
3. Hardening: RLS / `0025_rls` / GUC `set_config` / `assertProjectScope` is Phase 4.1 — do not mix into Phase 3.
4. Queues.tsx / Spec 10 Action Types Studio is Phase 4 — not this slice.
5. Scheduler + quiet hours: prove `runOnce(asOf)` and send-path quiet hours with tests; HTTP `/sweep` and Studio columns are not the proof.
