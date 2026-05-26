/* Timecard PWA — employee mode + roster + CA OT calc + .xlsx export.
 * Two-mode app (Employee | Foreman). Foreman mode is v2 (placeholder for now).
 * All data stays on this device (IndexedDB). The only thing that leaves is
 * the .xlsx the user explicitly exports.
 */
(function () {
  "use strict";

  // ----- date helpers -----
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseISO(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function todayISO() { return iso(new Date()); }
  // Monday of the week containing d (CA workweek default — easy to change to Sun).
  function weekStart(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dow = x.getDay();             // 0 Sun .. 6 Sat
    var diff = (dow === 0 ? -6 : 1 - dow);
    x.setDate(x.getDate() + diff);
    return x;
  }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function weekLabel(start) {
    var end = addDays(start, 6);
    var m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var sm = m[start.getMonth()], em = m[end.getMonth()];
    if (start.getMonth() === end.getMonth())
      return "Week of " + sm + " " + start.getDate() + "–" + end.getDate() + ", " + end.getFullYear();
    return "Week of " + sm + " " + start.getDate() + " – " + em + " " + end.getDate() + ", " + end.getFullYear();
  }
  var DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // ----- CA OT split (private work, daily-rule primary) -----
  // 7th-consecutive-day rule applied when streak === 7 within the same workweek.
  function splitDay(hours, seventhConsecutive) {
    if (!hours || hours <= 0) return { reg: 0, ot15: 0, ot2: 0 };
    if (seventhConsecutive) {
      return { reg: 0, ot15: Math.min(hours, 8), ot2: Math.max(0, hours - 8) };
    }
    return {
      reg: Math.min(hours, 8),
      ot15: Math.max(0, Math.min(hours, 12) - 8),
      ot2: Math.max(0, hours - 12),
    };
  }

  // ----- IndexedDB -----
  var DB;
  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open("timecard", 1);
      r.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(key) {
    return new Promise(function (res, rej) {
      var rq = DB.transaction("state", "readonly").objectStore("state").get(key);
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbPut(val, key) {
    return new Promise(function (res, rej) {
      var rq = DB.transaction("state", "readwrite").objectStore("state").put(val, key);
      rq.onsuccess = function () { res(); };
      rq.onerror = function () { rej(rq.error); };
    });
  }

  // ----- STATE -----
  var STATE;            // {roster:[], currentEmployeeId, weekStart (ISO), timecards: {key: WeekTimecard}}
  var SAVE_T;
  function blankState() {
    return {
      roster: [],
      currentEmployeeId: "",
      weekStart: iso(weekStart(new Date())),
      timecards: {},          // key = `${employeeId}|${weekStartISO}`
      mode: "employee",
    };
  }
  function scheduleSave() {
    document.getElementById("saveState").textContent = "Saving…";
    clearTimeout(SAVE_T);
    SAVE_T = setTimeout(function () {
      idbPut(STATE, "current").then(function () {
        document.getElementById("saveState").textContent = "Saved";
      });
    }, 350);
  }
  function tcKey(empId, weekISO) { return empId + "|" + weekISO; }
  function getOrInitTimecard() {
    var k = tcKey(STATE.currentEmployeeId, STATE.weekStart);
    if (!STATE.timecards[k]) {
      STATE.timecards[k] = {
        employee_id: STATE.currentEmployeeId,
        week_starting: STATE.weekStart,
        entries: [],
        submitted_at: null, approved_by: null, approved_at: null,
      };
    }
    return STATE.timecards[k];
  }

  // ----- DOM helpers -----
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function fmtHrs(h) { return (Math.round(h * 100) / 100).toFixed(2); }

  // ----- Render: Employee mode -----
  function render() {
    var app = document.getElementById("app");
    app.innerHTML = "";
    document.getElementById("modeEmployee").classList.toggle("active", STATE.mode === "employee");
    document.getElementById("modeEmployee").setAttribute("aria-selected", STATE.mode === "employee");
    document.getElementById("modeForeman").classList.toggle("active", STATE.mode === "foreman");
    document.getElementById("modeForeman").setAttribute("aria-selected", STATE.mode === "foreman");
    if (STATE.mode === "employee") return renderEmployee(app);
    return renderForeman(app);
  }

  function renderEmployee(app) {
    // Roster card (collapsible)
    app.appendChild(rosterCard());

    if (!STATE.roster.length) {
      app.appendChild(el("section", { class: "card" },
        '<h2>Welcome</h2><div class="empty">Add at least one employee in the Roster card above to start entering time.</div>'));
      return;
    }
    if (!STATE.currentEmployeeId) STATE.currentEmployeeId = STATE.roster[0].id;

    app.appendChild(weekNavCard());
    app.appendChild(entriesCard());
    app.appendChild(weekSummaryCard());
    app.appendChild(exportCard());
  }

  function rosterCard() {
    var open = !STATE.roster.length;     // auto-open when empty
    var c = el("section", { class: "card" });
    var head = el("div", { html:
      '<h2 style="display:flex;align-items:center;justify-content:space-between;cursor:pointer">' +
      '<span>Roster <small style="color:#666;font-weight:400">(' + STATE.roster.length + ')</small></span>' +
      '<button type="button" class="ghost" style="font-size:.78rem;padding:.25rem .6rem">' +
      (open ? "Hide" : "Manage") + "</button></h2>" });
    c.appendChild(head);
    var body = el("div");
    if (open) {
      STATE.roster.forEach(function (e, i) {
        var row = el("div", { class: "fld", style: "display:grid;grid-template-columns:1fr 100px 110px 30px;gap:.4rem;align-items:end" });
        row.innerHTML =
          '<label class="fld">Name<input type="text" data-i="' + i + '" data-k="name" value="' + esc(e.name) + '"></label>' +
          '<label class="fld">$/hr<input type="number" min="0" step="0.01" data-i="' + i + '" data-k="base_rate" value="' + (e.base_rate || 0) + '"></label>' +
          '<label class="fld">Default class<select data-i="' + i + '" data-k="default_class">' +
            window.TC_WCIRB.map(function (w) { return '<option value="' + w.code + '"' + (e.default_class === w.code ? " selected" : "") + '>' + esc(w.code + " " + w.title.substring(0, 28)) + '</option>'; }).join("") +
          '</select></label>' +
          '<button type="button" data-i="' + i + '" data-act="rm" class="ghost" style="padding:.3rem">✕</button>';
        body.appendChild(row);
      });
      var add = el("button", { class: "primary", type: "button", style: "margin-top:.5rem" }, "+ Add Employee");
      add.addEventListener("click", function () {
        var nextId = "E" + String(STATE.roster.length + 1).padStart(3, "0");
        STATE.roster.push({ id: nextId, name: "New Employee", base_rate: 35, default_class: window.TC_WCIRB[0].code, active: true });
        scheduleSave(); render();
      });
      body.appendChild(add);
      body.addEventListener("input", function (e) {
        var i = e.target.getAttribute("data-i"), k = e.target.getAttribute("data-k");
        if (i == null || !k) return;
        var v = e.target.value;
        if (k === "base_rate") v = parseFloat(v) || 0;
        STATE.roster[+i][k] = v;
        scheduleSave();
      });
      body.addEventListener("click", function (e) {
        if (e.target.getAttribute("data-act") === "rm") {
          var i = +e.target.getAttribute("data-i");
          if (confirm("Remove " + STATE.roster[i].name + "? Their existing timecards remain on this device.")) {
            STATE.roster.splice(i, 1);
            scheduleSave(); render();
          }
        }
      });
    }
    head.querySelector("h2").addEventListener("click", function () {
      open = !open; render();    // re-render; simple
    });
    c.appendChild(body);
    return c;
  }

  function weekNavCard() {
    var c = el("section", { class: "card" });
    var emp = STATE.roster.find(function (e) { return e.id === STATE.currentEmployeeId; });
    var ws = parseISO(STATE.weekStart);

    var top = el("div", { style: "display:grid;grid-template-columns:1fr;gap:.6rem" });
    var picker = el("label", { class: "fld" }, "Employee");
    var sel = el("select");
    STATE.roster.forEach(function (e) {
      var o = document.createElement("option");
      o.value = e.id; o.textContent = e.name + " ($" + (e.base_rate || 0) + "/hr · " + (e.default_class || "—") + ")";
      if (e.id === STATE.currentEmployeeId) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { STATE.currentEmployeeId = sel.value; scheduleSave(); render(); });
    picker.appendChild(sel);
    top.appendChild(picker);

    var nav = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:.4rem" });
    var prev = el("button", { class: "ghost", type: "button" }, "◀ Prev");
    var lbl = el("strong", { style: "font-size:1rem" }, weekLabel(ws));
    var next = el("button", { class: "ghost", type: "button" }, "Next ▶");
    var today = el("button", { class: "primary", type: "button" }, "Today");
    prev.addEventListener("click", function () { STATE.weekStart = iso(addDays(ws, -7)); scheduleSave(); render(); });
    next.addEventListener("click", function () { STATE.weekStart = iso(addDays(ws, 7)); scheduleSave(); render(); });
    today.addEventListener("click", function () { STATE.weekStart = iso(weekStart(new Date())); scheduleSave(); render(); });
    nav.appendChild(prev); nav.appendChild(lbl); nav.appendChild(next); nav.appendChild(today);
    top.appendChild(nav);
    c.appendChild(top);
    return c;
  }

  function entriesCard() {
    var c = el("section", { class: "card" });
    c.appendChild(el("h2", null, "Time Entries"));
    var tc = getOrInitTimecard();
    var ws = parseISO(STATE.weekStart);
    var inWeek = function (d) { return d >= STATE.weekStart && d <= iso(addDays(ws, 6)); };

    // recent jobs (datalist) — from this and prior week timecards
    var recentJobs = {};
    Object.keys(STATE.timecards).forEach(function (k) {
      (STATE.timecards[k].entries || []).forEach(function (e) { if (e.project) recentJobs[e.project] = true; });
    });
    var dataList = el("datalist", { id: "jobsList" });
    Object.keys(recentJobs).sort().forEach(function (j) {
      dataList.appendChild(el("option", { value: j }));
    });
    c.appendChild(dataList);

    // group entries by date
    var byDate = {};
    tc.entries.forEach(function (e, idx) {
      (byDate[e.date] = byDate[e.date] || []).push({ e: e, idx: idx });
    });
    for (var i = 0; i < 7; i++) {
      var d = addDays(ws, i);
      var diso = iso(d);
      var rows = byDate[diso] || [];
      var dayWrap = el("div", { style: "border-top:1px solid var(--line);padding:.6rem 0" });
      var head = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem" });
      head.appendChild(el("strong", null, DAYS[i] + " " + (d.getMonth() + 1) + "/" + d.getDate()));
      var dayHrs = rows.reduce(function (s, r) { return s + (parseFloat(r.e.hours) || 0); }, 0);
      head.appendChild(el("span", { style: "color:" + (dayHrs > 12 ? "var(--bad)" : dayHrs > 8 ? "var(--warn)" : "#444") },
        fmtHrs(dayHrs) + "h"));
      dayWrap.appendChild(head);
      rows.forEach(function (r) { dayWrap.appendChild(entryRow(r.idx, r.e)); });
      var addBtn = el("button", { class: "ghost", type: "button", style: "margin-top:.3rem;width:100%" }, "+ Add entry for " + DAYS[i]);
      (function (dateISO) {
        addBtn.addEventListener("click", function () { addEntry(dateISO); });
      })(diso);
      dayWrap.appendChild(addBtn);
      c.appendChild(dayWrap);
    }
    return c;
  }

  function entryRow(idx, e) {
    var row = el("div", { style: "background:#fafbfc;border:1px solid var(--line);border-radius:8px;padding:.5rem;margin:.3rem 0;display:grid;grid-template-columns:80px 1fr 80px;gap:.4rem" });
    var hrs = el("input", { type: "number", min: "0", step: "0.25", value: e.hours });
    hrs.addEventListener("input", function () { e.hours = parseFloat(hrs.value) || 0; scheduleSave(); summary(); });
    row.appendChild(wrapField("Hours", hrs));
    var job = el("input", { type: "text", value: e.project || "", list: "jobsList", placeholder: "Job / address" });
    job.addEventListener("input", function () { e.project = job.value; scheduleSave(); });
    row.appendChild(wrapField("Job", job));
    var rm = el("button", { class: "ghost", type: "button", style: "align-self:end;padding:.3rem" }, "✕");
    rm.addEventListener("click", function () {
      var tc = getOrInitTimecard(); tc.entries.splice(idx, 1); scheduleSave(); render();
    });
    row.appendChild(wrapField(" ", rm));
    var second = el("div", { style: "grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:.4rem" });
    var clsSel = el("select");
    window.TC_WCIRB.forEach(function (w) {
      var o = document.createElement("option");
      o.value = w.code; o.textContent = w.code + " — " + w.title;
      if (e.wcirb === w.code) o.selected = true;
      clsSel.appendChild(o);
    });
    clsSel.addEventListener("change", function () { e.wcirb = clsSel.value; scheduleSave(); summary(); });
    second.appendChild(wrapField("WCIRB class", clsSel));
    var desc = el("input", { type: "text", value: e.notes || "", placeholder: "Description (what you worked on)" });
    desc.addEventListener("input", function () { e.notes = desc.value; scheduleSave(); });
    second.appendChild(wrapField("Description", desc));
    row.appendChild(second);
    return row;
  }
  function wrapField(label, input) {
    var w = el("label", { class: "fld", style: "margin:0" }, esc(label));
    w.appendChild(input);
    return w;
  }
  function addEntry(dateISO) {
    var emp = STATE.roster.find(function (e) { return e.id === STATE.currentEmployeeId; });
    var tc = getOrInitTimecard();
    tc.entries.push({ date: dateISO, project: "", hours: 8, wcirb: emp ? emp.default_class : (window.TC_WCIRB[0].code), notes: "" });
    scheduleSave(); render();
  }

  // ----- Weekly summary + OT calc -----
  function computeWeek(tc, rate) {
    // returns {byDate: {date: {hours, reg, ot15, ot2, classes:{code:hours}}}, byClass:{code:{hours,wages}}, totals:{...}}
    var ws = parseISO(tc.week_starting);
    var byDate = {}, dayHours = {};
    for (var i = 0; i < 7; i++) {
      var diso = iso(addDays(ws, i));
      byDate[diso] = { hours: 0, classes: {}, jobs: {} };
      dayHours[diso] = 0;
    }
    tc.entries.forEach(function (e) {
      if (!byDate[e.date]) return;          // outside week
      var h = parseFloat(e.hours) || 0;
      byDate[e.date].hours += h;
      byDate[e.date].classes[e.wcirb] = (byDate[e.date].classes[e.wcirb] || 0) + h;
      if (e.project) byDate[e.date].jobs[e.project] = (byDate[e.date].jobs[e.project] || 0) + h;
      dayHours[e.date] += h;
    });
    // 7th-consecutive-day detection within week
    var streak = 0;
    Object.keys(byDate).sort().forEach(function (d) {
      var hrs = byDate[d].hours;
      streak = hrs > 0 ? streak + 1 : 0;
      var s = splitDay(hrs, streak === 7);
      byDate[d].reg = s.reg; byDate[d].ot15 = s.ot15; byDate[d].ot2 = s.ot2;
      // wages = (reg + ot15*1.5 + ot2*2) * rate ; allocate proportionally per class on that day
      var dayPay = (s.reg + s.ot15 * 1.5 + s.ot2 * 2) * (rate || 0);
      byDate[d].pay = dayPay;
    });
    // by WCIRB class
    var byClass = {};
    Object.keys(byDate).forEach(function (d) {
      var dh = byDate[d].hours;
      if (!dh) return;
      Object.keys(byDate[d].classes).forEach(function (c) {
        var ch = byDate[d].classes[c];
        var share = ch / dh;
        byClass[c] = byClass[c] || { hours: 0, wages: 0 };
        byClass[c].hours += ch;
        byClass[c].wages += byDate[d].pay * share;
      });
    });
    var totals = { hours: 0, reg: 0, ot15: 0, ot2: 0, wages: 0 };
    Object.keys(byDate).forEach(function (d) {
      totals.hours += byDate[d].hours;
      totals.reg += byDate[d].reg || 0;
      totals.ot15 += byDate[d].ot15 || 0;
      totals.ot2 += byDate[d].ot2 || 0;
      totals.wages += byDate[d].pay || 0;
    });
    return { byDate: byDate, byClass: byClass, totals: totals };
  }

  function weekSummaryCard() {
    var c = el("section", { class: "card", id: "summaryCard" });
    c.appendChild(el("h2", null, "Week Summary"));
    summary(c);
    return c;
  }
  function summary(container) {
    var c = container || document.getElementById("summaryCard");
    if (!c) return;
    // wipe non-h2 children
    Array.prototype.slice.call(c.children).forEach(function (k) { if (k.tagName !== "H2") c.removeChild(k); });
    var tc = getOrInitTimecard();
    var emp = STATE.roster.find(function (e) { return e.id === STATE.currentEmployeeId; });
    var rate = emp ? (emp.base_rate || 0) : 0;
    var r = computeWeek(tc, rate);
    var t = r.totals;
    var tot = el("div", { style: "display:grid;grid-template-columns:repeat(4,1fr);gap:.4rem;margin-bottom:.6rem" });
    tot.appendChild(stat("Total hrs", fmtHrs(t.hours)));
    tot.appendChild(stat("Reg", fmtHrs(t.reg)));
    tot.appendChild(stat("1.5×", fmtHrs(t.ot15)));
    tot.appendChild(stat("2×", fmtHrs(t.ot2)));
    c.appendChild(tot);
    c.appendChild(el("div", { style: "font-size:.86rem;color:#444;margin-bottom:.5rem" },
      "Est. wages @ $" + (rate || 0).toFixed(2) + "/hr: <strong>$" + (t.wages || 0).toFixed(2) + "</strong>"));
    // per-class table
    var cls = Object.keys(r.byClass);
    if (cls.length) {
      var tbl = el("table", { style: "width:100%;border-collapse:collapse;font-size:.86rem" });
      tbl.innerHTML = "<tr style='text-align:left;background:var(--chip)'><th style='padding:.3rem'>WCIRB</th><th>Class</th><th style='text-align:right'>Hours</th><th style='text-align:right'>Est. wages</th></tr>";
      cls.sort().forEach(function (k) {
        var w = window.TC_WCIRB.find(function (x) { return x.code === k; });
        var tr = el("tr", { style: "border-top:1px solid var(--line)" });
        tr.innerHTML = "<td style='padding:.3rem;font-weight:600'>" + esc(k) + "</td>" +
          "<td style='padding:.3rem'>" + esc(w ? w.title : "(unknown)") + "</td>" +
          "<td style='padding:.3rem;text-align:right'>" + fmtHrs(r.byClass[k].hours) + "</td>" +
          "<td style='padding:.3rem;text-align:right'>$" + r.byClass[k].wages.toFixed(2) + "</td>";
        tbl.appendChild(tr);
      });
      c.appendChild(tbl);
    }
  }
  function stat(label, val) {
    var d = el("div", { style: "background:var(--chip);border-radius:8px;padding:.4rem;text-align:center" });
    d.innerHTML = "<div style='font-size:.7rem;color:#555'>" + esc(label) + "</div><div style='font-size:1rem;font-weight:700;color:var(--navy)'>" + esc(val) + "</div>";
    return d;
  }

  // ----- Export to .xlsx (SheetJS) -----
  function exportCard() {
    var c = el("section", { class: "card" });
    c.appendChild(el("h2", null, "Export"));
    var btn = el("button", { class: "primary", type: "button" }, "Export this week as .xlsx");
    btn.addEventListener("click", exportWeek);
    c.appendChild(btn);
    c.appendChild(el("div", { class: "empty", style: "margin-top:.5rem" },
      "Generates a per-employee timecard workbook (saved to your phone). Send the file to your foreman; they import it in Foreman mode to consolidate."));
    return c;
  }

  function exportWeek() {
    if (!window.XLSX) { alert("xlsx engine missing — reload while online."); return; }
    var emp = STATE.roster.find(function (e) { return e.id === STATE.currentEmployeeId; });
    if (!emp) { alert("Pick an employee first."); return; }
    var tc = getOrInitTimecard();
    tc.submitted_at = new Date().toISOString();
    var r = computeWeek(tc, emp.base_rate || 0);
    var ws = parseISO(STATE.weekStart);

    // Tab 1 — Timecard (daily entries)
    var rows1 = [
      ["Timecard"],
      ["Employee", emp.name, "ID", emp.id, "Rate/hr", emp.base_rate || 0],
      ["Week starting", STATE.weekStart, "(Mon–Sun)"],
      ["Submitted", tc.submitted_at],
      [],
      ["Date", "Day", "Job", "WCIRB", "Hours", "Description"],
    ];
    for (var i = 0; i < 7; i++) {
      var diso = iso(addDays(ws, i));
      var dayEntries = tc.entries.filter(function (e) { return e.date === diso; });
      if (!dayEntries.length) {
        rows1.push([diso, DAYS[i], "", "", 0, ""]);
      } else {
        dayEntries.forEach(function (e) {
          rows1.push([diso, DAYS[i], e.project || "", e.wcirb, parseFloat(e.hours) || 0, e.notes || ""]);
        });
      }
      var d = r.byDate[diso];
      rows1.push(["", DAYS[i] + " total", "", "", d.hours,
        "Reg " + fmtHrs(d.reg) + " | 1.5x " + fmtHrs(d.ot15) + " | 2x " + fmtHrs(d.ot2)]);
    }
    rows1.push([]);
    rows1.push(["", "WEEK TOTAL", "", "", r.totals.hours,
      "Reg " + fmtHrs(r.totals.reg) + " | 1.5x " + fmtHrs(r.totals.ot15) + " | 2x " + fmtHrs(r.totals.ot2)]);
    rows1.push(["", "Est. wages", "", "", "", "$" + r.totals.wages.toFixed(2)]);
    rows1.push([]);
    rows1.push(["Employee signature: _______________________  Date: __________"]);
    rows1.push(["Foreman approval:   _______________________  Date: __________"]);
    var s1 = XLSX.utils.aoa_to_sheet(rows1);
    s1["!cols"] = [{ wch: 11 }, { wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 8 }, { wch: 40 }];

    // Tab 2 — Class summary (State Fund payload axis)
    var rows2 = [["WCIRB Class Summary — for State Fund reporting"],
      ["Employee", emp.name, "ID", emp.id], ["Week starting", STATE.weekStart], [],
      ["WCIRB", "Classification", "Hours", "Est. wages"]];
    Object.keys(r.byClass).sort().forEach(function (k) {
      var w = window.TC_WCIRB.find(function (x) { return x.code === k; });
      rows2.push([k, w ? w.title : "(unknown)", r.byClass[k].hours, r.byClass[k].wages]);
    });
    rows2.push([]);
    rows2.push(["", "TOTAL", r.totals.hours, r.totals.wages]);
    var s2 = XLSX.utils.aoa_to_sheet(rows2);
    s2["!cols"] = [{ wch: 10 }, { wch: 44 }, { wch: 10 }, { wch: 14 }];

    // Tab 3 — Foreman re-import payload (JSON; small, structured)
    var payload = {
      v: 1, employee: { id: emp.id, name: emp.name, base_rate: emp.base_rate, default_class: emp.default_class },
      week_starting: STATE.weekStart, entries: tc.entries, submitted_at: tc.submitted_at,
    };
    var s3 = XLSX.utils.aoa_to_sheet([["__TIMECARD_JSON__"], [JSON.stringify(payload)]]);

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, s1, "Timecard");
    XLSX.utils.book_append_sheet(wb, s2, "WCIRB Summary");
    XLSX.utils.book_append_sheet(wb, s3, "_data");
    var fname = "Timecard_" + emp.name.replace(/\s+/g, "_") + "_W" + STATE.weekStart + ".xlsx";
    XLSX.writeFile(wb, fname);
    scheduleSave();
  }

  // ----- Foreman mode (v1 placeholder) -----
  function renderForeman(app) {
    var c = el("section", { class: "card" });
    c.innerHTML =
      '<h2>Foreman Mode</h2>' +
      '<div class="empty">Coming next: drop the .xlsx timecards your employees send, ' +
      'review/edit/approve, then export the consolidated State Fund WCIRB summary ' +
      'and payroll workbook. For now use Employee mode on each phone.</div>';
    app.appendChild(c);
  }

  // ----- Boot + wire -----
  function wire() {
    document.getElementById("modeEmployee").addEventListener("click", function () {
      STATE.mode = "employee"; scheduleSave(); render();
    });
    document.getElementById("modeForeman").addEventListener("click", function () {
      STATE.mode = "foreman"; scheduleSave(); render();
    });
  }
  openDB().then(function (db) { DB = db; return idbGet("current"); })
    .then(function (saved) {
      STATE = saved || blankState();
      // ensure weekStart is a Monday
      STATE.weekStart = iso(weekStart(parseISO(STATE.weekStart)));
      wire(); render(); idbPut(STATE, "current");
    })
    .catch(function (e) {
      document.getElementById("app").innerHTML =
        "<section class='card'>Storage unavailable: " + esc(e && e.message) + "</section>";
    });
})();
