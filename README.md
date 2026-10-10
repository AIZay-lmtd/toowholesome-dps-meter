# TooWholesome DPS Meter

A real-time DPS meter overlay for **AION 2**, styled in Elyos gold and Abyss indigo, with **personal-best tracking**.

TooWholesome DPS Meter is a fork of [A2Tools DPS Meter](https://github.com/taengu/A2Tools-DPS-Meter) by taengu and contributors. The packet parser, combat engine and most features come from that project. See [README_UPSTREAM.md](README_UPSTREAM.md) for its full feature list and FAQ.

## What's different in TooWholesome DPS

- **TooWholesome theme (default).** A gold-framed overlay with corner filigree, Cinzel serif titles, gilded bars for your own row and azure bars for your party. All the original themes are still in Settings → Theme.
- **Personal bests.**
  - The meter remembers your best DPS for every boss, broken down by instance tier and by class.
  - While you fight a boss you have a best on, a gold **PB** strip under the title shows your best and how far ahead (▲ green) or behind (▼ red) you are right now.
  - When a kill beats your best, or is your first kill of that boss, a banner announces it.
  - The **trophy** button in the header lists all your bests.
  - Only kills count. Wipes, training dummies, trash mobs and pulls shorter than 20 seconds are ignored.
  - The "New Personal Best!" banner appears when the fight ends (about 10 seconds after the last hit).
  - Bests are kept in their own file, so the 500-fight History limit never erases them.
  - The first time the meter knows your character name, it builds bests from fights already in History.
- **Start automatically with AION 2.**
  - Turn it on in Settings.
  - The meter then starts hidden when you sign in to Windows, as administrator and without a UAC prompt.
  - The overlay appears when the AION 2 window opens and hides about 10 seconds after the game closes.
  - It uses a Windows Task Scheduler task named "TooWholesome DPS Meter", which is removed when you turn the setting off or uninstall.
  - Opening the meter a second time brings up the copy that's already running instead of starting another one.
- **Self-contained.** Online log uploads, a2tools.app sign-in, "send logs to dev" and the upstream donation links are switched off. The meter only talks to npcap.com (if you ask it to install Npcap) and the game's own CDN for skill icons.

## Install

**[Download the latest installer](https://github.com/AIZay-lmtd/toowholesome-dps-meter/releases/latest)**, then follow **[INSTALL.md](INSTALL.md)** step by step.

## Build from source

Requires Rust (stable), Node.js 18+, the Visual Studio C++ Build Tools and Npcap.

```bash
npm install
npm run tauri build
```

The installer is written to `src-tauri/target/release/bundle/msi/`.

## Staying up to date with upstream

Game patches can change the network protocol, and the upstream project fixes its parser when that happens. To bring those fixes in:

```bash
git fetch upstream
git merge upstream/main
```

TooWholesome DPS keeps its own changes in a few places to keep merges easy:
- `src/toowhole.css`
- `public/src/js/personalBests.js`
- `src-tauri/src/history/personal_bests.rs`
- small hooks in `app.rs`, `dps_calculator.rs`, `dps_data.rs`, `core.js` and `index.html`

## License

GPL-3.0, the same as the upstream project. See [LICENSE](LICENSE). If you share the app, you must also offer its source code, for example by publishing this repository.

- Original work © taengu and A2Tools DPS Meter contributors. Some parser fixes come from [Daevalog](https://github.com/Seralth/Daevalog) by Seralth.
- Cinzel font: SIL Open Font License 1.1 (`public/vendor/fonts/cinzel/LICENSE`). Other bundled fonts are listed in [README_UPSTREAM.md](README_UPSTREAM.md#fonts).

TooWholesome DPS Meter is not affiliated with NCSoft or with A2Tools. AION 2 is a trademark of NCSoft.
