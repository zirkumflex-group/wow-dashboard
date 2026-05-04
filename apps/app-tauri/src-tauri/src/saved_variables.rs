use crate::models::{
    AddonFileStats, AddonParseResult, CharacterData, Faction, MythicPlusAbandonReason,
    MythicPlusRunData, MythicPlusRunMemberData, MythicPlusRunStatus, OwnedKeystone, Region, Role,
    SnapshotClientInfo, SnapshotCurrencies, SnapshotCurrencyDetails, SnapshotCurrencyInfo,
    SnapshotData, SnapshotEquipment, SnapshotEquipmentItem, SnapshotMajorFaction,
    SnapshotMajorFactions, SnapshotStats, SnapshotWeeklyRewardActivity, SnapshotWeeklyRewards,
    character_merge_key,
};
use anyhow::{Result, anyhow};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::Path,
};

#[derive(Debug, Clone)]
enum LuaValue {
    Nil,
    String(String),
    Number(f64),
    Bool(bool),
    Table(LuaTable),
}

#[derive(Debug, Clone, Default)]
struct LuaTable {
    fields: BTreeMap<String, LuaValue>,
    array: Vec<LuaValue>,
}

impl LuaTable {
    fn insert_key(&mut self, key: LuaValue, value: LuaValue) {
        match key {
            LuaValue::String(key) => {
                self.fields.insert(key, value);
            }
            LuaValue::Number(number) if number.fract() == 0.0 && number >= 1.0 => {
                let index = number as usize - 1;
                if self.array.len() <= index {
                    self.array.resize(index + 1, LuaValue::Nil);
                }
                self.array[index] = value;
            }
            _ => {}
        }
    }

    fn push_array(&mut self, value: LuaValue) {
        self.array.push(value);
    }

    fn get(&self, key: &str) -> Option<&LuaValue> {
        self.fields.get(key)
    }

    fn array_tables(&self) -> impl Iterator<Item = &LuaTable> {
        self.array.iter().filter_map(|value| match value {
            LuaValue::Table(table) => Some(table),
            _ => None,
        })
    }
}

#[derive(Debug)]
pub struct ParsedSavedVariables {
    pub characters: Vec<CharacterData>,
}

#[derive(Debug)]
struct Parser<'a> {
    src: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(src: &'a str) -> Self {
        Self { src, pos: 0 }
    }

    fn parse_saved_variables(mut self) -> Result<ParsedSavedVariables> {
        let db_start = self
            .src
            .find("WowDashboardDB")
            .ok_or_else(|| anyhow!("WowDashboardDB not found"))?;
        self.pos = db_start + "WowDashboardDB".len();
        self.skip();
        self.expect_byte(b'=')?;
        self.skip();
        self.expect_byte(b'{')?;

        let mut characters = Vec::new();
        let mut pending_members = BTreeMap::<String, Vec<MythicPlusRunMemberData>>::new();

        loop {
            self.skip();
            if self.consume_byte(b'}') {
                break;
            }
            if self.eof() {
                return Err(anyhow!("unexpected EOF in WowDashboardDB"));
            }

            let key = self.parse_entry_key()?;
            self.skip();
            self.expect_byte(b'=')?;
            self.skip();
            match key.as_deref() {
                Some("characters") => {
                    self.parse_characters_table(&mut characters)?;
                }
                Some("pendingMythicPlusMembers") => {
                    pending_members = normalize_pending_members(self.parse_table()?);
                }
                _ => self.skip_value()?,
            }
            self.skip();
            let _ = self.consume_byte(b',') || self.consume_byte(b';');
        }

        apply_pending_members(&mut characters, &pending_members);
        Ok(ParsedSavedVariables { characters })
    }

    fn parse_characters_table(&mut self, output: &mut Vec<CharacterData>) -> Result<()> {
        self.expect_byte(b'{')?;
        loop {
            self.skip();
            if self.consume_byte(b'}') {
                break;
            }
            let fallback_key = self.parse_entry_key()?;
            self.skip();
            self.expect_byte(b'=')?;
            self.skip();
            let table = self.parse_table()?;
            if let Some(character) = normalize_character(&table, fallback_key.as_deref()) {
                output.push(character);
            }
            self.skip();
            let _ = self.consume_byte(b',') || self.consume_byte(b';');
        }
        Ok(())
    }

    fn parse_table(&mut self) -> Result<LuaTable> {
        self.expect_byte(b'{')?;
        let mut table = LuaTable::default();
        loop {
            self.skip();
            if self.consume_byte(b'}') {
                break;
            }
            if self.eof() {
                return Err(anyhow!("unexpected EOF in table"));
            }

            if self.peek_byte() == Some(b'[') {
                self.pos += 1;
                let key = self.parse_value()?;
                self.skip();
                self.expect_byte(b']')?;
                self.skip();
                self.expect_byte(b'=')?;
                let value = self.parse_value()?;
                table.insert_key(key, value);
            } else if self.peek_identifier_start() {
                let mark = self.pos;
                let ident = self.parse_identifier()?;
                self.skip();
                if self.consume_byte(b'=') {
                    let value = self.parse_value()?;
                    table.fields.insert(ident, value);
                } else {
                    self.pos = mark;
                    table.push_array(self.parse_value()?);
                }
            } else {
                table.push_array(self.parse_value()?);
            }

            self.skip();
            let _ = self.consume_byte(b',') || self.consume_byte(b';');
        }
        Ok(table)
    }

    fn skip_value(&mut self) -> Result<()> {
        self.skip();
        match self.peek_byte() {
            Some(b'{') => {
                self.pos += 1;
                loop {
                    self.skip();
                    if self.consume_byte(b'}') {
                        break;
                    }
                    if self.eof() {
                        return Err(anyhow!("unexpected EOF while skipping table"));
                    }
                    if self.peek_byte() == Some(b'[') {
                        self.pos += 1;
                        self.skip_value()?;
                        self.skip();
                        self.expect_byte(b']')?;
                        self.skip();
                        if self.consume_byte(b'=') {
                            self.skip_value()?;
                        }
                    } else if self.peek_identifier_start() {
                        let mark = self.pos;
                        let _ = self.parse_identifier()?;
                        self.skip();
                        if self.consume_byte(b'=') {
                            self.skip_value()?;
                        } else {
                            self.pos = mark;
                            self.skip_value()?;
                        }
                    } else {
                        self.skip_value()?;
                    }
                    self.skip();
                    let _ = self.consume_byte(b',') || self.consume_byte(b';');
                }
                Ok(())
            }
            Some(b'"' | b'\'') => self.parse_string().map(|_| ()),
            Some(b'-' | b'0'..=b'9') => self.parse_number().map(|_| ()),
            Some(_) if self.peek_identifier_start() => self.parse_identifier().map(|_| ()),
            _ => Err(anyhow!("unexpected value while skipping")),
        }
    }

    fn parse_value(&mut self) -> Result<LuaValue> {
        self.skip();
        match self.peek_byte() {
            Some(b'{') => Ok(LuaValue::Table(self.parse_table()?)),
            Some(b'"' | b'\'') => Ok(LuaValue::String(self.parse_string()?)),
            Some(b'-' | b'0'..=b'9') => Ok(LuaValue::Number(self.parse_number()?)),
            Some(_) if self.peek_identifier_start() => {
                let ident = self.parse_identifier()?;
                Ok(match ident.as_str() {
                    "true" => LuaValue::Bool(true),
                    "false" => LuaValue::Bool(false),
                    "nil" => LuaValue::Nil,
                    _ => LuaValue::String(ident),
                })
            }
            _ => Err(anyhow!("unexpected Lua value at byte {}", self.pos)),
        }
    }

    fn parse_entry_key(&mut self) -> Result<Option<String>> {
        self.skip();
        if self.consume_byte(b'[') {
            let key = self.parse_value()?;
            self.skip();
            self.expect_byte(b']')?;
            return Ok(match key {
                LuaValue::String(value) => Some(value),
                LuaValue::Number(value) => Some(format_number_key(value)),
                _ => None,
            });
        }
        if self.peek_identifier_start() {
            return self.parse_identifier().map(Some);
        }
        Ok(None)
    }

    fn parse_string(&mut self) -> Result<String> {
        let quote = self.next_byte().ok_or_else(|| anyhow!("expected string"))?;
        let mut out = String::new();
        while let Some(byte) = self.next_byte() {
            if byte == quote {
                return Ok(out);
            }
            if byte == b'\\' {
                let escaped = self
                    .next_byte()
                    .ok_or_else(|| anyhow!("unfinished string escape"))?;
                out.push(match escaped {
                    b'n' => '\n',
                    b'r' => '\r',
                    b't' => '\t',
                    b'\\' => '\\',
                    b'"' => '"',
                    b'\'' => '\'',
                    other => other as char,
                });
            } else {
                out.push(byte as char);
            }
        }
        Err(anyhow!("unterminated string"))
    }

    fn parse_number(&mut self) -> Result<f64> {
        let start = self.pos;
        if self.peek_byte() == Some(b'-') {
            self.pos += 1;
        }
        while matches!(self.peek_byte(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        if self.peek_byte() == Some(b'.') {
            self.pos += 1;
            while matches!(self.peek_byte(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        if matches!(self.peek_byte(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek_byte(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            while matches!(self.peek_byte(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        self.src[start..self.pos]
            .parse::<f64>()
            .map_err(|error| anyhow!("invalid number: {error}"))
    }

    fn parse_identifier(&mut self) -> Result<String> {
        let start = self.pos;
        if !self.peek_identifier_start() {
            return Err(anyhow!("expected identifier"));
        }
        self.pos += 1;
        while matches!(
            self.peek_byte(),
            Some(b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_')
        ) {
            self.pos += 1;
        }
        Ok(self.src[start..self.pos].to_string())
    }

    fn skip(&mut self) {
        loop {
            while matches!(self.peek_byte(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
                self.pos += 1;
            }
            if self.peek_byte() == Some(b'-') && self.peek_nth_byte(1) == Some(b'-') {
                self.pos += 2;
                while !matches!(self.peek_byte(), None | Some(b'\n')) {
                    self.pos += 1;
                }
                continue;
            }
            break;
        }
    }

    fn expect_byte(&mut self, expected: u8) -> Result<()> {
        self.skip();
        if self.consume_byte(expected) {
            Ok(())
        } else {
            Err(anyhow!(
                "expected '{}' at byte {}",
                expected as char,
                self.pos
            ))
        }
    }

    fn consume_byte(&mut self, expected: u8) -> bool {
        if self.peek_byte() == Some(expected) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn next_byte(&mut self) -> Option<u8> {
        let byte = self.peek_byte()?;
        self.pos += 1;
        Some(byte)
    }

    fn peek_byte(&self) -> Option<u8> {
        self.src.as_bytes().get(self.pos).copied()
    }

    fn peek_nth_byte(&self, offset: usize) -> Option<u8> {
        self.src.as_bytes().get(self.pos + offset).copied()
    }

    fn peek_identifier_start(&self) -> bool {
        matches!(self.peek_byte(), Some(b'a'..=b'z' | b'A'..=b'Z' | b'_'))
    }

    fn eof(&self) -> bool {
        self.pos >= self.src.len()
    }
}

fn format_number_key(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

pub fn parse_saved_variables(content: &str) -> Result<Vec<CharacterData>> {
    Ok(Parser::new(content).parse_saved_variables()?.characters)
}

pub fn find_and_parse_addon_data(retail_path: &Path) -> AddonParseResult {
    let wtf_account_path = retail_path.join("WTF").join("Account");
    let Ok(accounts) = fs::read_dir(wtf_account_path) else {
        return AddonParseResult::default();
    };

    let mut accounts_found = Vec::new();
    let mut all_chars = HashMap::<String, CharacterData>::new();
    let mut total_bytes = 0_u64;
    let mut created_at = f64::INFINITY;
    let mut modified_at = 0_f64;

    for account in accounts.flatten() {
        let account_name = account.file_name().to_string_lossy().to_string();
        let lua_path = account
            .path()
            .join("SavedVariables")
            .join("wow-dashboard.lua");
        let Ok(content) = fs::read_to_string(&lua_path) else {
            continue;
        };
        accounts_found.push(account_name);
        if let Ok(metadata) = fs::metadata(&lua_path) {
            total_bytes += metadata.len();
            if let Ok(created) = metadata.created() {
                if let Ok(duration) = created.duration_since(std::time::UNIX_EPOCH) {
                    created_at = created_at.min(duration.as_millis() as f64);
                }
            }
            if let Ok(modified) = metadata.modified() {
                if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                    modified_at = modified_at.max(duration.as_millis() as f64);
                }
            }
        }

        let Ok(characters) = parse_saved_variables(&content) else {
            continue;
        };
        for character in characters {
            merge_character(&mut all_chars, character);
        }
    }

    let characters = all_chars.into_values().collect::<Vec<_>>();
    let total_snapshots = characters
        .iter()
        .map(|character| character.snapshots.len())
        .sum();
    let total_mythic_plus_runs = characters
        .iter()
        .map(|character| character.mythic_plus_runs.len())
        .sum();
    let file_stats = (!accounts_found.is_empty()).then_some(AddonFileStats {
        total_bytes,
        created_at: if created_at.is_finite() {
            created_at
        } else {
            0.0
        },
        modified_at,
        total_snapshots,
        total_mythic_plus_runs,
    });

    AddonParseResult {
        characters,
        accounts_found,
        file_stats,
    }
}

pub fn merge_character(all_chars: &mut HashMap<String, CharacterData>, incoming: CharacterData) {
    let key = character_merge_key(&incoming);
    let Some(existing) = all_chars.get_mut(&key) else {
        all_chars.insert(key, incoming);
        return;
    };

    for snapshot in incoming.snapshots {
        if let Some(current) = existing
            .snapshots
            .iter_mut()
            .find(|current| current.taken_at == snapshot.taken_at)
        {
            *current = merge_snapshot_data(current.clone(), snapshot);
        } else {
            existing.snapshots.push(snapshot);
        }
    }
    existing
        .snapshots
        .sort_by(|left, right| left.taken_at.total_cmp(&right.taken_at));

    for run in incoming.mythic_plus_runs {
        upsert_mythic_plus_run(&mut existing.mythic_plus_runs, run);
    }
    sort_mythic_plus_runs(&mut existing.mythic_plus_runs);
}

pub fn merge_snapshot_data(current: SnapshotData, candidate: SnapshotData) -> SnapshotData {
    if snapshot_completeness_score(&candidate) >= snapshot_completeness_score(&current) {
        candidate
    } else {
        current
    }
}

fn snapshot_completeness_score(snapshot: &SnapshotData) -> usize {
    let mut score = 0;
    if snapshot.spec != "Unknown" && !snapshot.spec.trim().is_empty() {
        score += 2;
    }
    if snapshot.item_level > 0.0 {
        score += 1;
    }
    if snapshot
        .equipment
        .as_ref()
        .is_some_and(|items| !items.is_empty())
    {
        score += 2;
    }
    if snapshot.weekly_rewards.is_some() {
        score += 1;
    }
    if snapshot.major_factions.is_some() {
        score += 1;
    }
    if snapshot.client_info.is_some() {
        score += 1;
    }
    score
}

pub fn upsert_mythic_plus_run(runs: &mut Vec<MythicPlusRunData>, incoming: MythicPlusRunData) {
    let key = mythic_plus_run_dedup_key(&incoming);
    if let Some(existing) = runs
        .iter_mut()
        .find(|run| mythic_plus_run_dedup_key(run) == key)
    {
        *existing = merge_mythic_plus_run(existing.clone(), incoming);
    } else {
        runs.push(incoming);
    }
}

pub fn merge_mythic_plus_run(
    current: MythicPlusRunData,
    candidate: MythicPlusRunData,
) -> MythicPlusRunData {
    let candidate_preferred = mythic_plus_run_completeness_score(&candidate)
        >= mythic_plus_run_completeness_score(&current);
    let (preferred, fallback) = if candidate_preferred {
        (candidate, current)
    } else {
        (current, candidate)
    };
    let members = merge_members(fallback.members.as_deref(), preferred.members.as_deref());

    MythicPlusRunData {
        fingerprint: first_non_empty(preferred.fingerprint, fallback.fingerprint),
        attempt_id: preferred.attempt_id.or(fallback.attempt_id),
        canonical_key: preferred.canonical_key.or(fallback.canonical_key),
        observed_at: preferred.observed_at.max(fallback.observed_at),
        season_id: preferred.season_id.or(fallback.season_id),
        map_challenge_mode_id: preferred
            .map_challenge_mode_id
            .or(fallback.map_challenge_mode_id),
        map_name: preferred.map_name.or(fallback.map_name),
        level: preferred.level.or(fallback.level),
        status: preferred.status.or(fallback.status),
        completed: preferred.completed.or(fallback.completed),
        completed_in_time: preferred.completed_in_time.or(fallback.completed_in_time),
        duration_ms: preferred.duration_ms.or(fallback.duration_ms),
        run_score: preferred.run_score.or(fallback.run_score),
        start_date: preferred.start_date.or(fallback.start_date),
        completed_at: preferred.completed_at.or(fallback.completed_at),
        ended_at: preferred.ended_at.or(fallback.ended_at),
        abandoned_at: preferred.abandoned_at.or(fallback.abandoned_at),
        abandon_reason: preferred.abandon_reason.or(fallback.abandon_reason),
        this_week: preferred.this_week.or(fallback.this_week),
        members,
    }
}

fn first_non_empty(left: String, right: String) -> String {
    if left.trim().is_empty() { right } else { left }
}

pub fn mythic_plus_run_dedup_key(run: &MythicPlusRunData) -> String {
    run.attempt_id
        .clone()
        .or_else(|| run.canonical_key.clone())
        .or_else(|| {
            (!run.fingerprint.trim().is_empty()
                && !is_temporary_attempt_fingerprint(&run.fingerprint))
            .then(|| run.fingerprint.clone())
        })
        .filter(|value| !is_temporary_attempt_fingerprint(value))
        .unwrap_or_else(|| {
            [
                run.season_id.map(format_number_key).unwrap_or_default(),
                run.map_challenge_mode_id
                    .map(format_number_key)
                    .unwrap_or_default(),
                run.level.map(format_number_key).unwrap_or_default(),
                run.start_date
                    .or(run.completed_at)
                    .or(run.ended_at)
                    .or(Some(run.observed_at))
                    .map(format_number_key)
                    .unwrap_or_default(),
                run.fingerprint.clone(),
            ]
            .join(":")
        })
}

fn is_temporary_attempt_fingerprint(value: &str) -> bool {
    value.starts_with("active:")
        || value.starts_with("started:")
        || value.starts_with("fallback:")
        || value.starts_with("unknown:")
}

fn mythic_plus_run_completeness_score(run: &MythicPlusRunData) -> usize {
    let mut score = 0;
    if run.status == Some(MythicPlusRunStatus::Completed) {
        score += 4;
    }
    if run.completed_at.is_some() || run.ended_at.is_some() {
        score += 2;
    }
    if run.duration_ms.is_some() {
        score += 1;
    }
    if run
        .members
        .as_ref()
        .is_some_and(|members| !members.is_empty())
    {
        score += 3;
    }
    if run.canonical_key.is_some() {
        score += 2;
    }
    score
}

fn merge_members(
    fallback: Option<&[MythicPlusRunMemberData]>,
    preferred: Option<&[MythicPlusRunMemberData]>,
) -> Option<Vec<MythicPlusRunMemberData>> {
    let mut merged = Vec::<MythicPlusRunMemberData>::new();
    for member in fallback
        .into_iter()
        .flatten()
        .chain(preferred.into_iter().flatten())
    {
        let key = member_key(member);
        if let Some(existing) = merged
            .iter_mut()
            .find(|existing| member_key(existing) == key)
        {
            if existing.class_tag.is_none() {
                existing.class_tag = member.class_tag.clone();
            }
            if existing.role.is_none() {
                existing.role = member.role;
            }
            if existing.realm.is_none() {
                existing.realm = member.realm.clone();
            }
        } else {
            merged.push(member.clone());
        }
    }
    (!merged.is_empty()).then_some(merged)
}

fn member_key(member: &MythicPlusRunMemberData) -> String {
    format!(
        "{}:{}",
        member.name.to_lowercase(),
        member.realm.clone().unwrap_or_default().to_lowercase()
    )
}

fn sort_mythic_plus_runs(runs: &mut [MythicPlusRunData]) {
    runs.sort_by(|left, right| {
        run_sort_value(right)
            .total_cmp(&run_sort_value(left))
            .then_with(|| mythic_plus_run_dedup_key(right).cmp(&mythic_plus_run_dedup_key(left)))
    });
}

fn run_sort_value(run: &MythicPlusRunData) -> f64 {
    run.completed_at
        .or(run.ended_at)
        .or(run.abandoned_at)
        .or(run.start_date)
        .unwrap_or(run.observed_at)
}

fn normalize_character(table: &LuaTable, fallback_key: Option<&str>) -> Option<CharacterData> {
    let (fallback_name, fallback_realm) = fallback_key
        .and_then(|key| key.split_once('-'))
        .map(|(name, realm)| (name.to_string(), realm.to_string()))
        .unwrap_or_default();
    let name = string_field(table, "name").unwrap_or(fallback_name);
    let realm = string_field(table, "realm").unwrap_or(fallback_realm);
    if name.trim().is_empty() || realm.trim().is_empty() {
        return None;
    }

    let mut snapshots = table_array_field(table, "snapshots")
        .into_iter()
        .filter_map(normalize_snapshot)
        .collect::<Vec<_>>();
    snapshots.sort_by(|left, right| left.taken_at.total_cmp(&right.taken_at));

    let mut mythic_plus_runs = table_array_field(table, "mythicPlusRuns")
        .into_iter()
        .filter_map(normalize_mythic_plus_run)
        .collect::<Vec<_>>();
    let mut deduped_runs = Vec::new();
    for run in mythic_plus_runs.drain(..) {
        upsert_mythic_plus_run(&mut deduped_runs, run);
    }
    sort_mythic_plus_runs(&mut deduped_runs);

    Some(CharacterData {
        name,
        realm,
        region: normalize_region(string_field(table, "region").as_deref()),
        class: string_field(table, "class").unwrap_or_else(|| "UNKNOWN".to_string()),
        race: string_field(table, "race").unwrap_or_else(|| "UNKNOWN".to_string()),
        faction: normalize_faction(string_field(table, "faction").as_deref()),
        snapshots,
        mythic_plus_runs: deduped_runs,
    })
}

fn normalize_snapshot(table: &LuaTable) -> Option<SnapshotData> {
    let taken_at = number_field(table, "takenAt")?;
    Some(SnapshotData {
        taken_at,
        level: number_field(table, "level").unwrap_or(0.0),
        spec: string_field(table, "spec").unwrap_or_else(|| "Unknown".to_string()),
        role: normalize_role(string_field(table, "role").as_deref()).unwrap_or_default(),
        item_level: number_field(table, "itemLevel").unwrap_or(0.0),
        gold: number_field(table, "gold").unwrap_or(0.0),
        playtime_seconds: number_field(table, "playtimeSeconds").unwrap_or(0.0),
        playtime_this_level_seconds: number_field(table, "playtimeThisLevelSeconds"),
        mythic_plus_score: number_field(table, "mythicPlusScore").unwrap_or(0.0),
        season_id: number_field(table, "seasonID"),
        owned_keystone: table_field(table, "ownedKeystone").map(|owned| OwnedKeystone {
            level: number_field(owned, "level").unwrap_or(0.0),
            map_challenge_mode_id: number_field(owned, "mapChallengeModeID"),
            map_name: string_field(owned, "mapName"),
        }),
        currencies: normalize_currencies(table_field(table, "currencies")),
        currency_details: table_field(table, "currencyDetails").map(normalize_currency_details),
        stats: normalize_stats(table_field(table, "stats")),
        equipment: table_field(table, "equipment").map(normalize_equipment),
        weekly_rewards: table_field(table, "weeklyRewards").map(normalize_weekly_rewards),
        major_factions: table_field(table, "majorFactions").map(normalize_major_factions),
        client_info: table_field(table, "clientInfo").map(normalize_client_info),
    })
}

fn normalize_mythic_plus_run(table: &LuaTable) -> Option<MythicPlusRunData> {
    let observed_at = number_field(table, "observedAt")
        .or_else(|| number_field(table, "completedAt"))
        .or_else(|| number_field(table, "startDate"))?;
    let status = normalize_run_status(string_field(table, "status").as_deref(), table);
    let fingerprint = string_field(table, "fingerprint").unwrap_or_else(|| {
        [
            number_field(table, "seasonID")
                .map(format_number_key)
                .unwrap_or_default(),
            number_field(table, "mapChallengeModeID")
                .map(format_number_key)
                .unwrap_or_default(),
            number_field(table, "level")
                .map(format_number_key)
                .unwrap_or_default(),
            format_number_key(observed_at),
        ]
        .join(":")
    });
    let members = table_array_field(table, "members")
        .into_iter()
        .filter_map(normalize_member)
        .collect::<Vec<_>>();
    Some(MythicPlusRunData {
        fingerprint,
        attempt_id: string_field(table, "attemptId"),
        canonical_key: string_field(table, "canonicalKey"),
        observed_at,
        season_id: number_field(table, "seasonID"),
        map_challenge_mode_id: number_field(table, "mapChallengeModeID"),
        map_name: string_field(table, "mapName"),
        level: number_field(table, "level"),
        status,
        completed: bool_field(table, "completed"),
        completed_in_time: bool_field(table, "completedInTime"),
        duration_ms: number_field(table, "durationMs"),
        run_score: number_field(table, "runScore"),
        start_date: number_field(table, "startDate"),
        completed_at: number_field(table, "completedAt")
            .or_else(|| number_field(table, "completionDate"))
            .or_else(|| number_field(table, "completedDate")),
        ended_at: number_field(table, "endedAt").or_else(|| number_field(table, "endTime")),
        abandoned_at: number_field(table, "abandonedAt"),
        abandon_reason: normalize_abandon_reason(string_field(table, "abandonReason").as_deref()),
        this_week: bool_field(table, "thisWeek"),
        members: (!members.is_empty()).then_some(members),
    })
}

fn normalize_pending_members(
    pending_table: LuaTable,
) -> BTreeMap<String, Vec<MythicPlusRunMemberData>> {
    let mut pending = BTreeMap::new();
    for (key, value) in pending_table.fields {
        let LuaValue::Table(table) = value else {
            continue;
        };
        let members = table_array_field(&table, "members")
            .into_iter()
            .filter_map(normalize_member)
            .collect::<Vec<_>>();
        if !members.is_empty() {
            pending.insert(key, members);
        }
    }
    pending
}

fn apply_pending_members(
    characters: &mut [CharacterData],
    pending_members: &BTreeMap<String, Vec<MythicPlusRunMemberData>>,
) {
    for character in characters {
        let key = format!("{}-{}", character.name, character.realm);
        let Some(members) = pending_members.get(&key) else {
            continue;
        };
        if let Some(run) = character.mythic_plus_runs.first_mut() {
            run.members = merge_members(run.members.as_deref(), Some(members));
        }
    }
}

fn normalize_member(table: &LuaTable) -> Option<MythicPlusRunMemberData> {
    let name = string_field(table, "name")?;
    if name.trim().is_empty() {
        return None;
    }
    Some(MythicPlusRunMemberData {
        name,
        realm: string_field(table, "realm"),
        class_tag: string_field(table, "classTag").or_else(|| {
            number_field(table, "classID").map(|class_id| format!("CLASS_{}", class_id as i64))
        }),
        role: normalize_role(string_field(table, "role").as_deref()),
    })
}

fn normalize_role(value: Option<&str>) -> Option<Role> {
    match value?.to_ascii_lowercase().as_str() {
        "tank" => Some(Role::Tank),
        "healer" => Some(Role::Healer),
        "dps" | "damager" => Some(Role::Dps),
        _ => None,
    }
}

fn normalize_region(value: Option<&str>) -> Region {
    match value.unwrap_or_default().to_ascii_lowercase().as_str() {
        "eu" => Region::Eu,
        "kr" => Region::Kr,
        "tw" => Region::Tw,
        _ => Region::Us,
    }
}

fn normalize_faction(value: Option<&str>) -> Faction {
    match value.unwrap_or_default().to_ascii_lowercase().as_str() {
        "horde" => Faction::Horde,
        _ => Faction::Alliance,
    }
}

fn normalize_run_status(value: Option<&str>, table: &LuaTable) -> Option<MythicPlusRunStatus> {
    match value.unwrap_or_default().to_ascii_lowercase().as_str() {
        "active" => Some(MythicPlusRunStatus::Active),
        "completed" => Some(MythicPlusRunStatus::Completed),
        "abandoned" => Some(MythicPlusRunStatus::Abandoned),
        _ if bool_field(table, "completed") == Some(true) => Some(MythicPlusRunStatus::Completed),
        _ if number_field(table, "abandonedAt").is_some() => Some(MythicPlusRunStatus::Abandoned),
        _ => None,
    }
}

fn normalize_abandon_reason(value: Option<&str>) -> Option<MythicPlusAbandonReason> {
    match value? {
        "challenge_mode_reset" => Some(MythicPlusAbandonReason::ChallengeModeReset),
        "left_instance" => Some(MythicPlusAbandonReason::LeftInstance),
        "leaver_timer" => Some(MythicPlusAbandonReason::LeaverTimer),
        "history_incomplete" => Some(MythicPlusAbandonReason::HistoryIncomplete),
        "stale_recovery" => Some(MythicPlusAbandonReason::StaleRecovery),
        "unknown" => Some(MythicPlusAbandonReason::Unknown),
        _ => None,
    }
}

fn normalize_currencies(table: Option<&LuaTable>) -> SnapshotCurrencies {
    let Some(table) = table else {
        return SnapshotCurrencies::default();
    };
    SnapshotCurrencies {
        adventurer_dawncrest: number_field(table, "adventurerDawncrest").unwrap_or(0.0),
        veteran_dawncrest: number_field(table, "veteranDawncrest").unwrap_or(0.0),
        champion_dawncrest: number_field(table, "championDawncrest").unwrap_or(0.0),
        hero_dawncrest: number_field(table, "heroDawncrest").unwrap_or(0.0),
        myth_dawncrest: number_field(table, "mythDawncrest").unwrap_or(0.0),
        radiant_spark_dust: number_field(table, "radiantSparkDust").unwrap_or(0.0),
    }
}

fn normalize_currency_details(table: &LuaTable) -> SnapshotCurrencyDetails {
    table
        .fields
        .iter()
        .filter_map(|(key, value)| {
            let LuaValue::Table(value) = value else {
                return None;
            };
            Some((
                key.clone(),
                SnapshotCurrencyInfo {
                    currency_id: number_field(value, "currencyID").unwrap_or(0.0),
                    name: string_field(value, "name"),
                    quantity: number_field(value, "quantity").unwrap_or(0.0),
                    icon_file_id: number_field(value, "iconFileID"),
                    max_quantity: number_field(value, "maxQuantity"),
                    can_earn_per_week: bool_field(value, "canEarnPerWeek"),
                    quantity_earned_this_week: number_field(value, "quantityEarnedThisWeek"),
                    max_weekly_quantity: number_field(value, "maxWeeklyQuantity"),
                    total_earned: number_field(value, "totalEarned"),
                    discovered: bool_field(value, "discovered"),
                    quality: number_field(value, "quality"),
                    use_total_earned_for_max_qty: bool_field(value, "useTotalEarnedForMaxQty"),
                },
            ))
        })
        .collect()
}

fn normalize_stats(table: Option<&LuaTable>) -> SnapshotStats {
    let Some(table) = table else {
        return SnapshotStats::default();
    };
    SnapshotStats {
        stamina: number_field(table, "stamina").unwrap_or(0.0),
        strength: number_field(table, "strength").unwrap_or(0.0),
        agility: number_field(table, "agility").unwrap_or(0.0),
        intellect: number_field(table, "intellect").unwrap_or(0.0),
        crit_rating: number_field(table, "critRating"),
        crit_percent: number_field(table, "critPercent").unwrap_or(0.0),
        haste_rating: number_field(table, "hasteRating"),
        haste_percent: number_field(table, "hastePercent").unwrap_or(0.0),
        mastery_rating: number_field(table, "masteryRating"),
        mastery_percent: number_field(table, "masteryPercent").unwrap_or(0.0),
        versatility_rating: number_field(table, "versatilityRating"),
        versatility_percent: number_field(table, "versatilityPercent").unwrap_or(0.0),
        speed_rating: number_field(table, "speedRating"),
        speed_percent: number_field(table, "speedPercent"),
        leech_rating: number_field(table, "leechRating"),
        leech_percent: number_field(table, "leechPercent"),
        avoidance_rating: number_field(table, "avoidanceRating"),
        avoidance_percent: number_field(table, "avoidancePercent"),
    }
}

fn normalize_equipment(table: &LuaTable) -> SnapshotEquipment {
    table
        .fields
        .iter()
        .filter_map(|(key, value)| {
            let LuaValue::Table(item) = value else {
                return None;
            };
            Some((
                key.clone(),
                SnapshotEquipmentItem {
                    slot: string_field(item, "slot").unwrap_or_else(|| key.clone()),
                    slot_id: number_field(item, "slotID").unwrap_or(0.0),
                    item_id: number_field(item, "itemID"),
                    item_name: string_field(item, "itemName"),
                    item_link: string_field(item, "itemLink"),
                    item_level: number_field(item, "itemLevel"),
                    quality: number_field(item, "quality"),
                    icon_file_id: number_field(item, "iconFileID"),
                },
            ))
        })
        .collect()
}

fn normalize_weekly_rewards(table: &LuaTable) -> SnapshotWeeklyRewards {
    SnapshotWeeklyRewards {
        can_claim_rewards: bool_field(table, "canClaimRewards"),
        is_current_period: bool_field(table, "isCurrentPeriod"),
        activities: table_array_field(table, "activities")
            .into_iter()
            .map(|activity| SnapshotWeeklyRewardActivity {
                r#type: number_field(activity, "type"),
                index: number_field(activity, "index"),
                id: number_field(activity, "id"),
                level: number_field(activity, "level"),
                threshold: number_field(activity, "threshold"),
                progress: number_field(activity, "progress"),
                activity_tier_id: number_field(activity, "activityTierID"),
                item_level: number_field(activity, "itemLevel"),
                name: string_field(activity, "name"),
            })
            .collect(),
    }
}

fn normalize_major_factions(table: &LuaTable) -> SnapshotMajorFactions {
    SnapshotMajorFactions {
        factions: table_array_field(table, "factions")
            .into_iter()
            .filter_map(|faction| {
                Some(SnapshotMajorFaction {
                    faction_id: number_field(faction, "factionID")?,
                    name: string_field(faction, "name"),
                    expansion_id: number_field(faction, "expansionID"),
                    is_unlocked: bool_field(faction, "isUnlocked"),
                    renown_level: number_field(faction, "renownLevel"),
                    renown_reputation_earned: number_field(faction, "renownReputationEarned"),
                    renown_level_threshold: number_field(faction, "renownLevelThreshold"),
                    is_weekly_capped: bool_field(faction, "isWeeklyCapped"),
                })
            })
            .collect(),
    }
}

fn normalize_client_info(table: &LuaTable) -> SnapshotClientInfo {
    SnapshotClientInfo {
        addon_version: string_field(table, "addonVersion"),
        interface_version: number_field(table, "interfaceVersion"),
        game_version: string_field(table, "gameVersion"),
        build_number: string_field(table, "buildNumber"),
        build_date: string_field(table, "buildDate"),
        toc_version: number_field(table, "tocVersion"),
        expansion: string_field(table, "expansion"),
        locale: string_field(table, "locale"),
    }
}

fn table_array_field<'a>(table: &'a LuaTable, key: &str) -> Vec<&'a LuaTable> {
    table
        .get(key)
        .and_then(|value| match value {
            LuaValue::Table(table) => Some(table.array_tables().collect()),
            _ => None,
        })
        .unwrap_or_default()
}

fn table_field<'a>(table: &'a LuaTable, key: &str) -> Option<&'a LuaTable> {
    match table.get(key)? {
        LuaValue::Table(table) => Some(table),
        _ => None,
    }
}

fn string_field(table: &LuaTable, key: &str) -> Option<String> {
    match table.get(key)? {
        LuaValue::String(value) => Some(value.clone()),
        LuaValue::Number(value) => Some(format_number_key(*value)),
        _ => None,
    }
}

fn number_field(table: &LuaTable, key: &str) -> Option<f64> {
    match table.get(key)? {
        LuaValue::Number(value) if value.is_finite() => Some(*value),
        _ => None,
    }
}

fn bool_field(table: &LuaTable, key: &str) -> Option<bool> {
    match table.get(key)? {
        LuaValue::Bool(value) => Some(*value),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_lua() -> String {
        r#"
        WowDashboardDB = {
          ["characters"] = {
            ["Testy-Area 52"] = {
              ["name"] = "Testy",
              ["realm"] = "Area 52",
              ["region"] = "us",
              ["class"] = "MAGE",
              ["race"] = "Human",
              ["faction"] = "alliance",
              ["snapshots"] = {
                [1] = {
                  ["takenAt"] = 100,
                  ["level"] = 80,
                  ["spec"] = "Fire",
                  ["role"] = "dps",
                  ["itemLevel"] = 680.5,
                  ["gold"] = 10,
                  ["playtimeSeconds"] = 500,
                  ["mythicPlusScore"] = 1234,
                  ["currencies"] = { ["adventurerDawncrest"] = 1, ["veteranDawncrest"] = 2, ["championDawncrest"] = 3, ["heroDawncrest"] = 4, ["mythDawncrest"] = 5, ["radiantSparkDust"] = 6 },
                  ["stats"] = { ["stamina"] = 1, ["strength"] = 2, ["agility"] = 3, ["intellect"] = 4, ["critPercent"] = 5, ["hastePercent"] = 6, ["masteryPercent"] = 7, ["versatilityPercent"] = 8 },
                },
              },
              ["mythicPlusRuns"] = {
                [1] = { ["fingerprint"] = "run-a", ["observedAt"] = 100, ["seasonID"] = 15, ["mapChallengeModeID"] = 501, ["level"] = 10, ["status"] = "active" },
                [2] = { ["fingerprint"] = "run-a", ["observedAt"] = 110, ["seasonID"] = 15, ["mapChallengeModeID"] = 501, ["level"] = 10, ["status"] = "completed", ["completedAt"] = 110, ["members"] = { [1] = { ["name"] = "Testy", ["realm"] = "Area 52", ["role"] = "dps" } } },
              },
            },
          },
        }
        "#
        .to_string()
    }

    #[test]
    fn parses_saved_variables_subset() {
        let characters = parse_saved_variables(&sample_lua()).unwrap();
        assert_eq!(characters.len(), 1);
        assert_eq!(characters[0].name, "Testy");
        assert_eq!(characters[0].snapshots.len(), 1);
        assert_eq!(characters[0].snapshots[0].spec, "Fire");
    }

    #[test]
    fn dedupes_and_merges_mythic_plus_runs() {
        let characters = parse_saved_variables(&sample_lua()).unwrap();
        assert_eq!(characters[0].mythic_plus_runs.len(), 1);
        let run = &characters[0].mythic_plus_runs[0];
        assert_eq!(run.status, Some(MythicPlusRunStatus::Completed));
        assert_eq!(run.members.as_ref().map(Vec::len), Some(1));
    }

    #[test]
    fn dedupes_snapshots_by_taken_at_with_more_complete_record() {
        let mut all = HashMap::new();
        let mut first = parse_saved_variables(&sample_lua()).unwrap().remove(0);
        let mut second = first.clone();
        first.snapshots[0].equipment = None;
        second.snapshots[0].equipment = Some(BTreeMap::from([(
            "head".to_string(),
            SnapshotEquipmentItem {
                slot: "head".to_string(),
                slot_id: 1.0,
                ..SnapshotEquipmentItem::default()
            },
        )]));
        merge_character(&mut all, first);
        merge_character(&mut all, second);
        let character = all.values().next().unwrap();
        assert!(character.snapshots[0].equipment.is_some());
        assert_eq!(character.snapshots.len(), 1);
    }
}
