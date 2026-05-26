use serde::Serialize;

#[derive(Serialize)]
struct ActiveWindowInfo {
    title: String,
    app_name: String,
    process_path: String,
}

#[tauri::command]
fn get_active_window() -> Option<ActiveWindowInfo> {
    active_win_pos_rs::get_active_window().ok().map(|w| ActiveWindowInfo {
        title: w.title,
        app_name: w.app_name,
        process_path: w.process_path.to_string_lossy().to_string(),
    })
}

/// Detect whether some OTHER app is currently in true fullscreen mode (game,
/// fullscreen video player, etc). Used by Lumi to politely hide herself so
/// she doesn't get in the way of immersive content.
///
/// Heuristic: foreground window rect covers the entire monitor work area.
#[cfg(windows)]
#[tauri::command]
fn is_foreground_fullscreen() -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowRect,
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() || hwnd == GetDesktopWindow() || hwnd == GetShellWindow() {
            return false;
        }
        let mut wnd_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetWindowRect(hwnd, &mut wnd_rect) == 0 {
            return false;
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.is_null() {
            return false;
        }
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return false;
        }
        // Compare window rect to full monitor rect (not work area — fullscreen
        // covers taskbar too). Allow 2px slop for window border quirks.
        let mr = info.rcMonitor;
        (wnd_rect.left - mr.left).abs() <= 2
            && (wnd_rect.top - mr.top).abs() <= 2
            && (wnd_rect.right - mr.right).abs() <= 2
            && (wnd_rect.bottom - mr.bottom).abs() <= 2
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn is_foreground_fullscreen() -> bool {
    // macOS / Linux detection deferred — for now never assume fullscreen
    // (Lumi stays visible). Wire later when we have those platforms.
    false
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_active_window,
            is_foreground_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
