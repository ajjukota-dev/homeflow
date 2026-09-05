import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "../lib/cn";
import { useReducedMotion, transition } from "../motion";

export type ToastTone = "success" | "error" | "info";

export interface ToastInput {
  message: string;
  description?: string;
  tone?: ToastTone;
  /** ms before auto-dismiss; 0 disables auto-dismiss (errors default to 0). */
  duration?: number;
}
interface ToastItem extends Required<Omit<ToastInput, "description">> {
  id: string;
  description?: string;
}

const ToastContext = React.createContext<((toast: ToastInput) => void) | null>(null);

/** useToast — call `toast({ message, tone })` from anywhere under `ToastProvider`. */
export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

const TONE_ICON = { success: CheckCircle2, error: AlertCircle, info: Info } as const;
const TONE_CLASS = {
  success: "border-ok/30 text-ok-fg [&_svg]:text-ok",
  error: "border-danger/30 text-danger-fg [&_svg]:text-danger",
  info: "border-info/30 text-info-fg [&_svg]:text-info",
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const reduced = useReducedMotion();

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID();
      const tone = input.tone ?? "info";
      const duration = input.duration ?? (tone === "error" ? 0 : 4000);
      setToasts((prev) => [...prev, { id, tone, duration, message: input.message, description: input.description }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="region" aria-label="Notifications">
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = TONE_ICON[t.tone];
            return (
              <motion.div
                key={t.id}
                role="status"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={transition("panel", reduced)}
                className={cn(
                  "flex w-80 items-start gap-2.5 rounded-card border bg-surface p-3 shadow-panel",
                  TONE_CLASS[t.tone],
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="flex-1">
                  <p className="text-ws-sm font-medium text-fg">{t.message}</p>
                  {t.description ? <p className="mt-0.5 text-ws-xs text-fg-muted">{t.description}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="text-fg-subtle hover:text-fg"
                >
                  <X className="size-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
