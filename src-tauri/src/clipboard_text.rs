//! TooWholesome DPS: put text on the clipboard (the Share button).
//!
//! Done here rather than with the page's `navigator.clipboard`, which the
//! webview may refuse when the overlay does not have focus.

#[cfg(windows)]
pub fn copy(text: &str) -> Result<(), String> {
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_UNICODETEXT: u32 = 13;
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = wide.len() * std::mem::size_of::<u16>();
    // SAFETY: the buffer is allocated with room for `wide`, locked while it is
    // written, and handed to the clipboard (which then owns it) or freed.
    unsafe {
        OpenClipboard(None).map_err(|e| format!("The clipboard is busy: {e}"))?;
        let result = (|| {
            EmptyClipboard().map_err(|e| e.to_string())?;
            let memory: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, bytes).map_err(|e| e.to_string())?;
            let target = GlobalLock(memory) as *mut u16;
            if target.is_null() {
                let _ = GlobalFree(Some(memory));
                return Err("Could not lock clipboard memory".to_string());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), target, wide.len());
            let _ = GlobalUnlock(memory);
            if let Err(e) = SetClipboardData(CF_UNICODETEXT, Some(HANDLE(memory.0))) {
                let _ = GlobalFree(Some(memory));
                return Err(e.to_string());
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

#[cfg(not(windows))]
pub fn copy(_text: &str) -> Result<(), String> {
    Err("Copying is handled by the page on this platform.".into())
}

#[cfg(all(test, windows))]
mod tests {
    /// Touches the real clipboard, so only run on request:
    /// `cargo test --lib clipboard_text -- --ignored`
    #[test]
    #[ignore]
    fn copies_unicode_text() {
        super::copy("[TooWholesome DPS] 테스트 ▲ 48.2K").unwrap();
        let out = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "[TooWholesome DPS] 테스트 ▲ 48.2K");
    }
}
