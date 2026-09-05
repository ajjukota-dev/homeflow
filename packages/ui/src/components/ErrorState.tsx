/**
 * Error is a state, never a toast: code, plain message, request id and retry
 * (technical/09 §3 and §6). The request id is what support needs to find the log line.
 */
import { AlertTriangle } from "lucide-react";
import { ApiError } from "../api/client";
import { Button } from "./Button";

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function ErrorState({ error, onRetry, title }: ErrorStateProps) {
  const api = error instanceof ApiError ? error : null;
  const code = api?.code ?? "UNEXPECTED";
  const message = api?.message ?? (error instanceof Error ? error.message : "Something went wrong.");
  return (
    <div className="hf-state" role="alert" data-testid="error-state">
      <AlertTriangle aria-hidden width={20} height={20} />
      <h2 className="hf-state__title">{title ?? "This didn’t load"}</h2>
      <p className="hf-state__body">{message}</p>
      <span className="hf-state__meta">
        {code}
        {api?.request_id ? ` · request ${api.request_id}` : ""}
      </span>
      {api?.source_ref && <span className="hf-state__meta">source: {api.source_ref}</span>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
