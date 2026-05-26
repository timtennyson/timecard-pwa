/* California WCIRB construction classification codes — STARTER list.
 * HIGH-WAGE classifications only (low-wage dual variants like 5651, 5432,
 * 5188 intentionally omitted — add them back if any worker is paid below
 * the dual-wage threshold and needs to be classed there).
 * Edit to match the codes on YOUR State Fund / WCIRB policy declaration.
 * Rates are policy-specific and NOT stored here.
 */
window.TC_WCIRB = [
  // ---- Residential / building carpentry ----
  { code: "5645", title: "Carpentry — Detached one or two family dwellings", group: "construction" },
  { code: "5403", title: "Carpentry — N.O.C. (commercial / multi-family)", group: "construction" },

  // ---- Trades ----
  { code: "5474", title: "Painting / Paperhanging — N.O.C.", group: "construction" },
  { code: "5183", title: "Plumbing — N.O.C.", group: "construction" },
  { code: "5190", title: "Electrical Wiring — within buildings", group: "construction" },
  { code: "5538", title: "Sheet Metal Work — installation (HVAC ducting)", group: "construction" },
  { code: "5703", title: "Roofing", group: "construction" },
  { code: "5022", title: "Masonry — N.O.C.", group: "construction" },
  { code: "5028", title: "Plastering / Stucco Work", group: "construction" },

  // ---- Site / civil ----
  { code: "5213", title: "Concrete / Cement Work — foundations & flatwork", group: "construction" },
  { code: "6217", title: "Excavation — N.O.C.", group: "construction" },
  { code: "6218", title: "Excavation — Rock", group: "construction" },
  { code: "6306", title: "Sewer Construction", group: "construction" },
  { code: "6315", title: "Water Mains or Connections Construction", group: "construction" },

  // ---- Supervision / cleanup / hauling / office ----
  { code: "5606", title: "Construction Executive / Supervisor / PM", group: "supervision" },
  { code: "5610", title: "Construction or Erection — Cleanup / Final Cleaning", group: "construction" },
  { code: "7219", title: "Trucking — N.O.C.", group: "hauling" },
  { code: "8810", title: "Clerical Office Employees", group: "office" },
  { code: "8742", title: "Salespersons — Outside", group: "office" },
];
