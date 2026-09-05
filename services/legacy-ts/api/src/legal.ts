// Legal Document Factory — governed generation (legal/spec.md §1.3, handshake H4).
// Pure: missing fields return source_refs so the user fixes the source record, never retypes.

export interface MergeField {
  key: string;
  label: string;
  source_ref: string;
  mandatory: boolean;
}

export interface FieldError {
  field: string;
  message: string;
  source_ref: string;
}

export function readinessCheck(
  snapshot: Record<string, string | null | undefined>,
  fields: MergeField[]
): { ok: boolean; errors: FieldError[] } {
  const errors: FieldError[] = [];
  for (const field of fields) {
    if (!field.mandatory) continue;
    const value = snapshot[field.key];
    if (value == null || !String(value).trim()) {
      errors.push({
        field: field.key,
        message: `${field.label} is missing`,
        source_ref: field.source_ref,
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Immutable copy of merge-field values so Draft v1 cannot be mutated later. */
export function freezeSnapshot(source: Record<string, string | null | undefined>): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value != null && String(value).trim()) copy[key] = String(value);
  }
  return Object.freeze({ ...copy }) as Record<string, string>;
}

const TOKEN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

export function renderDraft(
  body: string,
  snapshot: Record<string, string>
): { body: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const rendered = body.replace(TOKEN, (_, key: string) => {
    const value = snapshot[key];
    if (value == null || value === "") {
      unresolved.push(key);
      return `{{${key}}}`;
    }
    return value;
  });
  return { body: rendered, unresolved };
}

export function autoValidate(input: {
  body: string;
  snapshot: Record<string, string>;
  consideration: number;
}): { ok: boolean; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const leftover = [...input.body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)];
  for (const match of leftover) {
    errors.push({
      field: match[1],
      message: "Unresolved merge token",
      source_ref: `snapshot.${match[1]}`,
    });
  }
  const snapAmt = Number(input.snapshot.consideration);
  if (!Number.isNaN(snapAmt) && snapAmt !== input.consideration) {
    errors.push({
      field: "consideration",
      message: "Consideration does not match the booking",
      source_ref: "booking.total_consideration",
    });
  }
  return { ok: errors.length === 0, errors };
}
