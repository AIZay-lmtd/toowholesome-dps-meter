//! TooWholeDPS: "Start with AION 2".
//!
//! Windows cannot start a program when another one starts without something
//! already running to notice, so this registers a Task Scheduler task that
//! starts the meter at sign-in with `--background`. In that mode the overlay
//! starts hidden, appears when the AION 2 window does, and hides again a few
//! seconds after the game closes. The task runs with highest privileges, so
//! packet capture works without a UAC prompt at every sign-in; registering it
//! therefore needs the meter itself to be running as administrator.

use std::sync::Mutex;

pub const BACKGROUND_ARG: &str = "--background";
pub const TASK_NAME: &str = "TooWholeDPS Meter";

/// Game gone for this many checks (one every 2 s) before the overlay hides:
/// a client restart or a crash-and-relaunch should not flicker it.
const HIDE_AFTER_ABSENT_CHECKS: u32 = 5;

pub fn launched_in_background() -> bool {
    std::env::args().any(|a| a == BACKGROUND_ARG)
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
    <Description>Starts TooWholeDPS Meter hidden at sign-in. The overlay appears when AION 2 opens. Turn off in the meter's Settings.</Description>
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

    use super::{task_xml, TASK_NAME};

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
            "Windows refused: run TooWholeDPS Meter as administrator, then try again.".into()
        } else {
            format!("Task Scheduler said: {}", text.trim())
        }
    }

    pub fn is_enabled() -> bool {
        schtasks(&["/Query", "/TN", TASK_NAME]).is_ok_and(|o| o.status.success())
    }

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        if !enabled {
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
}

pub use imp::{is_enabled, set_enabled};

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
        let xml = task_xml(r"C:\Program Files\TooWholeDPS Meter\TooWholeDPS-Meter.exe", r"PC\Me & You");
        assert!(xml.contains(r"<Command>C:\Program Files\TooWholeDPS Meter\TooWholeDPS-Meter.exe</Command>"));
        assert!(xml.contains("<Arguments>--background</Arguments>"));
        assert!(xml.contains(r"<UserId>PC\Me &amp; You</UserId>"));
        assert!(xml.contains("<RunLevel>HighestAvailable</RunLevel>"));
        assert!(xml.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
    }
}
