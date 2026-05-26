# Timecard App (Alexander Building Company Inc)

Phone-first PWA for California construction timecards. Employees fill on their
own device offline; foreman imports the weekly exports, reviews/approves, and
generates the **State Fund (WCIRB) workers'-comp** spreadsheet + a
**payroll-ready** workbook.

> **Confidential.** This repo holds employee data, hourly rates, and payroll.
> Keep it **private** — never push to a public remote. Real rosters and
> timecards are git-ignored; only template structure and config are tracked.

## How it works (two-mode, file-based — no backend)

```
EMPLOYEE MODE                                FOREMAN MODE
(each phone, offline)                        (foreman's phone or laptop)

  pick self from roster
  enter daily hours by             email /    drag & drop the .xlsx files
  WCIRB class               --->   AirDrop -->   review + edit + approve
  end of week: tap Export                      generate:
  -> Timecard_<name>_W<wk>.xlsx                  - State Fund WCIRB summary
                                                 - Payroll workbook
                                                 (.xlsx, local)
```

- **WCIRB classification codes** (CA construction) baked in — see
  `data/wcirb_construction.js`. Edit to match your policy declaration.
- **CA OT auto-calculated** — >8/day = 1.5×, >12/day = 2×, >40/week = 1.5×,
  7th-consecutive-day premium.
- **Hourly rate** comes from the roster: pick employee → rate auto-fills.
- **Private-by-architecture** — timecards live in the browser's IndexedDB on
  each phone; nothing is uploaded. The only data that moves is the weekly
  `.xlsx` file the employee chooses to send. Same pattern as AB2533.
- **`.xlsx` generated client-side** via [SheetJS](https://sheetjs.com)
  (vendored locally for offline use).

## Roadmap

- [x] Project structure, WCIRB construction class list, schema
- [ ] PWA shell + IndexedDB persistence + mode toggle
- [ ] Employee mode: roster pick + weekly entry grid + CA OT calc
- [ ] Per-employee `.xlsx` export (SheetJS)
- [ ] Foreman mode: import → review/edit → consolidated workbook
- [ ] State Fund (WCIRB) per-class summary tab + payroll-ready tab
- [ ] v2 — DIR eCPR (certified payroll) for occasional public-works jobs

## Local run

```
cd timecard-app
python -m http.server 8000
# open http://localhost:8000 on phone (same Wi-Fi) or desktop
```

For phone install: deploy to a static HTTPS host (Netlify drop, GitHub Pages
on a **private** repo, or a private subdomain). Add to Home Screen.

## Disclaimer

Tool, not legal/payroll advice. Confirm WCIRB class assignments against your
State Fund policy, and verify OT/payroll output before submission.
