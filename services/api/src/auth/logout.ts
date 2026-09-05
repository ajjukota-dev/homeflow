import { revokeSession } from "./session";
import { appendAuthEvent } from "./events";
import type { Actor } from "../authz/types";

export async function logout(token: string, actor: Actor | null): Promise<void> {
  await revokeSession(token);
  if (actor) await appendAuthEvent("auth.logout", actor.user_id, actor.user_id, {});
}
