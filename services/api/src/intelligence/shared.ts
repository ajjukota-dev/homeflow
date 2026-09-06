import { appendEvent, withTx } from "../events";
import { persistSnapshot } from "../scores/store";
import type { Score, ScoreType } from "../scores/contract";

// 31-intelligence.md's own new event, `score.recomputed` — not part of 14's contract (14's own
// `scores/*.ts` never emit it, compute-on-read with no event). Two gotchas caught before writing
// any code, not by a test:
//
// 1. `score_snapshot` is written on every compute call by design (store.ts's own comment: "this is
//    the honest substitute" for a debounced/scheduled recompute). Emitting an event on every one of
//    those calls too would flood the log every time a screen loads a score — same "write on every
//    GET" class advisor already caught twice this session (16's `handover_gate_run`, 27's
//    `intervention.computed`). Fixed here by only emitting when the value actually moved since the
//    last snapshot.
// 2. `appendEvent` queues its event for after-commit dispatch via an AsyncLocalStorage context that
//    only exists inside an open `withTx` (`events/append.ts`'s own `pendingDispatch`) — calling it
//    with the bare `db` handle from a plain read path inserts the row but silently never dispatches
//    to subscribers. Wrapped in its own `withTx` here so dispatch actually runs; safe as a
//    top-level call (never invoked from inside another module's already-open transaction).

export async function recordScore(
  scoreType: ScoreType,
  subjectType: string,
  subjectId: string,
  projectId: string | null,
  score: Score,
  previous: number | null
): Promise<void> {
  await persistSnapshot(scoreType, subjectType, subjectId, projectId, score);
  if (previous === null || Math.abs(previous - score.value) > 1e-9) {
    await withTx(undefined, async (tx) => {
      await appendEvent(tx, {
        type: "score.recomputed", entity_type: subjectType, entity_id: subjectId, project_id: projectId,
        payload: { score_type: scoreType, value: score.value, trend: score.trend },
        actor_user_id: null, actor_kind: "SYSTEM",
      });
    });
  }
}
