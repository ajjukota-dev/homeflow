/** Empty is a designed state with real copy and a next action (technical/09 §6). */
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export interface EmptyStateProps {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({ title, body, action, icon }: EmptyStateProps) {
  return (
    <div className="hf-state" data-testid="empty-state">
      {icon ?? <Inbox aria-hidden width={20} height={20} />}
      <h2 className="hf-state__title">{title}</h2>
      {body && <p className="hf-state__body">{body}</p>}
      {action}
    </div>
  );
}
