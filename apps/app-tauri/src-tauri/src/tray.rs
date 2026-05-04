use tauri::{
    AppHandle, Manager,
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show WoW Dashboard", true, None::<&str>)?;
    let install_update = MenuItem::with_id(
        app,
        "install_update",
        "Install downloaded update",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &install_update, &separator, &quit])?;

    TrayIconBuilder::new()
        .tooltip("WoW Dashboard")
        .icon(tray_icon())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "install_update" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app.state::<crate::AppState>();
                    let _ = crate::updater::app_install_update(app.clone(), state).await;
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick { .. } => show_window(tray.app_handle()),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn tray_icon() -> Image<'static> {
    let size = 16_u32;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        for x in 0..size {
            let border = x == 0 || y == 0 || x == size - 1 || y == size - 1;
            let (r, g, b, a) = if border {
                (96, 165, 250, 255)
            } else {
                (37, 99, 235, 255)
            };
            rgba.extend_from_slice(&[r, g, b, a]);
        }
    }
    Image::new_owned(rgba, size, size)
}
