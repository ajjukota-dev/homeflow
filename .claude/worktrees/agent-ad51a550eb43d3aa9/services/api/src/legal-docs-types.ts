// Row shapes returned by legal-docs.ts db.query calls (kept separate to respect the 200-line rule).

export type SourceRow = {
  id: string;
  project_id: string;
  unit_id: string;
  booking_number: string;
  total_consideration: number;
  unit_number: string;
  unit_type: string;
  facing: string;
  project_name: string;
  display_name: string | null;
  pan: string | null;
};

export type GeneratedDocumentRow = {
  id: string; booking_id: string; document_family: string; status: string; version: number;
  snapshot: unknown; body_rendered: string; checksum: string | null; created_at: Date;
};
