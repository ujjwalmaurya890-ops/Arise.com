// jsdom smoke test for the v202 additions to cse-syllabus-unified-widget.js:
// detail drawer (difficulty / exam date / revision / units / study-time log),
// Revision tab, add/delete custom subject, bulk done/pending, sort,
// XP-once wiring, Exam Tracker date fallback, search keeps focus.
//
// Run with: node tests/test-syllabus-unified-features.js
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const BASE = path.join(path.resolve(__dirname, ".."), "src", "features", "semester-risk");
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error("FAIL: " + m); } }
function eq(a, b, m) { ok(a === b, m + " (got " + JSON.stringify(a) + ", expected " + JSON.stringify(b) + ")"); }

function freshDom(seed) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="sem-1"></div></body></html>`,
    { url: "https://example.test/", runScripts: "dangerously", pretendToBeVisual: true });
  const { window } = dom;
  const store = Object.assign({}, seed || {});
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  } });
  let xpCalls = [];
  window.__XP_ENGINE__ = { syllabusXP: (s) => xpCalls.push(s.id) };
  window.confirm = () => true;
  window.alert = () => {};
  window.eval(fs.readFileSync(path.join(BASE, "cse-full-syllabus-config.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(BASE, "cse-syllabus-unified-widget.js"), "utf8"));
  if (window.document.readyState === "loading")
    window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  return { window, doc: window.document, store, xpCalls };
}
const J = (store, k, d) => (store[k] ? JSON.parse(store[k]) : d);
const $ = (doc, sel) => doc.querySelector("#csu-unified-root " + sel);
const $$ = (doc, sel) => Array.from(doc.querySelectorAll("#csu-unified-root " + sel));
function click(window, el) { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); }
function change(window, el, v) { if (v !== undefined) el.value = v; el.dispatchEvent(new window.Event("change", { bubbles: true })); }

(function main() {
  let { window, doc, store, xpCalls } = freshDom();
  ok(!!doc.getElementById("csu-unified-root"), "widget mounts");

  // ── tab order: revision slots in after ia-tracker, others unchanged
  const tabs = $$(doc, ".csu-tab-btn").map((b) => b.getAttribute("data-tab"));
  eq(tabs.join(","), "subjects,priority,ia-tracker,revision,overview,analytics,resources,college-sync,data", "tab order");
  eq($$(doc, ".csu-tab-btn[data-active='1']")[0].getAttribute("data-tab"), "subjects", "default tab is subjects");

  // ── drawer opens
  const firstId = "s1-1";
  ok(!$(doc, ".csu-drawer"), "drawer closed by default");
  click(window, $(doc, `[data-open-id="${firstId}"]`));
  ok(!!$(doc, ".csu-drawer"), "drawer opens on chevron click");
  eq($(doc, `[data-open-id="${firstId}"]`).getAttribute("aria-expanded"), "true", "chevron aria-expanded");
  ok(!J(store, "cse-syllabus-progress-v1", {})[firstId], "opening drawer did not toggle done");

  // ── difficulty
  click(window, $(doc, `[data-diff-set="${firstId}:4"]`));
  eq(J(store, "cse-syllabus-difficulty-v1", {})[firstId], 4, "difficulty saved");
  ok(!!$(doc, ".csu-chip-diff"), "difficulty chip shown on row");
  click(window, $(doc, `[data-diff-set="${firstId}:4"]`));
  ok(!(firstId in J(store, "cse-syllabus-difficulty-v1", {})), "clicking same dot clears difficulty");

  // ── exam date override
  const soon = new Date(Date.now() + 5 * 86400000); const ds = soon.toISOString().slice(0, 10);
  change(window, $(doc, `[data-exam-input="${firstId}"]`), ds);
  eq(J(store, "cse-syllabus-exam-dates-v1", {})[firstId], ds, "exam date saved");
  ok(/📅/.test($(doc, ".csu-subj-row").textContent), "exam chip on row");
  change(window, $(doc, `[data-exam-input="${firstId}"]`), "");
  ok(!(firstId in J(store, "cse-syllabus-exam-dates-v1", {})), "clearing exam date removes override");

  // ── revision: flag, review twice (same box semantics as the Syllabus+ panel: flag = box 1, review moves up a box)
  click(window, $(doc, `[data-rev-on="${firstId}"]`));
  let rv = J(store, "cse-syllabus-revision-v1", {})[firstId];
  ok(rv && rv.flagged && rv.box === 1, "flagged for revision at box 1");
  ok(rv.nextDueAt <= Date.now(), "freshly flagged subject is due immediately");
  click(window, $(doc, `[data-rev-review="${firstId}"]`));
  rv = J(store, "cse-syllabus-revision-v1", {})[firstId];
  eq(rv.box, 2, "first review -> box 2");
  ok(Math.abs(rv.nextDueAt - (Date.now() + 3 * 86400000)) < 5000, "box 2 -> due in 3 days");
  click(window, $(doc, `[data-rev-review="${firstId}"]`));
  rv = J(store, "cse-syllabus-revision-v1", {})[firstId];
  eq(rv.box, 3, "second review -> box 3");
  ok(Math.abs(rv.nextDueAt - (Date.now() + 7 * 86400000)) < 5000, "box 3 -> due in 7 days");

  // ── units
  const unitBox = $(doc, `[data-unit^="${firstId}:"]`);
  ok(!!unitBox, "unit checkboxes rendered");
  const uid = unitBox.getAttribute("data-unit").split(":")[1];
  unitBox.checked = true; change(window, unitBox);
  ok(J(store, "cse-syllabus-topic-progress-v1", {})[firstId][uid] === true, "unit progress saved");
  ok(/20% weighted coverage/.test($(doc, ".csu-drawer").textContent), "weighted coverage shown (20%)");
  const unitBox2 = $(doc, `[data-unit="${firstId}:${uid}"]`);
  unitBox2.checked = false; change(window, unitBox2);
  ok(!J(store, "cse-syllabus-topic-progress-v1", {})[firstId][uid], "unit unchecked");

  // ── log study time
  $(doc, `[data-log-input="${firstId}"]`).value = "45";
  click(window, $(doc, `[data-log-save="${firstId}"]`));
  const sess = J(store, "focusSessionsV2", []);
  ok(sess.length === 1 && sess[0].subjectId === firstId && sess[0].minutes === 45, "study session logged");
  ok(/45m logged/.test($(doc, ".csu-drawer").textContent), "logged time shown");
  $(doc, `[data-log-input="${firstId}"]`).value = "0";
  click(window, $(doc, `[data-log-save="${firstId}"]`));
  eq(J(store, "focusSessionsV2", []).length, 1, "zero minutes rejected");

  // ── placement-critical tag on a non-core subject
  const pcBox = $(doc, `[data-pc-set="${firstId}"]`);
  pcBox.checked = true; change(window, pcBox);
  eq(J(store, "cse-syllabus-custom-v1", {}).edits[firstId].pc, true, "PC tag saved as edit override");
  ok(!!$(doc, ".csu-chip-pc"), "PC chip appears");

  // ── add / delete custom subject
  click(window, $(doc, "#csu-add-toggle"));
  ok(!!$(doc, ".csu-form"), "add form opens");
  $(doc, "#csu-add-name").value = "Compiler Design";
  $(doc, "#csu-add-credits").value = "4";
  $(doc, "#csu-add-sem").value = "6";
  click(window, $(doc, "#csu-add-save"));
  let added = J(store, "cse-syllabus-custom-v1", {}).added;
  ok(added.length === 1 && added[0].name === "Compiler Design" && added[0].credits === 4 && String(added[0].sem) === "6", "custom subject added");
  const customId = added[0].id;
  ok(!$(doc, ".csu-form"), "form closes after add");
  click(window, $(doc, `[data-open-id="${customId}"]`));
  ok(!!$(doc, `[data-del-custom="${customId}"]`), "delete button for custom subject");
  click(window, $(doc, `[data-del-custom="${customId}"]`));
  eq(J(store, "cse-syllabus-custom-v1", {}).added.length, 0, "custom subject deleted");

  // ── XP once + timestamps on done
  click(window, $(doc, `[data-toggle-id="s1-2"]`));
  ok(J(store, "cse-syllabus-progress-v1", {})["s1-2"] === true, "toggle marks done");
  ok(!!J(store, "cse-syllabus-completion-timestamps-v1", {})["s1-2"], "completion timestamp stamped");
  eq(xpCalls.filter((x) => x === "s1-2").length, 1, "XP awarded once");
  click(window, $(doc, `[data-toggle-id="s1-2"]`));
  ok(!J(store, "cse-syllabus-progress-v1", {})["s1-2"], "toggle back to pending");
  click(window, $(doc, `[data-toggle-id="s1-2"]`));
  eq(xpCalls.filter((x) => x === "s1-2").length, 1, "XP not re-awarded on re-check");

  // ── bulk done / pending on filtered set (Sem 2)
  const semSel = $(doc, "#csu-sem-filter"); change(window, semSel, "2");
  const sem2 = $$(doc, "[data-toggle-id]").length;
  ok(sem2 > 0 && sem2 < 56, "sem filter narrows list (" + sem2 + ")");
  click(window, $(doc, "#csu-bulk-done"));
  const prog = J(store, "cse-syllabus-progress-v1", {});
  const sem2Done = Object.keys(prog).filter((k) => /^s2-/.test(k)).length;
  eq(sem2Done, sem2, "bulk done marks exactly the filtered subjects");
  ok(prog["s1-2"] === true, "bulk did not touch other semesters");
  click(window, $(doc, "#csu-bulk-pending"));
  eq(Object.keys(J(store, "cse-syllabus-progress-v1", {})).filter((k) => /^s2-/.test(k)).length, 0, "bulk pending clears the filtered subjects");

  // ── status filter 'Due' + sort by difficulty
  change(window, $(doc, "#csu-sem-filter"), "All");
  change(window, $(doc, "#csu-status-filter"), "Due");
  const dueRows = $$(doc, "[data-toggle-id]").map((r) => r.getAttribute("data-toggle-id"));
  ok(dueRows.indexOf(firstId) === -1, "not-yet-due subject excluded from Due filter (box 2 scheduled 7d out)");
  change(window, $(doc, "#csu-status-filter"), "All");
  const dd = J(store, "cse-syllabus-difficulty-v1", {}); dd["s1-3"] = 5; dd["s1-4"] = 2;
  store["cse-syllabus-difficulty-v1"] = JSON.stringify(dd);
  change(window, $(doc, "#csu-sort"), "difficulty");
  const order = $$(doc, "[data-toggle-id]").map((r) => r.getAttribute("data-toggle-id"));
  eq(order[0], "s1-3", "sort by difficulty puts 5/5 first");
  eq(order[1], "s1-4", "then 2/5");
  change(window, $(doc, "#csu-sort"), "name");
  const names = $$(doc, ".csu-subj-name").map((n) => n.textContent);
  ok(names.slice().sort((a, b) => a.localeCompare(b)).join("|") === names.join("|"), "sort by name is A-Z");
  change(window, $(doc, "#csu-sort"), "default");

  // ── Revision tab
  click(window, $(doc, '[data-tab="revision"]'));
  ok(!!$(doc, ".csu-rev-row"), "revision tab lists flagged subject");
  ok(!!$(doc, "#csu-rev-pick"), "revision picker present");
  const pick = $(doc, "#csu-rev-pick"); pick.value = "s1-3";
  click(window, $(doc, "#csu-rev-add"));
  ok(J(store, "cse-syllabus-revision-v1", {})["s1-3"].flagged === true, "flag via revision tab picker");
  // legacy `true` revision value is normalised, not ignored
  const rvAll = J(store, "cse-syllabus-revision-v1", {}); rvAll["s1-4"] = true;
  store["cse-syllabus-revision-v1"] = JSON.stringify(rvAll);
  click(window, $(doc, '[data-tab="subjects"]')); click(window, $(doc, '[data-tab="revision"]'));
  ok($$(doc, ".csu-rev-row").length === 3, "legacy boolean revision entry listed (3 rows)");
  ok(/Revise/.test($(doc, ".csu-header").textContent), "header shows Revise tile when items due");
  // flag all completed
  click(window, $(doc, '[data-tab="subjects"]'));
  click(window, $(doc, `[data-toggle-id="s1-5"]`));
  click(window, $(doc, '[data-tab="revision"]'));
  ok(!!$(doc, "#csu-rev-flag-done"), "flag-all-completed button when done subjects unflagged");
  click(window, $(doc, "#csu-rev-flag-done"));
  ok(J(store, "cse-syllabus-revision-v1", {})["s1-5"].flagged === true, "completed subject flagged via bulk");
  // remove
  click(window, $(doc, '[data-rev-off="s1-5"]'));
  ok(!("s1-5" in J(store, "cse-syllabus-revision-v1", {})), "remove from revision");

  // ── priority: unit coverage pushes a mostly-covered subject down
  click(window, $(doc, '[data-tab="priority"]'));
  ok(!/not yet wired/.test($(doc, ".csu-tab-body").textContent), "stale 'not yet wired' note removed");
  const subjectsCfg = window.AriseCSEFullSyllabusConfig.SUBJECTS;
  const topName = $(doc, ".csu-prio-name").textContent;
  const top = subjectsCfg.find((x) => x.name === topName);
  ok(!!top && top.units.length > 0, "top-priority subject identified (" + topName + ")");
  const um = {}; um[top.id] = {}; top.units.forEach((u) => { um[top.id][u.id] = true; });
  store["cse-syllabus-topic-progress-v1"] = JSON.stringify(um);
  click(window, $(doc, '[data-tab="subjects"]')); click(window, $(doc, '[data-tab="priority"]'));
  ok($(doc, ".csu-prio-name").textContent !== topName, "fully unit-covered subject no longer ranks first");

  // ── Exam Tracker fallback for exam dates
  const nm = window.AriseCSEFullSyllabusConfig.SUBJECTS.find((s) => s.id === "s1-6").name;
  store["arise_exam_tracker_v1"] = JSON.stringify({ exams: [{ subjectName: nm, examDate: ds, completed: false }] });
  click(window, $(doc, '[data-tab="subjects"]'));
  click(window, $(doc, '[data-open-id="s1-6"]'));
  eq($(doc, '[data-exam-input="s1-6"]').value, ds, "exam date falls back to Exam Tracker");
  ok(/auto from Exam Tracker/.test($(doc, ".csu-drawer").textContent), "drawer says date is auto from Exam Tracker");

  // ── search keeps focus while typing
  const se = $(doc, "#csu-search"); se.focus(); se.value = "data"; se.setSelectionRange(4, 4);
  se.dispatchEvent(new window.Event("input", { bubbles: true }));
  const se2 = $(doc, "#csu-search");
  ok(doc.activeElement === se2, "search input regains focus after re-render");
  eq(se2.selectionStart, 4, "caret position preserved");

  // ── invalid stored tab falls back to subjects
  const f2 = freshDom({ "csu-unified-tab-v1": JSON.stringify("nope") });
  eq(f2.doc.querySelector("#csu-unified-root .csu-tab-btn[data-active='1']").getAttribute("data-tab"), "subjects", "invalid persisted tab -> subjects");


  // ════════ v203 ════════
  {
    const day = 86400000, iso = (d) => new Date(d).toISOString().slice(0, 10);
    const cfgSubs = (w) => w.AriseCSEFullSyllabusConfig.SUBJECTS;

    // ── edit base subject + custom subject
    let g = freshDom();
    click(g.window, $(g.doc, '[data-open-id="s1-1"]'));
    click(g.window, $(g.doc, '[data-edit-open="s1-1"]'));
    ok(!!$(g.doc, "#csu-edit-name"), "edit form opens");
    ok($(g.doc, "#csu-edit-sem").disabled, "base subject semester is locked");
    $(g.doc, "#csu-edit-name").value = "Maths-I (renamed)"; $(g.doc, "#csu-edit-credits").value = "5"; $(g.doc, "#csu-edit-type").value = "Lab";
    click(g.window, $(g.doc, "[data-edit-save]"));
    let ed = J(g.store, "cse-syllabus-custom-v1", {}).edits["s1-1"];
    ok(ed && ed.name === "Maths-I (renamed)" && ed.credits === 5 && ed.type === "Lab", "base edit saved as override");
    ok(/Maths-I \(renamed\)/.test($(g.doc, ".csu-subj-row").textContent), "renamed subject shown on row");
    ok(!$(g.doc, "#csu-edit-name"), "edit form closes after save");

    click(g.window, $(g.doc, "#csu-add-toggle"));
    $(g.doc, "#csu-add-name").value = "Cloud Computing"; $(g.doc, "#csu-add-sem").value = "2";
    click(g.window, $(g.doc, "#csu-add-save"));
    const cid = J(g.store, "cse-syllabus-custom-v1", {}).added[0].id;
    // custom subject now sits inside its semester group, not at the very end
    const ids0 = $$(g.doc, "[data-toggle-id]").map((r) => r.getAttribute("data-toggle-id"));
    const lastSem2 = Math.max.apply(null, ids0.map((id, i) => (/^s2-/.test(id) || id === cid ? i : -1)));
    eq(ids0[lastSem2], cid, "custom Sem-2 subject placed at end of Sem 2 group");
    ok(ids0.indexOf(cid) < ids0.length - 1, "custom subject not dumped at the end of the whole list");
    click(g.window, $(g.doc, `[data-open-id="${cid}"]`));
    click(g.window, $(g.doc, `[data-edit-open="${cid}"]`));
    $(g.doc, "#csu-edit-sem").value = "4"; $(g.doc, "#csu-edit-name").value = "Cloud Computing II";
    click(g.window, $(g.doc, "[data-edit-save]"));
    const cust = J(g.store, "cse-syllabus-custom-v1", {}).added[0];
    ok(String(cust.sem) === "4" && cust.name === "Cloud Computing II", "custom subject edit incl. semester saved");

    // ── reorder within semester
    g = freshDom();
    const semIds = (w, d, sem) => Array.from(d.querySelectorAll("#csu-unified-root [data-toggle-id]")).map((r) => r.getAttribute("data-toggle-id")).filter((id) => new RegExp("^s" + sem + "-").test(id));
    const before = semIds(g.window, g.doc, 1);
    click(g.window, $(g.doc, `[data-open-id="${before[0]}"]`));
    click(g.window, $(g.doc, `[data-move="${before[0]}:down"]`));
    let after = semIds(g.window, g.doc, 1);
    eq(after[0], before[1], "move down: neighbour now first");
    eq(after[1], before[0], "move down: subject now second");
    click(g.window, $(g.doc, `[data-move="${before[0]}:up"]`));
    eq(semIds(g.window, g.doc, 1).join(","), before.join(","), "move up restores original order");
    click(g.window, $(g.doc, `[data-move="${before[0]}:up"]`));
    eq(semIds(g.window, g.doc, 1).join(","), before.join(","), "moving the first subject up is a no-op");

    // ── backlog risk: internal marks + attendance
    g = freshDom();
    click(g.window, $(g.doc, '[data-open-id="s1-2"]'));
    const mi = $(g.doc, '[data-marks-input="s1-2"]'); mi.value = "30"; change(g.window, mi);
    eq(J(g.store, "cse-syllabus-internal-marks-v1", {})["s1-2"], 30, "internal marks saved");
    ok(/Backlog Risk/.test($("s1-2" && g.doc, '[data-toggle-id="s1-2"]').textContent), "row shows Backlog Risk chip for marks < 40");
    ok(/At risk/.test($(g.doc, ".csu-header").textContent), "header shows At risk tile");
    change(g.window, $(g.doc, "#csu-status-filter"), "BacklogRisk");
    eq($$(g.doc, "[data-toggle-id]").map((r) => r.getAttribute("data-toggle-id")).join(","), "s1-2", "BacklogRisk filter lists only the at-risk subject");
    change(g.window, $(g.doc, "#csu-status-filter"), "All");
    const nm3 = cfgSubs(g.window).find((s) => s.id === "s1-3").name;
    g.store["arise-attendance-tracker-v1"] = JSON.stringify({ threshold: 75, subjects: [{ name: nm3.toUpperCase(), total: 20, attended: 12 }] });
    click(g.window, $(g.doc, '[data-tab="data"]')); click(g.window, $(g.doc, '[data-tab="subjects"]'));
    ok(/Backlog Risk/.test($(g.doc, '[data-toggle-id="s1-3"]').textContent), "attendance 60% < 75% flags risk (name match is case-insensitive)");
    const mi2 = $(g.doc, '[data-marks-input="s1-2"]') || (click(g.window, $(g.doc, '[data-open-id="s1-2"]')), $(g.doc, '[data-marks-input="s1-2"]'));
    mi2.value = ""; change(g.window, mi2);
    ok(!("s1-2" in J(g.store, "cse-syllabus-internal-marks-v1", {})), "clearing marks removes the entry");
    ok(!/Backlog Risk/.test($(g.doc, '[data-toggle-id="s1-2"]').textContent), "risk chip gone once marks cleared");

    // ── exam banner
    g = freshDom();
    ok(!$(g.doc, "[data-exam-banner]"), "no banner without near exams");
    const nmB = cfgSubs(g.window).find((s) => s.id === "s1-4").name;
    g.store["cse-syllabus-exam-dates-v1"] = JSON.stringify({ "s1-4": iso(Date.now() + 3 * day) });
    click(g.window, $(g.doc, '[data-tab="data"]'));
    const bn = $(g.doc, "[data-exam-banner]");
    ok(!!bn && bn.textContent.indexOf(nmB) !== -1 && /3 days to exam/.test(bn.textContent), "banner names subject and days left");
    ok(/100% of its units still pending/.test(bn.textContent), "banner shows pending units");
    click(g.window, $(g.doc, "[data-exam-banner] [data-prio-jump]"));
    eq($$(g.doc, ".csu-tab-btn[data-active='1']")[0].getAttribute("data-tab"), "subjects", "banner Open jumps to Subjects");
    ok(!!$(g.doc, '[data-open-id="s1-4"][aria-expanded="true"]'), "banner Open expands that subject's drawer");
    click(g.window, $(g.doc, '[data-toggle-id="s1-4"]'));
    ok(!$(g.doc, "[data-exam-banner]"), "banner disappears once the subject is done");

    // ── priority row jumps to subject drawer
    click(g.window, $(g.doc, '[data-tab="priority"]'));
    const pr = $(g.doc, ".csu-prio-row"); const pid = pr.getAttribute("data-prio-jump");
    click(g.window, pr);
    ok(!!$(g.doc, `[data-open-id="${pid}"][aria-expanded="true"]`), "priority row opens that subject in Subjects");

    // ── overview: semester pace (readiness history / milestones were removed)
    const seedStamps = {}, seedProg = {};
    ["s1-1", "s1-2", "s1-3", "s1-4"].forEach((id, i) => { seedProg[id] = true; seedStamps[id] = new Date(Date.now() - (i + 1) * day).toISOString(); });
    g = freshDom({
      "cse-syllabus-progress-v1": JSON.stringify(seedProg),
      "cse-syllabus-completion-timestamps-v1": JSON.stringify(seedStamps),
      "cse-syllabus-readiness-history-v1": JSON.stringify([{ d: iso(Date.now() - 9 * day), pct: 2 }, { d: iso(Date.now() - 2 * day), pct: 5 }]),
    });
    click(g.window, $(g.doc, '[data-tab="overview"]'));
    const bodyTxt = $(g.doc, ".csu-tab-body").textContent;
    ok(!/Readiness/i.test(bodyTxt), "no readiness history / readiness wording on the overview");
    ok(!$(g.doc, "svg.csu-spark"), "no readiness history sparkline rendered");
    ok(!/Milestones/.test(bodyTxt) && $$(g.doc, ".csu-mile-fill").length === 0, "milestone bands are gone");
    ok(!/% ready/.test(bodyTxt), "no per-subject '% ready' scores");
    ok(!$(g.doc, ".csu-header-ring") && !$(g.doc, ".csu-header svg"), "no score ring in the All-in-One header");
    ok(!/Excelling|On Track|Getting Started|Subject Mastery/.test(($(g.doc, ".csu-header").textContent + " " + $(g.doc, ".csu-tab-body").textContent)), "no mastery level label / Subject Mastery % card");
    click(g.window, $(g.doc, '[data-tab="data"]'));
    ok(!$(g.doc, "#csu-score-count") && !$(g.doc, "#csu-score-credit"), "Score Mode (Simple % / Credit-Weighted %) toggle removed");
    click(g.window, $(g.doc, '[data-tab="overview"]'));
    ok(g.store["cse-syllabus-readiness-history-v1"] === undefined || J(g.store, "cse-syllabus-readiness-history-v1", []).length === 2, "unified widget no longer records readiness history");
    const sp = $(g.doc, "[data-sem-pace]");
    ok(!!sp && /difficulty-units\/day/.test(sp.textContent), "semester pace unlocked with 4 recent completions");
    ok(/~\d{1,2} \w{3} \d{4}/.test(sp.textContent), "semester pace shows a projected finish date");
    // 3 completions minimum
    g = freshDom({ "cse-syllabus-progress-v1": JSON.stringify({ "s1-1": true }), "cse-syllabus-completion-timestamps-v1": JSON.stringify({ "s1-1": new Date().toISOString() }) });
    click(g.window, $(g.doc, '[data-tab="overview"]'));
    ok(/at least 3 subjects/.test($(g.doc, "[data-sem-pace]").textContent), "semester pace explains the 3-completion minimum");

    // ── summary copy / download
    g = freshDom();
    g.store["cse-syllabus-exam-dates-v1"] = JSON.stringify({ "s1-5": iso(Date.now() + 10 * day) });
    g.store["cse-syllabus-internal-marks-v1"] = JSON.stringify({ "s1-6": 20 });
    let copied = null, blobText = null, dlName = null;
    Object.defineProperty(g.window.navigator, "clipboard", { configurable: true, value: { writeText: (t) => { copied = t; return Promise.resolve(); } } });
    g.window.Blob = function (parts) { blobText = parts.join(""); };
    g.window.URL.createObjectURL = () => "blob:x"; g.window.URL.revokeObjectURL = () => {};
    const origCreate = g.doc.createElement.bind(g.doc);
    g.doc.createElement = (tag) => { const el = origCreate(tag); if (tag === "a") el.click = function () { dlName = this.download; }; return el; };
    click(g.window, $(g.doc, '[data-tab="data"]'));
    click(g.window, $(g.doc, "#csu-copy-summary"));
    ok(copied && /^CSE Syllabus\+ progress/.test(copied), "summary copied to clipboard");
    ok(/Upcoming exams/.test(copied) && /Backlog risk:/.test(copied) && /Study next:/.test(copied), "summary includes exams, backlog risk and study-next sections");
    ok(/Sem 1: 0\/\d+ done|Semester 1: 0\/\d+ done|: 0\/\d+ done/.test(copied), "summary includes per-semester lines");
    click(g.window, $(g.doc, "#csu-dl-summary"));
    ok(blobText === copied || (blobText && /^CSE Syllabus\+ progress/.test(blobText)), "download builds the same summary text");
    ok(/^cse-syllabus-summary-\d{4}-\d{2}-\d{2}\.txt$/.test(dlName || ""), "download filename is dated .txt");
  }

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
