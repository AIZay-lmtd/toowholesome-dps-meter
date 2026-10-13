# TooWholesome: what can be built for AION 2

Research notes (October 2026) on what's possible around AION 2, what's safe, and what would get players banned. Use them to choose where this project goes next.

## The ground rules

NCSOFT hasn't published an API, an addon system or a modding policy for AION 2. What it has published, through its Operation Policy and enforcement notices, is what it bans:

- **Unauthorized programs, macros and bots.** Enforcement notices name "macros, bots or other unauthorized programs". Reported penalties go up to a permanent ban that can cover every account the same person owns.
- **Input automation.** Programs that press keys or click for you. Korean coverage says NCSOFT now runs an AI model that analyzes input patterns to catch hardware and software macros.
- **Client tampering.** Modifying the client or server programs, injecting into the process, editing memory, or manipulating packets.
- **Anti-cheat.** The game ships kernel-level anti-cheat. Community trackers list "VIOLET" and "NCGuard", but neither is confirmed. That anti-cheat is why client mods are close to non-existent.

There's no official statement on **passive DPS meters** like this one. They read a copy of network traffic and never touch the game. The community largely tolerates them, but NCSOFT hasn't approved any. The game now has its own personal-only meter (Ctrl+X, added in the April 2026 patch).

### What that means in practice

| Category | Examples | Risk |
|---|---|---|
| **Outside the game, read-only** | DPS meter, history, personal bests, Discord posts, web dashboards, timers that use your own clock | Lowest. Never touches the client. |
| **Config tweaks** | `Engine.ini` visual tweaks (one exists on Nexus Mods: no depth-of-field, film grain or motion blur) | Low to medium. It's your own config file, but it's unofficial. |
| **Post-processing** | ReShade presets | Medium. Kernel anti-cheat may block or flag injected graphics hooks. |
| **Anything that acts in the game** | Auto-typing chat, key or mouse macros, auto-loot, botting | **High: bannable.** |
| **Client mods** | DLL injection, memory reading or writing, packet editing, UI replacement | **High: bannable.** |

**This is why Share can't type into party chat for you.** AION 2's chat doesn't accept a paste (players also report there's no chat-macro feature). The only way to put text in the chat box would be simulating key presses, which is exactly the "program that presses keys for you" category above. That's why Share sends to Discord instead.

## What TooWholesome can grow into (the safe column)

These all build on the data the meter already collects, without touching the game.

### 1. Party and guild sharing (started in 1.0.4)
- ✅ **Send to Discord** through a webhook.
- **Auto-post kills:** when a boss dies, post the table to the party's channel automatically. An opt-in toggle.
- **PB announcements:** "Valoria set a new personal best on Commander Ptakaron: 48.2K DPS".
- **Image cards:** post a rendered picture of the meter instead of a text table. The screenshot code already exists.

### 2. Guild leaderboard (the biggest "community mod" win)
- Friends' meters upload personal bests (opt-in) to a small shared database. A web page shows guild rankings per boss, tier and class.
- **Needs:** a hosted database (Supabase or similar), a sign-in or guild-key scheme, and a privacy policy.
- Alternatively, talk to the a2tools.app team, who already run leaderboards and accept logs from third-party meters with permission.

### 3. Coaching and analysis
- Skill rotation timeline and uptime (gaps where you weren't casting).
- Buff uptime per fight. The buff tracker already exists.
- Compare two fights side by side, or yourself against your PB, skill by skill.
- Session report: bosses killed, time spent, DPS trend over a night.

### 4. Timers that use only your own data
- Boss and dungeon reset timers (daily and weekly), and field-boss spawn timers entered by players.
- These count as "addons" only in the loosest sense. They run on your clock, not the game's.
- ⚠️ **Gray area: live boss-mechanic alerts** (a "DBM-style" warning when a boss casts something). The packet data might make this possible, but it gives a direct gameplay advantage, which is where "unfair advantage" enforcement points. Leave it out unless NCSOFT says otherwise.

### 5. Streaming
- The meter already serves a browser overlay for OBS. Give it the TooWholesome theme and a "PB pace" bar for viewers.

### 6. Beyond AION 2
- The architecture (read-only capture → Rust parser → web overlay) carries over to other online games with traffic-based meters. The parser is specific to each game, and every game's terms need checking first.

## Suggested order
1. Auto-post kills and PB announcements to Discord. Small, and finishes the Share story.
2. Fight comparison and rotation and uptime view.
3. Guild leaderboard with a backend.
4. A themed stream overlay.

## Sources
- [AION 2 Damage Meter Guide (aion2guide.org)](https://aion2guide.org/guides/aion-2-damage-meter/)
- [AION 2 DPS Meter setup guide (aion-2-wiki.wiki)](https://www.aion-2-wiki.wiki/systems/AION-2-dps-meter)
- [Are Macros Banned in AION 2? (aion2.help)](https://www.aion2.help/guide/macro-ban-policy)
- [Clear Visuals mod, Nexus Mods](https://www.nexusmods.com/aion2/mods/5)
- [AreWeAntiCheatYet: AION 2 request](https://github.com/AreWeAntiCheatYet/AreWeAntiCheatYet/issues/1881)
- [게임뷰: 엔씨소프트 '아이온2', 매크로와 전면전 선언](https://www.gamevu.co.kr/news/articleView.html?idxno=54898)
- [게임어바웃: 아이온2 불법 매크로와의 전쟁](http://www.gameabout.com/news/articleView.html?idxno=95989)
- [아이온2 인벤: 채팅 매크로 기능 없냐](https://www.inven.co.kr/board/aion2/6388/46392)
- [AION 2 Patch Notes, April 1 2026 (built-in meter)](https://aion2hub.com/updates/aion-2-update-2026-04-01)
- Official AION 2 Operation Policy: plaync.com/policy/operation/aion2global. This is the authoritative source; the notes above rely on reports about it.
