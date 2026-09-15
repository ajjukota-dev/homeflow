import { beforeEach } from "vitest";
import { enterSystem } from "./rls-context";

// Existing test files query as superuser after initDb. Default the vitest ALS
// to runAsSystem so fixtures keep working; request-path tests call runWithActor.
enterSystem();
beforeEach(() => {
  enterSystem();
});
