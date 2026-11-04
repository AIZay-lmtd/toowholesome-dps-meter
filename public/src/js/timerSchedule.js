// TooWholesome DPS: the game's recurring events and when each starts next.
//
// Ported from Nyerk by xCROv (GPL-3.0, https://github.com/xCROv/aion2-nyerk,
// app/src/shared/timers.ts), whose notes record how each schedule was
// checked against the game (2026-10). Times are UTC; "zoned" events follow
// the region's server time zone, daylight saving included.

const TIMER_MINUTE = 60_000;
const TIMER_DAY = 24 * 60 * TIMER_MINUTE;
const hm = (h, m = 0) => h * 60 + m;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** Global regions; `digit` is the region's in a game server id (Kaisinel NA East 1104: 1). */
const TIMER_REGIONS = [
  { id: "na-east", label: "NA East", zone: "America/New_York", digit: 1 },
  { id: "na-west", label: "NA West", zone: "America/Los_Angeles", digit: 2 },
  { id: "europe", label: "Europe", zone: "Europe/Berlin", digit: 3 },
  { id: "latam", label: "Latin America", zone: "America/Sao_Paulo", digit: 4 },
  { id: "asia", label: "Asia", zone: "Asia/Singapore", digit: 5 },
];

/**
 * schedule: { kind: "every", every, offset } minutes from 00:00 UTC, or
 * { kind: "zoned", days (0 = Sunday), times (minutes after midnight), zone? }.
 * lead: minutes before the start to alert.
 */
const TIMERS = [
  { id: "shugo", name: "Shugo Festival", detail: "Minigames in Verteron and Altgard; lobby opens 3 min before", schedule: { kind: "every", every: 60, offset: 0 }, lead: 3 },
  { id: "merchant", name: "Black Cloud Merchant", detail: "New stock every hour", schedule: { kind: "every", every: 60, offset: 0 }, lead: 0 },
  { id: "rift", name: "Spacetime Rift", detail: "Rifts to the other side open (level 45+)", schedule: { kind: "every", every: 180, offset: 0 }, lead: 5 },
  { id: "invasion", name: "Dimensional Invasion", detail: "A 3-minute entry window", schedule: { kind: "every", every: 60, offset: 30 }, lead: 3 },
  { id: "kaira", name: "Watcher Kaira", detail: "Abyss boss in Lower Reshanta, at a random spot", schedule: { kind: "every", every: 180, offset: 120 }, lead: 10 },
  { id: "siege", name: "Artifact Siege", detail: "Elyos vs Asmodians over the artifacts in Lower Reshanta", schedule: { kind: "zoned", days: [1, 4, 6], times: [hm(21)] }, lead: 10 },
  { id: "siegeBosses", name: "Executors (siege bosses)", detail: "Tamasa, Argo and Kaira in Lower Reshanta after the siege", schedule: { kind: "zoned", days: [1, 4, 6], times: [hm(21, 30)] }, lead: 5 },
  { id: "nahma", name: "Guardian Lord Nahma", detail: "Abyss field boss in Lower Reshanta (three of them)", schedule: { kind: "zoned", days: [0, 5], times: [hm(21)] }, lead: 10 },
  { id: "dailyReset", name: "Daily Reset", detail: "Daily quests and limits reset", schedule: { kind: "zoned", days: EVERY_DAY, times: [hm(7)], zone: "UTC" }, lead: 0 },
  { id: "weeklyReset", name: "Weekly Reset", detail: "Weekly quests and limits reset (Wednesday)", schedule: { kind: "zoned", days: [3], times: [hm(7)], zone: "UTC" }, lead: 0 },
];

/** A game server's region from its id's second digit (2311: Europe); null when unknown. */
function regionOfServer(server) {
  if (!server) return null;
  return TIMER_REGIONS.find((r) => r.digit === Math.floor(server / 100) % 10)?.id ?? null;
}

/** How far `zone`'s wall clock is ahead of UTC at instant `t` (ms). */
function zoneOffset(zone, t) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(t);
  const n = (type) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return wall - Math.floor(t / 1000) * 1000;
}

/** The first start at or after `from` (ms). Zoned schedules in `region`'s time zone. */
function nextStart(schedule, from, region = "na-east") {
  if (schedule.kind === "every") {
    const period = schedule.every * TIMER_MINUTE;
    const offset = schedule.offset * TIMER_MINUTE;
    return Math.ceil((from - offset) / period) * period + offset;
  }
  const zone = schedule.zone ?? TIMER_REGIONS.find((r) => r.id === region)?.zone ?? "America/New_York";
  const midnight = Math.floor((from + zoneOffset(zone, from)) / TIMER_DAY) * TIMER_DAY;
  const times = [...schedule.times].sort((a, b) => a - b);
  for (let d = 0; d <= 7; d++) {
    const day = midnight + d * TIMER_DAY;
    if (!schedule.days.includes(new Date(day).getUTCDay())) continue;
    for (const t of times) {
      const wall = day + t * TIMER_MINUTE;
      // The offset at the start itself (it can differ across a daylight-saving change).
      const start = wall - zoneOffset(zone, wall - zoneOffset(zone, wall));
      if (start >= from) return start;
    }
  }
  return Infinity;
}

/** How long an alert stays up after the start. */
const ALERT_AFTER_MS = 2 * TIMER_MINUTE;

/** The start an alert is up for at `now` (from `lead` min before until 2 min after), or null. */
function alertingStart(def, now, region = "na-east", lead = def.lead) {
  const next = nextStart(def.schedule, now - ALERT_AFTER_MS, region);
  return now >= next - lead * TIMER_MINUTE && now < next + ALERT_AFTER_MS ? next : null;
}

if (typeof module !== "undefined") module.exports = { TIMERS, TIMER_REGIONS, regionOfServer, nextStart, alertingStart };
