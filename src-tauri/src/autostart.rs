//! TooWholesome DPS: "Start with AION 2".
//!
//! Windows cannot start a program when another one starts without something
//! already running to notice, so this registers a Task Scheduler task that
//! starts the meter at sign-in with `--background`. In that mode the overlay
//! starts hidden, appears when the AION 2 window does, and hides again a few
//! seconds after the game closes. The task runs with highest privileges, so
//! packet capture works without a UAC prompt at every sign-in. Registering
//! such a task needs administrator rights: a meter that is not elevated runs
//! a copy of itself with `--autostart-helper=on|off` through one UAC prompt.

use std::sync::Mutex;

pub const BACKGROUND_ARG: &str = "--background";
/// `--autostart-helper=on` / `=off`: register or remove the task and exit.
pub const HELPER_ARG: &str = "--autostart-helper=";
pub const TASK_NAME: &str = "TooWholesome DPS Meter";
/// Names the task had in earlier versions. Their command points at the old
/// install folder, so `migrate_legacy` re-registers them under `TASK_NAME`.
pub const LEGACY_TASK_NAMES: &[&str] = &["TooWholeDPS Meter"];

/// Game gone for this many checks (one every 2 s) before the overlay hides:
/// a client restart or a crash-and-relaunch should not flicker it.
const HIDE_AFTER_ABSENT_CHECKS: u32 = 5;

pub fn launched_in_background() -> bool {
    std::env::args().any(|a| a == BACKGROUND_ARG)
}

/// When started as the elevated helper, do its one job and return the exit
/// code; `None` for a normal start.
pub fn run_helper_if_asked() -> Option<i32> {
    let wanted = std::env::args().find_map(|a| a.strip_prefix(HELPER_ARG).map(|v| v == "on"))?;
    Some(match imp::set_enabled_here(wanted) {
        Ok(()) => 0,
        Err(_) => 1,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Show,
    Hide,
}

/// When a background-launched meter shows or hides itself.
#[derive(Debug, Default)]
pub struct Watcher {
    game_seen: bool,
    absent_checks: u32,
    /// The player opened the meter themselves (the shortcut, while this copy
    /// waited hidden): leave it up until the game has come and gone.
    manual: bool,
}

impl Watcher {
    pub fn check(&mut self, game_running: bool) -> Option<Action> {
        if game_running {
            self.absent_checks = 0;
            if !self.game_seen {
                self.game_seen = true;
                self.manual = false;
                return Some(Action::Show);
            }
            return None;
        }
        if !self.game_seen {
            return None;
        }
        self.absent_checks += 1;
        if self.absent_checks < HIDE_AFTER_ABSENT_CHECKS {
            return None;
        }
        self.game_seen = false;
        self.absent_checks = 0;
        (!std::mem::take(&mut self.manual)).then_some(Action::Hide)
    }

    pub fn opened_by_player(&mut self) {
        self.manual = true;
    }
}

pub static WATCHER: Mutex<Watcher> =
    Mutex::new(Watcher { game_seen: false, absent_checks: 0, manual: false });

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// The Task Scheduler definition: at `user`'s sign-in, run `exe --background`
/// with highest privileges, never time out, ignore batteries.
pub fn task_xml(exe: &str, user: &str) -> String {
    let exe = xml_escape(exe);
    let user = xml_escape(user);
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Starts TooWholesome DPS Meter hidden at sign-in. The overlay appears when AION 2 opens. Turn off in the meter's Settings.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{user}</UserId>
      <Delay>PT10S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{exe}</Command>
      <Arguments>{BACKGROUND_ARG}</Arguments>
    </Exec>
  </Actions>
</Task>
"#
    )
}

#[cfg(windows)]
mod imp {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Output};

    use super::{task_xml, HELPER_ARG, LEGACY_TASK_NAMES, TASK_NAME};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn schtasks(args: &[&str]) -> Result<Output, String> {
        Command::new("schtasks")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Could not run Task Scheduler: {e}"))
    }

    fn failure(output: &Output) -> String {
        let text = String::from_utf8_lossy(&output.stderr);
        if text.to_lowercase().contains("access is denied") {
            "Windows refused: administrator rights are needed for this.".into()
        } else {
            format!("Task Scheduler said: {}", text.trim())
        }
    }

    fn exists(name: &str) -> bool {
        schtasks(&["/Query", "/TN", name]).is_ok_and(|o| o.status.success())
    }

    pub fn is_enabled() -> bool {
        exists(TASK_NAME)
    }

    /// A task from before the rename: register it again under the current
    /// name and this exe, then drop the old one. Quietly does nothing when
    /// there is none, or when not elevated (it is tried again next start).
    pub fn migrate_legacy() {
        // Never a UAC prompt at startup: only an elevated meter moves it.
        if !crate::platform::admin::is_admin() {
            return;
        }
        for &old in LEGACY_TASK_NAMES {
            if !exists(old) {
                continue;
            }
            match set_enabled_here(true) {
                Ok(()) => {
                    let _ = schtasks(&["/Delete", "/TN", old, "/F"]);
                    tracing::info!("Moved the start-with-AION-2 task from {old:?} to {TASK_NAME:?}");
                }
                Err(e) => tracing::warn!("Could not move the start-with-AION-2 task {old:?}: {e}"),
            }
        }
    }

    /// Register or remove the task, asking Windows for administrator rights
    /// (one UAC prompt) when this meter is not elevated.
    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        if crate::platform::admin::is_admin() {
            return set_enabled_here(enabled);
        }
        run_elevated_helper(enabled)?;
        if is_enabled() == enabled {
            Ok(())
        } else {
            Err("Windows did not save the change. Try again, or run the meter as administrator.".into())
        }
    }

    /// Run this exe elevated with `--autostart-helper=…` and wait for it.
    fn run_elevated_helper(enabled: bool) -> Result<(), String> {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::{w, PCWSTR};
        use windows::Win32::Foundation::{CloseHandle, ERROR_CANCELLED};
        use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
        use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
        use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

        let exe = std::env::current_exe().map_err(|e| format!("Could not find the meter's program file: {e}"))?;
        let wide = |s: &std::ffi::OsStr| s.encode_wide().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let file = wide(exe.as_os_str());
        let params = wide(std::ffi::OsStr::new(&format!("{HELPER_ARG}{}", if enabled { "on" } else { "off" })));
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: w!("runas"),
            lpFile: PCWSTR(file.as_ptr()),
            lpParameters: PCWSTR(params.as_ptr()),
            nShow: SW_HIDE.0,
            ..Default::default()
        };
        // SAFETY: `info` and the strings it points to live across the call.
        if let Err(e) = unsafe { ShellExecuteExW(&mut info) } {
            return Err(if e.code() == ERROR_CANCELLED.to_hresult() {
                "Windows needs your permission for this. Click Yes on the prompt to turn it on or off.".into()
            } else {
                format!("Could not ask Windows for permission: {e}")
            });
        }
        if info.hProcess.is_invalid() {
            return Ok(());
        }
        let mut code = 1u32;
        // SAFETY: a process handle ShellExecuteExW opened for us; closed once.
        unsafe {
            WaitForSingleObject(info.hProcess, INFINITE);
            let _ = GetExitCodeProcess(info.hProcess, &mut code);
            let _ = CloseHandle(info.hProcess);
        }
        if code == 0 { Ok(()) } else { Err("Task Scheduler could not save the change.".into()) }
    }

    pub fn set_enabled_here(enabled: bool) -> Result<(), String> {
        if !enabled {
            for &old in LEGACY_TASK_NAMES {
                if exists(old) {
                    let _ = schtasks(&["/Delete", "/TN", old, "/F"]);
                }
            }
            if !is_enabled() {
                return Ok(());
            }
            let output = schtasks(&["/Delete", "/TN", TASK_NAME, "/F"])?;
            return if output.status.success() { Ok(()) } else { Err(failure(&output)) };
        }
        let exe = std::env::current_exe().map_err(|e| format!("Could not find the meter's program file: {e}"))?;
        let user = match (std::env::var("USERDOMAIN"), std::env::var("USERNAME")) {
            (Ok(domain), Ok(name)) if !domain.is_empty() => format!("{domain}\\{name}"),
            (_, Ok(name)) => name,
            _ => return Err("Could not tell which Windows user is signed in.".into()),
        };
        let xml = task_xml(&exe.to_string_lossy(), &user);
        // schtasks reads /XML files as UTF-16 with a byte-order mark.
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend(xml.encode_utf16().flat_map(|u| u.to_le_bytes()));
        let path = std::env::temp_dir().join(format!("toowhole-autostart-{}.xml", std::process::id()));
        std::fs::write(&path, bytes).map_err(|e| format!("Could not write the task file: {e}"))?;
        let path_text = path.to_string_lossy().to_string();
        let output = schtasks(&["/Create", "/TN", TASK_NAME, "/XML", &path_text, "/F"]);
        let _ = std::fs::remove_file(&path);
        let output = output?;
        if output.status.success() { Ok(()) } else { Err(failure(&output)) }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn is_enabled() -> bool {
        false
    }

    pub fn set_enabled(_enabled: bool) -> Result<(), String> {
        Err("Starting with AION 2 is only available on Windows.".into())
    }

    pub fn migrate_legacy() {}

    pub fn set_enabled_here(enabled: bool) -> Result<(), String> {
        set_enabled(enabled)
    }
}

pub use imp::{is_enabled, migrate_legacy, set_enabled};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shows_when_the_game_opens_and_hides_after_it_closes() {
        let mut w = Watcher::default();
        assert_eq!(w.check(false), None);
        assert_eq!(w.check(true), Some(Action::Show));
        assert_eq!(w.check(true), None);
        for _ in 0..HIDE_AFTER_ABSENT_CHECKS - 1 {
            assert_eq!(w.check(false), None);
        }
        assert_eq!(w.check(false), Some(Action::Hide));
        assert_eq!(w.check(false), None);
        assert_eq!(w.check(true), Some(Action::Show));
    }

    #[test]
    fn a_brief_game_restart_does_not_hide_it() {
        let mut w = Watcher::default();
        w.check(true);
        w.check(false);
        w.check(false);
        assert_eq!(w.check(true), None);
    }

    #[test]
    fn a_meter_the_player_opened_stays_up_once_the_game_closes() {
        let mut w = Watcher::default();
        w.check(true);
        w.opened_by_player();
        for _ in 0..HIDE_AFTER_ABSENT_CHECKS {
            assert_ne!(w.check(false), Some(Action::Hide));
        }
        // ...but the next session behaves normally again.
        assert_eq!(w.check(true), Some(Action::Show));
        for _ in 0..HIDE_AFTER_ABSENT_CHECKS - 1 {
            w.check(false);
        }
        assert_eq!(w.check(false), Some(Action::Hide));
    }

    #[test]
    fn the_task_runs_this_exe_in_background_mode() {
        let xml = task_xml(r"C:\Program Files\TooWholesome DPS Meter\TooWholesome-DPS-Meter.exe", r"PC\Me & You");
        assert!(xml.contains(r"<Command>C:\Program Files\TooWholesome DPS Meter\TooWholesome-DPS-Meter.exe</Command>"));
        assert!(xml.contains("<Arguments>--background</Arguments>"));
        assert!(xml.contains(r"<UserId>PC\Me &amp; You</UserId>"));
        assert!(xml.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(xml.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
    }
}
