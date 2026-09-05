import { createRoot } from "react-dom/client";
import { Plus } from "lucide-react";
import { PreviewPage, Section } from "./Shell";
import { Button, IconButton } from "../../src";

const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;

function Buttons() {
  return (
    <PreviewPage title="Buttons">
      <Section title="Variants x sizes" description="Copy names the action, never a generic 'Submit'.">
        <div className="flex flex-col gap-4">
          {(["md", "sm"] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-3">
              {VARIANTS.map((variant) => (
                <Button key={variant} variant={variant} size={size}>
                  Record receipt
                </Button>
              ))}
            </div>
          ))}
        </div>
      </Section>
      <Section title="States">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Recording…</Button>
        </div>
      </Section>
      <Section title="Icon-only" description="Pair with Tooltip in real use so sighted users get the label too.">
        <div className="flex items-center gap-3">
          <IconButton icon={Plus} aria-label="Add commitment" />
          <IconButton icon={Plus} aria-label="Add commitment" size="sm" />
          <IconButton icon={Plus} aria-label="Add commitment" variant="primary" />
        </div>
      </Section>
    </PreviewPage>
  );
}

createRoot(document.getElementById("root")!).render(<Buttons />);
