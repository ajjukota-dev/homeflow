import type { DbClient } from "./db/types";
import { insertUnit } from "./model/units";

// Second demo project (04 §Rules 7, TODO §7.10: "villa and plot demo units under a second
// demo project so product-awareness is visible") — East Crest alone can't show a MIXED
// project or a PLOT unit (no floor/carpet area, plot_area_sqyd instead).

export async function seedCanonicalDemo(db: DbClient): Promise<void> {
  await db.query(
    `INSERT INTO project
       (id, code, name, portfolio_id, product_type, legal_entity, jurisdiction,
        escrow_account_ref, launch_date, planned_handover_date, status)
     VALUES
       ('p_meadows','MEADOWS','Pranava Meadows','portfolio_pranava','MIXED',
        'Pranava Meadows Developers LLP','Bengaluru Rural, Karnataka','ESCROW/MEADOWS/01',
        '2025-06-01','2028-03-31','PLANNING')`
  );
  await db.query(
    `INSERT INTO project_hierarchy_node (id, project_id, kind, code, name, sort_order) VALUES
       ('node_meadows_villas','p_meadows','PHASE','VILLAS','Villa Enclave',1),
       ('node_meadows_plots','p_meadows','PHASE','PLOTS','Plotted Development',2)`
  );

  await insertUnit(db, "p_meadows", "node_meadows_villas", {
    unit_number: "MV-01",
    unit_type: "Villa-A",
    facing: "East",
    product_type: "VILLA",
    carpet_area_sqft: 2400,
    base_price_inr: 18500000,
  });
  await insertUnit(db, "p_meadows", "node_meadows_villas", {
    unit_number: "MV-02",
    unit_type: "Villa-A",
    facing: "North",
    product_type: "VILLA",
    carpet_area_sqft: 2400,
    base_price_inr: 18500000,
  });
  await insertUnit(db, "p_meadows", "node_meadows_plots", {
    unit_number: "MP-01",
    unit_type: "Plot-30x40",
    facing: "East",
    product_type: "PLOT",
    plot_area_sqyd: 1333,
    base_price_inr: 9500000,
  });
  await insertUnit(db, "p_meadows", "node_meadows_plots", {
    unit_number: "MP-02",
    unit_type: "Plot-30x50",
    facing: "West",
    product_type: "PLOT",
    plot_area_sqyd: 1667,
    base_price_inr: 11000000,
  });
}
