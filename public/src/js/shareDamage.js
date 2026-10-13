// TooWholesome DPS: the header's Share button.
//
// Copies the fight on the meter as text, in one of two shapes:
//   - Party chat: one short line to paste into the game's chat
//     (Enter, Ctrl+V, Enter). The meter never types into the game itself:
//     it only reads traffic, and sending input would change that.
//   - Discord: a monospaced table with every row the meter shows.
// core.js calls TooWholeShare.onFrame() after each render with what is on
// screen, so the text always matches the meter.
(() => {
  const view = window.__A2_VIEW__ || new URLSearchParams(window.location.search).get("view");
  if (view === "settings") return;

  /** Game chat lines are short; stay well inside the limit. */
  const PARTY_LINE_MAX = 180;

  let latest = { rows: [], battleTimeMs: 0, targetLabel: "" };

  const onFrame = ({ rows, battleTimeMs, targetLabel }) => {
    latest = {
      rows: Array.isArray(rows) ? rows.filter((r) => Number(r?.dps) > 0) : [],
      battleTimeMs: Number(battleTimeMs) || 0,
      targetLabel: String(targetLabel || "").trim(),
    };
  };

  const compact = (n) => {
    const v = Math.abs(Number(n) || 0);
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return String(Math.round(v));
  };
  const grouped = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
  const clock = (ms) => {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const share = (row, total) => {
    const pct = Number.isFinite(row.damageContribution) && row.damageContribution > 0
      ? row.damageContribution
      : total > 0 ? (row.totalDamage / total) * 100 : 0;
    return `${Math.round(pct)}%`;
  };
  const sorted = () => [...latest.rows].sort((a, b) => b.dps - a.dps);
  const totalDamage = (rows) => rows.reduce((sum, r) => sum + (Number(r.totalDamage) || 0), 0);
  const heading = () => {
    const parts = [latest.targetLabel, latest.battleTimeMs > 0 ? clock(latest.battleTimeMs) : ""];
    return parts.filter(Boolean).join(" ");
  };

  /** One line for party chat, cut at a whole player to fit. */
  const partyLine = () => {
    const rows = sorted();
    const total = totalDamage(rows);
    let line = `[TooWholesome DPS] ${heading()}`.trim();
    rows.forEach((row, i) => {
      const part = ` | ${i + 1}. ${row.name} ${compact(row.dps)} (${share(row, total)})`;
      if (line.length + part.length <= PARTY_LINE_MAX) line += part;
    });
    return line;
  };

  /** A table for Discord, in a code block so the columns line up. */
  const discordTable = () => {
    const rows = sorted();
    const total = totalDamage(rows);
    const cell = (text, width, right = false) => {
      const s = String(text);
      const cut = s.length > width ? `${s.slice(0, width - 1)}~` : s;
      return right ? cut.padStart(width) : cut.padEnd(width);
    };
    const lines = [
      `${cell("#", 2, true)}  ${cell("Name", 14)} ${cell("Class", 12)} ${cell("DPS", 9, true)} ${cell("Damage", 9, true)} ${cell("Share", 6, true)}`,
    ];
    rows.forEach((row, i) => {
      lines.push(
        `${cell(i + 1, 2, true)}  ${cell(row.name, 14)} ${cell(row.job || "", 12)} ` +
          `${cell(grouped(row.dps), 9, true)} ${cell(compact(row.totalDamage), 9, true)} ${cell(share(row, total), 6, true)}`
      );
    });
    const partyDps = rows.reduce((sum, r) => sum + (Number(r.dps) || 0), 0);
    lines.push("", `Party: ${grouped(partyDps)} DPS, ${compact(total)} damage`);
    return [`**${heading() || "Fight"}** - TooWholesome DPS Meter`, "```", ...lines, "```"].join("\n");
  };

  // --- UI -------------------------------------------------------------------
  let menu;
  let note;

  const say = (text) => {
    const meter = document.querySelector(".meter");
    if (!meter) return;
    note?.remove();
    note = document.createElement("div");
    note.className = "shareNote";
    note.textContent = text;
    meter.appendChild(note);
    const mine = note;
    setTimeout(() => mine.classList.add("isLeaving"), 3500);
    setTimeout(() => mine.remove(), 4200);
  };

  const copy = async (kind) => {
    toggleMenu(false);
    if (latest.rows.length === 0) {
      say("Nothing to share yet. Hit something first.");
      return;
    }
    const text = kind === "party" ? partyLine() : discordTable();
    try {
      // The backend writes the clipboard; the page's clipboard API is the
      // fallback (it can refuse when the overlay is not focused).
      const invoke = window.__TAURI__?.core?.invoke;
      if (invoke) {
        await invoke("copy_text", { text }).catch(() => navigator.clipboard.writeText(text));
      } else {
        await navigator.clipboard.writeText(text);
      }
      say(kind === "party"
        ? "Copied! In game: Enter, Ctrl+V, Enter."
        : "Copied! Paste it in Discord with Ctrl+V.");
    } catch {
      say("Could not copy to the clipboard.");
    }
  };

  const ensureMenu = () => {
    if (menu) return menu;
    const meter = document.querySelector(".meter");
    if (!meter) return null;
    menu = document.createElement("div");
    menu.className = "shareMenu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    const item = (kind, title, hint) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "shareMenuItem";
      b.setAttribute("role", "menuitem");
      const t = document.createElement("span");
      t.className = "shareMenuTitle";
      t.textContent = title;
      const h = document.createElement("span");
      h.className = "shareMenuHint";
      h.textContent = hint;
      b.append(t, h);
      b.addEventListener("click", () => copy(kind));
      return b;
    };
    menu.append(
      item("party", "Copy for party chat", "One line: paste in game with Enter, Ctrl+V, Enter"),
      item("discord", "Copy full table", "Every player's DPS, damage and share, for Discord")
    );
    meter.appendChild(menu);
    return menu;
  };

  const toggleMenu = (force) => {
    const m = ensureMenu();
    if (!m) return;
    const show = typeof force === "boolean" ? force : m.hidden;
    m.hidden = !show;
    // A class change, so tauriBridge's observer re-fits the overlay window.
    m.classList.toggle("isOpen", show);
    document.querySelector(".meter")?.classList.toggle("shareOpen", show);
  };

  const start = () => {
    const btn = document.querySelector(".shareBtn");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu();
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleMenu();
      }
    });
    document.addEventListener("click", (e) => {
      if (menu && !menu.hidden && !menu.contains(e.target)) toggleMenu(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu && !menu.hidden) toggleMenu(false);
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.TooWholeShare = { onFrame, partyLine, discordTable };
})();
