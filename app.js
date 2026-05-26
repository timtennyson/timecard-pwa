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
    if (!STATE.roster.length) return renderEmployeeSetup(app);
    var have = STATE.roster.find(function (e) { return e.id === STATE.currentEmployeeId; });
    if (!have) return renderEmployeePicker(app);
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

    // Pinned-user header (read-only on this device). Switch requires confirm.
    var who = el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:.4rem;margin-bottom:.5rem;padding:.45rem .6rem;background:var(--chip);border-radius:6px" });
    who.innerHTML = "<div><strong>" + esc(emp ? emp.name : "(unknown)") +
      "</strong> <small style='color:#555'>$" +
      (parseFloat(emp && emp.base_rate) || 0).toFixed(2) + "/hr · " +
      esc((emp && emp.default_class) || "—") + "</small></div>";
    var sw = el("button", { class: "ghost", type: "button", style: "font-size:.78rem;padding:.2rem .55rem" }, "Switch user");
    sw.addEventListener("click", function () {
      if (!confirm("Switch this phone's user? You'll pick yourself from the roster again. Your existing weeks stay on the device.")) return;
      STATE.currentEmployeeId = ""; scheduleSave(); render();
    });
    who.appendChild(sw);
    c.appendChild(who);

    var nav = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:.4rem;flex-wrap:wrap" });
    var prev = el("button", { class: "ghost", type: "button" }, "◀ Prev");
    var lbl = el("strong", { style: "font-size:1rem" }, weekLabel(ws));
    var next = el("button", { class: "ghost", type: "button" }, "Next ▶");
    var today = el("button", { class: "primary", type: "button" }, "Today");
    prev.addEventListener("click", function () { STATE.weekStart = iso(addDays(ws, -7)); scheduleSave(); render(); });
    next.addEventListener("click", function () { STATE.weekStart = iso(addDays(ws, 7)); scheduleSave(); render(); });
    today.addEventListener("click", function () { STATE.weekStart = iso(weekStart(new Date())); scheduleSave(); render(); });
    nav.appendChild(prev); nav.appendChild(lbl); nav.appendChild(next); nav.appendChild(today);
    c.appendChild(nav);
    return c;
  }

  // ----- Employee mode setup helpers -----
  function renderEmployeeSetup(app) {
    var c = el("section", { class: "card" });
    c.innerHTML = "<h2>Welcome — set up this phone</h2>" +
      '<div class="empty" style="margin-bottom:.6rem">Either import the roster file your foreman shared, or enter your own info manually.</div>';
    var impWrap = el("div", { style: "border:1px solid var(--line);border-radius:8px;padding:.6rem;margin-bottom:.6rem" });
    impWrap.innerHTML = "<strong>I have a roster file from my foreman</strong>";
    var fi = el("input", { type: "file", accept: ".json,application/json" });
    fi.style.marginTop = ".5rem"; fi.style.display = "block";
    fi.addEventListener("change", function () {
      var f = fi.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var arr = JSON.parse(fr.result);
          if (!Array.isArray(arr)) throw new Error("Not a roster file");
          STATE.roster = arr; scheduleSave(); render();
        } catch (err) { alert("Couldn't read roster: " + (err.message || err)); }
      };
      fr.readAsText(f);
    });
    impWrap.appendChild(fi);
    c.appendChild(impWrap);

    var man = el("div", { style: "border:1px solid var(--line);border-radius:8px;padding:.6rem" });
    man.innerHTML = "<strong>Or enter my info manually</strong>";
    var nameI = el("input", { type: "text", placeholder: "Your name" });
    var rateI = el("input", { type: "number", min: "0", step: "0.01", placeholder: "$/hr" });
    var clsSel = el("select");
    window.TC_WCIRB.forEach(function (w) {
      var o = document.createElement("option");
      o.value = w.code; o.textContent = w.code + " — " + w.title;
      clsSel.appendChild(o);
    });
    [nameI, rateI, clsSel].forEach(function (n) { n.style.marginTop = ".4rem"; });
    var save = el("button", { class: "primary", type: "button", style: "margin-top:.5rem" }, "Save & start");
    save.addEventListener("click", function () {
      var name = nameI.value.trim();
      if (!name) { alert("Enter your name."); return; }
      var id = "E" + String(Date.now()).slice(-6);
      STATE.roster = [{ id: id, name: name, base_rate: parseFloat(rateI.value) || 0,
                        default_class: clsSel.value, active: true }];
      STATE.currentEmployeeId = id;
      scheduleSave(); render();
    });
    man.appendChild(nameI); man.appendChild(rateI); man.appendChild(clsSel); man.appendChild(save);
    c.appendChild(man);
    app.appendChild(c);
  }

  function renderEmployeePicker(app) {
    var c = el("section", { class: "card" });
    c.innerHTML = "<h2>Which one are you?</h2>" +
      '<div class="empty" style="margin-bottom:.5rem">Tap your name. Set once per device.</div>';
    STATE.roster.forEach(function (e) {
      var b = el("button", { class: "ghost", type: "button",
        style: "display:block;width:100%;text-align:left;margin:.25rem 0;padding:.6rem" });
      b.innerHTML = "<strong>" + esc(e.name) + "</strong>  <small style='color:#555'>$" +
        (parseFloat(e.base_rate) || 0).toFixed(2) + "/hr · " + esc(e.default_class || "—") + "</small>";
      b.addEventListener("click", function () {
        STATE.currentEmployeeId = e.id; scheduleSave(); render();
      });
      c.appendChild(b);
    });
    app.appendChild(c);
  }

  // Foreman roster export/import — share roster.json with all employees.
  function rosterShareCard() {
    var c = el("section", { class: "card" });
    c.innerHTML = "<h2>Roster file</h2>" +
      '<div class="empty" style="margin-bottom:.5rem">Export once everyone\'s set up, then send the file to each employee\'s phone for a one-time import. (Or use the manual setup on each phone.)</div>';
    var bar = el("div", { style: "display:flex;gap:.4rem;flex-wrap:wrap;align-items:center" });
    var exp = el("button", { class: "primary", type: "button" }, "Export roster.json");
    exp.addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(STATE.roster, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "roster.json";
      document.body.appendChild(a); a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 800);
    });
    bar.appendChild(exp);
    var lbl = el("label", { style: "display:inline-block;padding:.45rem .8rem;border-radius:6px;cursor:pointer;border:1px solid var(--navy);color:var(--navy);font-weight:600" }, "Import roster.json");
    var fi = el("input", { type: "file", accept: ".json,application/json" });
    fi.style.display = "none";
    fi.addEventListener("change", function () {
      var f = fi.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var arr = JSON.parse(fr.result);
          if (!Array.isArray(arr)) throw new Error("Not a roster file");
          if (!confirm("Replace current roster with " + arr.length + " imported entries?")) return;
          STATE.roster = arr; scheduleSave(); render();
        } catch (err) { alert("Couldn't read: " + (err.message || err)); }
      };
      fr.readAsText(f);
      fi.value = "";
    });
    lbl.appendChild(fi);
    bar.appendChild(lbl);
    c.appendChild(bar);
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
    clsSel.addEventListener("change", function () {
      e.wcirb = clsSel.value; e.manualClass = true;
      scheduleSave(); summary(); refreshHint();
    });
    second.appendChild(wrapField("WCIRB class", clsSel));
    var desc = el("input", { type: "text", value: e.notes || "",
      placeholder: "Describe the work — auto-classifies from words like 'framing', 'paint', 'sewer'" });
    desc.addEventListener("input", function () {
      e.notes = desc.value;
      if (!e.manualClass) {
        var m = window.TC_classify(desc.value);
        if (m && m.code !== e.wcirb) { e.wcirb = m.code; clsSel.value = m.code; summary(); }
      }
      scheduleSave(); refreshHint();
    });
    second.appendChild(wrapField("Description", desc));
    row.appendChild(second);

    // Offline keyword auto-classifier hint (no API; runs locally).
    var hint = el("div", { style: "grid-column:1/-1;font-size:.72rem;color:#666;min-height:1.1em" });
    row.appendChild(hint);
    function refreshHint() {
      if (e.manualClass) { hint.innerHTML = '<span style="color:#888">↳ class set manually — change dropdown to re-enable auto</span>'; return; }
      var m = window.TC_classify(e.notes);
      if (!m) { hint.textContent = ""; return; }
      if (m.code === e.wcirb) {
        hint.innerHTML = "↳ auto-classified <strong>" + esc(m.code) + "</strong> from description";
      } else {
        var w = window.TC_WCIRB.find(function (x) { return x.code === m.code; });
        hint.innerHTML = '↳ suggested: <a href="#" style="color:var(--navy)">' +
          esc(m.code) + " — " + esc((w && w.title) ? w.title.substring(0, 36) : "") + "</a>";
        var lk = hint.querySelector("a");
        lk.addEventListener("click", function (ev) {
          ev.preventDefault();
          e.wcirb = m.code; clsSel.value = m.code; e.manualClass = false;
          scheduleSave(); summary(); refreshHint();
        });
      }
    }
    refreshHint();
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

  // ----- Foreman access gate (client-side passcode; soft control) -----
  // SHA-256 hash of the passcode stored in IndexedDB on the foreman's device.
  // FOREMAN_UNLOCKED is session-only — locks again on reload / Lock button.
  // This is the right model for THIS threat: employees only have their own
  // data on their own devices anyway; the gate prevents accidental entry into
  // Foreman mode on the foreman's device. A motivated attacker with devtools
  // on the foreman's phone could bypass the gate — there's no defense against
  // that without a backend. The .xlsx files traveling between devices are the
  // real trust boundary; keep them on secure channels.
  var FOREMAN_UNLOCKED = false;
  function hashPasscode(p) {
    var enc = new TextEncoder().encode(String(p || ""));
    return crypto.subtle.digest("SHA-256", enc).then(function (buf) {
      return Array.from(new Uint8Array(buf))
        .map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  }
  function renderForemanSetup(app) {
    var c = el("section", { class: "card" });
    c.innerHTML = "<h2>Foreman setup — set a passcode</h2>" +
      '<div class="empty" style="margin-bottom:.6rem">First-time setup on this device. Pick a passcode (≥4 chars). Only the foreman uses this tab — employees should use the <strong>Employee</strong> tab.</div>';
    var p1 = el("input", { type: "password", placeholder: "New passcode", autocomplete: "new-password" });
    var p2 = el("input", { type: "password", placeholder: "Confirm passcode", autocomplete: "new-password" });
    p1.style.marginBottom = ".3rem"; p2.style.marginBottom = ".3rem";
    var btn = el("button", { class: "primary", type: "button" }, "Set passcode");
    var msg = el("div", { style: "color:var(--bad);font-size:.85rem;margin-top:.4rem" });
    c.appendChild(p1); c.appendChild(p2); c.appendChild(btn); c.appendChild(msg);
    btn.addEventListener("click", function () {
      if (p1.value.length < 4) { msg.textContent = "At least 4 characters."; return; }
      if (p1.value !== p2.value) { msg.textContent = "Passcodes do not match."; return; }
      hashPasscode(p1.value).then(function (h) {
        STATE.foremanPasscodeHash = h; scheduleSave();
        FOREMAN_UNLOCKED = true; render();
      });
    });
    app.appendChild(c);
  }
  function renderForemanLock(app) {
    var c = el("section", { class: "card" });
    c.innerHTML = "<h2>Foreman access</h2>" +
      '<div class="empty" style="margin-bottom:.6rem">Enter the foreman passcode to review and export employee timecards.</div>';
    var p = el("input", { type: "password", placeholder: "Passcode", autocomplete: "current-password" });
    p.style.marginBottom = ".3rem";
    var btn = el("button", { class: "primary", type: "button" }, "Unlock");
    var reset = el("button", { class: "ghost", type: "button", style: "margin-left:.4rem" }, "Forgot / reset");
    var msg = el("div", { style: "color:var(--bad);font-size:.85rem;margin-top:.4rem" });
    c.appendChild(p); c.appendChild(btn); c.appendChild(reset); c.appendChild(msg);
    function tryUnlock() {
      hashPasscode(p.value).then(function (h) {
        if (h === STATE.foremanPasscodeHash) { FOREMAN_UNLOCKED = true; render(); }
        else msg.textContent = "Wrong passcode.";
      });
    }
    btn.addEventListener("click", tryUnlock);
    p.addEventListener("keydown", function (e) { if (e.key === "Enter") tryUnlock(); });
    reset.addEventListener("click", function () {
      if (!confirm("Reset foreman access on THIS device? This wipes the passcode and any imported employee timecards loaded here. Employees' own data on their devices is unaffected.")) return;
      STATE.foremanPasscodeHash = null;
      if (STATE.foreman) STATE.foreman.loaded = {};
      FOREMAN_UNLOCKED = false; scheduleSave(); render();
    });
    app.appendChild(c);
  }
  // ----- Foreman mode -----
  // Drop employee .xlsx exports here; pulls the JSON payload from the `_data`
  // tab of each, lets the foreman review/edit/approve, and exports a single
  // consolidated workbook (WCIRB Summary + Payroll + Detail).
  function renderForeman(app) {
    if (!STATE.foremanPasscodeHash) return renderForemanSetup(app);
    if (!FOREMAN_UNLOCKED) return renderForemanLock(app);

    // Roster CRUD (foreman is the authority on who's on the crew + rates).
    app.appendChild(rosterCard());
    app.appendChild(rosterShareCard());

    // Import section with Lock button so foreman can re-lock the tab.
    var imp = el("section", { class: "card" });
    var hdr = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem;flex-wrap:wrap;gap:.4rem" });
    var ttl = el("h2", { style: "margin:0" }, "Import timecards"); hdr.appendChild(ttl);
    var lockBtn = el("button", { class: "ghost", type: "button" }, "🔒 Lock");
    lockBtn.addEventListener("click", function () { FOREMAN_UNLOCKED = false; render(); });
    hdr.appendChild(lockBtn);
    imp.appendChild(hdr);
    imp.appendChild(importZone());
    app.appendChild(imp);

    var loaded = (STATE.foreman && STATE.foreman.loaded) || {};
    var keys = Object.keys(loaded);
    if (!keys.length) {
      app.appendChild(el("section", { class: "card", html:
        '<div class="empty">No timecards loaded yet. Drop the <strong>.xlsx</strong> ' +
        'files your employees send (or tap to pick) and they\'ll appear here for review.</div>' }));
      return;
    }
    // group by week (most recent first)
    var byWeek = {};
    keys.forEach(function (k) {
      var w = loaded[k].week_starting;
      (byWeek[w] = byWeek[w] || []).push(k);
    });
    Object.keys(byWeek).sort().reverse().forEach(function (w) {
      var card = el("section", { class: "card" });
      card.appendChild(el("h2", null, "Week of " + w));
      byWeek[w].sort(function (a, b) {
        return loaded[a].employee.name < loaded[b].employee.name ? -1 : 1;
      }).forEach(function (k) { card.appendChild(foremanTimecardRow(k, loaded[k])); });
      app.appendChild(card);
    });
    // export consolidated
    var ex = el("section", { class: "card" });
    ex.appendChild(el("h2", null, "Export consolidated"));
    var approvedCount = keys.filter(function (k) { return loaded[k].approved; }).length;
    ex.appendChild(el("div", { class: "empty", style: "margin-bottom:.6rem" },
      keys.length + " timecard(s) loaded — " + approvedCount + " approved."));
    var btn = el("button", { class: "primary", type: "button" },
      "Export consolidated workbook (.xlsx)");
    btn.addEventListener("click", exportConsolidated);
    ex.appendChild(btn);
    ex.appendChild(el("div", { class: "empty", style: "margin-top:.5rem" },
      "Produces: WCIRB Class Summary (State Fund) · Payroll by employee/week · Timecard Detail (audit)."));
    app.appendChild(ex);
  }

  function importZone() {
    var z = el("div", { style: "border:2px dashed var(--line);border-radius:10px;padding:1rem;text-align:center;background:#fafbfc" });
    z.innerHTML = '<div style="margin-bottom:.5rem">📥 <strong>Drop employee timecard .xlsx files here</strong>, or pick:</div>';
    var inp = el("input", { type: "file", accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", multiple: "" });
    z.appendChild(inp);
    inp.addEventListener("change", function () {
      Array.prototype.slice.call(inp.files).forEach(importXlsx);
      inp.value = "";
    });
    z.addEventListener("dragover", function (e) { e.preventDefault(); z.style.background = "#eaf1ff"; });
    z.addEventListener("dragleave", function () { z.style.background = "#fafbfc"; });
    z.addEventListener("drop", function (e) {
      e.preventDefault(); z.style.background = "#fafbfc";
      Array.prototype.slice.call(e.dataTransfer.files).forEach(importXlsx);
    });
    return z;
  }

  function importXlsx(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(fr.result), { type: "array" });
        var ws = wb.Sheets["_data"];
        if (!ws) { alert("Not a timecard file (missing _data tab): " + file.name); return; }
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        var jsonStr = rows[1] && rows[1][0];
        var payload = JSON.parse(jsonStr);
        var key = payload.employee.id + "|" + payload.week_starting;
        STATE.foreman = STATE.foreman || { loaded: {} };
        STATE.foreman.loaded[key] = {
          employee: payload.employee,
          week_starting: payload.week_starting,
          entries: payload.entries || [],
          submitted_at: payload.submitted_at,
          approved: false, approved_by: "", approved_at: null,
          source_file: file.name,
        };
        scheduleSave(); render();
      } catch (err) {
        alert("Failed to read " + file.name + ": " + (err && err.message || err));
      }
    };
    fr.readAsArrayBuffer(file);
  }

  function foremanTimecardRow(key, tc) {
    var rate = (tc.employee && tc.employee.base_rate) || 0;
    var r = computeWeek({ week_starting: tc.week_starting, entries: tc.entries }, rate);
    var row = el("div", { style: "border:1px solid var(--line);border-radius:8px;padding:.6rem;margin:.4rem 0;background:#fff" });
    var head = el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.5rem" });
    var info = el("div", { style: "flex:1;min-width:200px" });
    info.innerHTML =
      "<strong>" + esc(tc.employee.name) + "</strong> " +
      "<small style='color:#666'>$" + (rate || 0).toFixed(2) + "/hr · default " + esc(tc.employee.default_class || "—") + "</small>" +
      "<div style='font-size:.86rem;color:#444'>Hours: <strong>" + fmtHrs(r.totals.hours) +
      "</strong> (Reg " + fmtHrs(r.totals.reg) + " / 1.5× " + fmtHrs(r.totals.ot15) +
      " / 2× " + fmtHrs(r.totals.ot2) + ") · Est. wages <strong>$" +
      r.totals.wages.toFixed(2) + "</strong></div>" +
      "<small style='color:#777'>" + esc(tc.source_file || "") + "</small>";
    head.appendChild(info);
    var actions = el("div", { style: "display:flex;gap:.3rem;align-items:center" });
    var detailBtn = el("button", { class: "ghost", type: "button" }, "Edit entries");
    var apprBtn = el("button", { class: tc.approved ? "primary" : "ghost", type: "button" },
      tc.approved ? "✓ Approved" : "Approve");
    apprBtn.addEventListener("click", function () {
      tc.approved = !tc.approved;
      tc.approved_at = tc.approved ? new Date().toISOString() : null;
      scheduleSave(); render();
    });
    var rmBtn = el("button", { class: "ghost", type: "button" }, "✕");
    rmBtn.addEventListener("click", function () {
      if (confirm("Remove " + tc.employee.name + " week " + tc.week_starting + " from this consolidation?")) {
        delete STATE.foreman.loaded[key]; scheduleSave(); render();
      }
    });
    actions.appendChild(detailBtn); actions.appendChild(apprBtn); actions.appendChild(rmBtn);
    head.appendChild(actions);
    row.appendChild(head);

    var detail = el("div", { style: "display:none;margin-top:.5rem;border-top:1px solid var(--line);padding-top:.5rem" });
    tc.entries.forEach(function (e, idx) {
      var er = el("div", {
        style: "display:grid;grid-template-columns:120px 70px 1fr 90px 26px;gap:.3rem;margin:.2rem 0;align-items:center;font-size:.85rem"
      });
      var dateIn = el("input", { type: "date", value: e.date });
      dateIn.addEventListener("input", function () { e.date = dateIn.value; scheduleSave(); render(); });
      er.appendChild(dateIn);
      var hrs = el("input", { type: "number", min: "0", step: "0.25", value: e.hours });
      hrs.addEventListener("input", function () { e.hours = parseFloat(hrs.value) || 0; scheduleSave(); render(); });
      er.appendChild(hrs);
      var desc = el("input", { type: "text", value: e.notes || "", placeholder: "Description / job: " + (e.project || "") });
      desc.addEventListener("input", function () { e.notes = desc.value; scheduleSave(); });
      er.appendChild(desc);
      var sel = el("select");
      window.TC_WCIRB.forEach(function (w) {
        var o = document.createElement("option");
        o.value = w.code; o.textContent = w.code;
        if (e.wcirb === w.code) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function () { e.wcirb = sel.value; scheduleSave(); render(); });
      er.appendChild(sel);
      var rm = el("button", { class: "ghost", type: "button", style: "padding:.2rem" }, "✕");
      rm.addEventListener("click", function () { tc.entries.splice(idx, 1); scheduleSave(); render(); });
      er.appendChild(rm);
      detail.appendChild(er);
    });
    row.appendChild(detail);
    detailBtn.addEventListener("click", function () {
      var open = detail.style.display !== "none";
      detail.style.display = open ? "none" : "block";
      detailBtn.textContent = open ? "Edit entries" : "Collapse";
    });
    return row;
  }

  function exportConsolidated() {
    if (!window.XLSX) { alert("xlsx engine missing — reload while online."); return; }
    var loaded = (STATE.foreman && STATE.foreman.loaded) || {};
    var keys = Object.keys(loaded);
    if (!keys.length) { alert("No timecards loaded."); return; }
    var byClass = {}, perEW = [], detail = [];
    keys.forEach(function (k) {
      var tc = loaded[k];
      var rate = (tc.employee && tc.employee.base_rate) || 0;
      var r = computeWeek({ week_starting: tc.week_starting, entries: tc.entries }, rate);
      perEW.push({
        name: tc.employee.name, id: tc.employee.id, rate: rate, week: tc.week_starting,
        hours: r.totals.hours, reg: r.totals.reg, ot15: r.totals.ot15, ot2: r.totals.ot2,
        reg_pay: r.totals.reg * rate, ot15_pay: r.totals.ot15 * 1.5 * rate,
        ot2_pay: r.totals.ot2 * 2 * rate, total: r.totals.wages,
        approved: tc.approved ? "YES" : "no",
      });
      Object.keys(r.byClass).forEach(function (c) {
        byClass[c] = byClass[c] || { hours: 0, wages: 0 };
        byClass[c].hours += r.byClass[c].hours;
        byClass[c].wages += r.byClass[c].wages;
      });
      (tc.entries || []).forEach(function (e) {
        detail.push({
          date: e.date, employee: tc.employee.name, eid: tc.employee.id,
          job: e.project || "", wcirb: e.wcirb,
          hours: parseFloat(e.hours) || 0, description: e.notes || "",
        });
      });
    });

    // ----- Tab 1: WCIRB Class Summary -----
    var rows1 = [
      ["WCIRB Class Summary — Consolidated (for State Fund reporting)"],
      ["Generated", new Date().toISOString()],
      ["Timecards", keys.length, "Approved", perEW.filter(function (p) { return p.approved === "YES"; }).length],
      [],
      ["WCIRB", "Classification", "Hours", "Est. wages"],
    ];
    var totH = 0, totW = 0;
    Object.keys(byClass).sort().forEach(function (c) {
      var w = window.TC_WCIRB.find(function (x) { return x.code === c; });
      rows1.push([c, w ? w.title : "(unknown)", byClass[c].hours, byClass[c].wages]);
      totH += byClass[c].hours; totW += byClass[c].wages;
    });
    rows1.push([]);
    rows1.push(["", "TOTAL", totH, totW]);
    var s1 = XLSX.utils.aoa_to_sheet(rows1);
    s1["!cols"] = [{ wch: 10 }, { wch: 50 }, { wch: 10 }, { wch: 14 }];

    // ----- Tab 2: Payroll -----
    var rows2 = [
      ["Payroll — Consolidated"],
      ["Generated", new Date().toISOString()],
      [],
      ["Employee", "ID", "Week", "Rate", "Total hrs", "Reg hrs", "1.5× hrs", "2× hrs",
       "Reg pay", "1.5× pay", "2× pay", "Total wages", "Approved"],
    ];
    perEW.sort(function (a, b) {
      return a.week === b.week ? (a.name < b.name ? -1 : 1) : (a.week < b.week ? -1 : 1);
    }).forEach(function (p) {
      rows2.push([p.name, p.id, p.week, p.rate, p.hours, p.reg, p.ot15, p.ot2,
                  p.reg_pay, p.ot15_pay, p.ot2_pay, p.total, p.approved]);
    });
    var s2 = XLSX.utils.aoa_to_sheet(rows2);
    s2["!cols"] = [{ wch: 24 }, { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 10 },
                   { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 12 }, { wch: 12 },
                   { wch: 12 }, { wch: 12 }, { wch: 10 }];

    // ----- Tab 3: Timecard Detail -----
    var rows3 = [
      ["Timecard Detail — All Entries"], [],
      ["Date", "Employee", "Employee ID", "Job", "WCIRB", "Hours", "Description"],
    ];
    detail.sort(function (a, b) {
      return a.date === b.date ? (a.employee < b.employee ? -1 : 1) : (a.date < b.date ? -1 : 1);
    }).forEach(function (e) {
      rows3.push([e.date, e.employee, e.eid, e.job, e.wcirb, e.hours, e.description]);
    });
    var s3 = XLSX.utils.aoa_to_sheet(rows3);
    s3["!cols"] = [{ wch: 11 }, { wch: 24 }, { wch: 8 }, { wch: 22 },
                   { wch: 10 }, { wch: 8 }, { wch: 40 }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, s1, "WCIRB Summary");
    XLSX.utils.book_append_sheet(wb, s2, "Payroll");
    XLSX.utils.book_append_sheet(wb, s3, "Timecard Detail");
    XLSX.writeFile(wb, "Consolidated_Timecards_" + iso(new Date()) + ".xlsx");
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
