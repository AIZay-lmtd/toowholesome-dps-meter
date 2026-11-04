// TooWholesome DPS: the Checklist. Dailies, weeklies and event limits per
// character (tasks in taskList.js, arithmetic in taskLogic.js, both from
// Nyerk). Where the game says a count (entries, keys, Odyle Energy, arena
// records, duties, shop limits: src-tauri/src/checklist.rs), the row fills
// itself and shows "auto"; everything else is ticked by hand. Counts clear
// at the daily (07:00 UTC) or weekly (Wednesday) reset.
(() => {
  const view = window.__A2_VIEW__ || new URLSearchParams(window.location.search).get("view");
  if (view === "settings") return;

  const L = window.taskLogic;
  const { TASKS, FOLDED_GROUPS } = window.tasks || {};
  if (!L || !TASKS) return;

  const invoke = (cmd, args) =>
    window.__TAURI__?.core?.invoke?.(cmd, args) ?? Promise.reject(new Error("no tauri"));
  const bridge = () => window.javaBridge;
  const KEY = "toowholesome.checklist";
  const TABS = [["daily", "Daily"], ["weekly", "Weekly"], ["event", "Event"]];
  const PVP_MODE = { 1: "Arena of Solitude", 2: "Arena of Cooperation", 3: "Battlefield" };

  let tab = "daily";
  let game = { chars: {}, current: null };
  let panel;
  const unfolded = new Set();

  // { entries: { scopeKey: { taskId: entry } }, pvp: { charKey: { mode: kept } }, member: { server: set }, optional }
  const load = () => {
    try {
      return JSON.parse(bridge()?.getSetting?.(KEY) || "{}");
    } catch {
      return {};
    }
  };
  const save = (data) => bridge()?.setSetting?.(KEY, JSON.stringify(data));

  const timers = (now) => {
    const at = (id) => nextStart(TIMERS.find((t) => t.id === id).schedule, now);
    return { dailyReset: at("dailyReset"), weeklyReset: at("weeklyReset") };
  };

  const character = () => {
    const g = game.current && game.chars[game.current];
    return g ? { key: game.current, name: g.name, server: g.server, g } : { key: "0:Me", name: "Me", server: 0, g: null };
  };

  /** This week's arena matches and wins, from the season record and where the week began. */
  const pvpThisWeek = (data, char, now, t) => {
    const out = {};
    const record = char.g?.pvp;
    if (!record) return out;
    const weekStart = t.weeklyReset - 7 * L.DAY;
    const kept = (data.pvp ??= {})[char.key] ??= {};
    for (const [mode, r] of Object.entries(record)) {
      kept[mode] = L.pvpBase(kept[mode], r, char.g.pvpAt ?? now, weekStart);
      out[mode] = L.pvpWeek(r, kept[mode].base);
    }
    return out;
  };

  const render = () => {
    if (!panel || panel.hidden) return;
    const now = Date.now();
    const t = timers(now);
    const data = load();
    const char = character();
    const memberSet = data.member?.[char.server];
    const member = L.memberOf(memberSet, L.membershipEnd(char.g?.benefits), now).member;
    const before = JSON.stringify(data.pvp ?? null);
    const pvp = pvpThisWeek(data, char, now, t);
    if (JSON.stringify(data.pvp ?? null) !== before) save(data);

    panel.querySelector(".checklistWho").textContent = char.g
      ? `${char.name} · resets in ${L.duration((tab === "daily" ? t.dailyReset : t.weeklyReset) - now)}`
      : "Log in with the meter running to fill this in automatically.";
    panel.querySelector(".checklistMember").checked = member;
    panel.querySelector(".checklistOptional").checked = !!data.optional;
    panel.querySelectorAll(".checklistTabs button").forEach((b) => b.classList.toggle("isActive", b.dataset.tab === tab));

    const list = panel.querySelector(".checklistList");
    list.textContent = "";
    const shown = TASKS.filter((task) => task.tab === tab && L.shown(task, { member, optional: !!data.optional, now }));
    if (!shown.length) {
      list.innerHTML = '<div class="pbPanelEmpty">Nothing here right now.</div>';
      return;
    }
    let group = null;
    let folded = false;
    for (const task of shown) {
      if (task.group !== group) {
        group = task.group;
        folded = FOLDED_GROUPS.has(group) && !unfolded.has(group);
        const head = document.createElement("button");
        head.type = "button";
        head.className = "checklistGroup";
        head.textContent = `${folded ? "▸" : "▾"} ${group}`;
        const g = group;
        head.addEventListener("click", () => {
          if (unfolded.has(g)) unfolded.delete(g);
          else if (FOLDED_GROUPS.has(g)) unfolded.add(g);
          render();
        });
        list.appendChild(head);
      }
      if (!folded) list.appendChild(row(task, data, char, member, now, t, pvp));
    }
  };

  const row = (task, data, char, member, now, t, pvp) => {
    const scope = L.scopeKey(task, char);
    const entries = ((data.entries ??= {})[scope] ??= {});
    let entry = entries[task.id];
    let auto = null;
    let note = "";
    if (task.game?.pvp !== undefined) {
      const week = pvp[task.game.pvp];
      if (week) {
        entry = { used: week[task.game.count], until: L.resetOf(task, t) };
        auto = true;
        note = PVP_MODE[task.game.pvp] ? "from your arena record" : "";
      }
    } else {
      const g = L.fromGame(task, char.g, member, now, t);
      if (g?.entry) {
        entry = g.entry;
        auto = true;
        note = g.note || "";
      } else if (g?.left !== undefined) {
        note = `${L.duration(g.left)} left this week`;
        auto = true;
      }
    }
    const cap = L.capOf(task, member, now);
    const done = L.isDone(task, entry, member, now);

    const el = document.createElement("div");
    el.className = "checklistRow" + (done ? " isDone" : "");
    const text = document.createElement("div");
    text.className = "pbItemText";
    const name = document.createElement("div");
    name.className = "pbItemBoss";
    name.textContent = task.name;
    if (auto) {
      const badge = document.createElement("span");
      badge.className = "checklistAuto";
      badge.textContent = "auto";
      badge.title = "Read from the game";
      name.appendChild(badge);
    }
    const meta = document.createElement("div");
    meta.className = "pbItemMeta";
    meta.textContent = [note, task.detail].filter(Boolean).join(" · ");
    meta.title = [task.detail, task.tip, task.unlock && `Unlocks: ${task.unlock}`].filter(Boolean).join("\n");
    text.append(name, meta);

    const control = document.createElement("div");
    control.className = "checklistControl";
    const edit = (next) => {
      const d = load();
      ((d.entries ??= {})[scope] ??= {})[task.id] = next;
      save(d);
      render();
    };
    if (task.kind === "check") {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = L.doneOf(entry, now);
      box.addEventListener("change", () => edit(L.setDone(task, box.checked, t)));
      control.appendChild(box);
    } else if (task.kind === "count") {
      const used = L.usedOf(entry, now);
      const minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "−";
      minus.disabled = !!auto || used <= 0;
      minus.addEventListener("click", () => edit(L.setUsed(task, used - 1, member, now, t)));
      const value = document.createElement("span");
      value.className = "checklistValue";
      value.textContent = cap == null ? `${used}` : `${used}/${cap}`;
      const plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+";
      plus.disabled = !!auto || (cap != null && used >= cap);
      plus.addEventListener("click", () => edit(L.setUsed(task, used + 1, member, now, t)));
      control.append(minus, value, plus);
    } else {
      const bank = L.bankNow(task, entry, member, now, t.dailyReset);
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.className = "checklistBank";
      input.value = bank.value ?? "";
      input.placeholder = "?";
      input.disabled = !!auto;
      input.addEventListener("keydown", (e) => e.stopPropagation());
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (Number.isFinite(v)) edit(L.setValue(task, v, member, Date.now()));
      });
      const capEl = document.createElement("span");
      capEl.className = "checklistValue";
      capEl.textContent = bank.cap == null ? "" : `/${bank.cap}`;
      control.append(input, capEl);
      if (bank.fullAt) meta.textContent = `full in ${L.duration(bank.fullAt - now)} · ` + meta.textContent;
      else if (bank.cap != null && bank.value >= bank.cap) {
        meta.textContent = "full: spend some · " + meta.textContent;
        el.classList.add("isFull");
      }
    }
    el.append(text, control);
    return el;
  };

  const refreshGame = () =>
    invoke("get_checklist_game")
      .then((g) => {
        if (g && typeof g === "object") game = { chars: g.chars || {}, current: g.current || null };
        render();
      })
      .catch(() => render());

  const ensurePanel = () => {
    if (panel) return panel;
    const meter = document.querySelector(".meter");
    if (!meter) return null;
    panel = document.createElement("div");
    panel.className = "pbPanel checklistPanel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="pbPanelHeader">
        <span class="pbPanelTitle">Checklist</span>
        <button type="button" class="pbPanelClose" aria-label="Close">✕</button>
      </div>
      <div class="checklistWho"></div>
      <div class="checklistBar">
        <div class="checklistTabs petsFilters" role="group"></div>
        <label title="Membership raises some limits. Read from the game when it says; tick to set it yourself."><input type="checkbox" class="checklistMember" /> Member</label>
        <label><input type="checkbox" class="checklistOptional" /> Optional</label>
      </div>
      <div class="pbPanelList checklistList"></div>`;
    const tabs = panel.querySelector(".checklistTabs");
    for (const [id, label] of TABS) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.tab = id;
      b.textContent = label;
      b.addEventListener("click", () => {
        tab = id;
        render();
      });
      tabs.appendChild(b);
    }
    panel.querySelector(".checklistMember").addEventListener("change", (e) => {
      const d = load();
      const server = character().server;
      const auto = L.memberOf(undefined, L.membershipEnd(character().g?.benefits), Date.now()).auto;
      (d.member ??= {})[server] = { on: e.target.checked, game: auto };
      save(d);
      render();
    });
    panel.querySelector(".checklistOptional").addEventListener("change", (e) => {
      const d = load();
      d.optional = e.target.checked;
      save(d);
      render();
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
    document.querySelector(".meter")?.classList.toggle("checklistOpen", show);
    if (show) refreshGame();
  };

  const start = () => {
    const btn = document.querySelector(".checklistBtn");
    btn?.addEventListener("click", () => toggle());
    btn?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    window.__TAURI__?.event?.listen?.("checklist-game", () => {
      if (panel && !panel.hidden) refreshGame();
    });
    // Countdowns and resets move on while it is open.
    setInterval(render, 30_000);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
