// Permission levels, ordered low → high (01-identity-access.md Data: permission_matrix).
export const LEVELS = ["NONE", "READ_STATUS_ONLY", "READ_LIMITED", "READ", "WRITE", "ADMIN"] as const;
export type Level = (typeof LEVELS)[number];

const ORDER: Record<Level, number> = Object.fromEntries(LEVELS.map((l, i) => [l, i])) as Record<Level, number>;

export function levelAtLeast(have: Level, need: Level): boolean {
  return ORDER[have] >= ORDER[need];
}

export function maxLevel(levels: Level[]): Level {
  return levels.reduce((best, l) => (ORDER[l] > ORDER[best] ? l : best), "NONE" as Level);
}
