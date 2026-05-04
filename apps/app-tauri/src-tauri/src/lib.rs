mod addon;
mod api;
mod auth;
mod models;
mod saved_variables;
mod settings;
mod sync;
mod tray;
mod updater;
mod wow_folder;

use anyhow::Context;
use reqwest::Client;
use settings::CloseBehavior;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Url, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    pub config: api::RuntimeConfig,
    pub client: Client,
    pub auth: auth::AuthStore,
    pub settings: settings::SettingsStore,
    pub addon_update: addon::AddonUpdateStore,
    pub app_update: updater::AppUpdateStore,
    pub sync: sync::SyncStore,
    pub pending_login: Mutex<Option<tokio::sync::oneshot::Sender<Result<(), String>>>>,
}

impl AppState {
    fn new(app: &AppHandle) -> anyhow::Result<Self> {
        let client = Client::builder()
            .user_agent("wow-dashboard-tauri")
            .build()
            .context("failed to create HTTP client")?;
        Ok(Self {
            config: api::RuntimeConfig::from_env()?,
            client,
            auth: auth::AuthStore::new()?,
            settings: settings::SettingsStore::load(app)?,
            addon_update: addon::AddonUpdateStore::new(),
            app_update: updater::AppUpdateStore::new(app.package_info().version.to_string()),
            sync: sync::SyncStore::new(),
            pending_login: Mutex::new(None),
        })
    }

    pub fn auth_token(&self) -> anyhow::Result<Option<String>> {
        self.auth.load_token()
    }
}

#[tauri::command]
async fn app_open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err("Unsupported external URL scheme".to_string());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for arg in args {
                if arg.starts_with("wow-dashboard://") {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        auth::handle_deep_link(app, &arg).await;
                    });
                }
            }
            tray::show_window(app);
        }))
        .invoke_handler(tauri::generate_handler![
            app_open_external,
            auth::auth_login,
            auth::auth_get_session,
            auth::auth_logout,
            api::api_fetch,
            wow_folder::wow_get_retail_path,
            wow_folder::wow_select_retail_folder,
            addon::wow_check_addon_installed,
            addon::wow_get_installed_addon_version,
            addon::wow_install_addon,
            addon::wow_get_latest_addon_release,
            addon::wow_get_addon_update_status,
            addon::wow_trigger_addon_update_check,
            sync::wow_watch_addon_file,
            sync::wow_unwatch_addon_file,
            sync::sync_get_state,
            sync::sync_refresh_file_state,
            sync::sync_now,
            settings::settings_get_app_settings,
            settings::settings_set_close_behavior,
            settings::settings_set_autostart,
            settings::settings_set_launch_minimized,
            updater::app_get_version,
            updater::app_get_update_status,
            updater::app_check_for_updates,
            updater::app_install_update,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = AppState::new(&handle)?;
            let launch_minimized = state.settings.snapshot().launch_minimized
                || std::env::args().any(|arg| arg == "--minimized");
            app.manage(state);

            let handle_for_deep_link = handle.clone();
            handle.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let app = handle_for_deep_link.clone();
                    tauri::async_runtime::spawn(async move {
                        auth::handle_deep_link(app, url.as_str()).await;
                    });
                }
            });
            #[cfg(debug_assertions)]
            handle.deep_link().register_all()?;

            let state = handle.state::<AppState>();
            settings::sync_autostart_state(&handle, &state.settings).ok();
            tray::create_tray(&handle)?;
            tauri::async_runtime::spawn({
                let app = handle.clone();
                async move {
                    let state = app.state::<AppState>();
                    addon::initialize_addon_state(&app, &state).await;
                    let _ = addon::stage_latest_addon_update(&app, &state).await;
                }
            });
            spawn_background_timers(handle.clone());

            if !launch_minimized {
                tray::show_window(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state.settings.snapshot().close_behavior == CloseBehavior::Tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running WoW Dashboard Tauri app");
}

fn spawn_background_timers(app: AppHandle) {
    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
            loop {
                interval.tick().await;
                let state = app.state::<AppState>();
                let _ = addon::stage_latest_addon_update(&app, &state).await;
            }
        }
    });

    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
        loop {
            interval.tick().await;
            let state = app.state::<AppState>();
            let _ = updater::trigger_app_update_check(&app, &state).await;
        }
    });
}
