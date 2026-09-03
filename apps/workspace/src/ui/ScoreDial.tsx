/** Explainable score ring (design-language §5). Value + one-line label; never a bare badge. */
export function ScoreDial({
  value,
  label,
  size = 72,
}: {
  value: number;
  label?: string;
  size?: number;
}) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 70 ? "var(--on-track)" : pct >= 40 ? "var(--due)" : "var(--at-risk)";
  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      <svg width={size} height={size} role="img" aria-label={`Score ${Math.round(pct)} of 100`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={size * 0.3}
          fontWeight={600}
          fill="var(--fg)"
        >
          {Math.round(pct)}
        </text>
      </svg>
      {label ? <span className="text-footnote text-fg-muted">{label}</span> : null}
    </div>
  );
}
