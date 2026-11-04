// TooWholesome DPS: the pet collection, read from the game's traffic
// (src-tauri/src/pets.rs). The paw button opens the list: collected count,
// the next collection reward, and every pet with its rank and souls toward
// the next one. Clicking a pet opens its page: which monsters drop its souls
// and where (assets/pets/guide.json, from PetTracker by 0Fox2Give, GPL-3.0,
// drop data from aion2maps.com), and a live arrow while they are around you.
// A notice shows when a pet ranks up.
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
  let nearby = [];
  let nearbyTimer = 0;
  let filter = "todo";
  let search = "";
  let panel;
  let selected = null;
  let guide = null;

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
      clickable(row, p.id);
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

  // shortcut: assumes the game's units are Unreal centimetres (unverified); recalibrate if distances look off.
  const metres = (units) => `≈${Math.max(1, Math.round(units / 100))} m`;

  // Pets you still need whose monsters are around you, nearest first.
  const renderNearby = () => {
    const box = panel?.querySelector(".petsNearby");
    if (!box || !data) return;
    const byId = new Map(data.pets.map((p) => [p.id, p]));
    const needed = nearby.filter((n) => !(byId.get(n.petId)?.rank >= 3)).slice(0, 6);
    box.hidden = needed.length === 0;
    box.textContent = "";
    if (!needed.length) return;
    const title = document.createElement("div");
    title.className = "petsNearbyTitle";
    title.textContent = "Nearby";
    box.appendChild(title);
    for (const n of needed) {
      const p = byId.get(n.petId);
      const row = document.createElement("div");
      row.className = "petNearby";
      clickable(row, n.petId);
      const img = document.createElement("img");
      img.className = "petPortrait";
      img.alt = "";
      img.src = `./assets/pets/${n.petId}.png`;
      img.onerror = () => img.classList.add("isMissing");
      const name = document.createElement("div");
      name.className = "pbItemBoss";
      name.textContent = p?.name ?? `Pet #${n.petId}`;
      const arrow = document.createElement("div");
      arrow.className = "petArrow";
      if (n.bearing == null) {
        arrow.textContent = "·";
        arrow.title = "Use a skill to update your position";
      } else {
        arrow.textContent = "↑";
        arrow.style.transform = `rotate(${n.bearing}deg)`;
      }
      const dist = document.createElement("div");
      dist.className = "petDistance";
      dist.textContent = n.distance == null ? "nearby" : metres(n.distance);
      row.append(img, name, arrow, dist);
      box.appendChild(row);
    }
  };

  const clickable = (el, id) => {
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.addEventListener("click", () => openPet(id));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPet(id);
      }
    });
  };

  const loadGuide = () =>
    guide
      ? Promise.resolve(guide)
      : fetch("./assets/pets/guide.json")
          .then((r) => r.json())
          .catch(() => ({}))
          .then((g) => (guide = g));

  const openPet = (id) => {
    selected = id;
    loadGuide().then(renderDetail);
  };

  const closePet = () => {
    selected = null;
    panel?.classList.remove("isDetail");
    render();
    renderNearby();
  };

  // One pet's page. The compass alone is redrawn on every poll.
  const renderDetail = () => {
    const box = panel?.querySelector(".petDetail");
    const p = data?.pets.find((x) => x.id === selected);
    if (!box || !p) return closePet();
    panel.classList.add("isDetail");
    const g = guide?.[p.id] ?? {};
    box.innerHTML = `
      <button type="button" class="petBack">‹ All pets</button>
      <div class="petDetailHead">
        <img class="petPortrait petBig" alt="" />
        <div class="pbItemText">
          <div class="pbItemBoss"></div>
          <div class="pbItemMeta petDetailRank"></div>
          <div class="petBar"><div></div></div>
        </div>
      </div>
      <div class="petCompass"></div>
      <div class="petDetailSection petHow" hidden></div>
      <div class="petDetailSection petDrops" hidden><div class="petsNearbyTitle">Souls drop from</div></div>
      <div class="petMaps"></div>`;
    box.querySelector(".petBack").addEventListener("click", closePet);
    const img = box.querySelector(".petBig");
    img.src = `./assets/pets/${p.id}.png`;
    img.onerror = () => img.classList.add("isMissing");
    box.querySelector(".pbItemBoss").textContent = p.name + (p.id === data.equipped ? " ★" : "");
    box.querySelector(".petDetailRank").textContent = p.goal == null
      ? `${p.family} · ${rankLabel(p)} · maxed`
      : `${p.family} · ${rankLabel(p)} · ${p.souls}/${p.goal} souls${p.rank === 0 ? " to unlock" : ` to R${p.rank + 1}`} (${remaining(p)} to go)`;
    box.querySelector(".petBar > div").style.width = p.goal == null ? "100%" : `${Math.min(100, (p.souls / p.goal) * 100)}%`;
    if (g.how) {
      const how = box.querySelector(".petHow");
      how.hidden = false;
      how.textContent = g.how;
    }
    if (g.drops?.length) {
      const drops = box.querySelector(".petDrops");
      drops.hidden = false;
      for (const [name, region] of g.drops) {
        const row = document.createElement("div");
        row.className = "petDrop";
        row.innerHTML = "<span></span><span class=\"petRegion\"></span>";
        row.firstChild.textContent = name;
        row.lastChild.textContent = region;
        drops.appendChild(row);
      }
    }
    for (const [region, url] of g.maps ?? []) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "petMapBtn";
      b.textContent = `Open ${region} map ↗`;
      b.title = "Spawn map on aion2maps.com, in your browser";
      b.addEventListener("click", () => window.javaBridge?.openBrowser?.(url));
      box.querySelector(".petMaps").appendChild(b);
    }
    if (!g.drops?.length && !g.how) {
      box.querySelector(".petHow").hidden = false;
      box.querySelector(".petHow").textContent = "No known source for this pet's souls yet.";
    }
    renderCompass();
  };

  const renderCompass = () => {
    const box = panel?.querySelector(".petCompass");
    if (!box || selected == null) return;
    const n = nearby.find((x) => x.petId === selected);
    const farmable = !!guide?.[selected]?.drops?.length;
    box.hidden = !n && !farmable;
    if (!n) {
      box.className = "petCompass isAway";
      box.textContent = "None of its monsters are around you right now. Head to a zone below; an arrow shows here once they are in range.";
      return;
    }
    box.className = "petCompass";
    box.innerHTML = '<div class="petArrow petBigArrow"></div><div><div class="petBigDistance"></div><div class="pbItemMeta"></div></div>';
    const arrow = box.querySelector(".petArrow");
    if (n.bearing == null) {
      arrow.textContent = "·";
      box.querySelector(".petBigDistance").textContent = "In range";
      box.querySelector(".pbItemMeta").textContent = "Use any skill to update your position and get the arrow.";
    } else {
      arrow.textContent = "↑";
      arrow.style.transform = `rotate(${n.bearing}deg)`;
      box.querySelector(".petBigDistance").textContent = `${metres(n.distance)} away`;
      box.querySelector(".pbItemMeta").textContent = "Nearest one, as on your map (north is up). Use a skill now and then to keep it fresh.";
    }
  };

  const pollNearby = () =>
    invoke("get_pet_nearby")
      .then((list) => {
        nearby = Array.isArray(list) ? list : [];
        if (selected != null) renderCompass();
        else renderNearby();
      })
      .catch(() => {});

  const load = () =>
    invoke("get_pets")
      .then((v) => {
        data = v;
        if (selected != null) return renderDetail();
        render();
        renderNearby();
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
      <div class="petsNearby" hidden></div>
      <div class="petsControls">
        <input type="search" class="petsSearch" placeholder="Search pets or family…" spellcheck="false" />
        <div class="petsFilters" role="group"></div>
      </div>
      <div class="pbPanelList petsList"></div>
      <div class="pbPanelList petDetail"></div>`;
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
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && selected != null) {
        e.stopPropagation();
        closePet();
      }
    });
    meter.appendChild(panel);
    return panel;
  };

  const toggle = (force) => {
    const p = ensurePanel();
    if (!p) return;
    const show = typeof force === "boolean" ? force : p.hidden;
    if (show) load();
    p.hidden = !show;
    clearInterval(nearbyTimer);
    if (show) nearbyTimer = setInterval(pollNearby, 500);
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
