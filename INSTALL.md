# Installing TooWholesome DPS Meter

These steps work on Windows 10 and 11 (64-bit). They take about five minutes.

## 1. Install Npcap (one time)

The meter reads AION 2's network traffic through Npcap, a free packet-capture driver. The meter can't include Npcap in its installer because Npcap's license doesn't allow it, so you install it yourself.

1. Go to **https://npcap.com/#download** and download the latest **Npcap installer**.
2. Run it. On the options page, **tick "Install Npcap in WinPcap API-compatible Mode"**.
3. Leave the other options at their defaults and finish the install.

> If you skip this step, the meter offers to download and run Npcap's installer for you the first time it starts.

## 2. Make sure WebView2 is installed (Windows 10 only)

Windows 11 already has it. On Windows 10:

1. Open **Settings → Apps** and search for **"Microsoft Edge WebView2 Runtime"**.
2. If it isn't listed, download the **Evergreen Bootstrapper** from https://developer.microsoft.com/microsoft-edge/webview2/ and run it.

## 3. Install the meter

1. Download the latest **`TooWholesome-DPS-Meter_<version>_x64_en-US.msi`** from the **[Releases page](https://github.com/AIZay-lmtd/toowholesome-dps-meter/releases/latest)**.
   - If you built it yourself, it's in `src-tauri\target\release\bundle\msi\`.
eleaseundle\msi\`.
2. Double-click the `.msi`.
3. **Windows SmartScreen** may say "Windows protected your PC" because the installer isn't code-signed. Click **More info → Run anyway**.
4. Follow the installer. It adds a **TooWholesome DPS Meter** shortcut to the Start menu (and to the desktop if you leave that ticked).

TooWholesome DPS installs separately from A2Tools DPS Meter, so both can be installed at the same time. Close one before you open the other, because both capture the same traffic.

## 4. Run it as administrator

Raw packet capture needs administrator rights.

1. Right-click the **TooWholesome DPS Meter** shortcut → **Properties → Compatibility**.
2. Tick **"Run this program as an administrator"** → **OK**.

From now on, double-clicking the shortcut starts it elevated. Accept the UAC prompt.

## 5. Where to launch it

After installing, open it from:
- **Start menu:** press the Windows key, type **TooWholesome**, and click **TooWholesome DPS Meter**.
- **Desktop:** the **TooWholesome DPS Meter** shortcut, if you kept it ticked in the installer.
- **The program file itself:** `C:\Program Files\TooWholesome DPS Meter\TooWholesome-DPS-Meter.exe`.

To skip this every time, turn on **Start automatically with AION 2** (step 7).

## 6. First launch

1. Start **AION 2** and log into your character. You can start the meter before or after the game.
2. Start **TooWholesome DPS Meter**. A small gold-framed overlay appears on top of the game. Drag it by the title bar to wherever you want it.
3. The title reads "Detecting AION2 connection..." until it sees game traffic. Attack anything and it locks on.
4. Open **Settings** (the gear icon) and check that **your character name** is filled in. It's normally detected from the game window. If it isn't, type it in. The meter needs it to know which row is yours.
5. **AION 2 must run in Windowed or Borderless (windowed fullscreen) mode.** Exclusive fullscreen draws over every overlay. Change it in the game's graphics options.

## 7. Start automatically with AION 2 (optional)

1. Make sure the meter is running **as administrator** (step 4).
2. Open **Settings** (gear icon) and turn on **Start automatically with AION 2**.

From then on:
- The meter starts hidden when you sign in to Windows, with no UAC prompt.
- The overlay appears by itself when AION 2 opens.
- It hides again about 10 seconds after you close the game, and stays ready, using almost no CPU.
- If you open the meter from the shortcut while it's waiting, it simply shows the copy that's already running.

To stop this, turn the setting off. Uninstalling the meter also removes it.

> Behind the scenes, this is a Windows Task Scheduler task named **"TooWholesome DPS Meter"** that runs at sign-in. It needs administrator rights to create because it lets the meter capture packets without asking each time.

## 8. Using it

| Header button | What it does |
|---|---|
| 🏆 Trophy | Your **personal bests**, one per boss, tier and class |
| 📜 Scroll | **Battle history.** Boss fights are saved automatically. Click one for full details |
| ↺ Reset | Clear the current fight |
| ⚙ Gear | Settings: theme, opacity, target mode, hotkeys, language… |
| 📷 Camera | Copy a screenshot of the meter to the clipboard (paste it into Discord) |

- **Click a player row** to open the skill breakdown: crits, back attacks, DoTs, buff timeline and more.
- **Personal bests:**
  - Kill a boss in a fight lasting 20 seconds or more, and your DPS is recorded.
  - The next time you fight that boss, the gold **PB** strip shows your best and a live ▲ ahead / ▼ behind comparison.
  - Beating your best shows a "New Personal Best!" banner about 10 seconds after the kill.
  - Wipes don't count, only kills.
- **Theme:** TooWholesome (Aion Gold) is the default. Every original theme is still available under Settings → Theme.

## Troubleshooting

| Problem | Fix |
|---|---|
| Turning on "Start automatically with AION 2" says "run as administrator" | Close the meter, start it as administrator (step 4), then try again. |
| Stuck on "Detecting AION2 connection…" | Make sure the meter runs **as administrator** and Npcap is installed **with WinPcap-compatible mode**. If you use a VPN or ping reducer, the meter should pick the right adapter by itself. Restart the meter after you change any of these. |
| Your row isn't highlighted, or no PB strip appears | Check your character name in Settings, then hit something so the meter can identify you. |
| Overlay not visible over the game | Switch AION 2 to Windowed or Borderless mode. |
| Npcap installed but still not capturing | Uninstall Npcap, reinstall it, and tick **WinPcap API-compatible Mode**. Then reboot. |
| The meter stopped working after a game patch | The game may have changed its network protocol. Update from the upstream project (see "Staying up to date with upstream" in [README.md](README.md)), rebuild, and reinstall. |

## Uninstall

Go to **Settings → Apps → Installed apps → TooWholesome DPS Meter → Uninstall**. Your fight history and personal bests stay in `%APPDATA%\com.toowhole.dps-meter` in case you reinstall. Delete that folder to remove them too.

## Sharing with friends

Send them the `.msi` file and this guide. TooWholesome DPS is GPL-3.0 software, so when you share the installer you must also make its source available, for example by publishing this folder to a GitHub repository and sending them the link.

---

*About the game's rules:* the meter only **reads** network traffic. It never sends anything to the game or changes anything in it. Even so, third-party tools may go against NCSoft's Terms of Service. Use it at your own risk.
