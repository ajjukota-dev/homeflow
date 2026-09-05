import { useState } from "react";
import { Info, X } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { stageColorForName } from "@/lib/stageColors";
import { stageHelpForName } from "@/lib/stageHelp";

function slug(s) {
  return String(s || "unknown")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Small `<Info />` icon that opens a self-help popover for a workflow stage.
 * Content is looked up by stage name; falls back to a "no guidance" note so
 * placement stays predictable across templates.
 *
 * Prop `onLight` (default true): if the icon sits on a light surface, use the
 * stage's saturated colour for the icon glyph. If it sits on the saturated
 * stage header itself, use white so the icon reads against the strong bg.
 *
 * Consumed on:
 *   • ProgressRail   (rail tile saturated header)
 *   • StageAccordion (accordion saturated trigger — click stopped from toggling)
 */
export default function StageInfoPopover({ stageName, onLight = true }) {
  const [open, setOpen] = useState(false);
  const help = stageHelpForName(stageName);
  const color = stageColorForName(stageName);
  const s = slug(stageName);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={`Stage info: ${stageName}`}
          className="inline-flex items-center justify-center h-5 w-5 rounded-full opacity-80 hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer shrink-0"
          data-testid={`stage-info-icon-${s}`}
        >
          <Info
            className="h-4 w-4"
            style={{ color: onLight ? color.bg : "#FFFFFF" }}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-[360px] max-w-[90vw] p-0 rounded-xl border border-warm-100 bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid={`stage-info-popover-${s}`}
      >
        {/* Saturated header — white text + white close button */}
        <div
          className="px-4 py-3 flex items-start justify-between gap-2"
          style={{ background: color.bg }}
        >
          <div className="min-w-0">
            <div className="font-heading text-base font-semibold leading-tight text-white">
              {stageName}
            </div>
            {help?.responsible && (
              <div className="text-xs text-white/85 mt-0.5">
                Responsible: <span className="font-medium">{help.responsible}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="h-6 w-6 -mr-1 -mt-0.5 flex items-center justify-center rounded-md text-white/85 hover:text-white hover:bg-white/15"
            aria-label="Close stage info"
            data-testid={`stage-info-close-${s}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body — black on white */}
        <div className="px-4 py-3">
          {help ? (
            <>
              <p className="text-sm leading-relaxed text-slate-800">
                {help.description}
              </p>
              <ul className="mt-3 pl-4 list-disc space-y-1.5 text-sm text-slate-700 leading-snug">
                {help.actions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-600">
              No guidance available for this stage yet.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
