// TooWholesome DPS: World & Events timers (schedules in timerSchedule.js).
// The clock button opens the list: every event with a live countdown and a
// bell to alert for it. Alerts are opt-in and show a banner with a chime from
// the timer's lead time until it starts, whether or not the list is open.
(() => {
  const view = window.__A2_VIEW__ || new URLSearchParams(window.location.search).get("view");
  if (view === "settings") return;

  const invoke = (cmd, args) =>
    window.__TAURI__?.core?.invoke?.(cmd, args) ?? Promise.reject(new Error("no tauri"));
  const bridge = () => window.javaBridge;
  const REGION_KEY = "toowholesome.timerRegion";
  const ALERTS_KEY = "toowholesome.timerAlerts";

  let server = 0;
  let panel;
  const fired = new Set();

  const readAlerts = () => {
    try {
      return new Set(JSON.parse(bridge()?.getSetting?.(ALERTS_KEY) || "[]"));
    } catch {
      return new Set();
    }
  };
  // Read each time: settings can arrive after this script runs.
  const saveAlerts = (alerts) => bridge()?.setSetting?.(ALERTS_KEY, JSON.stringify([...alerts]));

  const regionSetting = () => bridge()?.getSetting?.(REGION_KEY) || "auto";
  const region = () => {
    const chosen = regionSetting();
    return chosen === "auto" ? regionOfServer(server) ?? "na-east" : chosen;
  };

  const countdown = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
    return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  };
  const clock = (t) => new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

  // A short two-note chime (no sound files to ship).
  const chime = () => {
    try {
      const ctx = new AudioContext();
      [880, 1318.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.65);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch {}
  };

  const banner = (title, body) => {
    const meter = document.querySelector(".meter");
    if (!meter) return;
    const el = document.createElement("div");
    el.className = "pbBanner";
    el.innerHTML = '<div class="pbBannerTitle"></div><div class="pbBannerBody"></div>';
    el.querySelector(".pbBannerTitle").textContent = title;
    el.querySelector(".pbBannerBody").textContent = body;
    meter.appendChild(el);
    setTimeout(() => el.classList.add("isLeaving"), 7000);
    setTimeout(() => el.remove(), 7800);
  };

  const checkAlerts = (now) => {
    const alerts = readAlerts();
    for (const def of TIMERS) {
      if (!alerts.has(def.id)) continue;
      const at = alertingStart(def, now, region());
      if (at == null) continue;
      const key = `${def.id}@${at}`;
      if (fired.has(key)) continue;
      fired.add(key);
      chime();
      banner(def.name, at > now ? `Starts in ${countdown(at - now)}` : "Starting now");
    }
  };

  const render = (now) => {
    if (!panel || panel.hidden) return;
    const r = region();
    const rows = TIMERS.map((def) => ({ def, at: nextStart(def.schedule, now, r) })).sort((a, b) => a.at - b.at);
    const list = panel.querySelector(".timersList");
    if (list.childElementCount !== rows.length || list.dataset.order !== rows.map((x) => x.def.id).join()) {
      list.textContent = "";
      list.dataset.order = rows.map((x) => x.def.id).join();
      for (const { def } of rows) {
        const row = document.createElement("div");
        row.className = "timerRow";
        row.dataset.id = def.id;
        row.innerHTML = `
          <div class="pbItemText"><div class="pbItemBoss"></div><div class="pbItemMeta"></div></div>
          <div class="timerWhen"><div class="timerIn"></div><div class="timerAt"></div></div>
          <button type="button" class="timerBell" aria-pressed="false"></button>`;
        row.querySelector(".pbItemBoss").textContent = def.name;
        row.querySelector(".pbItemMeta").textContent = def.detail;
        const bell = row.querySelector(".timerBell");
        bell.addEventListener("click", () => {
          const alerts = readAlerts();
          if (alerts.has(def.id)) alerts.delete(def.id);
          else alerts.add(def.id);
          saveAlerts(alerts);
          render(Date.now());
        });
        list.appendChild(row);
      }
    }
    const alerts = readAlerts();
    for (const { def, at } of rows) {
      const row = list.querySelector(`[data-id="${def.id}"]`);
      const on = alerts.has(def.id);
      row.querySelector(".timerIn").textContent = countdown(at - now);
      row.querySelector(".timerAt").textContent = clock(at);
      row.classList.toggle("isSoon", at - now <= def.lead * 60_000 + 60_000);
      const bell = row.querySelector(".timerBell");
      bell.textContent = "🔔";
      bell.title = on ? `Alert ${def.lead ? `${def.lead} min before` : "at the start"} (click to turn off)` : "Click to get an alert";
      bell.setAttribute("aria-pressed", String(on));
    }
  };

  const ensurePanel = () => {
    if (panel) return panel;
    const meter = document.querySelector(".meter");
    if (!meter) return null;
    panel = document.createElement("div");
    panel.className = "pbPanel timersPanel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="pbPanelHeader">
        <span class="pbPanelTitle">World &amp; Events</span>
        <button type="button" class="pbPanelClose" aria-label="Close">✕</button>
      </div>
      <div class="timersRegion">
        <label>Region <select class="timersRegionSelect"></select></label>
      </div>
      <div class="pbPanelList timersList"></div>`;
    const select = panel.querySelector(".timersRegionSelect");
    const auto = document.createElement("option");
    auto.value = "auto";
    auto.textContent = "Automatic (your server)";
    select.appendChild(auto);
    for (const r of TIMER_REGIONS) {
      const o = document.createElement("option");
      o.value = r.id;
      o.textContent = r.label;
      select.appendChild(o);
    }
    select.value = regionSetting();
    select.addEventListener("change", () => {
      bridge()?.setSetting?.(REGION_KEY, select.value);
      render(Date.now());
    });
    panel.querySelector(".pbPanelClose").addEventListener("click", () => toggle(false));
    meter.appendChild(panel);
    return panel;
  };

  const toggle = (force) => {
    const p = ensurePanel();
    if (!p) return;
    const show = typeof force === "boolean" ? force : p.hidden;
    p.hidden = !show;
    // Class changes re-fit the overlay window and the lock's click area.
    p.classList.toggle("isOpen", show);
    document.querySelector(".meter")?.classList.toggle("timersOpen", show);
    if (show) {
      invoke("get_local_server").then((s) => (server = Number(s) || 0)).catch(() => {});
      render(Date.now());
    }
  };

  const start = () => {
    const btn = document.querySelector(".timersBtn");
    btn?.addEventListener("click", () => toggle());
    btn?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    invoke("get_local_server").then((s) => (server = Number(s) || 0)).catch(() => {});
    setInterval(() => {
      const now = Date.now();
      checkAlerts(now);
      render(now);
    }, 1000);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
