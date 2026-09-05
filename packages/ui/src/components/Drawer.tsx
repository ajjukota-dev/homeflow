import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { useReducedMotion, drawerVariants, drawerContentVariants } from "../motion";

export const Drawer = RadixDialog.Root;
export const DrawerTrigger = RadixDialog.Trigger;

export interface DrawerContentProps {
  /** Mirrors the `Drawer` root's `open` — Radix doesn't expose it via context, and
   * `AnimatePresence` needs it to run the exit animation before unmounting. */
  open: boolean;
  title: string;
  width?: 480 | 640;
  children: React.ReactNode;
  className?: string;
}

/** Drawer — right-side panel (480/640px). Authored moment (Rule 6): slides in from the right,
 * content fades in 60ms later. `forceMount` + `AnimatePresence` drive the exit, since Radix would
 * otherwise unmount before the animation runs. */
export function DrawerContent({ open, title, width = 480, children, className }: DrawerContentProps) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {open ? (
        <RadixDialog.Portal forceMount>
          <RadixDialog.Overlay asChild forceMount>
            <motion.div
              className="fixed inset-0 z-40 bg-fg/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.12 : 0.24 }}
            />
          </RadixDialog.Overlay>
          <RadixDialog.Content asChild forceMount>
            <motion.div
              style={{ width }}
              className={cn(
                "fixed right-0 top-0 z-50 h-full max-w-full overflow-y-auto bg-surface shadow-panel",
                "focus-visible:outline-none",
                className,
              )}
              variants={drawerVariants(reduced)}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <div className="flex items-center justify-between border-b border-line px-6 py-4">
                <RadixDialog.Title className="font-heading text-ws-lg font-semibold text-fg">
                  {title}
                </RadixDialog.Title>
                <RadixDialog.Close
                  className="rounded-control p-1 text-fg-muted hover:bg-surface-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  aria-label="Close"
                >
                  <X className="size-4" aria-hidden />
                </RadixDialog.Close>
              </div>
              <motion.div
                className="px-6 py-4"
                variants={drawerContentVariants(reduced)}
                initial="hidden"
                animate="visible"
              >
                {children}
              </motion.div>
            </motion.div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      ) : null}
    </AnimatePresence>
  );
}
