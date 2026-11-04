// TooWholesome DPS: the pet collection, read from the game's traffic
// (src-tauri/src/pets.rs). The paw button opens the list: collected count,
// the next collection reward, and every pet with its rank and souls toward
// the next one. A notice shows when a pet ranks up.
(() => {
  const view = window.__A2_VIEW__ || new URLSearchParams(window.location.search).get("view");
  if (view === "settings") return;

  const tauri = window.__TAURI__;
  const invoke = (cmd, args) => tauri?.core?.invoke?.(cmd, args) ?? Promise.reject(new Error("no tauri"));

  /** Collection rewards come every 10 pets owned. */
  const REWARD_STEP = 10;
  const FILTERS = [
    ["todo", "In progress"],
    ["missing", "Not collected"],
    ["all", "All"],
    ["max", "Maxed"],
  ];

  let data = null;
  let filter = "todo";
  let search = "";
  let panel;

  const remaining = (p) => (p.goal == null ? Infinity : Math.max(0, p.goal - p.souls));
  const rankLabel = (p) => (p.rank == null ? "?" : p.rank === 0 ? "—" : p.rank >= 3 ? "MAX" : `R${p.rank}`);

  const visible = () => {
    const q = search.trim().toLowerCase();
    return data.pets
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.family.toLowerCase().includes(q))
      .filter((p) =>
        filter === "all" ? true
          : filter === "max" ? p.rank >= 3
          : filter === "missing" ? p.rank === 0
          : p.rank != null && p.rank < 3 && (p.rank > 0 || p.souls > 0)
      )
      .sort((a, b) => (filter === "todo" ? remaining(a) - remaining(b) : 0) || a.name.localeCompare(b.name));
  };

  const render = () => {
    if (!panel || !data) return;
    const owned = data.pets.filter((p) => p.rank > 0).length;
    const maxed = data.pets.filter((p) => p.rank >= 3).length;
    const nextReward = (Math.floor(owned / REWARD_STEP) + 1) * REWARD_STEP;
    const summary = panel.querySelector(".petsSummary");
    if (!data.syncedAtMs) {
      summary.textContent = "Log in to a character (or change zones) with the meter running to read your collection.";
    } else {
      const who = data.character ? `${data.character} · ` : "";
      summary.textContent = `${who}${owned}/${data.pets.length} collected · ${maxed} maxed · next reward at ${nextReward} (${nextReward - owned} to go)`;
    }
    const list = panel.querySelector(".petsList");
    list.textContent = "";
    const rows = data.syncedAtMs ? visible() : [];
    if (data.syncedAtMs && rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pbPanelEmpty";
      empty.textContent = "No pets match.";
      list.appendChild(empty);
    }
    for (const p of rows.slice(0, 150)) {
      const row = document.createElement("div");
      row.className = "petRow" + (p.id === data.equipped ? " isEquipped" : "");
      const portrait = document.createElement("img");
      portrait.className = "petPortrait";
      portrait.alt = "";
      portrait.loading = "lazy";
      portrait.src = `./assets/pets/${p.id}.png`;
      portrait.onerror = () => portrait.classList.add("isMissing");
      const text = document.createElement("div");
      text.className = "pbItemText";
      const name = document.createElement("div");
      name.className = "pbItemBoss";
      name.textContent = p.name + (p.id === data.equipped ? " ★" : "");
      const meta = document.createElement("div");
      meta.className = "pbItemMeta";
      meta.textContent = p.goal == null
        ? `${p.family} · maxed`
        : `${p.family} · ${p.souls}/${p.goal} souls${p.rank === 0 ? " to unlock" : ` to R${p.rank + 1}`}`;
      const bar = document.createElement("div");
      bar.className = "petBar";
      const fill = document.createElement("div");
      fill.style.width = p.goal == null ? "100%" : `${Math.min(100, (p.souls / p.goal) * 100)}%`;
      bar.appendChild(fill);
      text.append(name, meta, bar);
      const rank = document.createElement("div");
      rank.className = "petRank" + (p.rank >= 3 ? " isMax" : "");
      rank.textContent = rankLabel(p);
      row.append(portrait, text, rank);
      list.appendChild(row);
    }
  };

  const load = () =>
    invoke("get_pets")
      .then((v) => {
        data = v;
        render();
      })
      .catch(() => {});

  const ensurePanel = () => {
    if (panel) return panel;
    const meter = document.querySelector(".meter");
    if (!meter) return null;
    panel = document.createElement("div");
    panel.className = "pbPanel petsPanel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="pbPanelHeader">
        <span class="pbPanelTitle">Pets</span>
        <button type="button" class="pbPanelClose" aria-label="Close">✕</button>
      </div>
      <div class="petsSummary"></div>
      <div class="petsControls">
        <input type="search" class="petsSearch" placeholder="Search pets or family…" spellcheck="false" />
        <div class="petsFilters" role="group"></div>
      </div>
      <div class="pbPanelList petsList"></div>`;
    const filters = panel.querySelector(".petsFilters");
    for (const [key, label] of FILTERS) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.filter = key;
      b.textContent = label;
      b.classList.toggle("isActive", key === filter);
      b.addEventListener("click", () => {
        filter = key;
        filters.querySelectorAll("button").forEach((x) => x.classList.toggle("isActive", x === b));
        render();
      });
      filters.appendChild(b);
    }
    const input = panel.querySelector(".petsSearch");
    input.addEventListener("input", () => {
      search = input.value;
      render();
    });
    input.addEventListener("keydown", (e) => e.stopPropagation());
    panel.querySelector(".pbPanelClose").addEventListener("click", () => toggle(false));
    meter.appendChild(panel);
    return panel;
  };

  const toggle = (force) => {
    const p = ensurePanel();
    if (!p) return;
    const show = typeof force === "boolean" ? force : p.hidden;
    if (show) load();
    p.hidden = !show;
    // Class changes re-fit the overlay window (tauriBridge) and the lock's click area (core.js).
    p.classList.toggle("isOpen", show);
    document.querySelector(".meter")?.classList.toggle("petsOpen", show);
  };

  const notice = (text) => {
    const meter = document.querySelector(".meter");
    if (!meter) return;
    const banner = document.createElement("div");
    banner.className = "pbBanner";
    banner.innerHTML = '<div class="pbBannerTitle"></div><div class="pbBannerBody"></div>';
    banner.querySelector(".pbBannerTitle").textContent = "Pet Rank Up!";
    banner.querySelector(".pbBannerBody").textContent = text;
    meter.appendChild(banner);
    setTimeout(() => banner.classList.add("isLeaving"), 5000);
    setTimeout(() => banner.remove(), 5800);
  };

  const start = () => {
    const btn = document.querySelector(".petsBtn");
    btn?.addEventListener("click", () => toggle());
    btn?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    tauri?.event?.listen?.("pets-changed", (event) => {
      const n = event?.payload;
      if (n?.kind === "rank") notice(`${n.name} reached ${n.rank >= 3 ? "MAX rank" : `rank ${n.rank}`}`);
      if (panel && !panel.hidden) load();
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
