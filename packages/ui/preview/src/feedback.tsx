import { createRoot } from "react-dom/client";
import { Inbox } from "lucide-react";
import { PreviewPage, Section } from "./Shell";
import { Button, EmptyState, Skeleton, ToastProvider, useToast } from "../../src";

function ToastButtons() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => toast({ message: "Receipt recorded", description: "₹5,00,000.00 against DEM-000342", tone: "success" })}
      >
        Trigger success
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => toast({ message: "Couldn't save the change request", description: "The API didn't respond — try again.", tone: "error" })}
      >
        Trigger error
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => toast({ message: "3 commitments due this week", tone: "info" })}
      >
        Trigger info
      </Button>
    </div>
  );
}

function Feedback() {
  return (
    <ToastProvider>
      <PreviewPage title="Feedback">
        <Section title="Toast" description="Auto-dismiss in 4s (success/info); errors stay until dismissed.">
          <ToastButtons />
        </Section>
        <Section title="EmptyState" description="Message names what's missing + one action.">
          <EmptyState
            icon={Inbox}
            message="No change requests are open for this unit."
            action={{ label: "Raise a change request", onClick: () => {} }}
          />
        </Section>
        <Section title="Skeleton — shaped like the content it replaces">
          <div className="flex max-w-sm flex-col gap-3">
            <div className="flex items-center gap-3">
              <Skeleton variant="circle" />
              <div className="flex-1">
                <Skeleton variant="text" className="mb-2 w-1/2" />
                <Skeleton variant="text" className="w-1/3" />
              </div>
            </div>
            <Skeleton variant="block" />
          </div>
        </Section>
      </PreviewPage>
    </ToastProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Feedback />);
