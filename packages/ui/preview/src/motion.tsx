import * as React from "react";
import { createRoot } from "react-dom/client";
import { motion } from "motion/react";
import { PreviewPage, Section } from "./Shell";
import { Button, Drawer, DrawerTrigger, DrawerContent, StatusChip, Skeleton } from "../../src";
import { useReducedMotion, listStagger, skeletonCrossfade } from "../../src/motion";

function ListStaggerDemo() {
  const reduced = useReducedMotion();
  const [key, setKey] = React.useState(0);
  const items = ["Record receipt — A-1204", "Approve change request CR-000112", "Close snag SNG-000045"];
  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setKey((k) => k + 1)}>
        Replay stagger
      </Button>
      <ul key={key} className="flex flex-col gap-2">
        {items.map((item, i) => (
          <motion.li
            key={item}
            {...listStagger(i, reduced)}
            className="rounded-control border border-line bg-surface px-3 py-2 text-ws-body text-fg"
          >
            {item}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function SkeletonCrossfadeDemo() {
  const reduced = useReducedMotion();
  const [loaded, setLoaded] = React.useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" size="sm" className="self-start" onClick={() => setLoaded((l) => !l)}>
        Toggle loaded
      </Button>
      {loaded ? (
        <motion.p {...skeletonCrossfade(reduced)} className="text-ws-body text-fg">
          Demand DEM-000342 · ₹24,95,678.00 outstanding
        </motion.p>
      ) : (
        <motion.div {...skeletonCrossfade(reduced)}>
          <Skeleton variant="text" />
        </motion.div>
      )}
    </div>
  );
}

function StatusMorphDemo() {
  const [status, setStatus] = React.useState<"ON_TRACK" | "AT_RISK" | "OVERDUE">("ON_TRACK");
  return (
    <div className="flex items-center gap-3">
      <StatusChip status={status} />
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setStatus((s) => (s === "ON_TRACK" ? "AT_RISK" : s === "AT_RISK" ? "OVERDUE" : "ON_TRACK"))}
      >
        Advance status
      </Button>
    </div>
  );
}

function DrawerDemo() {
  const [open, setOpen] = React.useState(false);
  return (
    // `self-start`: Radix's `Drawer` root renders no DOM node, so the trigger button is Section's
    // direct flex-column item and would otherwise stretch to the full section width.
    <div className="self-start">
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Button>Open action drawer</Button>
        </DrawerTrigger>
        <DrawerContent open={open} title="Record receipt">
          <p className="text-ws-body text-fg-muted">Unit A-1204 · ₹24,95,678.00 outstanding.</p>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function Motion() {
  return (
    <PreviewPage title="Motion">
      <Section title="Drawer — authored moment" description="Slides in from the right, content fades in 60ms later. cubic-bezier(0.16, 1, 0.3, 1), 240ms.">
        <DrawerDemo />
      </Section>
      <Section title="StatusChip morph — authored moment" description="Colour + icon crossfade on state change.">
        <StatusMorphDemo />
      </Section>
      <Section title="Skeleton -> content crossfade — authored moment">
        <SkeletonCrossfadeDemo />
      </Section>
      <Section title="List stagger — authored moment" description="40ms per item, capped at 400ms total delay.">
        <ListStaggerDemo />
      </Section>
      <Section title="Reduced motion" description="prefers-reduced-motion collapses every transition above to an opacity fade <=120ms — toggle it in your OS/browser and replay.">
        <p className="text-ws-sm text-fg-muted">
          Current preference: <span className="hf-tnum font-medium text-fg">{window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "no-preference"}</span>
        </p>
      </Section>
    </PreviewPage>
  );
}

createRoot(document.getElementById("root")!).render(<Motion />);
