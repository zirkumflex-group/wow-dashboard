use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppUpdateStatus {
    Idle,
    Checking,
    Available,
    Downloading,
    Downloaded,
    Installing,
    UpToDate,
    Error,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateState {
    pub status: AppUpdateStatus,
    pub current_version: String,
    pub available_version: Option<String>,
    pub downloaded_version: Option<String>,
    pub progress_percent: Option<f64>,
    pub error: Option<String>,
    pub last_checked_at: Option<i64>,
    pub is_packaged: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppInstallUpdateResult {
    pub ok: bool,
    pub status: AppInstallUpdateStatus,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppInstallUpdateStatus {
    Installing,
    NotDownloaded,
    Unsupported,
    Failed,
}

#[derive(Clone)]
pub struct AppUpdateStore {
    state: Arc<Mutex<AppUpdateState>>,
    pending_update: Arc<Mutex<Option<Update>>>,
    pending_update_bytes: Arc<Mutex<Option<Vec<u8>>>>,
}

impl AppUpdateStore {
    pub fn new(current_version: String) -> Self {
        Self {
            state: Arc::new(Mutex::new(AppUpdateState {
                status: if is_packaged() {
                    AppUpdateStatus::Idle
                } else {
                    AppUpdateStatus::Unsupported
                },
                current_version,
                available_version: None,
                downloaded_version: None,
                progress_percent: None,
                error: None,
                last_checked_at: None,
                is_packaged: is_packaged(),
            })),
            pending_update: Arc::new(Mutex::new(None)),
            pending_update_bytes: Arc::new(Mutex::new(None)),
        }
    }

    pub fn snapshot(&self) -> AppUpdateState {
        self.state
            .lock()
            .expect("app update mutex poisoned")
            .clone()
    }

    fn update(&self, patch: impl FnOnce(&mut AppUpdateState)) -> AppUpdateState {
        let mut state = self.state.lock().expect("app update mutex poisoned");
        patch(&mut state);
        state.is_packaged = is_packaged();
        state.clone()
    }
}

#[tauri::command]
pub async fn app_get_version(app: AppHandle) -> Result<String, String> {
    Ok(app.package_info().version.to_string())
}

#[tauri::command]
pub async fn app_get_update_status(
    state: State<'_, crate::AppState>,
) -> Result<AppUpdateState, String> {
    Ok(state.app_update.snapshot())
}

#[tauri::command]
pub async fn app_check_for_updates(
    app: AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    trigger_app_update_check(&app, &state)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn app_install_update(
    app: AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<AppInstallUpdateResult, String> {
    if !is_packaged() {
        return Ok(AppInstallUpdateResult {
            ok: false,
            status: AppInstallUpdateStatus::Unsupported,
            message: Some("Desktop app updates are unavailable in development builds.".to_string()),
        });
    }

    let update = state
        .app_update
        .pending_update
        .lock()
        .expect("pending update mutex poisoned")
        .take();
    let bytes = state
        .app_update
        .pending_update_bytes
        .lock()
        .expect("pending update bytes mutex poisoned")
        .take();
    let (Some(update), Some(bytes)) = (update, bytes) else {
        return Ok(AppInstallUpdateResult {
            ok: false,
            status: AppInstallUpdateStatus::NotDownloaded,
            message: Some("No downloaded desktop update is ready to install.".to_string()),
        });
    };

    emit_app_update_state(&app, &state, |snapshot| {
        snapshot.status = AppUpdateStatus::Installing;
        snapshot.error = None;
    });

    if let Err(error) = update.install(&bytes) {
        let message = error.to_string();
        *state
            .app_update
            .pending_update
            .lock()
            .expect("pending update mutex poisoned") = Some(update);
        *state
            .app_update
            .pending_update_bytes
            .lock()
            .expect("pending update bytes mutex poisoned") = Some(bytes);
        emit_app_update_state(&app, &state, |snapshot| {
            snapshot.status = AppUpdateStatus::Error;
            snapshot.progress_percent = None;
            snapshot.error = Some(message.clone());
            snapshot.last_checked_at = Some(chrono::Utc::now().timestamp_millis());
        });
        return Ok(AppInstallUpdateResult {
            ok: false,
            status: AppInstallUpdateStatus::Failed,
            message: Some(message),
        });
    }

    Ok(AppInstallUpdateResult {
        ok: true,
        status: AppInstallUpdateStatus::Installing,
        message: None,
    })
}

pub async fn trigger_app_update_check(
    app: &AppHandle,
    state: &crate::AppState,
) -> anyhow::Result<()> {
    if !is_packaged() {
        emit_app_update_state(app, state, |snapshot| {
            snapshot.status = AppUpdateStatus::Unsupported;
            snapshot.available_version = None;
            snapshot.downloaded_version = None;
            snapshot.progress_percent = None;
            snapshot.error = None;
            snapshot.last_checked_at = Some(chrono::Utc::now().timestamp_millis());
        });
        return Ok(());
    }

    emit_app_update_state(app, state, |snapshot| {
        snapshot.status = AppUpdateStatus::Checking;
        snapshot.error = None;
        snapshot.progress_percent = None;
        snapshot.last_checked_at = Some(chrono::Utc::now().timestamp_millis());
    });

    let check_result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => {
            emit_app_update_state(app, state, |snapshot| {
                snapshot.status = AppUpdateStatus::Error;
                snapshot.progress_percent = None;
                snapshot.error = Some(error.to_string());
                snapshot.last_checked_at = Some(chrono::Utc::now().timestamp_millis());
            });
            return Ok(());
        }
    };

    match check_result {
        Ok(Some(update)) => {
            let version = update.version.clone();
            clear_pending_update(state);
            emit_app_update_state(app, state, |snapshot| {
                snapshot.status = AppUpdateStatus::Available;
                snapshot.available_version = Some(version.clone());
                snapshot.downloaded_version = None;
                snapshot.progress_percent = None;
                snapshot.error = None;
                snapshot.last_checked_at = Some(chrono::Utc::now().timestamp_millis());
            });
            let _ = app.emit("app-update-available", version.clone());

            let total_received = Arc::new(std::sync::atomic::AtomicU64::new(0));
            let received_for_chunk = total_received.clone();
            emit_app_update_state(app, state, |snapshot| {
                snapshot.status = AppUpdateStatus::Downloading;
                snapshot.progress_percent = None;
            });
            let download_result = update
                .download(
                    |chunk_size, content_length| {
                        let received = received_for_chunk
                            .fetch_add(chunk_size as u64, std::sync::atomic::Ordering::SeqCst)
                            + chunk_size as u64;
                        if let Some(content_length) = content_length
                            && content_length > 0
                        {
                            emit_app_update_state(app, state, |snapshot| {
                                snapshot.status = AppUpdateStatus::Downloading;
                                snapshot.progress_percent = Some(
                                    ((received as f64 / content_length as f64) * 100.0).min(100.0),
                                );
                            });
                        }
                    },
                    || {},
                )
                .await;
            let bytes = match download_result {
                Ok(bytes) => bytes,
                Err(error) => {
                    clear_pending_update(state);
                    emit_app_update_state(app, state, |snapshot| {
                        snapshot.status = AppUpdateStatus::Error;
                        snapshot.downloaded_version = None;
                        snapshot.progress_percent = None;
                        snapshot.error = Some(error.to_string());
                        snapshot.last_checked_at = Some(chrono::Utc::now().timestamp_millis());
                    });
                    return Ok(());
                }
            };

            *state
                .app_update
                .pending_update
                .lock()
                .expect("pending update mutex poisoned") = Some(update);
            *state
                .app_update
                .pending_update_bytes
                .lock()
                .expect("pending update bytes mutex poisoned") = Some(bytes);
            emit_app_update_state(app, state, |snapshot| {
                snapshot.status = AppUpdateStatus::Downloaded;
                snapshot.available_version = Some(version.clone());
                snapshot.downloaded_version = Some(version.clone());
                snapshot.progress_percent = Some(100.0);
                snapshot.error = None;
                snapshot.last_checked_at = Some(chrono::Utc::now().timestamp_millis());
            });
            let _ = app.emit("app-update-downloaded", version);
        }
        Ok(None) => {
            clear_pending_update(state);
            emit_app_update_state(app, state, |snapshot| {
                snapshot.status = AppUpdateStatus::UpToDate;
                snapshot.available_version = None;
                snapshot.downloaded_version = None;
                snapshot.progress_percent = None;
                snapshot.error = None;
                snapshot.last_checked_at = Some(chrono::Utc::now().timestamp_millis());
            });
            let _ = app.emit("app-update-not-available", true);
        }
        Err(error) => {
            emit_app_update_state(app, state, |snapshot| {
                snapshot.status = AppUpdateStatus::Error;
                snapshot.progress_percent = None;
                snapshot.error = Some(error.to_string());
                snapshot.last_checked_at = Some(chrono::Utc::now().timestamp_millis());
            });
        }
    }

    Ok(())
}

fn clear_pending_update(state: &crate::AppState) {
    *state
        .app_update
        .pending_update
        .lock()
        .expect("pending update mutex poisoned") = None;
    *state
        .app_update
        .pending_update_bytes
        .lock()
        .expect("pending update bytes mutex poisoned") = None;
}

fn emit_app_update_state(
    app: &AppHandle,
    state: &crate::AppState,
    patch: impl FnOnce(&mut AppUpdateState),
) -> AppUpdateState {
    let snapshot = state.app_update.update(patch);
    let _ = app.emit("app-update-state", snapshot.clone());
    snapshot
}

fn is_packaged() -> bool {
    !cfg!(debug_assertions)
}
