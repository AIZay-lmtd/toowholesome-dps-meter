import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// taskList.js and taskLogic.js attach to the page's global (`this`), as in the overlay.
const context = vm.createContext({});
for (const file of ["taskList.js", "taskLogic.js"]) {
  vm.runInContext(readFileSync(new URL(`../public/src/js/${file}`, import.meta.url), "utf8"), context);
}
const { TASKS } = context.tasks;
const L = context.taskLogic;
const task = (id) => TASKS.find((t) => t.id === id);

const now = Date.parse("2026-11-03T12:00:00Z");
const timers = { dailyReset: Date.parse("2026-11-04T07:00:00Z"), weeklyReset: Date.parse("2026-11-04T07:00:00Z") };

// Shaped as src-tauri/src/checklist.rs keeps a character's counters.
const g = {
  tickets: { 4: { n: [9], at: now - 1000 }, 101: { n: [10], at: now - 1000 }, 60000001: { n: [0, 1395], at: now - 1000 } },
  ticketsAt: now - 1000,
};

test("a stock ticket fills the bank with its count and recharge pool", () => {
  const r = L.fromGame(task("nightmare"), g, false, now, timers);
  assert.deepEqual({ ...r.entry }, { value: 9, at: now - 1000 });
  const odyle = L.fromGame(task("odyle"), g, false, now, timers);
  assert.equal(odyle.entry.value, 0);
  assert.equal(odyle.recharge, 1395);
});

test("a 'left' ticket becomes uses this week, and a stale one is ignored", () => {
  // Daily Dungeon: 14 a week, 10 left = 4 used.
  const r = L.fromGame(task("daily-dungeon"), g, false, now, timers);
  assert.equal(r.entry.used, 4);
  const old = { tickets: { 101: { n: [10], at: Date.parse("2026-10-27T00:00:00Z") } } };
  assert.equal(L.fromGame(task("daily-dungeon"), old, false, now, timers), null);
});

test("counts clear at their reset and stocks refill", () => {
  const duties = task("duties");
  const entry = L.setUsed(duties, 3, false, now, timers);
  assert.equal(L.usedOf(entry, now), 3);
  assert.equal(L.usedOf(entry, timers.dailyReset + 1), 0);
  // Nightmare: 2 a day at the daily reset, up to 14.
  const bank = L.bankNow(task("nightmare"), { value: 9, at: now }, false, timers.dailyReset + 1000, timers.dailyReset + L.DAY);
  assert.equal(bank.value, 11);
});

test("Season Missions are counted by hand here", () => {
  assert.equal(task("season-missions").game, undefined);
});
