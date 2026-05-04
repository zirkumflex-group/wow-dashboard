use crate::models::{
    AddonFileStats, AddonIngestResponse, AddonParseResult, CharacterData, MythicPlusRunData,
    PendingUploadCounts, SnapshotData,
};
use anyhow::{Result, anyhow};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use reqwest::Method;
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

const MYTHIC_PLUS_UPLOAD_LOOKBACK_SECONDS: i64 = 2 * 60 * 60;
const MYTHIC_PLUS_MEMBER_UPLOAD_LOOKBACK_SECONDS: i64 = 48 * 60 * 60;
const ADDON_UPLOAD_CHARACTERS_PER_BATCH: usize = 20;
const ADDON_UPLOAD_SNAPSHOTS_PER_CHARACTER: usize = 100;
const ADDON_UPLOAD_RUNS_PER_CHARACTER: usize = 150;
const ADDON_UPLOAD_MAX_BATCH_BODY_BYTES: usize = 768 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncStatus {
    Idle,
    Scanning,
    Uploading,
    Resyncing,
    Success,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub status: SyncStatus,
    pub message: Option<String>,
    pub pending_upload_counts: Option<PendingUploadCounts>,
    pub file_stats: Option<AddonFileStats>,
    pub last_synced_at: i64,
    pub last_upload_result: Option<AddonIngestResponse>,
    pub accounts_found: Vec<String>,
    pub tracked_characters: usize,
    pub batches_total: usize,
    pub batches_completed: usize,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            status: SyncStatus::Idle,
            message: None,
            pending_upload_counts: None,
            file_stats: None,
            last_synced_at: 0,
            last_upload_result: None,
            accounts_found: Vec::new(),
            tracked_characters: 0,
            batches_total: 0,
            batches_completed: 0,
        }
    }
}

#[derive(Clone)]
pub struct SyncStore {
    state: Arc<Mutex<SyncState>>,
    running: Arc<AtomicBool>,
    watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    watch_generation: Arc<AtomicU64>,
}

impl SyncStore {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(SyncState::default())),
            running: Arc::new(AtomicBool::new(false)),
            watcher: Arc::new(Mutex::new(None)),
            watch_generation: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn snapshot(&self) -> SyncState {
        self.state
            .lock()
            .expect("sync state mutex poisoned")
            .clone()
    }

    fn update(&self, patch: impl FnOnce(&mut SyncState)) -> SyncState {
        let mut state = self.state.lock().expect("sync state mutex poisoned");
        patch(&mut state);
        state.clone()
    }
}

#[tauri::command]
pub async fn sync_get_state(state: State<'_, crate::AppState>) -> Result<SyncState, String> {
    let mut snapshot = state.sync.snapshot();
    snapshot.last_synced_at = state.settings.snapshot().last_synced_at;
    Ok(snapshot)
}

#[tauri::command]
pub async fn sync_refresh_file_state(
    app: AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<SyncState, String> {
    refresh_file_state(&app, &state).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn sync_now(
    app: AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<SyncState, String> {
    sync_now_inner(&app, &state)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn wow_watch_addon_file(
    app: AppHandle,
    state: State<'_, crate::AppState>,
) -> Result<bool, String> {
    let retail_path = crate::wow_folder::validated_retail_path(&state)?;
    let watch_path = retail_path.join("WTF").join("Account");
    if !watch_path.exists() {
        return Ok(false);
    }

    let app_for_callback = app.clone();
    let generation = state.sync.watch_generation.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else {
            return;
        };
        if !event.paths.iter().any(is_saved_variables_path) {
            return;
        }
        let current_generation = generation.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app_for_callback.clone();
        let generation = generation.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            if generation.load(Ordering::SeqCst) != current_generation {
                return;
            }
            let _ = app.emit("addon-file-changed", true);
            let state = app.state::<crate::AppState>();
            let _ = sync_now_inner(&app, &state).await;
        });
    })
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&watch_path, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;
    *state.sync.watcher.lock().expect("watcher mutex poisoned") = Some(watcher);
    Ok(true)
}

#[tauri::command]
pub async fn wow_unwatch_addon_file(state: State<'_, crate::AppState>) -> Result<(), String> {
    *state.sync.watcher.lock().expect("watcher mutex poisoned") = None;
    Ok(())
}

fn is_saved_variables_path(path: &PathBuf) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("wow-dashboard.lua"))
}

fn refresh_file_state(app: &AppHandle, state: &crate::AppState) -> Result<SyncState> {
    let retail_path =
        crate::wow_folder::validated_retail_path(state).map_err(|error| anyhow!(error))?;
    let data = crate::saved_variables::find_and_parse_addon_data(&retail_path);
    let since_ts = state.settings.snapshot().last_synced_at.saturating_sub(60);
    let pending_upload_counts = get_pending_upload_counts(&data.characters, since_ts);
    let snapshot = state.sync.update(|sync| {
        sync.pending_upload_counts = Some(pending_upload_counts);
        sync.file_stats = data.file_stats;
        sync.last_synced_at = state.settings.snapshot().last_synced_at;
        sync.accounts_found = data.accounts_found;
        sync.tracked_characters = data.characters.len();
        sync.message = None;
    });
    emit_sync_state(app, &snapshot);
    Ok(snapshot)
}

async fn sync_now_inner(app: &AppHandle, state: &crate::AppState) -> Result<SyncState> {
    if state.sync.running.swap(true, Ordering::SeqCst) {
        return Ok(state.sync.snapshot());
    }

    let result = sync_now_guarded(app, state).await;
    state.sync.running.store(false, Ordering::SeqCst);
    match result {
        Ok(snapshot) => Ok(snapshot),
        Err(error) => Ok(set_sync_error(app, state, error.to_string())),
    }
}

async fn sync_now_guarded(app: &AppHandle, state: &crate::AppState) -> Result<SyncState> {
    let token = state
        .auth_token()?
        .ok_or_else(|| anyhow!("No desktop session token available"))?;
    let retail_path = match crate::wow_folder::validated_retail_path(state) {
        Ok(path) => path,
        Err(error) => {
            let snapshot = state.sync.update(|sync| {
                sync.status = SyncStatus::Warning;
                sync.message = Some(error);
                sync.last_synced_at = state.settings.snapshot().last_synced_at;
            });
            emit_sync_state(app, &snapshot);
            return Ok(snapshot);
        }
    };

    let started = state.sync.update(|sync| {
        sync.status = SyncStatus::Scanning;
        sync.message = None;
        sync.last_upload_result = None;
        sync.batches_total = 0;
        sync.batches_completed = 0;
        sync.last_synced_at = state.settings.snapshot().last_synced_at;
    });
    emit_sync_state(app, &started);

    let addon_data = crate::saved_variables::find_and_parse_addon_data(&retail_path);
    let since_ts = state.settings.snapshot().last_synced_at.saturating_sub(60);
    let pending_upload_counts = get_pending_upload_counts(&addon_data.characters, since_ts);
    update_from_parse_result(app, state, &addon_data, pending_upload_counts);

    if addon_data.characters.is_empty() {
        let message = if addon_data.accounts_found.is_empty() {
            "No wow-dashboard.lua found - run the addon in-game first".to_string()
        } else {
            format!(
                "Parsed {} account(s) but no characters found",
                addon_data.accounts_found.len()
            )
        };
        let snapshot = state.sync.update(|sync| {
            sync.status = SyncStatus::Warning;
            sync.message = Some(message);
        });
        emit_sync_state(app, &snapshot);
        return Ok(snapshot);
    }

    let pending_characters = filter_pending_characters(addon_data.characters, since_ts);
    let batches = create_addon_upload_batches(&pending_characters);
    let mut aggregate = AddonIngestResponse::default();

    if !batches.is_empty() {
        let uploading = state.sync.update(|sync| {
            sync.status = SyncStatus::Uploading;
            sync.batches_total = batches.len();
            sync.batches_completed = 0;
        });
        emit_sync_state(app, &uploading);

        for (index, batch) in batches.iter().enumerate() {
            let result = upload_addon_batch(state, &token, batch).await?;
            aggregate.new_chars += result.new_chars;
            aggregate.new_snapshots += result.new_snapshots;
            aggregate.new_mythic_plus_runs += result.new_mythic_plus_runs;
            let snapshot = state.sync.update(|sync| {
                sync.batches_completed = index + 1;
            });
            emit_sync_state(app, &snapshot);
        }

        let now = chrono::Utc::now().timestamp();
        state
            .settings
            .update(|settings| settings.last_synced_at = now)?;
        let snapshot = state.sync.update(|sync| {
            sync.last_synced_at = now;
            sync.last_upload_result = Some(aggregate);
        });
        emit_sync_state(app, &snapshot);
    } else {
        let snapshot = state.sync.update(|sync| {
            sync.last_upload_result = Some(AddonIngestResponse::default());
        });
        emit_sync_state(app, &snapshot);
    }

    let resyncing = state.sync.update(|sync| {
        sync.status = SyncStatus::Resyncing;
    });
    emit_sync_state(app, &resyncing);
    let _ = crate::api::post_empty(
        &state.client,
        &state.config,
        Some(&token),
        "/characters/resync",
    )
    .await?;

    let snapshot = state.sync.update(|sync| {
        sync.status = SyncStatus::Success;
        sync.message = None;
        sync.pending_upload_counts = Some(PendingUploadCounts::default());
        sync.last_synced_at = state.settings.snapshot().last_synced_at;
    });
    emit_sync_state(app, &snapshot);
    Ok(snapshot)
}

fn update_from_parse_result(
    app: &AppHandle,
    state: &crate::AppState,
    data: &AddonParseResult,
    pending_upload_counts: PendingUploadCounts,
) {
    let snapshot = state.sync.update(|sync| {
        sync.pending_upload_counts = Some(pending_upload_counts);
        sync.file_stats = data.file_stats;
        sync.accounts_found = data.accounts_found.clone();
        sync.tracked_characters = data.characters.len();
    });
    emit_sync_state(app, &snapshot);
}

fn emit_sync_state(app: &AppHandle, snapshot: &SyncState) {
    let _ = app.emit("sync-state", snapshot.clone());
}

fn set_sync_error(app: &AppHandle, state: &crate::AppState, message: String) -> SyncState {
    let snapshot = state.sync.update(|sync| {
        sync.status = SyncStatus::Error;
        sync.message = Some(message);
        sync.last_synced_at = state.settings.snapshot().last_synced_at;
    });
    emit_sync_state(app, &snapshot);
    snapshot
}

async fn upload_addon_batch(
    state: &crate::AppState,
    token: &str,
    batch: &[CharacterData],
) -> Result<AddonIngestResponse> {
    crate::api::request_json(
        &state.client,
        &state.config,
        Some(token),
        Method::POST,
        "/addon/ingest",
        Some(serde_json::json!({ "characters": batch })),
    )
    .await
}

pub fn get_pending_upload_counts(
    characters: &[CharacterData],
    since_ts: i64,
) -> PendingUploadCounts {
    let mut counts = PendingUploadCounts::default();
    for character in characters {
        counts.snapshots += character
            .snapshots
            .iter()
            .filter(|snapshot| is_uploadable_snapshot(snapshot, since_ts))
            .count();
        counts.mythic_plus_runs += character
            .mythic_plus_runs
            .iter()
            .filter(|run| is_uploadable_mythic_plus_run(run, since_ts))
            .count();
    }
    counts
}

fn filter_pending_characters(characters: Vec<CharacterData>, since_ts: i64) -> Vec<CharacterData> {
    characters
        .into_iter()
        .filter_map(|mut character| {
            character
                .snapshots
                .retain(|snapshot| is_uploadable_snapshot(snapshot, since_ts));
            character
                .mythic_plus_runs
                .retain(|run| is_uploadable_mythic_plus_run(run, since_ts));
            (!character.snapshots.is_empty() || !character.mythic_plus_runs.is_empty())
                .then_some(character)
        })
        .collect()
}

fn is_uploadable_snapshot(snapshot: &SnapshotData, since_ts: i64) -> bool {
    snapshot.taken_at > since_ts as f64
        && !snapshot.spec.trim().is_empty()
        && snapshot.spec.trim() != "Unknown"
}

fn is_uploadable_mythic_plus_run(run: &MythicPlusRunData, since_ts: i64) -> bool {
    let now = chrono::Utc::now().timestamp();
    let lookback_seconds = if run
        .members
        .as_ref()
        .is_some_and(|members| !members.is_empty())
    {
        MYTHIC_PLUS_MEMBER_UPLOAD_LOOKBACK_SECONDS
    } else {
        MYTHIC_PLUS_UPLOAD_LOOKBACK_SECONDS
    };
    let effective_since_ts = since_ts.min(now - lookback_seconds);
    mythic_plus_run_last_mutation_at(run) > effective_since_ts as f64
}

fn mythic_plus_run_last_mutation_at(run: &MythicPlusRunData) -> f64 {
    [
        run.start_date,
        run.completed_at,
        run.ended_at,
        run.abandoned_at,
        Some(run.observed_at),
    ]
    .into_iter()
    .flatten()
    .filter(|value| value.is_finite() && *value > 0.0)
    .fold(0.0, f64::max)
}

pub fn create_addon_upload_batches(characters: &[CharacterData]) -> Vec<Vec<CharacterData>> {
    let chunks = characters
        .iter()
        .flat_map(chunk_character_for_upload)
        .collect::<Vec<_>>();
    let mut batches = Vec::<Vec<CharacterData>>::new();
    let mut current_batch = Vec::<CharacterData>::new();

    for chunk in chunks {
        let mut candidate = current_batch.clone();
        candidate.push(chunk.clone());
        let exceeds_character_limit = candidate.len() > ADDON_UPLOAD_CHARACTERS_PER_BATCH;
        let exceeds_body_limit = !current_batch.is_empty()
            && approximate_payload_size(&candidate) > ADDON_UPLOAD_MAX_BATCH_BODY_BYTES;

        if exceeds_character_limit || exceeds_body_limit {
            batches.push(current_batch);
            current_batch = vec![chunk];
        } else {
            current_batch = candidate;
        }
    }

    if !current_batch.is_empty() {
        batches.push(current_batch);
    }
    batches
}

fn chunk_character_for_upload(character: &CharacterData) -> Vec<CharacterData> {
    let chunk_count = character
        .snapshots
        .len()
        .div_ceil(ADDON_UPLOAD_SNAPSHOTS_PER_CHARACTER)
        .max(
            character
                .mythic_plus_runs
                .len()
                .div_ceil(ADDON_UPLOAD_RUNS_PER_CHARACTER),
        )
        .max(1);
    let mut chunks = Vec::new();
    for index in 0..chunk_count {
        let snapshots = character
            .snapshots
            .iter()
            .skip(index * ADDON_UPLOAD_SNAPSHOTS_PER_CHARACTER)
            .take(ADDON_UPLOAD_SNAPSHOTS_PER_CHARACTER)
            .cloned()
            .collect::<Vec<_>>();
        let mythic_plus_runs = character
            .mythic_plus_runs
            .iter()
            .skip(index * ADDON_UPLOAD_RUNS_PER_CHARACTER)
            .take(ADDON_UPLOAD_RUNS_PER_CHARACTER)
            .cloned()
            .collect::<Vec<_>>();
        if snapshots.is_empty() && mythic_plus_runs.is_empty() {
            continue;
        }
        let mut chunk = character.clone();
        chunk.snapshots = snapshots;
        chunk.mythic_plus_runs = mythic_plus_runs;
        chunks.push(chunk);
    }
    chunks
}

fn approximate_payload_size(characters: &[CharacterData]) -> usize {
    serde_json::to_vec(&serde_json::json!({ "characters": characters }))
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Region, Role, SnapshotCurrencies, SnapshotStats};

    fn snapshot(taken_at: f64) -> SnapshotData {
        SnapshotData {
            taken_at,
            level: 80.0,
            spec: "Fire".to_string(),
            role: Role::Dps,
            item_level: 680.0,
            gold: 0.0,
            playtime_seconds: 1.0,
            playtime_this_level_seconds: None,
            mythic_plus_score: 0.0,
            season_id: None,
            owned_keystone: None,
            currencies: SnapshotCurrencies::default(),
            currency_details: None,
            stats: SnapshotStats::default(),
            equipment: None,
            weekly_rewards: None,
            major_factions: None,
            client_info: None,
        }
    }

    fn character(snapshot_count: usize, run_count: usize) -> CharacterData {
        CharacterData {
            name: "Test".to_string(),
            realm: "Area 52".to_string(),
            region: Region::Us,
            class: "MAGE".to_string(),
            race: "Human".to_string(),
            faction: crate::models::Faction::Alliance,
            snapshots: (0..snapshot_count)
                .map(|index| snapshot(1000.0 + index as f64))
                .collect(),
            mythic_plus_runs: (0..run_count)
                .map(|index| MythicPlusRunData {
                    fingerprint: format!("run-{index}"),
                    attempt_id: None,
                    canonical_key: None,
                    observed_at: 1000.0 + index as f64,
                    season_id: Some(15.0),
                    map_challenge_mode_id: Some(500.0),
                    map_name: None,
                    level: Some(10.0),
                    status: None,
                    completed: None,
                    completed_in_time: None,
                    duration_ms: None,
                    run_score: None,
                    start_date: None,
                    completed_at: None,
                    ended_at: None,
                    abandoned_at: None,
                    abandon_reason: None,
                    this_week: None,
                    members: None,
                })
                .collect(),
        }
    }

    #[test]
    fn creates_bounded_upload_batches() {
        let character = character(250, 350);
        let batches = create_addon_upload_batches(&[character]);
        assert_eq!(batches.iter().map(Vec::len).sum::<usize>(), 3);
        assert!(
            batches
                .iter()
                .all(|batch| batch.len() <= ADDON_UPLOAD_CHARACTERS_PER_BATCH)
        );
        assert!(batches.iter().all(|batch| {
            batch.iter().all(|character| {
                character.snapshots.len() <= ADDON_UPLOAD_SNAPSHOTS_PER_CHARACTER
                    && character.mythic_plus_runs.len() <= ADDON_UPLOAD_RUNS_PER_CHARACTER
            })
        }));
    }

    #[test]
    fn counts_pending_records() {
        let counts = get_pending_upload_counts(&[character(2, 1)], 999);
        assert_eq!(counts.snapshots, 2);
        assert_eq!(counts.mythic_plus_runs, 1);
    }
}
