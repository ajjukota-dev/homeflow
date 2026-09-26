/** Which git commit this process was built from — set at image/CI time, never guessed. */
export function liveCommitSha(env: NodeJS.ProcessEnv = process.env): string | null {
  const sha = env.GIT_SHA || env.GITHUB_SHA;
  return sha ? sha : null;
}

export function healthPayload(dbOk: boolean, env: NodeJS.ProcessEnv = process.env): {
  ok: boolean;
  db: boolean;
  commit: string | null;
} {
  return { ok: dbOk, db: dbOk, commit: liveCommitSha(env) };
}
