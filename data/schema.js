/* Timecard data model — plain JS objects (no classes; JSON-serializable).
 *
 *   Employee        : a person on the roster.
 *   DayEntry        : one line on a daily timecard — hours of one WCIRB class
 *                     for one day (an employee can have multiple per day).
 *   WeekTimecard    : a full week for one employee (7 days × N entries).
 *   ExportedTimecard: the payload an employee sends to the foreman (a
 *                     normalized JSON embedded inside the .xlsx workbook so
 *                     foreman mode can re-import it cleanly).
 *
 * Money formula (per entry) — applied at export / consolidation time:
 *   reg_hours, ot_hours, dt_hours = California OT split of the day's hours
 *   wages = reg*rate + ot*1.5*rate + dt*2.0*rate
 *
 * CA OT rules (private work, non-prevailing-wage):
 *   - >8 to 12 hours in one day  -> 1.5x
 *   - >12 hours in one day       -> 2.0x
 *   - >40 hours in a workweek    -> 1.5x  (combined with daily cap)
 *   - 7th consecutive workday    -> first 8 hrs at 1.5x, beyond 8 at 2.0x
 */
window.TC_SCHEMA = {
  exampleEmployee: {
    id: "E001",                 // short code; stable
    name: "Jane Doe",
    base_rate: 35.00,           // $/hr default
    default_class: "5645",      // WCIRB code most often worked
    active: true,
  },
  exampleDayEntry: {
    date: "2026-05-25",         // ISO
    wcirb: "5645",              // WCIRB code
    hours: 6.5,                 // raw hours (OT split happens at export)
    project: "",                // optional: job # / address
    notes: "",
  },
  exampleWeekTimecard: {
    employee_id: "E001",
    week_starting: "2026-05-25",   // Monday (configurable)
    entries: [/* DayEntry, … */],
    submitted_at: null,            // set when employee exports
    approved_by: null,             // foreman name on approve
    approved_at: null,
  },
};
