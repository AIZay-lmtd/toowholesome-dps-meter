import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = vm.createContext({ Intl, Date, Math, Number, Infinity });
vm.runInContext(readFileSync(new URL("../public/src/js/timerSchedule.js", import.meta.url), "utf8"), context);
const { TIMERS, nextStart, alertingStart, regionOfServer } = vm.runInContext(
  "({ TIMERS, nextStart, alertingStart, regionOfServer })",
  context
);
const def = (id) => TIMERS.find((t) => t.id === id);
const utc = (s) => Date.parse(s);

test("hourly and three-hourly events land on their UTC marks", () => {
  const at = utc("2026-11-03T14:47:00Z");
  assert.equal(nextStart(def("shugo").schedule, at), utc("2026-11-03T15:00:00Z"));
  assert.equal(nextStart(def("invasion").schedule, at), utc("2026-11-03T15:30:00Z"));
  assert.equal(nextStart(def("rift").schedule, at), utc("2026-11-03T15:00:00Z"));
  assert.equal(nextStart(def("kaira").schedule, at), utc("2026-11-03T17:00:00Z"));
  // Exactly on a start is that start.
  assert.equal(nextStart(def("shugo").schedule, utc("2026-11-03T15:00:00Z")), utc("2026-11-03T15:00:00Z"));
});

test("resets are 07:00 UTC, weekly on Wednesday", () => {
  // 2026-11-03 is a Tuesday.
  assert.equal(nextStart(def("dailyReset").schedule, utc("2026-11-03T08:00:00Z")), utc("2026-11-04T07:00:00Z"));
  assert.equal(nextStart(def("weeklyReset").schedule, utc("2026-11-03T08:00:00Z")), utc("2026-11-04T07:00:00Z"));
  assert.equal(nextStart(def("weeklyReset").schedule, utc("2026-11-04T07:00:01Z")), utc("2026-11-11T07:00:00Z"));
});

test("the siege follows the region's own clock, daylight saving included", () => {
  // Thursday 21:00 New York: 01:00 UTC Friday in summer time (EDT) ...
  assert.equal(nextStart(def("siege").schedule, utc("2026-10-29T12:00:00Z"), "na-east"), utc("2026-10-30T01:00:00Z"));
  // ... and 02:00 UTC after the change to EST (2026-11-01).
  assert.equal(nextStart(def("siege").schedule, utc("2026-11-05T12:00:00Z"), "na-east"), utc("2026-11-06T02:00:00Z"));
  // Europe: Thursday 21:00 Berlin (CET) is 20:00 UTC.
  assert.equal(nextStart(def("siege").schedule, utc("2026-11-05T12:00:00Z"), "europe"), utc("2026-11-05T20:00:00Z"));
});

test("an alert is up from its lead until two minutes after the start", () => {
  const shugo = def("shugo");
  assert.equal(alertingStart(shugo, utc("2026-11-03T14:56:00Z")), null);
  assert.equal(alertingStart(shugo, utc("2026-11-03T14:57:00Z")), utc("2026-11-03T15:00:00Z"));
  assert.equal(alertingStart(shugo, utc("2026-11-03T15:01:59Z")), utc("2026-11-03T15:00:00Z"));
  assert.equal(alertingStart(shugo, utc("2026-11-03T15:02:00Z")), null);
});

test("a server id names its region", () => {
  assert.equal(regionOfServer(1104), "na-east");
  assert.equal(regionOfServer(2311), "europe");
  assert.equal(regionOfServer(0), null);
});
