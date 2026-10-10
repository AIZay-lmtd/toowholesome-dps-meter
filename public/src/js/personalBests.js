// TooWholesome DPS: personal bests.
//
// The backend keeps the local player's best DPS per boss, tier and class
// (src-tauri/src/history/personal_bests.rs) and emits "personal-best" when a
// saved fight sets one. This shows, in the meter window:
//   - a strip under the header while you fight a boss you have a best on:
//     your best and how far ahead or behind it you are right now;
//   - a gold banner when a fight sets a new best;
//   - a trophy button listing every best.
// core.js calls TooWholePB.onFrame() after each render.
(() => {
  const view = window.__A2_VIEW__ || new URLSearchParams(window.location.search).get("view");
  if (view === "settings") return;

  const tauri = window.__TAURI__;
  const invoke = (cmd, args) => tauri?.core?.invoke?.(cmd, args) ?? Promise.reject(new Error("no tauri"));

  /** key "mob:dungeon:job" -> best */
  let bests = new Map();
  let loaded = false;
  let backfillTried = false;

  const keyOf = (mob, dungeon, job) => `${mob}:${dungeon}:${job}`;

  const compact = (n) => {
    const v = Math.abs(Number(n) || 0);
    const sign = Number(n) < 0 ? "-" : "";
    if (v >= 1e9) return `${sign}${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${sign}${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e4) return `${sign}${(v / 1e3).toFixed(1)}K`;
    return `${sign}${Math.round(v).toLocaleString("en-US")}`;
  };
  const duration = (ms) => {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const t = (key, fallback) => window._dpsApp?.i18n?.t?.(key, fallback) ?? fallback;
  const dungeonLabel = (id) => (Number(id) > 0 ? window._dpsApp?.i18n?.getDungeonLabel?.(Number(id)) ?? "" : "");

  const setAll = (list) => {
    bests = new Map((Array.isArray(list) ? list : []).map((b) => [keyOf(b.mobCode, b.dungeonId, b.job), b]));
    loaded = true;
    renderList();
  };

  const reload = () =>
    invoke("get_personal_bests")
      .then(setAll)
      .catch(() => {});

  // History from before this feature: build bests from it once, as soon as we
  // know whose fights they are.
  const maybeBackfill = () => {
    if (!loaded || backfillTried || bests.size > 0) return;
    const name = String(window._dpsApp?.USER_NAME || "").trim();
    if (!name) return;
    backfillTried = true;
    invoke("backfill_personal_bests", { character: name })
      .then((count) => (count > 0 ? reload() : null))
      .catch(() => {});
  };

  // --- Live strip -----------------------------------------------------------
  let strip;
  const ensureStrip = () => {
    if (strip) return strip;
    const anchor = document.querySelector(".bossHpBar") || document.querySelector(".meter .header");
    if (!anchor) return null;
    strip = document.createElement("div");
    strip.className = "pbStrip";
    strip.hidden = true;
    strip.innerHTML =
      '<span class="pbStripLabel"></span><span class="pbStripBest"></span><span class="pbStripDelta"></span>';
    anchor.insertAdjacentElement("afterend", strip);
    return strip;
  };

  const onFrame = ({ rows, mobCode, pbDungeonId, battleTimeMs }) => {
    maybeBackfill();
    const el = ensureStrip();
    if (!el) return;
    const me = Array.isArray(rows) ? rows.find((r) => r.isUser) : null;
    let best = me && mobCode > 0 ? bests.get(keyOf(mobCode, pbDungeonId, me.job)) : null;
    // Class not known yet this fight: use the boss's only best, if it has one.
    if (!best && me && mobCode > 0) {
      const same = [...bests.values()].filter((b) => b.mobCode === mobCode && b.dungeonId === pbDungeonId);
      if (same.length === 1) best = same[0];
    }
    // A class change (not only `hidden`) so tauriBridge's observer re-fits
    // the overlay window to the new height.
    if (!best) {
      el.hidden = true;
      el.classList.remove("isShown");
      return;
    }
    el.hidden = false;
    el.classList.add("isShown");
    el.querySelector(".pbStripLabel").textContent = t("toowhole.pb.short", "PB");
    el.querySelector(".pbStripBest").textContent = `${compact(best.dps)} · ${duration(best.durationMs)}`;
    const deltaEl = el.querySelector(".pbStripDelta");
    // Too early in a pull for the comparison to mean anything.
    if (!(Number(battleTimeMs) >= 5000) || !(me.dps > 0)) {
      deltaEl.textContent = "";
      deltaEl.className = "pbStripDelta";
      return;
    }
    const diff = me.dps - best.dps;
    const pct = best.dps > 0 ? (diff / best.dps) * 100 : 0;
    deltaEl.textContent = `${diff >= 0 ? "▲ +" : "▼ "}${compact(diff)} (${diff >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
    deltaEl.className = `pbStripDelta ${diff >= 0 ? "isAhead" : "isBehind"}`;
  };

  // --- New-best banner ------------------------------------------------------
  const celebrate = ({ best, previousDps }) => {
    const meter = document.querySelector(".meter");
    if (!meter || !best) return;
    const banner = document.createElement("div");
    banner.className = "pbBanner";
    const title = document.createElement("div");
    title.className = "pbBannerTitle";
    title.textContent = previousDps
      ? t("toowhole.pb.new", "New Personal Best!")
      : t("toowhole.pb.first", "First Clear Recorded!");
    const body = document.createElement("div");
    body.className = "pbBannerBody";
    const gain = previousDps ? `  (+${compact(best.dps - previousDps)})` : "";
    body.textContent = `${best.bossName} — ${compact(best.dps)} DPS${gain}`;
    banner.append(title, body);
    meter.appendChild(banner);
    setTimeout(() => banner.classList.add("isLeaving"), 6000);
    setTimeout(() => banner.remove(), 6800);
  };

  // --- Trophy list ----------------------------------------------------------
  let panel;
  const ensurePanel = () => {
    if (panel) return panel;
    const meter = document.querySelector(".meter");
    if (!meter) return null;
    panel = document.createElement("div");
    panel.className = "pbPanel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="pbPanelHeader">
        <span class="pbPanelTitle"></span>
        <button type="button" class="pbPanelClose" aria-label="Close">✕</button>
      </div>
      <div class="pbPanelList"></div>
      <div class="pbPanelFooter">
        <button type="button" class="pbPanelReset"></button>
      </div>`;
    meter.appendChild(panel);
    panel.querySelector(".pbPanelClose").addEventListener("click", () => togglePanel(false));
    let armed = false;
    const reset = panel.querySelector(".pbPanelReset");
    reset.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        reset.textContent = t("toowhole.pb.resetConfirm", "Click again to erase all bests");
        setTimeout(() => {
          armed = false;
          renderList();
        }, 4000);
        return;
      }
      armed = false;
      invoke("clear_personal_bests").then(() => setAll([])).catch(() => {});
    });
    return panel;
  };

  const renderList = () => {
    if (!panel) return;
    panel.querySelector(".pbPanelTitle").textContent = t("toowhole.pb.title", "Personal Bests");
    panel.querySelector(".pbPanelReset").textContent = t("toowhole.pb.reset", "Reset bests");
    const list = panel.querySelector(".pbPanelList");
    list.textContent = "";
    const items = [...bests.values()].sort((a, b) => b.achievedAtMs - a.achievedAtMs);
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pbPanelEmpty";
      empty.textContent = t(
        "toowhole.pb.empty",
        "No bests yet. Clear a boss (20s or longer) and your DPS is recorded here."
      );
      list.appendChild(empty);
      return;
    }
    for (const b of items) {
      const row = document.createElement("div");
      row.className = "pbItem";
      const name = document.createElement("div");
      name.className = "pbItemBoss";
      name.textContent = b.bossName || `#${b.mobCode}`;
      const meta = document.createElement("div");
      meta.className = "pbItemMeta";
      const tier = dungeonLabel(b.dungeonId);
      const when = new Date(Number(b.achievedAtMs) || 0).toLocaleDateString();
      meta.textContent = [tier, b.job, duration(b.durationMs), when].filter(Boolean).join(" · ");
      const dps = document.createElement("div");
      dps.className = "pbItemDps";
      dps.textContent = compact(b.dps);
      const left = document.createElement("div");
      left.className = "pbItemText";
      left.append(name, meta);
      row.append(left, dps);
      list.appendChild(row);
    }
  };

  const togglePanel = (force) => {
    const p = ensurePanel();
    if (!p) return;
    const show = typeof force === "boolean" ? force : p.hidden;
    if (show) {
      renderList();
      reload();
    }
    p.hidden = !show;
    // Grow the meter (and so the overlay window) to fit the list.
    p.classList.toggle("isOpen", show);
    document.querySelector(".meter")?.classList.toggle("pbOpen", show);
  };

  const bindButton = () => {
    const btn = document.querySelector(".pbBtn");
    if (!btn) return;
    btn.addEventListener("click", () => togglePanel());
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        togglePanel();
      }
    });
  };

  const start = () => {
    bindButton();
    reload();
    tauri?.event?.listen?.("personal-best", (event) => {
      const outcome = event?.payload;
      if (!outcome?.best) return;
      const b = outcome.best;
      bests.set(keyOf(b.mobCode, b.dungeonId, b.job), b);
      renderList();
      celebrate(outcome);
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.TooWholePB = { onFrame, reload, toggle: togglePanel };
})();
