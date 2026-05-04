use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CloseBehavior {
    Tray,
    Exit,
}

impl Default for CloseBehavior {
    fn default() -> Self {
        Self::Tray
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSettings {
    #[serde(default)]
    pub close_behavior: CloseBehavior,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default = "default_launch_minimized")]
    pub launch_minimized: bool,
    #[serde(default)]
    pub last_synced_at: i64,
    #[serde(default)]
    pub retail_path: Option<String>,
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            close_behavior: CloseBehavior::Tray,
            autostart: false,
            launch_minimized: true,
            last_synced_at: 0,
            retail_path: None,
        }
    }
}

fn default_launch_minimized() -> bool {
    true
}

#[derive(Clone)]
pub struct SettingsStore {
    path: PathBuf,
    inner: Arc<Mutex<StoredSettings>>,
}

impl SettingsStore {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Self> {
        let app_data = app
            .path()
            .app_data_dir()
            .context("failed to resolve app data directory")?;
        fs::create_dir_all(&app_data).context("failed to create app data directory")?;
        let path = app_data.join("wow-dashboard-settings.json");
        let loaded_settings = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<StoredSettings>(&raw).ok());
        let mut settings = loaded_settings.clone().unwrap_or_default();
        if loaded_settings.is_none() {
            import_legacy_electron_settings(&mut settings);
        }

        Ok(Self {
            path,
            inner: Arc::new(Mutex::new(settings)),
        })
    }

    pub fn snapshot(&self) -> StoredSettings {
        self.inner.lock().expect("settings mutex poisoned").clone()
    }

    pub fn update(&self, update: impl FnOnce(&mut StoredSettings)) -> Result<StoredSettings> {
        let snapshot = {
            let mut settings = self.inner.lock().expect("settings mutex poisoned");
            update(&mut settings);
            settings.clone()
        };
        self.save_snapshot(&snapshot)?;
        Ok(snapshot)
    }

    fn save_snapshot(&self, settings: &StoredSettings) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).context("failed to create settings directory")?;
        }
        let raw = serde_json::to_string_pretty(settings)?;
        fs::write(&self.path, raw).context("failed to write settings")
    }
}

fn import_legacy_electron_settings(settings: &mut StoredSettings) {
    let Some(legacy_path) = legacy_electron_settings_path() else {
        return;
    };
    let Ok(raw) = fs::read_to_string(legacy_path) else {
        return;
    };
    let Ok(legacy) = serde_json::from_str::<StoredSettings>(&raw) else {
        return;
    };

    if settings.retail_path.is_none() {
        settings.retail_path = legacy.retail_path;
    }
    if settings.last_synced_at <= 0 {
        settings.last_synced_at = legacy.last_synced_at;
    }
    settings.close_behavior = legacy.close_behavior;
    settings.autostart = legacy.autostart;
    settings.launch_minimized = legacy.launch_minimized;
}

fn legacy_electron_settings_path() -> Option<PathBuf> {
    legacy_electron_user_data_dir().map(|path| path.join("wow-dashboard-settings.json"))
}

#[cfg(target_os = "windows")]
fn legacy_electron_user_data_dir() -> Option<PathBuf> {
    env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("WoW Dashboard"))
}

#[cfg(not(target_os = "windows"))]
fn legacy_electron_user_data_dir() -> Option<PathBuf> {
    None
}

#[tauri::command]
pub async fn settings_get_app_settings(
    state: tauri::State<'_, crate::AppState>,
) -> Result<StoredSettings, String> {
    Ok(state.settings.snapshot())
}

#[tauri::command]
pub async fn settings_set_close_behavior(
    state: tauri::State<'_, crate::AppState>,
    value: CloseBehavior,
) -> Result<(), String> {
    state
        .settings
        .update(|settings| settings.close_behavior = value)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn settings_set_launch_minimized(
    state: tauri::State<'_, crate::AppState>,
    value: bool,
) -> Result<(), String> {
    state
        .settings
        .update(|settings| settings.launch_minimized = value)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn settings_set_autostart<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, crate::AppState>,
    value: bool,
) -> Result<(), String> {
    if value {
        app.autolaunch()
            .enable()
            .map_err(|error| error.to_string())?;
    } else {
        app.autolaunch()
            .disable()
            .map_err(|error| error.to_string())?;
    }

    state
        .settings
        .update(|settings| settings.autostart = value)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn sync_autostart_state<R: Runtime>(
    app: &AppHandle<R>,
    settings: &SettingsStore,
) -> Result<()> {
    let snapshot = settings.snapshot();
    if snapshot.autostart {
        app.autolaunch()
            .enable()
            .map_err(|error| anyhow::anyhow!(error))?;
    } else {
        app.autolaunch()
            .disable()
            .map_err(|error| anyhow::anyhow!(error))?;
    }
    Ok(())
}
