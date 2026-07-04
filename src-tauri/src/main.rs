// Morok Desktop — Tauri 2 shell (round 2: tray, autostart, window memory).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

fn main() {
    tauri::Builder::default()
        // Пам'ять розміру/позиції вікна між запусками.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Автозапуск із Windows (вмикається з трей-меню).
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        // Нативні сповіщення Windows (на майбутнє).
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // ── Трей ──
            let show = MenuItem::with_id(app, "show", "Відкрити Morok", true, None::<&str>)?;
            let autostart_item =
                MenuItem::with_id(app, "autostart", "Автозапуск: перемкнути", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Вийти", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &autostart_item, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Morok")
                .menu(&menu)
                // ЛКМ по трею → показати вікно (меню лише на ПКМ).
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "autostart" => {
                        use tauri_plugin_autostart::ManagerExt;
                        let mgr = app.autolaunch();
                        match mgr.is_enabled() {
                            Ok(true) => { let _ = mgr.disable(); }
                            _ => { let _ = mgr.enable(); }
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        // «Закрити» вікно = сховати в трей (застосунок живе далі,
        // повідомлення приходять). Справжній вихід — із трей-меню.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Morok");
}
