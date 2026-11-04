// TooWholesome DPS: the pet collection, read from the game's traffic
// (src-tauri/src/pets.rs). The paw button opens the list: collected count,
// the next collection reward, and every pet with its rank and souls toward
// the next one. Clicking a pet opens its page: which monsters drop its souls
// and where (assets/pets/guide.json, from PetTracker by 0Fox2Give, GPL-3.0,
// drop data from aion2maps.com), and a live arrow while they are around you.
// A notice shows when a pet ranks up. Pets whose monsters you have attacked
// lately ("hunting") lead the In progress list, and one pet can be pinned
// under the strip with its souls and arrow: a chosen one, or "auto", which
// follows whatever you are hunting.
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
  let filter = "todo";
  let search = "";
  let panel;
  let selected = null;
  let guide = null;
  let sources = null;
  let bar;

  /** A pet counts as hunted for this long after you last hit one of its monsters. */
  const RECENT_MS = 30 * 60_000;
  const PIN_KEY = "toowholesome.petPin";
  const RECENT_KEY = "toowholesome.petRecent";
  const getSetting = (key) => {
    try {
      return window.javaBridge?.getSetting?.(key) ?? "";
    } catch {
      return "";
    }
  };
  const setSetting = (key, value) => window.javaBridge?.setSetting?.(key, value);
  // "" (none), "auto" (follow your hunt) or a pet id.
  let pin = "";
  // petId -> when you last hit one of its monsters or gained its souls.
  const recent = new Map();
  let recentSavedAt = 0;

  const huntedAt = (id) => {
    const at = recent.get(id);
    return at && Date.now() - at < RECENT_MS ? at : 0;
  };

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
          : p.rank != null && p.rank < 3 && (p.rank > 0 || p.souls > 0 || huntedAt(p.id) > 0)
      )
      .sort((a, b) =>
        (filter === "todo" ? huntedAt(b.id) - huntedAt(a.id) || remaining(a) - remaining(b) : 0) ||
        a.name.localeCompare(b.name)
      );
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
      row.className = "petRow" + (p.id === data.equipped ? " isEquipped" : "") + (huntedAt(p.id) ? " isHunting" : "");
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
      meta.textContent = (huntedAt(p.id) ? "Hunting · " : "") + soulsText(p);
      text.append(name, meta, soulsBar(p));
      const rank = document.createElement("div");
      rank.className = "petRank" + (p.rank >= 3 ? " isMax" : "");
      rank.textContent = rankLabel(p);
      row.append(portrait, text, rank);
      list.appendChild(row);
    }
  };

  const soulsText = (p) =>
    p.goal == null
      ? `${p.family} · maxed`
      : `${p.family} · ${p.souls}/${p.goal} souls${p.rank === 0 ? " to unlock" : ` to R${p.rank + 1}`}`;

  const soulsBar = (p) => {
    const bar = document.createElement("div");
    bar.className = "petBar";
    const fill = document.createElement("div");
    fill.style.width = p.goal == null ? "100%" : `${Math.min(100, (p.souls / p.goal) * 100)}%`;
    bar.appendChild(fill);
    return bar;
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
      pointArrow(arrow, n);
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
    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "petMapBtn petPinBtn";
    const pinned = pin === String(p.id);
    pinBtn.textContent = pinned ? "Unpin from meter" : "📌 Pin to meter";
    pinBtn.title = "Keep this pet's souls and arrow on the meter with the panel closed";
    pinBtn.addEventListener("click", () => {
      setPin(pinned ? "" : String(p.id));
      renderDetail();
    });
    box.querySelector(".petMaps").appendChild(pinBtn);
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

  const pointArrow = (arrow, n) => {
    if (n?.bearing == null) {
      arrow.textContent = "·";
      arrow.title = "Use a skill to update your position";
      arrow.style.transform = "";
    } else {
      arrow.textContent = "↑";
      arrow.title = "Map direction, north up";
      arrow.style.transform = `rotate(${n.bearing}deg)`;
    }
  };

  // The pinned pet: the chosen one, or in auto the one you hunted last.
  const pinnedPet = () => {
    if (!pin || !data) return null;
    if (pin !== "auto") return data.pets.find((p) => String(p.id) === pin) ?? null;
    let best = null;
    for (const p of data.pets) {
      if (p.rank >= 3 || !huntedAt(p.id)) continue;
      if (!best || huntedAt(p.id) > huntedAt(best.id)) best = p;
    }
    return best;
  };

  // The pinned pet under the strip.
  const renderBar = () => {
    if (!bar) return;
    const p = pinnedPet();
    const show = !!pin && !!data?.syncedAtMs;
    if (bar.hidden === show) bar.hidden = !show;
    document.querySelector(".meter")?.classList.toggle("petPinned", show);
    if (!show) return;
    bar.dataset.petId = p ? p.id : "";
    const img = bar.querySelector(".petPortrait");
    const name = bar.querySelector(".pbItemBoss");
    const meta = bar.querySelector(".pbItemMeta");
    const arrow = bar.querySelector(".petArrow");
    const dist = bar.querySelector(".petDistance");
    if (!p) {
      img.classList.add("isMissing");
      img.removeAttribute("src");
      name.textContent = "Tracking your hunt";
      meta.textContent = "Attack a monster that drops pet souls";
      bar.querySelector(".petBar > div").style.width = "0%";
      arrow.textContent = "";
      dist.textContent = "";
      return;
    }
    const src = `./assets/pets/${p.id}.png`;
    if (img.getAttribute("src") !== src) {
      img.classList.remove("isMissing");
      img.src = src;
    }
    name.textContent = (pin === "auto" ? "Hunting: " : "") + p.name;
    meta.textContent = soulsText(p);
    bar.querySelector(".petBar > div").style.width = p.goal == null ? "100%" : `${Math.min(100, (p.souls / p.goal) * 100)}%`;
    const n = nearby.find((x) => x.petId === p.id);
    pointArrow(arrow, n);
    if (!n) arrow.textContent = "";
    dist.textContent = !n ? "not near" : n.distance == null ? "nearby" : metres(n.distance);
  };

  const ensureBar = () => {
    if (bar) return bar;
    const strip = document.querySelector(".toolStrip");
    if (!strip) return null;
    bar = document.createElement("div");
    bar.className = "petPin";
    bar.hidden = true;
    bar.setAttribute("data-no-drag", "");
    bar.setAttribute("role", "button");
    bar.tabIndex = 0;
    bar.title = "Open this pet's page";
    bar.innerHTML = `
      <img class="petPortrait" alt="" />
      <div class="pbItemText"><div class="pbItemBoss"></div><div class="pbItemMeta"></div><div class="petBar"><div></div></div></div>
      <div class="petArrow"></div>
      <div class="petDistance"></div>
      <button type="button" class="petPinClose" aria-label="Unpin" title="Unpin">✕</button>`;
    bar.querySelector(".petPortrait").onerror = (e) => e.target.classList.add("isMissing");
    bar.querySelector(".petPinClose").addEventListener("click", (e) => {
      e.stopPropagation();
      setPin("");
    });
    const open = () => {
      const id = Number(bar.dataset.petId);
      toggle(true);
      if (id) openPet(id);
    };
    bar.addEventListener("click", open);
    bar.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    strip.after(bar);
    return bar;
  };

  const setPin = (value) => {
    pin = value;
    setSetting(PIN_KEY, value);
    panel?.querySelector(".petAutoBtn")?.setAttribute("aria-pressed", String(pin === "auto"));
    if (pin && !data) load();
    renderBar();
  };

  // You hit one of this pet's monsters, or gained its souls.
  const hunted = (id) => {
    const before = huntedAt(id);
    const now = Date.now();
    recent.set(id, now);
    if (now - recentSavedAt > 30_000 || !before) {
      recentSavedAt = now;
      const kept = {};
      for (const [k, at] of recent) if (now - at < RECENT_MS) kept[k] = at;
      setSetting(RECENT_KEY, JSON.stringify(kept));
    }
    if (before) return;
    // A newly hunted pet moves to the top of In progress and into an auto pin.
    renderBar();
    if (panel && !panel.hidden && selected == null) render();
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
    pointArrow(arrow, n);
    if (n.bearing == null) {
      box.querySelector(".petBigDistance").textContent = "In range";
      box.querySelector(".pbItemMeta").textContent = "Use any skill to update your position and get the arrow.";
    } else {
      box.querySelector(".petBigDistance").textContent = `${metres(n.distance)} away`;
      box.querySelector(".pbItemMeta").textContent = "Nearest one, as on your map (north is up). Use a skill now and then to keep it fresh.";
    }
  };

  const pollNearby = () =>
    invoke("get_pet_nearby")
      .then((list) => {
        nearby = Array.isArray(list) ? list : [];
        renderBar();
        if (!panel || panel.hidden) return;
        if (selected != null) renderCompass();
        else renderNearby();
      })
      .catch(() => {});

  const load = () =>
    invoke("get_pets")
      .then((v) => {
        data = v;
        renderBar();
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
        <button type="button" class="petAutoBtn" title="Pin whichever pet you are hunting to the meter, with its souls and arrow">📌 Track my hunt</button>
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
    const auto = panel.querySelector(".petAutoBtn");
    auto.setAttribute("aria-pressed", String(pin === "auto"));
    auto.addEventListener("click", () => setPin(pin === "auto" ? "" : "auto"));
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
    pin = getSetting(PIN_KEY) || "";
    try {
      for (const [id, at] of Object.entries(JSON.parse(getSetting(RECENT_KEY) || "{}"))) recent.set(Number(id), at);
    } catch {}
    ensureBar();
    load();
    invoke("get_pet_sources")
      .then((map) => (sources = map || {}))
      .catch(() => {});
    // Positions only matter while something shows them.
    setInterval(() => {
      if ((panel && !panel.hidden) || pin) pollNearby();
    }, 500);
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
      if (n?.kind === "souls" && n.id) hunted(Number(n.id));
      if ((panel && !panel.hidden) || pin) load();
    });
  };

  // Each meter frame (core.js): the monster you are fighting.
  window.TooWholePets = {
    onFrame({ mobCode } = {}) {
      const pet = mobCode && sources?.[mobCode];
      if (pet && Date.now() - (recent.get(pet) ?? 0) > 5000) hunted(pet);
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
