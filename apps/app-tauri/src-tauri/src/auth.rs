use anyhow::{Context, Result, anyhow};
use keyring_core::{Entry, Error as KeyringError};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::{sync::oneshot, time::Duration};
use url::Url;

const KEYRING_SERVICE: &str = "io.zirkumflex.wow-dashboard.desktop";
const KEYRING_USER: &str = "session-token";

#[derive(Clone)]
pub struct AuthStore {
    inner: Arc<Mutex<()>>,
}

impl AuthStore {
    pub fn new() -> Result<Self> {
        keyring::use_native_store(true).context("failed to initialize OS credential store")?;
        Ok(Self {
            inner: Arc::new(Mutex::new(())),
        })
    }

    fn entry(&self) -> Result<Entry> {
        Entry::new(KEYRING_SERVICE, KEYRING_USER).context("failed to create keyring entry")
    }

    pub fn load_token(&self) -> Result<Option<String>> {
        let _guard = self.inner.lock().expect("auth mutex poisoned");
        match self.entry()?.get_password() {
            Ok(token) if !token.trim().is_empty() => Ok(Some(token)),
            Ok(_) => Ok(None),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(anyhow!(error)),
        }
    }

    pub fn save_token(&self, token: &str) -> Result<()> {
        let _guard = self.inner.lock().expect("auth mutex poisoned");
        self.entry()?
            .set_password(token)
            .map_err(|error| anyhow!(error))
    }

    pub fn clear_token(&self) -> Result<()> {
        let _guard = self.inner.lock().expect("auth mutex poisoned");
        match self.entry()?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(anyhow!(error)),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum DesktopAuthSessionState {
    Valid { session: Value },
    Unauthenticated,
    Unknown,
}

#[derive(Debug, Deserialize)]
struct RedeemCodeResponse {
    token: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn auth_login(app: AppHandle, state: State<'_, crate::AppState>) -> Result<bool, String> {
    let (sender, receiver) = oneshot::channel::<Result<(), String>>();
    {
        let mut pending = state
            .pending_login
            .lock()
            .expect("pending login mutex poisoned");
        if pending.is_some() {
            return Err("Login already in progress".to_string());
        }
        *pending = Some(sender);
    }

    let login_url = state
        .config
        .site_endpoint("/auth/electron-login")
        .map_err(|error| error.to_string())?;
    app.opener()
        .open_url(login_url.as_str(), None::<&str>)
        .map_err(|error| {
            let mut pending = state
                .pending_login
                .lock()
                .expect("pending login mutex poisoned");
            *pending = None;
            error.to_string()
        })?;

    match tokio::time::timeout(Duration::from_secs(10 * 60), receiver).await {
        Ok(Ok(Ok(()))) => {
            focus_main_window(&app);
            Ok(true)
        }
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(_)) => Err("Login was cancelled".to_string()),
        Err(_) => {
            let mut pending = state
                .pending_login
                .lock()
                .expect("pending login mutex poisoned");
            *pending = None;
            Err("Login timed out".to_string())
        }
    }
}

#[tauri::command]
pub async fn auth_get_session(
    state: State<'_, crate::AppState>,
) -> Result<DesktopAuthSessionState, String> {
    let token = state.auth_token().map_err(|error| error.to_string())?;
    let Some(token) = token else {
        return Ok(DesktopAuthSessionState::Unauthenticated);
    };

    let url = state
        .config
        .api_endpoint("/auth/get-session")
        .map_err(|error| error.to_string())?;
    let response = state
        .client
        .get(url)
        .headers(crate::api::bearer_headers(&state.config, Some(&token)))
        .send()
        .await
        .map_err(|_| "unknown".to_string());

    let Ok(response) = response else {
        return Ok(DesktopAuthSessionState::Unknown);
    };
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        let _ = state.auth.clear_token();
        return Ok(DesktopAuthSessionState::Unauthenticated);
    }
    if !response.status().is_success() {
        return Ok(DesktopAuthSessionState::Unknown);
    }

    match response.json::<Value>().await {
        Ok(session) => Ok(DesktopAuthSessionState::Valid { session }),
        Err(_) => Ok(DesktopAuthSessionState::Unknown),
    }
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, crate::AppState>) -> Result<bool, String> {
    let token = state.auth_token().map_err(|error| error.to_string())?;
    let _ = state.auth.clear_token();
    if let Some(token) = token {
        let _ = crate::api::request_json::<Value>(
            &state.client,
            &state.config,
            Some(&token),
            Method::POST,
            "/auth/sign-out",
            Some(serde_json::json!({})),
        )
        .await;
    }
    Ok(true)
}

pub async fn handle_deep_link(app: AppHandle, raw_url: &str) {
    let result = redeem_deep_link(&app, raw_url).await;
    let state = app.state::<crate::AppState>();
    let sender = {
        let mut pending = state
            .pending_login
            .lock()
            .expect("pending login mutex poisoned");
        pending.take()
    };

    match result {
        Ok(()) => {
            let _ = app.emit("auth-state-changed", true);
            if let Some(sender) = sender {
                let _ = sender.send(Ok(()));
            }
            focus_main_window(&app);
        }
        Err(error) => {
            if let Some(sender) = sender {
                let _ = sender.send(Err(error.to_string()));
            }
        }
    }
}

async fn redeem_deep_link(app: &AppHandle, raw_url: &str) -> Result<()> {
    let parsed = Url::parse(raw_url).context("invalid deep link")?;
    if parsed.scheme() != "wow-dashboard" || parsed.host_str() != Some("auth") {
        return Err(anyhow!("ignored unsupported deep link"));
    }
    let code = parsed
        .query_pairs()
        .find_map(|(key, value)| (key == "code").then_some(value.to_string()))
        .ok_or_else(|| anyhow!("missing auth code"))?;
    validate_auth_code(&code)?;

    let state = app.state::<crate::AppState>();
    let token = redeem_code(&state, &code).await?;
    state.auth.save_token(&token)?;
    Ok(())
}

fn validate_auth_code(code: &str) -> Result<()> {
    if code.is_empty() || code.len() > 512 || code.chars().any(char::is_whitespace) {
        return Err(anyhow!("invalid auth code"));
    }
    Ok(())
}

async fn redeem_code(state: &crate::AppState, code: &str) -> Result<String> {
    let response: RedeemCodeResponse = crate::api::request_json(
        &state.client,
        &state.config,
        None,
        Method::POST,
        "/auth/redeem-code",
        Some(serde_json::json!({ "code": code })),
    )
    .await?;

    response
        .token
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| {
            anyhow!(
                response
                    .error
                    .unwrap_or_else(|| "No token in response".to_string())
            )
        })
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_code_rejects_empty_whitespace_and_large_values() {
        assert!(validate_auth_code("abc-123._").is_ok());
        assert!(validate_auth_code("").is_err());
        assert!(validate_auth_code("abc 123").is_err());
        assert!(validate_auth_code(&"a".repeat(513)).is_err());
    }
}
