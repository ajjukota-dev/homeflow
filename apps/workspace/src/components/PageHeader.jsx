export default function PageHeader({ title, subtitle, actions, testId }) {
  return (
    <div className="flex items-start justify-between gap-4 pb-4 border-b border-warm-100" data-testid={testId || "page-header"}>
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900" data-testid="page-header-title">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-slate-500" data-testid="page-header-subtitle">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
