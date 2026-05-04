use anyhow::{Context, Result, anyhow};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tempfile::TempDir;
use tokio::io::AsyncWriteExt;
use url::Url;

const GITHUB_REPO: &str = "zirkumflex-group/wow-dashboard";
const ADDON_ZIP_NAME: &str = "wow-dashboard.zip";
const ADDON_CHECKSUM_NAME: &str = "wow-dashboard.zip.sha256";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AddonUpdateStatus {
    Idle,
    Checking,
    Updating,
    UpToDate,
    Staged,
    Applied,
    NotInstalled,
    NoRetailPath,
    InvalidRetailPath,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonUpdateState {
    pub status: AddonUpdateStatus,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub staged_version: Option<String>,
    pub error: Option<String>,
    pub last_checked_at: Option<i64>,
}

impl Default for AddonUpdateState {
    fn default() -> Self {
        Self {
            status: AddonUpdateStatus::Idle,
            installed_version: None,
            latest_version: None,
            staged_version: None,
            error: None,
            last_checked_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonUpdateCheckResult {
    pub status: AddonUpdateStatus,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub staged_version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExposedAddonReleaseInfo {
    pub version: String,
}

#[derive(Debug, Clone)]
struct AddonReleaseInfo {
    version: String,
    url: String,
    checksum_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StagedAddonUpdate {
    version: String,
    checksum_url: String,
    downloaded_at: i64,
}

#[derive(Clone)]
pub struct AddonUpdateStore {
    inner: Arc<Mutex<AddonUpdateState>>,
}

impl AddonUpdateStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(AddonUpdateState::default())),
        }
    }

    pub fn snapshot(&self) -> AddonUpdateState {
        self.inner
            .lock()
            .expect("addon update mutex poisoned")
            .clone()
    }

    pub fn update(&self, patch: impl FnOnce(&mut AddonUpdateState)) -> AddonUpdateState {
        let mut state = self.inner.lock().expect("addon update mutex poisoned");
        patch(&mut state);
        state.clone()
    }
}

pub async fn initialize_addon_state(app: &AppHandle, state: &crate::AppState) {
    let staged = get_usable_staged_addon_update(app, state)
        .await
        .ok()
        .flatten();
    let retail_path = crate::wow_folder::validated_retail_path(state).ok();
    let installed_version = retail_path.as_ref().and_then(|path| {
        get_installed_addon_version_for_retail_path(path)
            .ok()
            .flatten()
    });
    let status = match retail_path {
        Some(_) if installed_version.is_some() => AddonUpdateStatus::Idle,
        Some(_) => AddonUpdateStatus::NotInstalled,
        None if crate::wow_folder::stored_retail_path(state).is_some() => {
            AddonUpdateStatus::InvalidRetailPath
        }
        None => AddonUpdateStatus::NoRetailPath,
    };
    update_addon_state(app, state, |update| {
        update.status = status;
        update.installed_version = installed_version;
        update.staged_version = staged.map(|staged| staged.version);
    });
}

#[tauri::command]
pub async fn wow_check_addon_installed(state: State<'_, crate::AppState>) -> Result<bool, String> {
    let retail_path = crate::wow_folder::validated_retail_path(&state)?;
    Ok(crate::wow_folder::get_addon_path(retail_path).exists())
}

#[tauri::command]
pub async fn wow_get_installed_addon_version(
    state: State<'_, crate::AppState>,
) -> Result<Option<String>, String> {
    let retail_path = crate::wow_folder::validated_retail_path(&state)?;
    get_installed_addon_version_for_retail_path(&retail_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn wow_get_latest_addon_release(
    state: State<'_, crate::AppState>,
) -> Result<ExposedAddonReleaseInfo, String> {
    fetch_latest_addon_release(&state.client)
        .await
        .map(|release| ExposedAddonReleaseInfo {
            version: release.version,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn wow_install_addon(
    app: AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<ExposedAddonReleaseInfo, String> {
    let retail_path = crate::wow_folder::validated_retail_path(&state)?;
    let release = fetch_latest_addon_release(&state.client)
        .await
        .map_err(|error| error.to_string())?;
    download_and_install_addon_release(&state.client, &release, &retail_path)
        .await
        .map_err(|error| error.to_string())?;
    clear_staged_addon_update(&app).ok();
    update_addon_state(&app, &state, |update| {
        update.status = AddonUpdateStatus::Applied;
        update.installed_version = Some(release.version.clone());
        update.latest_version = Some(release.version.clone());
        update.staged_version = None;
        update.error = None;
    });
    let _ = app.emit("addon-update-applied", release.version.clone());
    Ok(ExposedAddonReleaseInfo {
        version: release.version,
    })
}

#[tauri::command]
pub async fn wow_get_addon_update_status(
    app: AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<AddonUpdateState, String> {
    let staged = get_usable_staged_addon_update(&app, &state)
        .await
        .map_err(|error| error.to_string())?;
    let snapshot = update_addon_state(&app, &state, |update| {
        update.staged_version = staged.map(|staged| staged.version);
    });
    Ok(snapshot)
}

#[tauri::command]
pub async fn wow_trigger_addon_update_check(
    app: AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<AddonUpdateCheckResult, String> {
    stage_latest_addon_update(&app, &state)
        .await
        .map_err(|error| error.to_string())
}

pub async fn stage_latest_addon_update(
    app: &AppHandle,
    state: &crate::AppState,
) -> Result<AddonUpdateCheckResult> {
    let started_at = chrono::Utc::now().timestamp_millis();
    let staged_at_start = get_usable_staged_addon_update(app, state).await?;
    update_addon_state(app, state, |update| {
        update.status = AddonUpdateStatus::Checking;
        update.staged_version = staged_at_start
            .as_ref()
            .map(|staged| staged.version.clone());
        update.error = None;
        update.last_checked_at = Some(started_at);
    });

    let retail_path = match crate::wow_folder::validated_retail_path(state) {
        Ok(path) => path,
        Err(error) => {
            let status = if crate::wow_folder::stored_retail_path(state).is_some() {
                AddonUpdateStatus::InvalidRetailPath
            } else {
                AddonUpdateStatus::NoRetailPath
            };
            let snapshot = update_addon_state(app, state, |update| {
                update.status = status.clone();
                update.error = Some(error);
                update.last_checked_at = Some(started_at);
            });
            return Ok(snapshot.into());
        }
    };

    let installed_version = get_installed_addon_version_for_retail_path(&retail_path)?;
    if installed_version.is_none() {
        clear_staged_addon_update(app).ok();
        let snapshot = update_addon_state(app, state, |update| {
            update.status = AddonUpdateStatus::NotInstalled;
            update.installed_version = None;
            update.staged_version = None;
            update.error = None;
            update.last_checked_at = Some(started_at);
        });
        return Ok(snapshot.into());
    }
    let installed_version = installed_version.expect("checked is_some");
    update_addon_state(app, state, |update| {
        update.installed_version = Some(installed_version.clone());
    });

    let latest = fetch_latest_addon_release(&state.client).await?;
    update_addon_state(app, state, |update| {
        update.latest_version = Some(latest.version.clone());
        update.last_checked_at = Some(started_at);
    });

    if !is_outdated_version(&installed_version, &latest.version) {
        clear_staged_addon_update(app).ok();
        let snapshot = update_addon_state(app, state, |update| {
            update.status = AddonUpdateStatus::UpToDate;
            update.installed_version = Some(installed_version.clone());
            update.latest_version = Some(latest.version.clone());
            update.staged_version = None;
            update.error = None;
        });
        return Ok(snapshot.into());
    }

    update_addon_state(app, state, |update| {
        update.status = AddonUpdateStatus::Updating;
        update.error = None;
    });

    let staged = get_usable_staged_addon_update(app, state).await?;
    if staged.as_ref().is_some_and(|staged| {
        staged.version == latest.version && staged.checksum_url == latest.checksum_url
    }) {
        update_addon_state(app, state, |update| {
            update.status = AddonUpdateStatus::Staged;
            update.staged_version = Some(latest.version.clone());
        });
    } else {
        download_addon_package(
            &state.client,
            &latest.url,
            &latest.checksum_url,
            &staged_zip_path(app)?,
            &staged_checksum_path(app)?,
        )
        .await?;
        write_staged_addon_update(
            app,
            &StagedAddonUpdate {
                version: latest.version.clone(),
                checksum_url: latest.checksum_url.clone(),
                downloaded_at: chrono::Utc::now().timestamp_millis(),
            },
        )?;
        let _ = app.emit("addon-update-staged", latest.version.clone());
        update_addon_state(app, state, |update| {
            update.status = AddonUpdateStatus::Staged;
            update.staged_version = Some(latest.version.clone());
            update.error = None;
        });
    }

    apply_staged_addon_update_if_ready(app, state).await
}

async fn apply_staged_addon_update_if_ready(
    app: &AppHandle,
    state: &crate::AppState,
) -> Result<AddonUpdateCheckResult> {
    let Some(staged) = get_usable_staged_addon_update(app, state).await? else {
        return Ok(state.addon_update.snapshot().into());
    };
    let retail_path =
        crate::wow_folder::validated_retail_path(state).map_err(|error| anyhow!(error))?;
    let installed_version = get_installed_addon_version_for_retail_path(&retail_path)?;
    let Some(installed_version) = installed_version else {
        return Ok(state.addon_update.snapshot().into());
    };
    if !is_outdated_version(&installed_version, &staged.version) {
        clear_staged_addon_update(app).ok();
        let snapshot = update_addon_state(app, state, |update| {
            update.status = AddonUpdateStatus::UpToDate;
            update.installed_version = Some(installed_version);
            update.staged_version = None;
            update.error = None;
        });
        return Ok(snapshot.into());
    }

    install_addon_from_package(
        &retail_path,
        &staged_zip_path(app)?,
        &staged_checksum_path(app)?,
    )?;
    clear_staged_addon_update(app).ok();
    let _ = app.emit("addon-update-applied", staged.version.clone());
    let snapshot = update_addon_state(app, state, |update| {
        update.status = AddonUpdateStatus::Applied;
        update.installed_version = Some(staged.version.clone());
        update.latest_version = Some(staged.version.clone());
        update.staged_version = None;
        update.error = None;
    });
    Ok(snapshot.into())
}

impl From<AddonUpdateState> for AddonUpdateCheckResult {
    fn from(value: AddonUpdateState) -> Self {
        Self {
            status: value.status,
            installed_version: value.installed_version,
            latest_version: value.latest_version,
            staged_version: value.staged_version,
            error: value.error,
        }
    }
}

fn update_addon_state(
    app: &AppHandle,
    state: &crate::AppState,
    patch: impl FnOnce(&mut AddonUpdateState),
) -> AddonUpdateState {
    let snapshot = state.addon_update.update(patch);
    let _ = app.emit("addon-update-state", snapshot.clone());
    snapshot
}

pub fn get_installed_addon_version_for_retail_path(retail_path: &Path) -> Result<Option<String>> {
    let toc_path = crate::wow_folder::get_addon_toc_path(retail_path);
    let Ok(content) = fs::read_to_string(toc_path) else {
        return Ok(None);
    };
    Ok(content.lines().find_map(|line| {
        line.strip_prefix("##")
            .map(str::trim)
            .and_then(|line| line.strip_prefix("Version:"))
            .map(str::trim)
            .filter(|version| !version.is_empty())
            .map(ToOwned::to_owned)
    }))
}

pub fn is_outdated_version(installed: &str, latest: &str) -> bool {
    let installed = parse_version(installed);
    let latest = parse_version(latest);
    for index in 0..installed.len().max(latest.len()) {
        let left = installed.get(index).copied().unwrap_or(0);
        let right = latest.get(index).copied().unwrap_or(0);
        if left < right {
            return true;
        }
        if left > right {
            return false;
        }
    }
    false
}

fn parse_version(value: &str) -> Vec<u64> {
    value
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect()
}

async fn fetch_latest_addon_release(client: &reqwest::Client) -> Result<AddonReleaseInfo> {
    let releases = client
        .get(format!(
            "https://api.github.com/repos/{GITHUB_REPO}/releases"
        ))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header(reqwest::header::USER_AGENT, "wow-dashboard-tauri")
        .send()
        .await?
        .error_for_status()?
        .json::<Vec<GitHubRelease>>()
        .await?;

    let release = releases
        .into_iter()
        .find(|release| {
            release.tag_name.starts_with("addon-v") && !release.draft && !release.prerelease
        })
        .ok_or_else(|| anyhow!("No addon release found on GitHub"))?;
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == ADDON_ZIP_NAME)
        .ok_or_else(|| anyhow!("No wow-dashboard.zip asset found in latest addon release"))?;
    let checksum = release
        .assets
        .iter()
        .find(|asset| asset.name == ADDON_CHECKSUM_NAME)
        .ok_or_else(|| {
            anyhow!("No wow-dashboard.zip.sha256 asset found in latest addon release")
        })?;
    validate_official_addon_release_url(
        &asset.browser_download_url,
        &release.tag_name,
        ADDON_ZIP_NAME,
    )?;
    validate_official_addon_release_url(
        &checksum.browser_download_url,
        &release.tag_name,
        ADDON_CHECKSUM_NAME,
    )?;
    Ok(AddonReleaseInfo {
        version: release.tag_name.trim_start_matches("addon-v").to_string(),
        url: asset.browser_download_url.clone(),
        checksum_url: checksum.browser_download_url.clone(),
    })
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

fn validate_official_addon_release_url(url: &str, tag_name: &str, asset_name: &str) -> Result<()> {
    let parsed = Url::parse(url).context("Invalid URL")?;
    let (owner, repo) = GITHUB_REPO
        .split_once('/')
        .ok_or_else(|| anyhow!("Invalid GitHub repository configuration"))?;
    let expected = format!("/{owner}/{repo}/releases/download/{tag_name}/{asset_name}");
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || parsed.path() != expected
    {
        return Err(anyhow!("Untrusted addon release asset URL: {url}"));
    }
    Ok(())
}

async fn download_addon_package(
    client: &reqwest::Client,
    download_url: &str,
    checksum_url: &str,
    zip_path: &Path,
    checksum_path: &Path,
) -> Result<()> {
    if let Some(parent) = zip_path.parent() {
        fs::create_dir_all(parent)?;
    }
    download_file(client, download_url, zip_path).await?;
    download_file(client, checksum_url, checksum_path).await?;
    verify_addon_package(zip_path, checksum_path)
}

async fn download_and_install_addon_release(
    client: &reqwest::Client,
    release: &AddonReleaseInfo,
    retail_path: &Path,
) -> Result<()> {
    let dir = TempDir::new()?;
    let zip_path = dir.path().join(ADDON_ZIP_NAME);
    let checksum_path = dir.path().join(ADDON_CHECKSUM_NAME);
    download_addon_package(
        client,
        &release.url,
        &release.checksum_url,
        &zip_path,
        &checksum_path,
    )
    .await?;
    install_addon_from_package(retail_path, &zip_path, &checksum_path)
}

async fn download_file(client: &reqwest::Client, url: &str, dest_path: &Path) -> Result<()> {
    let response = client.get(url).send().await?.error_for_status()?;
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(dest_path).await?;
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk?).await?;
    }
    file.flush().await?;
    Ok(())
}

pub fn compute_file_sha256(file_path: &Path) -> Result<String> {
    let mut file = fs::File::open(file_path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

pub fn verify_addon_package(zip_path: &Path, checksum_path: &Path) -> Result<()> {
    let checksum_content = fs::read_to_string(checksum_path)?;
    let expected_hash = checksum_content
        .split_whitespace()
        .next()
        .ok_or_else(|| anyhow!("Invalid addon checksum format"))?;
    if expected_hash.len() != 64 || !expected_hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(anyhow!("Invalid addon checksum format"));
    }
    let actual_hash = compute_file_sha256(zip_path)?;
    if actual_hash.to_ascii_lowercase() != expected_hash.to_ascii_lowercase() {
        return Err(anyhow!(
            "Checksum mismatch - addon package may be corrupted or tampered with."
        ));
    }
    Ok(())
}

pub fn install_addon_from_package(
    retail_path: &Path,
    zip_path: &Path,
    checksum_path: &Path,
) -> Result<()> {
    verify_addon_package(zip_path, checksum_path)?;
    let extract_dir = TempDir::new()?;
    extract_zip_safe(zip_path, extract_dir.path())?;

    let entries = fs::read_dir(extract_dir.path())?
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .collect::<Vec<_>>();
    let addon_src = if entries.len() == 1 {
        entries[0].path()
    } else {
        extract_dir.path().to_path_buf()
    };
    if !is_path_inside(extract_dir.path(), &addon_src) {
        return Err(anyhow!("Path traversal detected in zip archive"));
    }

    let addons_dir = retail_path.join("Interface").join("AddOns");
    let addon_dest = addons_dir.join("wow-dashboard");
    fs::create_dir_all(&addons_dir)?;
    if addon_dest.exists() {
        fs::remove_dir_all(&addon_dest)?;
    }
    copy_dir_recursive(&addon_src, &addon_dest)
}

pub fn extract_zip_safe(zip_path: &Path, dest_dir: &Path) -> Result<()> {
    let resolved_dest = dest_dir
        .canonicalize()
        .unwrap_or_else(|_| dest_dir.to_path_buf());
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| anyhow!("Path traversal detected in zip entry: {}", entry.name()))?;
        let out_path = resolved_dest.join(enclosed);
        if !is_path_inside(&resolved_dest, &out_path) {
            return Err(anyhow!(
                "Path traversal detected in zip entry: {}",
                entry.name()
            ));
        }
        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut output = fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut output)?;
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn is_path_inside(parent: &Path, child: &Path) -> bool {
    let parent = parent
        .canonicalize()
        .unwrap_or_else(|_| parent.to_path_buf());
    let child = child.canonicalize().unwrap_or_else(|_| child.to_path_buf());
    child == parent || child.starts_with(parent)
}

fn addon_update_stage_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("addon-update"))
}

fn staged_zip_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(addon_update_stage_dir(app)?.join(ADDON_ZIP_NAME))
}

fn staged_checksum_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(addon_update_stage_dir(app)?.join(ADDON_CHECKSUM_NAME))
}

fn staged_meta_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(addon_update_stage_dir(app)?.join("staged.json"))
}

fn read_staged_addon_update(app: &AppHandle) -> Result<Option<StagedAddonUpdate>> {
    let path = staged_meta_path(app)?;
    let Ok(raw) = fs::read_to_string(path) else {
        return Ok(None);
    };
    Ok(Some(serde_json::from_str(&raw)?))
}

fn write_staged_addon_update(app: &AppHandle, update: &StagedAddonUpdate) -> Result<()> {
    let path = staged_meta_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(update)?)?;
    Ok(())
}

fn clear_staged_addon_update(app: &AppHandle) -> Result<()> {
    let path = addon_update_stage_dir(app)?;
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

async fn get_usable_staged_addon_update(
    app: &AppHandle,
    state: &crate::AppState,
) -> Result<Option<StagedAddonUpdate>> {
    let staged = read_staged_addon_update(app)?;
    let Some(staged) = staged else {
        return Ok(None);
    };
    if staged_zip_path(app)?.exists() && staged_checksum_path(app)?.exists() {
        return Ok(Some(staged));
    }
    clear_staged_addon_update(app).ok();
    update_addon_state(app, state, |update| update.staged_version = None);
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        for (name, bytes) in entries {
            zip.start_file(name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn verifies_sha256_checksum() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("wow-dashboard.zip");
        let checksum = dir.path().join("wow-dashboard.zip.sha256");
        fs::write(&zip, b"addon").unwrap();
        let hash = compute_file_sha256(&zip).unwrap();
        fs::write(&checksum, format!("{hash}  wow-dashboard.zip")).unwrap();
        verify_addon_package(&zip, &checksum).unwrap();
        fs::write(&checksum, "0".repeat(64)).unwrap();
        assert!(verify_addon_package(&zip, &checksum).is_err());
    }

    #[test]
    fn rejects_zip_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("bad.zip");
        write_zip(&zip, &[("../evil.txt", b"bad")]);
        let out = dir.path().join("out");
        fs::create_dir_all(&out).unwrap();
        assert!(extract_zip_safe(&zip, &out).is_err());
    }

    #[test]
    fn compares_versions_numerically() {
        assert!(is_outdated_version("1.2.9", "1.2.10"));
        assert!(!is_outdated_version("1.10.0", "1.2.0"));
    }
}
