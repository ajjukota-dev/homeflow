import { useState } from "react";
import { api } from "../../api";
import type { HierarchyKind, HierarchyNode } from "../../api-model";
import { Card, CardBody, Button } from "@homeflow/ui";

// Hierarchy tree editor (04 §Screens "Projects"). Add + list only — reordering ships as
// up/down buttons once a PATCH sort_order endpoint exists; no drag-and-drop library (new
// dependency needs sign-off, and keyboard-only drag fails the WCAG 2.1 AA bar anyway).

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-subhead outline-none focus:border-accent";
const KINDS: HierarchyKind[] = ["PHASE", "TOWER", "BLOCK", "CLUSTER", "FLOOR", "STREET"];

function depthOf(nodes: HierarchyNode[], node: HierarchyNode): number {
  let d = 0;
  let cur = node;
  while (cur.parent_id) {
    const parent = nodes.find((n) => n.id === cur.parent_id);
    if (!parent) break;
    d++;
    cur = parent;
  }
  return d;
}

export function HierarchyEditor({
  projectId,
  nodes,
  onChange,
}: {
  projectId: string;
  nodes: HierarchyNode[];
  onChange: (nodes: HierarchyNode[]) => void;
}) {
  const [newNode, setNewNode] = useState({ kind: "PHASE" as HierarchyKind, code: "", name: "", parent_id: "" });
  const [error, setError] = useState<string | null>(null);

  async function addNode() {
    if (!newNode.code.trim() || !newNode.name.trim()) return;
    try {
      await api.createHierarchyNode(projectId, {
        kind: newNode.kind,
        code: newNode.code.trim(),
        name: newNode.name.trim(),
        parent_id: newNode.parent_id || null,
      });
      onChange(await api.listHierarchy(projectId));
      setNewNode({ kind: "PHASE", code: "", name: "", parent_id: "" });
      setError(null);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 text-title3 font-semibold">Hierarchy</h2>
        {error && <p className="mb-2 text-footnote text-overdue">{error}</p>}
        {nodes.length === 0 && <p className="text-subhead text-fg-muted">No hierarchy nodes yet.</p>}
        <ul className="mb-4 flex flex-col gap-1.5">
          {nodes.map((n) => (
            <li key={n.id} style={{ paddingLeft: depthOf(nodes, n) * 16 }} className="text-subhead">
              <span className="font-medium">{n.code}</span> — {n.name}{" "}
              <span className="text-footnote text-fg-muted">({n.kind})</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <select
            className={inputCls}
            value={newNode.kind}
            onChange={(e) => setNewNode({ ...newNode, kind: e.target.value as HierarchyKind })}
            aria-label="New node kind"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            className={inputCls}
            placeholder="Code, e.g. P2"
            value={newNode.code}
            onChange={(e) => setNewNode({ ...newNode, code: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="Name, e.g. Phase 2"
            value={newNode.name}
            onChange={(e) => setNewNode({ ...newNode, name: e.target.value })}
          />
          <select
            className={inputCls}
            value={newNode.parent_id}
            onChange={(e) => setNewNode({ ...newNode, parent_id: e.target.value })}
            aria-label="Parent node"
          >
            <option value="">No parent (top level)</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.code} — {n.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={addNode}>
            Add node
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
