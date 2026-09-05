import * as React from "react";
import { createRoot } from "react-dom/client";
import { Info } from "lucide-react";
import { PreviewPage, Section } from "./Shell";
import {
  Button,
  IconButton,
  Drawer,
  DrawerTrigger,
  DrawerContent,
  Dialog,
  DialogTrigger,
  DialogContent,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Tooltip,
  TooltipProvider,
  Field,
  MoneyInput,
} from "../../src";

function DrawerDemo() {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState(500000);
  return (
    // `Section` is a column flexbox; without `self-start` this trigger button, as a direct flex
    // item, stretches to the full cross-axis width (align-items:stretch is flex's default) since
    // the Radix `Drawer` root renders no DOM node of its own to carry the class.
    <div className="self-start">
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Button>Record receipt</Button>
        </DrawerTrigger>
        <DrawerContent open={open} title="Record receipt — A-1204" width={480}>
          <Field label="Amount received" htmlFor="drawer-amount">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save receipt</Button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function Overlays() {
  return (
    <TooltipProvider>
      <PreviewPage title="Overlays">
        <Section title="Drawer — right panel, 480/640px">
          <DrawerDemo />
        </Section>
        <Section title="Dialog — protected-focus tasks only">
          <div className="self-start">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="danger">Cancel booking</Button>
              </DialogTrigger>
              <DialogContent title="Cancel booking BKG-002190?" description="This cannot be undone — the unit returns to available inventory.">
                <div className="flex justify-end gap-2">
                  <Button variant="secondary">Keep booking</Button>
                  <Button variant="danger">Cancel booking</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </Section>
        <Section title="Popover">
          <div className="self-start">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Filter by status</Button>
              </PopoverTrigger>
              <PopoverContent>
                <p className="text-ws-sm text-fg-muted">On track, Due soon, At risk, Overdue</p>
              </PopoverContent>
            </Popover>
          </div>
        </Section>
        <Section title="Tooltip">
          <Tooltip content="3 commitments due this week">
            <IconButton icon={Info} aria-label="Commitment summary" />
          </Tooltip>
        </Section>
      </PreviewPage>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Overlays />);
