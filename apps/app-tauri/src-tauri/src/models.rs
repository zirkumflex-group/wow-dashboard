use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Tank,
    Healer,
    Dps,
}

impl Default for Role {
    fn default() -> Self {
        Self::Dps
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Region {
    Us,
    Eu,
    Kr,
    Tw,
}

impl Default for Region {
    fn default() -> Self {
        Self::Us
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Faction {
    Alliance,
    Horde,
}

impl Default for Faction {
    fn default() -> Self {
        Self::Alliance
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCurrencyInfo {
    pub currency_id: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub quantity: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_file_id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_quantity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_earn_per_week: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity_earned_this_week: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_weekly_quantity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_earned: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub discovered: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_total_earned_for_max_qty: Option<bool>,
}

pub type SnapshotCurrencyDetails = BTreeMap<String, SnapshotCurrencyInfo>;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEquipmentItem {
    pub slot: String,
    pub slot_id: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_link: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_file_id: Option<f64>,
}

pub type SnapshotEquipment = BTreeMap<String, SnapshotEquipmentItem>;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotWeeklyRewardActivity {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_tier_id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotWeeklyRewards {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_claim_rewards: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_current_period: Option<bool>,
    pub activities: Vec<SnapshotWeeklyRewardActivity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMajorFaction {
    pub faction_id: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expansion_id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_unlocked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renown_level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renown_reputation_earned: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renown_level_threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_weekly_capped: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMajorFactions {
    pub factions: Vec<SnapshotMajorFaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotClientInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addon_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interface_version: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toc_version: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expansion: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCurrencies {
    pub adventurer_dawncrest: f64,
    pub veteran_dawncrest: f64,
    pub champion_dawncrest: f64,
    pub hero_dawncrest: f64,
    pub myth_dawncrest: f64,
    pub radiant_spark_dust: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotStats {
    pub stamina: f64,
    pub strength: f64,
    pub agility: f64,
    pub intellect: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crit_rating: Option<f64>,
    pub crit_percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub haste_rating: Option<f64>,
    pub haste_percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mastery_rating: Option<f64>,
    pub mastery_percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub versatility_rating: Option<f64>,
    pub versatility_percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speed_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leech_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leech_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avoidance_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avoidance_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OwnedKeystone {
    pub level: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_challenge_mode_id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotData {
    pub taken_at: f64,
    pub level: f64,
    pub spec: String,
    pub role: Role,
    pub item_level: f64,
    pub gold: f64,
    pub playtime_seconds: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playtime_this_level_seconds: Option<f64>,
    pub mythic_plus_score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season_id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owned_keystone: Option<OwnedKeystone>,
    pub currencies: SnapshotCurrencies,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency_details: Option<SnapshotCurrencyDetails>,
    pub stats: SnapshotStats,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub equipment: Option<SnapshotEquipment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weekly_rewards: Option<SnapshotWeeklyRewards>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub major_factions: Option<SnapshotMajorFactions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_info: Option<SnapshotClientInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MythicPlusRunStatus {
    Active,
    Completed,
    Abandoned,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MythicPlusAbandonReason {
    ChallengeModeReset,
    LeftInstance,
    LeaverTimer,
    HistoryIncomplete,
    StaleRecovery,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MythicPlusRunMemberData {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub realm: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub class_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<Role>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MythicPlusRunData {
    pub fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_key: Option<String>,
    pub observed_at: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season_id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_challenge_mode_id: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<MythicPlusRunStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_in_time: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abandoned_at: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abandon_reason: Option<MythicPlusAbandonReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub this_week: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<MythicPlusRunMemberData>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterData {
    pub name: String,
    pub realm: String,
    pub region: Region,
    pub class: String,
    pub race: String,
    pub faction: Faction,
    pub snapshots: Vec<SnapshotData>,
    #[serde(default)]
    pub mythic_plus_runs: Vec<MythicPlusRunData>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PendingUploadCounts {
    pub snapshots: usize,
    pub mythic_plus_runs: usize,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddonFileStats {
    pub total_bytes: u64,
    pub created_at: f64,
    pub modified_at: f64,
    pub total_snapshots: usize,
    pub total_mythic_plus_runs: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonParseResult {
    pub characters: Vec<CharacterData>,
    pub accounts_found: Vec<String>,
    pub file_stats: Option<AddonFileStats>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddonIngestResponse {
    pub new_chars: usize,
    pub new_snapshots: usize,
    pub new_mythic_plus_runs: usize,
}

pub fn character_merge_key(character: &CharacterData) -> String {
    format!(
        "{:?}:{}:{}",
        character.region,
        character.realm.to_lowercase(),
        character.name.to_lowercase()
    )
}
