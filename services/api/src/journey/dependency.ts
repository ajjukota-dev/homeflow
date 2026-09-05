// Pure graph check for journey_dependency (spec 05 rule 5: "a template with a cycle in
// journey_dependency cannot be published"). Framework-free, unit-tested in isolation.

export interface DependencyEdge {
  from_task_code: string;
  to_task_code: string;
}

/** DFS with a 3-colour mark (white/gray/black) — a gray-to-gray edge is a back edge, i.e. a cycle. */
export function hasCycle(edges: DependencyEdge[]): boolean {
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    if (!graph.has(e.from_task_code)) graph.set(e.from_task_code, []);
    graph.get(e.from_task_code)!.push(e.to_task_code);
    if (!graph.has(e.to_task_code)) graph.set(e.to_task_code, []);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  function visit(node: string): boolean {
    color.set(node, GRAY);
    for (const next of graph.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE && visit(node)) return true;
  }
  return false;
}
