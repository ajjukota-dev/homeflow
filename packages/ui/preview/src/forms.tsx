import * as React from "react";
import { createRoot } from "react-dom/client";
import { PreviewPage, Section } from "./Shell";
import {
  Field,
  Input,
  Textarea,
  MoneyInput,
  Checkbox,
  RadioGroup,
  RadioItem,
  Switch,
  Segmented,
  Select,
  SelectTrigger,
  SelectOptions,
} from "../../src";

function Forms() {
  const [amount, setAmount] = React.useState(2495678);
  const [density, setDensity] = React.useState<"compact" | "comfortable">("compact");

  return (
    <PreviewPage title="Forms">
      <Section title="Input — all states">
        <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer name" htmlFor="cust-name">
            <Input defaultValue="Priyanka Deshmukh" />
          </Field>
          <Field label="Unit code" htmlFor="unit-code" hint="Format: block-floor-unit">
            <Input defaultValue="A-1204" />
          </Field>
          <Field label="Email" htmlFor="email-error" error="Enter a valid email address">
            <Input defaultValue="rohan.mehta@" status="error" />
          </Field>
          <Field label="PAN verified" htmlFor="pan-ok">
            <Input defaultValue="ABCDE1234F" status="success" />
          </Field>
          <Field label="Fetching CIBIL score" htmlFor="cibil">
            <Input defaultValue="" status="loading" placeholder="Looking up…" />
          </Field>
          <Field label="Disabled" htmlFor="disabled-field">
            <Input defaultValue="Locked after registration" disabled />
          </Field>
        </div>
      </Section>
      <Section title="Textarea">
        <Field label="Snag description" htmlFor="snag-desc" className="max-w-xl">
          <Textarea defaultValue="Cracked tile near the balcony threshold, unit A-1204, noticed during the pre-handover walkthrough on 14 Sep 2026." />
        </Field>
      </Section>
      <Section title="MoneyInput — Indian grouping" description="₹1,23,45,678.00 style grouping, ₹ prefix.">
        <Field label="Receipt amount" htmlFor="receipt-amount" className="max-w-xs">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
      </Section>
      <Section title="Checkbox / Radio / Switch">
        <div className="flex flex-col gap-4">
          <Checkbox label="Notify customer by email" defaultChecked />
          <Checkbox label="Auto-approve minor change requests" disabled />
          <RadioGroup defaultValue="apartment" className="flex gap-6">
            <RadioItem value="apartment" label="Apartment" />
            <RadioItem value="villa" label="Villa" />
            <RadioItem value="plot" label="Plot" />
          </RadioGroup>
          <Switch label="Comfortable row height" />
        </div>
      </Section>
      <Section title="Segmented — density toggle">
        <Segmented
          aria-label="Table density"
          className="self-start"
          value={density}
          onChange={setDensity}
          options={[
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
          ]}
        />
      </Section>
      <Section title="Select">
        <Field label="Product type" htmlFor="product-type" className="max-w-xs">
          <Select defaultValue="apartment">
            {/* `Field` clones its direct child to inject `id`/`aria-*`, but that child here is a
                Radix `Select.Root` context provider with no DOM node of its own to carry them —
                the real focusable element is `SelectTrigger`, so it needs the id directly. */}
            <SelectTrigger id="product-type" placeholder="Choose product type" />
            <SelectOptions
              options={[
                { value: "apartment", label: "Apartment" },
                { value: "villa", label: "Villa" },
                { value: "plot", label: "Plot" },
              ]}
            />
          </Select>
        </Field>
      </Section>
    </PreviewPage>
  );
}

createRoot(document.getElementById("root")!).render(<Forms />);
