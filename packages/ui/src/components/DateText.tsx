/** Dates render in IST with the UTC instant in `title` (technical/09 §6). */
import { date, dateTime } from "../format";

export interface DateTextProps {
  value: string | number | Date | null | undefined;
  /** Include the time of day. */
  withTime?: boolean;
}

export function DateText({ value, withTime = false }: DateTextProps) {
  if (value == null || value === "") return <span>—</span>;
  const parsed = value instanceof Date ? value : new Date(value);
  const utc = Number.isNaN(parsed.getTime()) ? undefined : `${parsed.toISOString()} (UTC)`;
  return (
    <time dateTime={utc ? parsed.toISOString() : undefined} title={utc}>
      {withTime ? dateTime(value) : date(value)}
    </time>
  );
}
