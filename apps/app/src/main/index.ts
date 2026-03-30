import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  safeStorage,
  session,
  shell,
  Tray,
  Menu,
  nativeImage,
} from "electron";
import { autoUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { join, resolve, sep } from "path";
import * as crypto from "crypto";
import * as os from "os";
import * as unzipper from "unzipper";
import { promisify } from "node:util";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let mainWindowReady = false;
let pendingWindowReveal = false;
// Cache close behavior so the window close handler can be synchronous (event.preventDefault
// must be called synchronously – awaiting inside the handler is too late on Windows).
let closeBehaviorCache: "tray" | "exit" = "tray";
let launchMinimizedCache = true;
let addonWatcher: ReturnType<typeof fs.watch> | null = null;
let addonWatchDebounce: ReturnType<typeof setTimeout> | null = null;
let cachedElectronToken: string | null = null;
let storedSessionToken: string | null = null;
let pendingLoginResolve: ((token: string) => void) | null = null;
let pendingLoginReject: ((err: Error) => void) | null = null;
let ignoreAddonWatchEventsUntil = 0;

const execFileAsync = promisify(execFile);

// ─── Token persistence via OS keychain (safeStorage) ──────────────────────────

function getTokenPath(): string {
  return join(app.getPath("userData"), "auth-token.bin");
}

function loadStoredAuth(): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const buf = fs.readFileSync(getTokenPath());
    const raw = safeStorage.decryptString(buf);
    try {
      const parsed = JSON.parse(raw) as { sessionToken?: string };
      if (typeof parsed.sessionToken === "string") {
        storedSessionToken = parsed.sessionToken;
        return;
      }
    } catch {
      cachedElectronToken = raw;
    }
  } catch {
    return;
  }
}

function saveSessionToken(token: string | null): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  storedSessionToken = token;
  const tokenPath = getTokenPath();
  if (!token) {
    try {
      fs.unlinkSync(tokenPath);
    } catch {
      // file may not exist
    }
    return;
  }
  try {
    fs.writeFileSync(tokenPath, safeStorage.encryptString(JSON.stringify({ sessionToken: token })));
  } catch (err) {
    console.warn("[wow-dashboard] Failed to persist token:", err);
  }
}

function getJwtExpirationMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payloadPart = parts[1];
  if (!payloadPart) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isJwtExpired(token: string, nowMs = Date.now(), skewMs = 60_000): boolean {
  const exp = getJwtExpirationMs(token);
  if (!exp) return true;
  return nowMs >= exp - skewMs;
}

async function fetchFreshConvexToken(): Promise<string | null> {
  if (!storedSessionToken) return null;
  try {
    const resp = await net.fetch(`${SITE_URL}/api/auth/convex/token`, {
      headers: {
        Origin: SITE_URL,
        Authorization: `Bearer ${storedSessionToken}`,
      },
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        storedSessionToken = null;
        saveSessionToken(null);
      }
      return null;
    }
    const data = (await resp.json()) as { token?: string };
    cachedElectronToken = data?.token ?? null;
    return cachedElectronToken;
  } catch {
    return null;
  }
}

async function loadTrayIcon(): Promise<Electron.NativeImage> {
  try {
    if (process.platform === "win32") {
      const icon = await app.getFileIcon(process.execPath, { size: "small" });
      if (!icon.isEmpty()) return icon;
    }
  } catch (error) {
    console.warn("[wow-dashboard] Failed to load tray icon from executable:", error);
  }

  return nativeImage.createEmpty();
}

async function createTray(): Promise<void> {
  if (tray) return;

  const icon = await loadTrayIcon();
  tray = new Tray(icon);

  const buildMenu = () =>
    Menu.buildFromTemplate([
      {
        label: "Show WoW Dashboard",
        click: () => {
          showWindow();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

  tray.setToolTip("WoW Dashboard");
  tray.setContextMenu(buildMenu());

  const revealWindow = () => {
    pendingWindowReveal = false;
    mainWindow?.setSkipTaskbar(false);
    mainWindow?.show();
    mainWindow?.focus();
  };

  const showWindow = () => {
    if (!mainWindow) {
      pendingWindowReveal = true;
      createWindow();
      return;
    }

    if (!mainWindowReady) {
      pendingWindowReveal = true;
      return;
    }

    revealWindow();
  };

  tray.on("click", showWindow);
  // Windows fires "double-click" on the tray icon; handle both.
  tray.on("double-click", showWindow);
}

// ─── Settings persistence ─────────────────────────────────────────────────────

function settingsPath(): string {
  return join(app.getPath("userData"), "wow-dashboard-settings.json");
}

async function getSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.promises.readFile(settingsPath(), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function saveSettings(data: Record<string, unknown>): Promise<void> {
  await fs.promises.writeFile(settingsPath(), JSON.stringify(data, null, 2), "utf-8");
}

// ─── Lua parser ───────────────────────────────────────────────────────────────
// Parses the WoW SavedVariables file format (a Lua table literal assignment).

class LuaParser {
  private src: string;
  private pos: number;

  constructor(src: string) {
    this.src = src;
    this.pos = 0;
  }

  parseFile(): Record<string, unknown> | null {
    const m = this.src.match(/WowDashboardDB\s*=\s*/);
    if (!m || m.index === undefined) return null;
    this.pos = m.index + m[0].length;
    const val = this.parseValue();
    return val as Record<string, unknown>;
  }

  private skip(): void {
    while (this.pos < this.src.length) {
      const current = this.src[this.pos] ?? "";
      if (/\s/.test(current)) {
        this.pos++;
      } else if (current === "-" && this.src[this.pos + 1] === "-") {
        while (this.pos < this.src.length && this.src[this.pos] !== "\n") this.pos++;
      } else {
        break;
      }
    }
  }

  private parseValue(): unknown {
    this.skip();
    const ch = this.src[this.pos] ?? "";
    if (ch === "{") return this.parseTable();
    if (ch === '"') return this.parseString();
    if (ch === "-" || /\d/.test(ch)) return this.parseNumber();
    if (this.src.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.src.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    if (this.src.startsWith("nil", this.pos)) {
      this.pos += 3;
      return null;
    }
    throw new Error(
      `Unexpected token at ${this.pos}: "${this.src.slice(this.pos, this.pos + 30)}"`,
    );
  }

  private parseTable(): unknown[] | Record<string, unknown> {
    this.pos++; // skip '{'
    const dict: Record<string, unknown> = {};
    const arr: unknown[] = [];
    let isDict = false;

    while (true) {
      this.skip();
      if (this.src[this.pos] === "}") {
        this.pos++;
        break;
      }
      if (this.src[this.pos] === ",") {
        this.pos++;
        continue;
      }

      if (this.src[this.pos] === "[" && this.src[this.pos + 1] === '"') {
        // ["string key"] = value
        isDict = true;
        this.pos += 2; // skip ["
        const end = this.src.indexOf('"', this.pos);
        const key = this.src.slice(this.pos, end);
        this.pos = end + 1; // skip closing "
        this.skip();
        this.pos++; // skip ]
        this.skip();
        this.pos++; // skip =
        dict[key] = this.parseValue();
      } else {
        // Positional (array) value
        arr.push(this.parseValue());
      }
    }

    return isDict ? dict : arr;
  }

  private parseString(): string {
    this.pos++; // skip opening "
    let result = "";
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '"') {
        this.pos++;
        break;
      }
      if (ch === "\\") {
        this.pos++;
        const esc = this.src[this.pos++];
        if (esc === "n") result += "\n";
        else if (esc === "t") result += "\t";
        else result += esc;
      } else {
        result += ch;
        this.pos++;
      }
    }
    return result;
  }

  private parseNumber(): number {
    const m = this.src.slice(this.pos).match(/^-?\d+\.?\d*/);
    if (!m) throw new Error(`Expected number at ${this.pos}`);
    this.pos += m[0].length;
    return parseFloat(m[0]);
  }
}

// ─── Addon data extraction ────────────────────────────────────────────────────

type Role = "tank" | "healer" | "dps";
type Region = "us" | "eu" | "kr" | "tw";
type Faction = "alliance" | "horde";
type LuaTable = Record<string, unknown>;

interface MythicPlusRunData {
  fingerprint: string;
  observedAt: number;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  completed?: boolean;
  completedInTime?: boolean;
  durationMs?: number;
  runScore?: number;
  startDate?: number;
  completedAt?: number;
  thisWeek?: boolean;
}

interface SnapshotData {
  takenAt: number;
  level: number;
  spec: string;
  role: Role;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  mythicPlusScore: number;
  currencies: {
    adventurerDawncrest: number;
    veteranDawncrest: number;
    championDawncrest: number;
    heroDawncrest: number;
    mythDawncrest: number;
    radiantSparkDust: number;
  };
  stats: {
    stamina: number;
    strength: number;
    agility: number;
    intellect: number;
    critPercent: number;
    hastePercent: number;
    masteryPercent: number;
    versatilityPercent: number;
    speedPercent?: number;
    leechPercent?: number;
    avoidancePercent?: number;
  };
}

interface CharacterData {
  name: string;
  realm: string;
  region: Region;
  class: string;
  race: string;
  faction: Faction;
  snapshots: SnapshotData[];
  mythicPlusRuns: MythicPlusRunData[];
}

interface AddonFileStats {
  totalBytes: number;
  createdAt: number;
  modifiedAt: number;
  totalSnapshots: number;
  totalMythicPlusRuns: number;
}

interface CompactAddonResult {
  status: "completed" | "blocked";
  wowProcesses: string[];
  filesProcessed: number;
  filesChanged: number;
  backupsWritten: number;
  bytesBefore: number;
  bytesAfter: number;
  snapshotsBefore: number;
  snapshotsAfter: number;
  mythicPlusRunsBefore: number;
  mythicPlusRunsAfter: number;
  rawRunsTrimmed: number;
  membersTrimmed: number;
}

function getSnapshotCompletenessScore(snapshot: SnapshotData): number {
  let score = 0;

  if (snapshot.playtimeSeconds > 0) score += 1;
  if (snapshot.stats.speedPercent !== undefined) score += 2;
  if (snapshot.stats.leechPercent !== undefined) score += 2;
  if (snapshot.stats.avoidancePercent !== undefined) score += 2;

  return score;
}

function mergeSnapshotData(current: SnapshotData, candidate: SnapshotData): SnapshotData {
  const currentScore = getSnapshotCompletenessScore(current);
  const candidateScore = getSnapshotCompletenessScore(candidate);
  const preferred = candidateScore >= currentScore ? candidate : current;
  const fallback = preferred === candidate ? current : candidate;

  return {
    ...preferred,
    playtimeSeconds: preferred.playtimeSeconds > 0 ? preferred.playtimeSeconds : fallback.playtimeSeconds,
    stats: {
      ...preferred.stats,
      speedPercent: preferred.stats.speedPercent ?? fallback.stats.speedPercent,
      leechPercent: preferred.stats.leechPercent ?? fallback.stats.leechPercent,
      avoidancePercent: preferred.stats.avoidancePercent ?? fallback.stats.avoidancePercent,
    },
  };
}

function isRecord(value: unknown): value is LuaTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toOptionalMythicPlusTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const year = toOptionalNumber(value.year);
  const month = toOptionalNumber(value.month);
  const day = toOptionalNumber(value.day);
  if (year === undefined || month === undefined || day === undefined) {
    return undefined;
  }

  const fullYear = year < 100 ? 2000 + year : year;
  const hour = toOptionalNumber(value.hour) ?? 0;
  const minute = toOptionalNumber(value.minute) ?? toOptionalNumber(value.min) ?? 0;
  const second = toOptionalNumber(value.second) ?? toOptionalNumber(value.sec) ?? 0;
  const timestampMs = new Date(fullYear, month, day + 1, hour, minute, second).getTime();

  return Number.isFinite(timestampMs) ? Math.floor(timestampMs / 1000) : undefined;
}

function toFingerprintToken(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

function buildRunFingerprint(run: Partial<MythicPlusRunData>): string {
  return [
    toFingerprintToken(run.seasonID),
    toFingerprintToken(run.mapChallengeModeID),
    toFingerprintToken(run.level),
    toFingerprintToken(run.completed),
    toFingerprintToken(run.completedInTime),
    toFingerprintToken(run.durationMs),
    toFingerprintToken(run.runScore),
    toFingerprintToken(run.completedAt),
    toFingerprintToken(run.startDate),
  ].join("|");
}

function normalizeStoredMythicPlusRun(runRaw: LuaTable): MythicPlusRunData {
  const legacyRaw = isRecord(runRaw.raw) ? runRaw.raw : null;
  const durationMs =
    toOptionalNumber(runRaw.durationMs) ??
    (toOptionalNumber(runRaw.durationSec) !== undefined
      ? Math.round((runRaw.durationSec as number) * 1000)
      : undefined) ??
    (toOptionalNumber(runRaw.durationSeconds) !== undefined
      ? Math.round((runRaw.durationSeconds as number) * 1000)
      : undefined) ??
    toOptionalNumber(runRaw.time) ??
    toOptionalNumber(runRaw.runDuration);

  const run: MythicPlusRunData = {
    fingerprint: "",
    observedAt:
      toOptionalNumber(runRaw.observedAt) ??
      toOptionalMythicPlusTimestamp(runRaw.completedAt) ??
      toOptionalMythicPlusTimestamp(runRaw.startDate) ??
      0,
    seasonID: toOptionalNumber(runRaw.seasonID),
    mapChallengeModeID:
      toOptionalNumber(runRaw.mapChallengeModeID) ??
      toOptionalNumber(runRaw.challengeModeID) ??
      toOptionalNumber(runRaw.mapID) ??
      (legacyRaw ? toOptionalNumber(legacyRaw.mapChallengeModeID ?? legacyRaw.challengeModeID ?? legacyRaw.mapID) : undefined),
    mapName:
      toOptionalString(runRaw.mapName) ??
      toOptionalString(runRaw.name) ??
      toOptionalString(runRaw.zoneName) ??
      toOptionalString(runRaw.shortName) ??
      (legacyRaw
        ? toOptionalString(
            legacyRaw.mapName ?? legacyRaw.name ?? legacyRaw.zoneName ?? legacyRaw.shortName,
          )
        : undefined),
    level: toOptionalNumber(runRaw.level) ?? toOptionalNumber(runRaw.keystoneLevel),
    completed:
      toOptionalBoolean(runRaw.completed) ??
      toOptionalBoolean(runRaw.finishedSuccess) ??
      toOptionalBoolean(runRaw.isCompleted),
    completedInTime:
      toOptionalBoolean(runRaw.completedInTime) ??
      toOptionalBoolean(runRaw.intime) ??
      toOptionalBoolean(runRaw.onTime),
    durationMs,
    runScore:
      toOptionalNumber(runRaw.runScore) ??
      toOptionalNumber(runRaw.score) ??
      toOptionalNumber(runRaw.mythicRating),
    startDate:
      toOptionalMythicPlusTimestamp(runRaw.startDate) ??
      toOptionalMythicPlusTimestamp(runRaw.startedAt),
    completedAt:
      toOptionalMythicPlusTimestamp(runRaw.completedAt) ??
      toOptionalMythicPlusTimestamp(runRaw.completionDate) ??
      toOptionalMythicPlusTimestamp(runRaw.completedDate) ??
      toOptionalMythicPlusTimestamp(runRaw.endTime) ??
      toOptionalMythicPlusTimestamp(runRaw.startDate),
    thisWeek: toOptionalBoolean(runRaw.thisWeek) ?? toOptionalBoolean(runRaw.isThisWeek),
  };

  if (run.completedInTime === undefined && typeof run.completed === "boolean") {
    run.completedInTime = run.completed;
  }
  if (
    run.completed !== true &&
    (run.durationMs !== undefined || run.runScore !== undefined || run.completedAt !== undefined)
  ) {
    run.completed = true;
  }

  run.fingerprint = toOptionalString(runRaw.fingerprint) ?? buildRunFingerprint(run);
  return run;
}

function extractCharacters(db: Record<string, unknown>): CharacterData[] {
  const characters = (db.characters ?? {}) as Record<string, unknown>;
  const result: CharacterData[] = [];
  const validRegions: Region[] = ["us", "eu", "kr", "tw"];

  for (const charRaw of Object.values(characters)) {
    const char = charRaw as Record<string, unknown>;
    const region = String(char.region ?? "us") as Region;
    if (!validRegions.includes(region)) continue;

    const faction = String(char.faction ?? "alliance").toLowerCase() as Faction;
    if (faction !== "alliance" && faction !== "horde") continue;

    const snapshots: SnapshotData[] = [];
    for (const snapRaw of (char.snapshots as unknown[]) ?? []) {
      const snap = snapRaw as Record<string, unknown>;
      const role = String(snap.role ?? "dps") as Role;
      if (role !== "tank" && role !== "healer" && role !== "dps") continue;

      const currencies = (snap.currencies ?? {}) as Record<string, unknown>;
      const stats = (snap.stats ?? {}) as Record<string, unknown>;

      snapshots.push({
        takenAt: Number(snap.takenAt),
        level: Number(snap.level),
        spec: String(snap.spec ?? "Unknown"),
        role,
        itemLevel: Number(snap.itemLevel),
        gold: Number(snap.gold),
        playtimeSeconds: Number(snap.playtimeSeconds),
        mythicPlusScore: Number(snap.mythicPlusScore),
        currencies: {
          adventurerDawncrest: Number(currencies.adventurerDawncrest ?? 0),
          veteranDawncrest: Number(currencies.veteranDawncrest ?? 0),
          championDawncrest: Number(currencies.championDawncrest ?? 0),
          heroDawncrest: Number(currencies.heroDawncrest ?? 0),
          mythDawncrest: Number(currencies.mythDawncrest ?? 0),
          radiantSparkDust: Number(currencies.radiantSparkDust ?? 0),
        },
        stats: {
          stamina: Number(stats.stamina ?? 0),
          strength: Number(stats.strength ?? 0),
          agility: Number(stats.agility ?? 0),
          intellect: Number(stats.intellect ?? 0),
          critPercent: Number(stats.critPercent ?? 0),
          hastePercent: Number(stats.hastePercent ?? 0),
          masteryPercent: Number(stats.masteryPercent ?? 0),
          versatilityPercent: Number(stats.versatilityPercent ?? 0),
          speedPercent: toOptionalNumber(stats.speedPercent),
          leechPercent: toOptionalNumber(stats.leechPercent),
          avoidancePercent: toOptionalNumber(stats.avoidancePercent),
        },
      });
    }

    const mythicPlusRuns: MythicPlusRunData[] = [];
    const knownFingerprints = new Set<string>();
    for (const runRaw of (char.mythicPlusRuns as unknown[]) ?? []) {
      if (!isRecord(runRaw)) continue;
      const run = normalizeStoredMythicPlusRun(runRaw);
      if (!run.fingerprint || knownFingerprints.has(run.fingerprint)) continue;
      knownFingerprints.add(run.fingerprint);
      mythicPlusRuns.push(run);
    }
    mythicPlusRuns.sort(
      (a, b) => (b.completedAt ?? b.startDate ?? b.observedAt ?? 0) - (a.completedAt ?? a.startDate ?? a.observedAt ?? 0),
    );

    result.push({
      name: String(char.name),
      realm: String(char.realm),
      region,
      class: String(char.class),
      race: String(char.race),
      faction,
      snapshots,
      mythicPlusRuns,
    });
  }

  return result;
}

async function findAndParseAddonData(
  retailPath: string,
): Promise<{
  characters: CharacterData[];
  accountsFound: string[];
  fileStats: AddonFileStats | null;
}> {
  const wtfAccountPath = join(retailPath, "WTF", "Account");
  let accounts: string[];
  try {
    accounts = await fs.promises.readdir(wtfAccountPath);
  } catch {
    return { characters: [], accountsFound: [], fileStats: null };
  }

  const accountsFound: string[] = [];
  const allChars = new Map<string, CharacterData>();
  let totalBytes = 0;
  let createdAt = Infinity;
  let modifiedAt = 0;

  for (const account of accounts) {
    const luaPath = join(wtfAccountPath, account, "SavedVariables", "wow-dashboard.lua");
    let content: string;
    try {
      content = await fs.promises.readFile(luaPath, "utf-8");
    } catch {
      continue;
    }

    accountsFound.push(account);

    try {
      const stat = await fs.promises.stat(luaPath);
      totalBytes += stat.size;
      createdAt = Math.min(createdAt, stat.birthtimeMs);
      modifiedAt = Math.max(modifiedAt, stat.mtimeMs);
    } catch {
      // ignore stat errors
    }

    let db: Record<string, unknown> | null = null;
    try {
      db = new LuaParser(content).parseFile();
    } catch (e) {
      console.error(`[wow-dashboard] Lua parse error for ${luaPath}:`, e);
    }
    if (!db) continue;

    const chars = extractCharacters(db);
    for (const char of chars) {
      const key = `${char.name}-${char.realm}`;
      const existing = allChars.get(key);
      if (!existing) {
        allChars.set(key, char);
      } else {
        const snapshotsByTime = new Map(existing.snapshots.map((snapshot) => [snapshot.takenAt, snapshot]));
        for (const snap of char.snapshots) {
          const current = snapshotsByTime.get(snap.takenAt);
          if (!current) {
            existing.snapshots.push(snap);
            snapshotsByTime.set(snap.takenAt, snap);
            continue;
          }

          const mergedSnapshot = mergeSnapshotData(current, snap);
          Object.assign(current, mergedSnapshot);
        }

        const knownFingerprints = new Set(existing.mythicPlusRuns.map((run) => run.fingerprint));
        for (const run of char.mythicPlusRuns) {
          if (!knownFingerprints.has(run.fingerprint)) {
            existing.mythicPlusRuns.push(run);
            knownFingerprints.add(run.fingerprint);
          }
        }
        existing.mythicPlusRuns.sort(
          (a, b) =>
            (b.completedAt ?? b.startDate ?? b.observedAt ?? 0) -
            (a.completedAt ?? a.startDate ?? a.observedAt ?? 0),
        );
      }
    }
  }

  const characters = Array.from(allChars.values());
  const totalSnapshots = characters.reduce((sum, c) => sum + c.snapshots.length, 0);
  const totalMythicPlusRuns = characters.reduce((sum, c) => sum + c.mythicPlusRuns.length, 0);
  const fileStats =
    accountsFound.length > 0
      ? { totalBytes, createdAt, modifiedAt, totalSnapshots, totalMythicPlusRuns }
      : null;

  return { characters, accountsFound, fileStats };
}

const SYNC_BUFFER_SECONDS = 60;
const SNAPSHOT_FULL_RETENTION_DAYS = 7;

function getDayBucket(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

function sortByTimestampAsc(records: unknown[], field: string): unknown[] {
  return records.sort((a, b) => {
    const left = isRecord(a) ? toOptionalNumber(a[field]) ?? 0 : 0;
    const right = isRecord(b) ? toOptionalNumber(b[field]) ?? 0 : 0;
    return left - right;
  });
}

function sortRunsDesc(records: unknown[]): unknown[] {
  return records.sort((a, b) => {
    const left = isRecord(a)
      ? toOptionalMythicPlusTimestamp(a.completedAt) ??
        toOptionalMythicPlusTimestamp(a.startDate) ??
        toOptionalNumber(a.observedAt) ??
        0
      : 0;
    const right = isRecord(b)
      ? toOptionalMythicPlusTimestamp(b.completedAt) ??
        toOptionalMythicPlusTimestamp(b.startDate) ??
        toOptionalNumber(b.observedAt) ??
        0
      : 0;
    return right - left;
  });
}

function compactSnapshotsInPlace(
  entry: LuaTable,
  lastSyncedAt: number,
  nowSeconds: number,
): { before: number; after: number; changed: boolean } {
  const hadSnapshotsArray = Array.isArray(entry.snapshots);
  const snapshots = hadSnapshotsArray ? (entry.snapshots as unknown[]).slice() : [];
  if (!hadSnapshotsArray) {
    entry.snapshots = snapshots;
  }

  const before = snapshots.length;
  if (before === 0 || lastSyncedAt <= 0) {
    return { before, after: before, changed: !hadSnapshotsArray };
  }

  const uploadedCutoff = Math.max(0, lastSyncedAt - SYNC_BUFFER_SECONDS);
  const keepFullSince = nowSeconds - SNAPSHOT_FULL_RETENTION_DAYS * 86_400;
  const keep = snapshots.filter((snapshot) => {
    if (!isRecord(snapshot)) return true;
    const takenAt = toOptionalNumber(snapshot.takenAt);
    return takenAt === undefined || takenAt > uploadedCutoff || takenAt >= keepFullSince;
  });

  const buckets = new Map<string, { takenAt: number; snapshot: unknown }>();
  for (const snapshot of snapshots) {
    if (!isRecord(snapshot)) continue;
    const takenAt = toOptionalNumber(snapshot.takenAt);
    if (takenAt === undefined || takenAt > uploadedCutoff || takenAt >= keepFullSince) {
      continue;
    }

    const bucketKey = getDayBucket(takenAt);
    const existing = buckets.get(bucketKey);
    if (!existing || takenAt > existing.takenAt) {
      buckets.set(bucketKey, { takenAt, snapshot });
    }
  }

  for (const { snapshot } of buckets.values()) {
    keep.push(snapshot);
  }

  entry.snapshots = sortByTimestampAsc(keep, "takenAt");
  return {
    before,
    after: Array.isArray(entry.snapshots) ? entry.snapshots.length : before,
    changed: !hadSnapshotsArray || keep.length !== before,
  };
}

function compactMythicPlusDebugInPlace(entry: LuaTable): boolean {
  if (!("mythicPlusDebug" in entry)) return false;
  delete entry.mythicPlusDebug;
  return true;
}

function compactMythicPlusRunsInPlace(
  entry: LuaTable,
  _lastSyncedAt: number,
  _nowSeconds: number,
): {
  before: number;
  after: number;
  changed: boolean;
  rawRunsTrimmed: number;
  membersTrimmed: number;
} {
  const hadRunsArray = Array.isArray(entry.mythicPlusRuns);
  const runs = hadRunsArray ? (entry.mythicPlusRuns as unknown[]).slice() : [];
  if (!hadRunsArray) {
    entry.mythicPlusRuns = runs;
  }

  const before = runs.length;
  let changed = !hadRunsArray;
  let rawRunsTrimmed = 0;
  let membersTrimmed = 0;

  const dedupedRuns: unknown[] = [];
  const dedupeKeys: Record<string, boolean> = {};

  for (const runValue of runs) {
    if (!isRecord(runValue)) {
      changed = true;
      continue;
    }

    const normalized = normalizeStoredMythicPlusRun(runValue);

    if (runValue.fingerprint !== normalized.fingerprint) {
      runValue.fingerprint = normalized.fingerprint;
      changed = true;
    }
    if (normalized.observedAt > 0 && runValue.observedAt !== normalized.observedAt) {
      runValue.observedAt = normalized.observedAt;
      changed = true;
    }
    if (normalized.seasonID !== undefined && runValue.seasonID !== normalized.seasonID) {
      runValue.seasonID = normalized.seasonID;
      changed = true;
    }
    if (
      normalized.mapChallengeModeID !== undefined &&
      runValue.mapChallengeModeID !== normalized.mapChallengeModeID
    ) {
      runValue.mapChallengeModeID = normalized.mapChallengeModeID;
      changed = true;
    }
    if (normalized.mapName && runValue.mapName !== normalized.mapName) {
      runValue.mapName = normalized.mapName;
      changed = true;
    }
    if (normalized.level !== undefined && runValue.level !== normalized.level) {
      runValue.level = normalized.level;
      changed = true;
    }
    if (normalized.durationMs !== undefined && runValue.durationMs !== normalized.durationMs) {
      runValue.durationMs = normalized.durationMs;
      changed = true;
    }
    if (normalized.runScore !== undefined && runValue.runScore !== normalized.runScore) {
      runValue.runScore = normalized.runScore;
      changed = true;
    }
    if (normalized.completedAt !== undefined && runValue.completedAt !== normalized.completedAt) {
      runValue.completedAt = normalized.completedAt;
      changed = true;
    }
    if (normalized.startDate !== undefined && runValue.startDate !== normalized.startDate) {
      runValue.startDate = normalized.startDate;
      changed = true;
    }
    if (normalized.completed !== undefined && runValue.completed !== normalized.completed) {
      runValue.completed = normalized.completed;
      changed = true;
    }
    if (
      normalized.completedInTime !== undefined &&
      runValue.completedInTime !== normalized.completedInTime
    ) {
      runValue.completedInTime = normalized.completedInTime;
      changed = true;
    }

    if (!runValue.fingerprint || dedupeKeys[String(runValue.fingerprint)]) {
      changed = true;
      continue;
    }
    dedupeKeys[String(runValue.fingerprint)] = true;

    if ("source" in runValue) {
      delete runValue.source;
      changed = true;
    }
    if ("raw" in runValue) {
      delete runValue.raw;
      rawRunsTrimmed++;
      changed = true;
    }
    if ("members" in runValue) {
      delete runValue.members;
      membersTrimmed++;
      changed = true;
    }

    dedupedRuns.push(runValue);
  }

  entry.mythicPlusRuns = sortRunsDesc(dedupedRuns);
  entry.mythicPlusRunKeys = dedupeKeys;

  if (compactMythicPlusDebugInPlace(entry)) {
    changed = true;
  }

  return {
    before,
    after: Array.isArray(entry.mythicPlusRuns) ? entry.mythicPlusRuns.length : before,
    changed: changed || before !== dedupedRuns.length,
    rawRunsTrimmed,
    membersTrimmed,
  };
}

function compactAddonDb(
  db: LuaTable,
  lastSyncedAt: number,
  nowSeconds: number,
): Omit<
  CompactAddonResult,
  | "status"
  | "wowProcesses"
  | "filesProcessed"
  | "filesChanged"
  | "backupsWritten"
  | "bytesBefore"
  | "bytesAfter"
> & { changed: boolean } {
  const characters = isRecord(db.characters) ? db.characters : {};
  if (!isRecord(db.characters)) {
    db.characters = characters;
  }

  let snapshotsBefore = 0;
  let snapshotsAfter = 0;
  let mythicPlusRunsBefore = 0;
  let mythicPlusRunsAfter = 0;
  let rawRunsTrimmed = 0;
  let membersTrimmed = 0;
  let changed = false;

  for (const value of Object.values(characters)) {
    if (!isRecord(value)) continue;

    const snapshotStats = compactSnapshotsInPlace(value, lastSyncedAt, nowSeconds);
    const mythicPlusStats = compactMythicPlusRunsInPlace(value, lastSyncedAt, nowSeconds);

    snapshotsBefore += snapshotStats.before;
    snapshotsAfter += snapshotStats.after;
    mythicPlusRunsBefore += mythicPlusStats.before;
    mythicPlusRunsAfter += mythicPlusStats.after;
    rawRunsTrimmed += mythicPlusStats.rawRunsTrimmed;
    membersTrimmed += mythicPlusStats.membersTrimmed;
    changed = changed || snapshotStats.changed || mythicPlusStats.changed;
  }

  return {
    changed,
    snapshotsBefore,
    snapshotsAfter,
    mythicPlusRunsBefore,
    mythicPlusRunsAfter,
    rawRunsTrimmed,
    membersTrimmed,
  };
}

function serializeLuaValue(value: unknown, indent = 0): string {
  const spacing = "  ".repeat(indent);
  const innerSpacing = "  ".repeat(indent + 1);

  if (value === null || value === undefined) return "nil";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "{}";
    return `{\n${value
      .map((entry) => `${innerSpacing}${serializeLuaValue(entry, indent + 1)}`)
      .join(",\n")}\n${spacing}}`;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    if (entries.length === 0) return "{}";

    return `{\n${entries
      .map(
        ([key, entryValue]) =>
          `${innerSpacing}[${JSON.stringify(key)}] = ${serializeLuaValue(entryValue, indent + 1)}`,
      )
      .join(",\n")}\n${spacing}}`;
  }

  return "nil";
}

function serializeAddonDb(db: LuaTable): string {
  return `WowDashboardDB = ${serializeLuaValue(db)}\n`;
}

async function findAddonDataFiles(retailPath: string): Promise<string[]> {
  const wtfAccountPath = join(retailPath, "WTF", "Account");
  let accounts: string[];
  try {
    accounts = await fs.promises.readdir(wtfAccountPath);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const account of accounts) {
    const luaPath = join(wtfAccountPath, account, "SavedVariables", "wow-dashboard.lua");
    try {
      await fs.promises.access(luaPath, fs.constants.F_OK);
      files.push(luaPath);
    } catch {
      // ignore missing files
    }
  }

  return files;
}

async function parseAddonDbFile(luaPath: string): Promise<{ content: string; db: LuaTable | null }> {
  const content = await fs.promises.readFile(luaPath, "utf-8");
  let db: LuaTable | null = null;
  try {
    db = new LuaParser(content).parseFile();
  } catch (error) {
    console.error(`[wow-dashboard] Lua parse error for ${luaPath}:`, error);
  }
  return { content, db };
}

async function listRunningProcesses(): Promise<string[]> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/fo", "csv", "/nh"]);
      return stdout
        .split(/\r?\n/)
        .map((line) => {
          const match = line.match(/^"([^"]+)"/);
          return match?.[1] ?? "";
        })
        .filter(Boolean);
    }

    const { stdout } = await execFileAsync("ps", ["-A", "-o", "comm="]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getWowProcesses(processNames: string[]): string[] {
  const wowProcessPattern =
    /^(wow(?:classic(?:era)?|b|t|ptr)?(?:-64)?\.exe|world of warcraft.*)$/i;
  return processNames.filter((processName) => wowProcessPattern.test(processName));
}

async function compactAddonData(
  retailPath: string,
  lastSyncedAt: number,
  forceIfRunning: boolean,
): Promise<CompactAddonResult> {
  const wowProcesses = getWowProcesses(await listRunningProcesses());
  if (wowProcesses.length > 0 && !forceIfRunning) {
    return {
      status: "blocked",
      wowProcesses,
      filesProcessed: 0,
      filesChanged: 0,
      backupsWritten: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      snapshotsBefore: 0,
      snapshotsAfter: 0,
      mythicPlusRunsBefore: 0,
      mythicPlusRunsAfter: 0,
      rawRunsTrimmed: 0,
      membersTrimmed: 0,
    };
  }

  const files = await findAddonDataFiles(retailPath);
  const result: CompactAddonResult = {
    status: "completed",
    wowProcesses,
    filesProcessed: files.length,
    filesChanged: 0,
    backupsWritten: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    snapshotsBefore: 0,
    snapshotsAfter: 0,
    mythicPlusRunsBefore: 0,
    mythicPlusRunsAfter: 0,
    rawRunsTrimmed: 0,
    membersTrimmed: 0,
  };

  if (files.length === 0) return result;

  const nowSeconds = Math.floor(Date.now() / 1000);
  ignoreAddonWatchEventsUntil = Date.now() + 10_000;

  for (const luaPath of files) {
    const { content, db } = await parseAddonDbFile(luaPath);
    if (!db) continue;

    const beforeBytes = Buffer.byteLength(content, "utf-8");
    const compacted = compactAddonDb(db, lastSyncedAt, nowSeconds);

    result.bytesBefore += beforeBytes;
    result.snapshotsBefore += compacted.snapshotsBefore;
    result.snapshotsAfter += compacted.snapshotsAfter;
    result.mythicPlusRunsBefore += compacted.mythicPlusRunsBefore;
    result.mythicPlusRunsAfter += compacted.mythicPlusRunsAfter;
    result.rawRunsTrimmed += compacted.rawRunsTrimmed;
    result.membersTrimmed += compacted.membersTrimmed;

    if (!compacted.changed) {
      result.bytesAfter += beforeBytes;
      continue;
    }

    const serialized = serializeAddonDb(db);
    const backupPath = `${luaPath}.bak`;
    await fs.promises.copyFile(luaPath, backupPath);
    result.backupsWritten += 1;
    await fs.promises.writeFile(luaPath, serialized, "utf-8");

    result.filesChanged += 1;
    result.bytesAfter += Buffer.byteLength(serialized, "utf-8");
  }

  return result;
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindowReady = false;
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    backgroundColor: "#030712",
    paintWhenInitiallyHidden: true,
    show: process.platform !== "win32", // on Windows start hidden in tray; show immediately on other platforms
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindowReady = true;

    if (process.platform !== "win32" || pendingWindowReveal) {
      pendingWindowReveal = false;
      mainWindow?.setSkipTaskbar(false);
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  // Use the cached close behavior so event.preventDefault() is called synchronously.
  // Awaiting inside a close handler is too late — Electron processes the event before
  // the async callback resumes, so the window would be destroyed even with preventDefault.
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    if (closeBehaviorCache === "tray") {
      event.preventDefault();
      mainWindow?.setSkipTaskbar(true);
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindowReady = false;
    pendingWindowReveal = false;
    mainWindow = null;
  });
}

// Build-time constants from .env — never read from renderer input.
const CONVEX_SITE_URL: string = (import.meta as unknown as { env: Record<string, string> }).env
  .VITE_CONVEX_SITE_URL ?? "";

function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "auth") {
      const code = parsed.searchParams.get("code");
      if (code && pendingLoginResolve) {
        const resolve = pendingLoginResolve;
        const reject = pendingLoginReject;
        pendingLoginResolve = null;
        pendingLoginReject = null;

        // Exchange the one-time code for the actual token via the Convex HTTP action.
        net
          .fetch(`${CONVEX_SITE_URL}/api/auth/redeem-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          })
          .then(async (resp) => {
            if (!resp.ok) throw new Error(`Code exchange failed: ${resp.status}`);
            const data = (await resp.json()) as { token?: string; error?: string };
            if (!data.token) throw new Error(data.error ?? "No token in response");
            storedSessionToken = data.token;
            cachedElectronToken = null;
            saveSessionToken(data.token);
            resolve(data.token);
          })
          .catch((err: Error) => {
            reject?.(err);
          });
      }
    }
  } catch {
    // ignore malformed deep-links
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

// Trusted site URL — read from build-time env, never from renderer input.
const SITE_URL: string = (import.meta as unknown as { env: Record<string, string> }).env
  .VITE_SITE_URL ?? "";

// Auth
ipcMain.handle("auth:login", () => {
  return new Promise<boolean>((resolve, reject) => {
    // Set up pending deep-link resolution with a 10-minute timeout.
    const timeout = setTimeout(() => {
      pendingLoginReject?.(new Error("Login timed out"));
      pendingLoginResolve = null;
      pendingLoginReject = null;
    }, 10 * 60 * 1000);

    pendingLoginResolve = (_token: string) => {
      clearTimeout(timeout);
      resolve(true);
    };
    pendingLoginReject = (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    };

    // Open the login page in the browser. The browser initiates the OAuth flow so the
    // state cookie lands in the browser session (not Electron's), which means better-auth
    // can validate the callback and honour the callbackURL → /auth/electron-callback.
    void shell.openExternal(`${SITE_URL}/auth/electron-login`);
  });
});

ipcMain.handle("auth:getToken", async () => {
  if (cachedElectronToken && !isJwtExpired(cachedElectronToken)) return cachedElectronToken;

  const refreshed = await fetchFreshConvexToken();
  if (refreshed) return refreshed;

  // Fallback: fetch from session cookies (legacy / future in-app flows).
  try {
    const resp = await session.defaultSession.fetch(`${SITE_URL}/api/auth/convex/token`, {
      headers: { Origin: SITE_URL },
    });
    if (!resp.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await resp.json();
    cachedElectronToken = data?.token ?? null;
    return cachedElectronToken;
  } catch {
    return null;
  }
});

ipcMain.handle("auth:getSession", async () => {
  try {
    const resp = await session.defaultSession.fetch(`${SITE_URL}/api/auth/get-session`, {
      headers: {
        Origin: SITE_URL,
        ...(storedSessionToken ? { Authorization: `Bearer ${storedSessionToken}` } : {}),
      },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
});

ipcMain.handle("auth:logout", async () => {
  const sessionToken = storedSessionToken;
  cachedElectronToken = null;
  storedSessionToken = null;
  saveSessionToken(null);
  try {
    await session.defaultSession.fetch(`${SITE_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: SITE_URL,
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({}),
    });
    return true;
  } catch {
    return false;
  }
});

// WoW addon data
ipcMain.handle("wow:getRetailPath", async () => {
  const settings = await getSettings();
  return (settings.retailPath as string) ?? null;
});

ipcMain.handle("wow:selectRetailFolder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select World of Warcraft _retail_ folder",
    buttonLabel: "Select folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folder = result.filePaths[0];
  const settings = await getSettings();
  settings.retailPath = folder;
  await saveSettings(settings);
  return folder;
});

ipcMain.handle("wow:readAddonData", async () => {
  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) return null;
  return findAndParseAddonData(retailPath);
});

ipcMain.handle("wow:compactAddonData", async (_, forceIfRunning = false) => {
  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) {
    throw new Error("WoW retail path is not configured");
  }

  const lastSyncedAt = (settings.lastSyncedAt as number) ?? 0;
  return compactAddonData(retailPath, lastSyncedAt, forceIfRunning);
});

function stopAddonWatcher() {
  if (addonWatchDebounce) {
    clearTimeout(addonWatchDebounce);
    addonWatchDebounce = null;
  }
  if (addonWatcher) {
    addonWatcher.close();
    addonWatcher = null;
  }
}

ipcMain.handle("wow:watchAddonFile", async () => {
  stopAddonWatcher();
  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) return;
  const watchPath = join(retailPath, "WTF", "Account");
  try {
    addonWatcher = fs.watch(watchPath, { recursive: true }, (_event, filename) => {
      if (!filename?.endsWith("wow-dashboard.lua")) return;
      if (Date.now() < ignoreAddonWatchEventsUntil) return;
      if (addonWatchDebounce) clearTimeout(addonWatchDebounce);
      addonWatchDebounce = setTimeout(() => {
        mainWindow?.webContents.send("wow:addonFileChanged");
      }, 2000);
    });
  } catch (e) {
    console.warn("[wow-dashboard] Failed to watch addon file:", e);
  }
});

ipcMain.handle("wow:unwatchAddonFile", () => {
  stopAddonWatcher();
});

// Addon installation
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = net.request({ url, useSessionCookies: false });
    const writeStream = fs.createWriteStream(destPath);
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        writeStream.destroy();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }
      response.on("data", (chunk: Buffer) => writeStream.write(chunk));
      response.on("end", () => writeStream.end(() => resolve()));
      response.on("error", (err: Error) => {
        writeStream.destroy();
        reject(err);
      });
    });
    request.on("error", (err: Error) => {
      writeStream.destroy();
      reject(err);
    });
    request.end();
  });
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const resolvedDest = resolve(destDir);
  const directory = await unzipper.Open.file(zipPath);
  for (const file of directory.files) {
    const outPath = resolve(resolvedDest, file.path);
    // Reject any entry whose resolved path escapes destDir.
    const rel = path.relative(resolvedDest, outPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Path traversal detected in zip entry: ${file.path}`);
    }
    if (file.type === "Directory") {
      await fs.promises.mkdir(outPath, { recursive: true });
    } else {
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      await new Promise<void>((res, rej) =>
        file.stream().pipe(fs.createWriteStream(outPath)).on("finish", res).on("error", rej),
      );
    }
  }
}

ipcMain.handle("wow:checkAddonInstalled", async () => {
  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) return false;
  const addonPath = join(retailPath, "Interface", "AddOns", "wow-dashboard");
  try {
    await fs.promises.access(addonPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("wow:getInstalledAddonVersion", async () => {
  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) return null;
  const tocPath = join(retailPath, "Interface", "AddOns", "wow-dashboard", "wow-dashboard.toc");
  try {
    const content = await fs.promises.readFile(tocPath, "utf-8");
    const match = content.match(/^##\s*Version:\s*(.+)$/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
});

function validateGitHubUrl(url: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (
    parsedUrl.hostname !== "objects.githubusercontent.com" &&
    parsedUrl.hostname !== "github.com"
  ) {
    throw new Error(`Untrusted download host: ${parsedUrl.hostname}`);
  }
}

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

ipcMain.handle("wow:installAddon", async (_, downloadUrl: string, checksumUrl: string) => {
  // Validate both URLs come from GitHub only.
  validateGitHubUrl(downloadUrl);
  if (checksumUrl) validateGitHubUrl(checksumUrl);

  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) throw new Error("WoW retail path is not configured");

  const tmpDir = os.tmpdir();
  const zipPath = join(tmpDir, "wow-dashboard-addon.zip");
  const checksumPath = join(tmpDir, "wow-dashboard-addon.zip.sha256");
  const extractDir = join(tmpDir, "wow-dashboard-addon-extract");
  const addonsDir = join(retailPath, "Interface", "AddOns");
  const addonDest = join(addonsDir, "wow-dashboard");

  try {
    await downloadFile(downloadUrl, zipPath);

    // Verify SHA256 checksum if a checksum URL was provided.
    if (checksumUrl) {
      await downloadFile(checksumUrl, checksumPath);
      const checksumContent = await fs.promises.readFile(checksumPath, "utf-8");
      const expectedHash = checksumContent.trim().split(/\s+/)[0];
      const actualHash = await computeFileSha256(zipPath);
      if (actualHash !== expectedHash) {
        throw new Error(
          `Checksum mismatch — addon package may be corrupted or tampered with.\nExpected: ${expectedHash}\nGot: ${actualHash}`,
        );
      }
    }

    await fs.promises.rm(extractDir, { recursive: true, force: true });
    await fs.promises.mkdir(extractDir, { recursive: true });

    await extractZip(zipPath, extractDir);

    const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const addonSrc =
      dirs.length === 1
        ? (() => {
            const dir = dirs[0];
            if (!dir) return extractDir;
            const candidate = resolve(extractDir, dir.name);
            if (!candidate.startsWith(resolve(extractDir) + sep)) {
              throw new Error("Path traversal detected in zip archive");
            }
            return candidate;
          })()
        : extractDir;

    await fs.promises.mkdir(addonsDir, { recursive: true });
    await fs.promises.rm(addonDest, { recursive: true, force: true });
    await fs.promises.cp(addonSrc, addonDest, { recursive: true });
  } finally {
    await fs.promises.rm(zipPath, { force: true }).catch(() => {});
    await fs.promises.rm(checksumPath, { force: true }).catch(() => {});
    await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
});

const GITHUB_REPO = "zirkumflex-group/wow-dashboard";

ipcMain.handle("wow:getLatestAddonRelease", async () => {
  const res = await net.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const releases = (await res.json()) as any[];
  const addonRelease = releases.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.tag_name.startsWith("addon-v") && !r.draft && !r.prerelease,
  );
  if (!addonRelease) throw new Error("No addon release found on GitHub");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asset = addonRelease.assets.find((a: any) => a.name === "wow-dashboard.zip");
  if (!asset) throw new Error("No wow-dashboard.zip asset found in latest addon release");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checksumAsset = addonRelease.assets.find((a: any) => a.name === "wow-dashboard.zip.sha256");
  return {
    url: asset.browser_download_url as string,
    checksumUrl: checksumAsset ? (checksumAsset.browser_download_url as string) : null,
    version: (addonRelease.tag_name as string).replace("addon-v", ""),
  };
});

// Shell
ipcMain.handle("app:openExternal", (_, url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol === "https:" || parsed.protocol === "http:") {
    shell.openExternal(url);
  }
});
ipcMain.handle("app:getVersion", () => app.getVersion());

// Trigger a silent install and relaunch — used by the "Restart Now" button in the renderer.
ipcMain.handle("app:installUpdate", () => {
  autoUpdater.quitAndInstall(true, true);
});

// Manually trigger an update check — used by the "Check for Updates" button in the renderer.
ipcMain.handle("app:checkForUpdates", () => {
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
});

// App settings
ipcMain.handle("settings:getAppSettings", async () => {
  const s = await getSettings();
  return {
    closeBehavior: (s.closeBehavior as string) ?? "tray",
    autostart: (s.autostart as boolean) ?? false,
    launchMinimized: (s.launchMinimized as boolean) ?? true,
    lastSyncedAt: (s.lastSyncedAt as number) ?? 0,
  };
});

ipcMain.handle("settings:setCloseBehavior", async (_, value: "tray" | "exit") => {
  // Update in-memory cache first so the window close handler picks it up immediately.
  closeBehaviorCache = value;
  const s = await getSettings();
  s.closeBehavior = value;
  await saveSettings(s);
});

ipcMain.handle("settings:setAutostart", async (_, value: boolean) => {
  const s = await getSettings();
  s.autostart = value;
  await saveSettings(s);
  if (process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: value });
  }
});

ipcMain.handle("settings:setLaunchMinimized", async (_, value: boolean) => {
  launchMinimizedCache = value;
  const s = await getSettings();
  s.launchMinimized = value;
  await saveSettings(s);
});

ipcMain.handle("settings:setLastSyncedAt", async (_, value: number) => {
  const s = await getSettings();
  s.lastSyncedAt = value;
  await saveSettings(s);
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

// macOS: deep-links arrive via open-url before the app is fully ready.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Windows/Linux: a second instance is launched with the deep-link URL in argv.
// Grab the lock so only one instance runs; the second instance forwards its URL and quits.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_, argv) => {
    const url = argv.find((a) => a.startsWith("wow-dashboard://"));
    if (url) handleDeepLink(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  // In dev mode on Windows the app isn't packaged, so we must supply the Electron
  // executable path and the app path explicitly for the registry entry to work.
  if (!app.isPackaged) {
    app.setAsDefaultProtocolClient("wow-dashboard", process.execPath, [
      path.resolve(process.argv[1] ?? "."),
    ]);
  } else {
    app.setAsDefaultProtocolClient("wow-dashboard");
  }
  // Restore persisted desktop auth state from OS keychain (safeStorage).
  loadStoredAuth();

  // Load settings before creating the window so closeBehaviorCache is populated and
  // the synchronous close handler has the correct value from the very first close event.
  const settings = await getSettings();
  closeBehaviorCache = (settings.closeBehavior as "tray" | "exit") ?? "tray";
  launchMinimizedCache = (settings.launchMinimized as boolean) ?? true;
  if (process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: (settings.autostart as boolean) ?? false });
    if (!launchMinimizedCache) {
      pendingWindowReveal = true;
    }
  }

  createWindow();
  void createTray().catch((error) => {
    console.warn("[wow-dashboard] Failed to create tray:", error);
  });

  // Check for app updates (only in packaged builds).
  // Updates download in the background and install silently on next quit (autoInstallOnAppQuit
  // is true by default in electron-updater). The renderer shows a banner so the user can also
  // trigger an immediate restart via app:installUpdate.
  if (app.isPackaged) {
    const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
    autoUpdater.on("update-available", (info) => {
      mainWindow?.webContents.send("app:updateAvailable", info.version);
    });
    autoUpdater.on("update-downloaded", (info) => {
      mainWindow?.webContents.send("app:updateDownloaded", info.version);
      // No blocking dialog — the renderer banner handles user interaction.
    });
    autoUpdater.on("update-not-available", () => {
      mainWindow?.webContents.send("app:updateNotAvailable");
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopAddonWatcher();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
