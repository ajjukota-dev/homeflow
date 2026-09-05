/** A labelled control with hint and server-field error (technical/09 §6, forms). */
import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

export function Field({ label, hint, error, ...rest }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="hf-field">
      <label className="hf-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="hf-field__control"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {hint && (
        <span className="hf-field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="hf-field__error" id={errorId} role="alert">
          <AlertCircle aria-hidden width={14} height={14} />
          {error}
        </span>
      )}
    </div>
  );
}
