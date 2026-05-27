/* California WCIRB construction classification codes — STARTER list.
 * HIGH-WAGE variants only on dual-wage classes; the known low-wage duals are
 * intentionally omitted (5651 carpentry-residential, 5432 carpentry-NOC, 5188
 * plumbing, 5482 painting, 5140 electrical, 5027 masonry, 5215 concrete, 5553
 * roofing, 6220 excavation-NOC, 6307 sewer, 6316 water-mains, 5484 plastering).
 * Add a low-wage variant back ONLY if a worker is paid below the dual-wage
 * threshold and must be classed there.
 *
 * VERIFY this list against the State Fund / WCIRB declaration on the actual
 * policy before going live — codes change, and some single-class entries here
 * may not appear on a given policy. Rates are policy-specific and NOT stored
 * here.
 *
 * Each entry includes `keywords` used to auto-classify entries from the
 * worker's description (offline keyword match, no AI needed).
 */
window.TC_WCIRB = [
  // ---- Carpentry (high-wage) ----
  // 5645 is the DEFAULT — ABCI's work is primarily detached residential
  // (incl. ADUs). Switch to 5403 only on commercial / multi-family / mixed-use.
  // Low-wage dual of 5645 is 5651 (intentionally omitted; add back if any
  // worker is paid below the WCIRB dual-wage threshold).
  { code: "5645",
    title: "Carpentry — Detached 1-2 family dwelling / ADU (default)",
    group: "construction",
    keywords: ["frame", "framing", "framer", "stud", "joist", "rafter", "sheath",
               "shear", "header", "blocking", "deck", "decking", "trim", "finish carpentry",
               "cabinet", "door", "window", "siding", "fascia", "soffit", "subfloor",
               "wall", "stair", "handrail", "addition", "detached residence",
               "detached residential", "single family residence", "duplex", "adu",
               "owner builder home"] },
  { code: "5403",
    title: "Carpentry — N.O.C. (commercial / multi-family)",
    group: "construction",
    keywords: ["commercial framing", "multi-family", "multi family", "mixed use",
               "office build", "tenant improvement", "ti", "store front", "storefront"] },

  // ---- Trades ----
  { code: "5474", title: "Painting / Paperhanging — N.O.C.", group: "construction",
    keywords: ["paint", "painting", "primer", "prime coat", "caulk", "caulking", "masking",
               "spray", "brush", "roll", "paper hang", "wallpaper", "stain"] },
  { code: "5183", title: "Plumbing — N.O.C.", group: "construction",
    keywords: ["plumb", "plumbing", "pipe", "p-trap", "p trap", "drain", "supply line",
               "fixture", "water heater", "abs", "copper", "pex", "faucet", "toilet",
               "shower", "sink", "rough-in plumb", "lateral plumb", "vent stack"] },
  { code: "5190", title: "Electrical Wiring — within buildings", group: "construction",
    keywords: ["electric", "electrical", "wire", "wiring", "panel", "breaker", "conduit",
               "romex", "outlet", "switch", "receptacle", "lighting fixture", "gfci",
               "subpanel", "low voltage", "data", "rough-in electrical"] },
  { code: "5538", title: "Sheet Metal Work — installation (HVAC ducting)", group: "construction",
    keywords: ["hvac", "duct", "ductwork", "sheet metal", "supply register", "return air",
               "condenser", "furnace", "mini split", "minisplit", "flue"] },
  { code: "5552", title: "Roofing — All Kinds & Drivers", group: "construction",
    keywords: ["roof", "roofing", "shingle", "underlayment", "flashing", "gutter",
               "downspout", "ridge", "valley", "tear off", "tear-off", "torch down"] },
  { code: "5022", title: "Masonry — N.O.C.", group: "construction",
    keywords: ["brick", "block", "cmu", "stone", "masonry", "mortar", "grout cell",
               "veneer stone"] },
  { code: "5485", title: "Plastering / Stucco Work — N.O.C.", group: "construction",
    keywords: ["stucco", "plaster", "lath", "scratch coat", "brown coat", "finish coat"] },

  // ---- Site / civil ----
  { code: "5213", title: "Concrete / Cement Work — foundations & flatwork", group: "construction",
    keywords: ["concrete", "conc", "pour", "footing", "foundation", "slab", "flatwork",
               "sidewalk", "curb", "gutter", "rebar", "formwork", "forms", "stem wall",
               "post tension", "approach", "driveway concrete"] },
  { code: "6217", title: "Excavation — N.O.C.", group: "construction",
    keywords: ["excavate", "excavation", "dig", "dirt", "soil", "grade", "grading",
               "rough grade", "finish grade", "compact", "cut and fill", "site prep",
               "import", "export", "trench general"] },
  { code: "6218", title: "Excavation — Rock", group: "construction",
    keywords: ["rock excavation", "rock removal", "blast", "rip rock"] },
  { code: "6306", title: "Sewer Construction", group: "construction",
    keywords: ["sewer", "sanitary", "lateral", "ssmh", "sewer manhole", "clean out",
               "cleanout", "sewer pipe", "sewer trench"] },
  { code: "6315", title: "Water Mains or Connections Construction", group: "construction",
    keywords: ["water main", "hydrant", "fire service line", "water connection",
               "water line", "water lateral", "water service"] },

  // ---- Supervision / cleanup / hauling / office ----
  { code: "5606", title: "Construction Executive / Supervisor / PM", group: "supervision",
    keywords: ["supervise", "supervision", "manage", "foreman", "project management",
               "pm meeting", "walkthrough", "punch list", "owner meeting",
               "inspection meeting", "schedule meeting"] },
  { code: "5610", title: "Construction or Erection — Cleanup / Final Cleaning", group: "construction",
    keywords: ["clean", "cleanup", "clean-up", "debris", "dump", "haul off", "trash",
               "broom", "sweep", "final clean"] },
  { code: "7219", title: "Trucking — N.O.C.", group: "hauling",
    keywords: ["truck", "haul", "delivery", "drive material", "trip to dump",
               "trip to yard"] },
  { code: "8810", title: "Clerical Office Employees", group: "office",
    keywords: ["office", "email", "paperwork", "scheduling", "payroll work",
               "bookkeeping", "accounting", "invoice", "permit submittal"] },
  { code: "8742", title: "Salespersons — Outside", group: "office",
    keywords: ["sales", "bid prep", "proposal", "estimate", "customer meeting",
               "site visit sales"] },
];

/* Keyword-based classifier. Returns {code, score} of best match, or null if
 * no keyword hits. Word-boundary match (case-insensitive). Ties go to the
 * entry with the most distinctive (longer) winning keyword. */
window.TC_classify = function (text) {
  if (!text) return null;
  var t = (" " + String(text).toLowerCase() + " ").replace(/[^\w\s-]/g, " ");
  var best = null;
  window.TC_WCIRB.forEach(function (w) {
    var hits = 0, longest = 0;
    (w.keywords || []).forEach(function (kw) {
      var k = kw.toLowerCase();
      // word-boundary contains: " k " or " k-" or "-k " etc. Spaces around our t
      // make leading/trailing matches work.
      var re = new RegExp("(^|[^a-z0-9])" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)");
      if (re.test(t)) { hits++; if (k.length > longest) longest = k.length; }
    });
    if (hits > 0) {
      var score = hits * 10 + longest;
      if (!best || score > best.score) best = { code: w.code, score: score, hits: hits };
    }
  });
  return best;
};
