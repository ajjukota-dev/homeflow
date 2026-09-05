import { createRoot } from "react-dom/client";
import { PreviewPage, Section } from "./Shell";
import { Tabs, TabsList, TabsTrigger, TabsContent, Breadcrumb, PageHeader, Button } from "../../src";

function Navigation() {
  return (
    <PreviewPage title="Navigation">
      <Section title="Breadcrumb">
        <Breadcrumb
          items={[
            { label: "Projects", href: "#" },
            { label: "Sunrise Meadows", href: "#" },
            { label: "Unit A-1204" },
          ]}
        />
      </Section>
      <Section title="PageHeader" description="One h1 per page, actions right.">
        <PageHeader
          title="Unit A-1204"
          description="Priyanka Deshmukh · 3 BHK · Tower A"
          actions={
            <>
              <Button variant="secondary" size="sm">
                Export
              </Button>
              <Button size="sm">Record receipt</Button>
            </>
          }
        />
      </Section>
      <Section title="Tabs">
        <Tabs defaultValue="timeline" className="max-w-xl">
          <TabsList>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="commitments">Commitments</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>
          <TabsContent value="timeline">
            <p className="text-ws-body text-fg-muted">Booking confirmed 12 Jan 2025 · Agreement signed 3 Feb 2025.</p>
          </TabsContent>
          <TabsContent value="commitments">
            <p className="text-ws-body text-fg-muted">2 open commitments, next due 18 Sep 2026.</p>
          </TabsContent>
          <TabsContent value="documents">
            <p className="text-ws-body text-fg-muted">Sale agreement, floor plan, payment schedule.</p>
          </TabsContent>
        </Tabs>
      </Section>
    </PreviewPage>
  );
}

createRoot(document.getElementById("root")!).render(<Navigation />);
