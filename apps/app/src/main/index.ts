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
import { env as appEnv } from "@wow-dashboard/env/app";
import { execFile, spawn } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { join, resolve, sep } from "path";
import * as crypto from "crypto";
import * as os from "os";
import * as unzipper from "unzipper";
import { fileURLToPath } from "node:url";
import type {
  AddonApplyStagedResult,
  AddonUpdateCheckResult,
  AddonUpdateState,
  AppInstallUpdateResult,
  AppUpdateState,
} from "../shared/update";
import type { DesktopAuthSessionState } from "../shared/auth";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let isInstallingAppUpdate = false;
let isEndingWindowsSession = false;
let mainWindowReady = false;
let pendingWindowReveal = false;
// Cache close behavior so the window close handler can be synchronous (event.preventDefault
// must be called synchronously – awaiting inside the handler is too late on Windows).
let closeBehaviorCache: "tray" | "exit" = "tray";
let launchMinimizedCache = true;
let addonWatcher: ReturnType<typeof fs.watch> | null = null;
let addonWatchDebounce: ReturnType<typeof setTimeout> | null = null;
let storedSessionToken: string | null = null;
let pendingLoginResolve: ((token: string) => void) | null = null;
let pendingLoginReject: ((err: Error) => void) | null = null;
let stagingAddonUpdate = false;
let applyingStagedAddonUpdate = false;
let appUpdateCheckInFlight: Promise<void> | null = null;
let addonUpdateCheckInFlight: Promise<AddonUpdateCheckResult> | null = null;
let appUpdaterListenersRegistered = false;
let addonUpdateCheckTimer: ReturnType<typeof setInterval> | null = null;
let addonUpdateApplyTimer: ReturnType<typeof setInterval> | null = null;
let appUpdateCheckTimer: ReturnType<typeof setInterval> | null = null;

const DEFAULT_APP_UPDATE_CHECK_INTERVAL_MINUTES = 60;
const DEFAULT_ADDON_UPDATE_CHECK_INTERVAL_MINUTES = 60;
const DEFAULT_ADDON_UPDATE_APPLY_INTERVAL_MINUTES = 1;

if (!app.isPackaged) {
  app.setName("WoW Dashboard Dev");
  app.setPath("userData", join(app.getPath("appData"), "WoW Dashboard Dev"));
}

const appUpdateState: AppUpdateState = {
  status: app.isPackaged ? "idle" : "unsupported",
  currentVersion: app.getVersion(),
  availableVersion: null,
  downloadedVersion: null,
  progressPercent: null,
  error: null,
  lastCheckedAt: null,
  isPackaged: app.isPackaged,
};

const addonUpdateState: AddonUpdateState = {
  status: "idle",
  installedVersion: null,
  latestVersion: null,
  stagedVersion: null,
  error: null,
  lastCheckedAt: null,
};
const SITE_URL = appEnv.VITE_SITE_URL;
const API_URL = appEnv.VITE_API_URL;
const RENDERER_DEV_URL = process.env["ELECTRON_RENDERER_URL"] ?? null;
const RENDERER_FILE_PATH = join(__dirname, "../renderer/index.html");
const RENDERER_DIR = resolve(__dirname, "../renderer");
const TAURI_UPDATE_MANIFEST_URL =
  "https://github.com/zirkumflex-group/wow-dashboard/releases/latest/download/latest.json";
const TAURI_WINDOWS_PLATFORM = "windows-x86_64";
const TAURI_INSTALLER_ASSET_NAME = "wow-dashboard.exe";
const ELECTRON_TAURI_MIGRATION_BRIDGE =
  app.isPackaged &&
  process.platform === "win32" &&
  process.env["WOW_DASHBOARD_DISABLE_TAURI_BRIDGE"] !== "1";

function isHttpUrl(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(resolve(parentPath), resolve(childPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isTrustedRendererUrl(rawUrl: string): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return false;
  }

  if (RENDERER_DEV_URL) {
    try {
      const devUrl = new URL(RENDERER_DEV_URL);
      return parsedUrl.origin === devUrl.origin;
    } catch {
      return false;
    }
  }

  if (parsedUrl.protocol !== "file:") {
    return false;
  }

  try {
    const filePath = fileURLToPath(parsedUrl);
    return isPathInside(RENDERER_DIR, filePath);
  } catch {
    return false;
  }
}

function handleBlockedRendererNavigation(rawUrl: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return;
  }

  if (isHttpUrl(parsedUrl)) {
    void openUrlInExternalBrowser(rawUrl).catch((error) => {
      console.warn("[wow-dashboard] Failed to open blocked renderer navigation externally:", error);
    });
  }
}

type MainApiFetchRequest = {
  url: string;
  method?: string;
  headers?: Array<[string, string]>;
  body?: string;
};

type MainApiFetchResponse = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
};

function isTrustedApiUrl(rawUrl: string): boolean {
  try {
    const parsedUrl = new URL(rawUrl);
    const apiBaseUrl = new URL(API_URL.endsWith("/") ? API_URL : `${API_URL}/`);
    return (
      parsedUrl.origin === apiBaseUrl.origin &&
      (parsedUrl.pathname === apiBaseUrl.pathname.slice(0, -1) ||
        parsedUrl.pathname.startsWith(apiBaseUrl.pathname))
    );
  } catch {
    return false;
  }
}

function buildApiProxyHeaders(inputHeaders: Array<[string, string]> | undefined): Headers {
  const headers = new Headers();
  for (const [name, value] of inputHeaders ?? []) {
    const normalizedName = name.toLowerCase();
    if (normalizedName === "accept" || normalizedName === "content-type") {
      headers.set(name, value);
    }
  }

  headers.set("Origin", SITE_URL);
  if (storedSessionToken) {
    headers.set("Authorization", `Bearer ${storedSessionToken}`);
  }
  return headers;
}

function getElectronLoginUrl(): string {
  return new URL("/auth/electron-login", SITE_URL).toString();
}

function getApiAuthUrl(pathname: string): string {
  return new URL(
    pathname.replace(/^\//, ""),
    API_URL.endsWith("/") ? API_URL : `${API_URL}/`,
  ).toString();
}

function persistDesktopSessionToken(token: string): void {
  storedSessionToken = token;
  saveSessionToken(token);
}

function runOpenCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, { windowsHide: true }, (error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
}

async function openUrlInExternalBrowser(url: string): Promise<void> {
  try {
    await shell.openExternal(url);
    return;
  } catch (error) {
    console.warn("[wow-dashboard] shell.openExternal failed:", error);
  }

  if (process.platform === "linux") {
    for (const [command, args] of [
      ["xdg-open", [url]],
      ["gio", ["open", url]],
    ] as const) {
      try {
        await runOpenCommand(command, args);
        return;
      } catch (error) {
        console.warn(`[wow-dashboard] ${command} failed:`, error);
      }
    }
  }

  throw new Error(`Could not open your browser automatically. Open ${url} manually.`);
}

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
      if (raw) {
        storedSessionToken = raw;
        saveSessionToken(raw);
      }
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

function getConfiguredAppUpdateCheckIntervalMs(): number {
  return DEFAULT_APP_UPDATE_CHECK_INTERVAL_MINUTES * 60 * 1000;
}

function getConfiguredAddonUpdateCheckIntervalMs(): number {
  return DEFAULT_ADDON_UPDATE_CHECK_INTERVAL_MINUTES * 60 * 1000;
}

function getConfiguredAddonStagedApplyIntervalMs(): number {
  return DEFAULT_ADDON_UPDATE_APPLY_INTERVAL_MINUTES * 60 * 1000;
}

function broadcastToRenderers(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(channel, ...args);
  }
}

function getAppUpdateStateSnapshot(): AppUpdateState {
  return { ...appUpdateState };
}

function updateAppUpdateState(patch: Partial<AppUpdateState>): AppUpdateState {
  Object.assign(appUpdateState, patch, {
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
  });
  const snapshot = getAppUpdateStateSnapshot();
  broadcastToRenderers("app:updateState", snapshot);
  refreshTrayMenu();
  return snapshot;
}

function getAddonUpdateStateSnapshot(): AddonUpdateState {
  return { ...addonUpdateState };
}

function updateAddonUpdateState(patch: Partial<AddonUpdateState>): AddonUpdateState {
  Object.assign(addonUpdateState, patch);
  const snapshot = getAddonUpdateStateSnapshot();
  broadcastToRenderers("wow:addonUpdateState", snapshot);
  return snapshot;
}

function destroyTray(): void {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function clearBackgroundTimers(): void {
  if (addonUpdateCheckTimer) {
    clearInterval(addonUpdateCheckTimer);
    addonUpdateCheckTimer = null;
  }
  if (addonUpdateApplyTimer) {
    clearInterval(addonUpdateApplyTimer);
    addonUpdateApplyTimer = null;
  }
  if (appUpdateCheckTimer) {
    clearInterval(appUpdateCheckTimer);
    appUpdateCheckTimer = null;
  }
}

function prepareForQuit(options?: { windowsSessionEnding?: boolean }): void {
  isQuitting = true;

  if (options?.windowsSessionEnding) {
    isEndingWindowsSession = true;
    autoUpdater.autoInstallOnAppQuit = false;
  }

  clearBackgroundTimers();
  stopAddonWatcher();
  destroyTray();
}

function quitApplication(): void {
  prepareForQuit();
  app.quit();
}

function revealWindow(): void {
  if (isQuitting) return;
  pendingWindowReveal = false;
  mainWindow?.setSkipTaskbar(false);
  mainWindow?.show();
  mainWindow?.focus();
}

function showWindow(): void {
  if (isQuitting) return;

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
}

function installDownloadedAppUpdate(): AppInstallUpdateResult {
  if (!app.isPackaged) {
    return {
      ok: false,
      status: "unsupported",
      message: "Desktop app updates are unavailable in development builds.",
    };
  }

  if (appUpdateState.status !== "downloaded" || !appUpdateState.downloadedVersion) {
    return {
      ok: false,
      status: "notDownloaded",
      message: "No downloaded desktop update is ready to install.",
    };
  }

  updateAppUpdateState({
    status: "installing",
    error: null,
  });
  isInstallingAppUpdate = true;
  isQuitting = true;
  setImmediate(() => {
    autoUpdater.quitAndInstall(true, true);
  });

  return {
    ok: true,
    status: "installing",
    message: null,
  };
}

function buildTrayMenu(): Electron.Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Show WoW Dashboard",
      click: () => {
        showWindow();
      },
    },
  ];

  if (appUpdateState.status === "downloaded" && appUpdateState.downloadedVersion) {
    template.push({
      label: "Install update and restart",
      click: () => {
        installDownloadedAppUpdate();
      },
    });
  }

  template.push(
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitApplication();
      },
    },
  );

  return Menu.buildFromTemplate(template);
}

function refreshTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
}

async function createTray(): Promise<void> {
  if (tray) return;

  const icon = await loadTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("WoW Dashboard");
  refreshTrayMenu();

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
const CLASS_TAG_BY_ID: Record<number, string> = {
  1: "WARRIOR",
  2: "PALADIN",
  3: "HUNTER",
  4: "ROGUE",
  5: "PRIEST",
  6: "DEATHKNIGHT",
  7: "SHAMAN",
  8: "MAGE",
  9: "WARLOCK",
  10: "MONK",
  11: "DRUID",
  12: "DEMONHUNTER",
  13: "EVOKER",
};

interface MythicPlusRunMemberData {
  name: string;
  realm?: string;
  classTag?: string;
  role?: Role;
}

interface MythicPlusRunData {
  fingerprint: string;
  attemptId?: string;
  canonicalKey?: string;
  observedAt: number;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  status?: "active" | "completed" | "abandoned";
  completed?: boolean;
  completedInTime?: boolean;
  durationMs?: number;
  runScore?: number;
  startDate?: number;
  completedAt?: number;
  endedAt?: number;
  abandonedAt?: number;
  abandonReason?:
    | "challenge_mode_reset"
    | "left_instance"
    | "leaver_timer"
    | "history_incomplete"
    | "stale_recovery"
    | "unknown";
  thisWeek?: boolean;
  members?: MythicPlusRunMemberData[];
}

interface SnapshotCurrencyInfo {
  currencyID: number;
  name?: string;
  quantity: number;
  iconFileID?: number;
  maxQuantity?: number;
  canEarnPerWeek?: boolean;
  quantityEarnedThisWeek?: number;
  maxWeeklyQuantity?: number;
  totalEarned?: number;
  discovered?: boolean;
  quality?: number;
  useTotalEarnedForMaxQty?: boolean;
}

type SnapshotCurrencyDetails = Record<string, SnapshotCurrencyInfo>;

interface SnapshotEquipmentItem {
  slot: string;
  slotID: number;
  itemID?: number;
  itemName?: string;
  itemLink?: string;
  itemLevel?: number;
  quality?: number;
  iconFileID?: number;
}

type SnapshotEquipment = Record<string, SnapshotEquipmentItem>;

interface SnapshotWeeklyRewardActivity {
  type?: number;
  index?: number;
  id?: number;
  level?: number;
  threshold?: number;
  progress?: number;
  activityTierID?: number;
  itemLevel?: number;
  name?: string;
}

interface SnapshotWeeklyRewards {
  canClaimRewards?: boolean;
  isCurrentPeriod?: boolean;
  activities: SnapshotWeeklyRewardActivity[];
}

interface SnapshotMajorFaction {
  factionID: number;
  name?: string;
  expansionID?: number;
  isUnlocked?: boolean;
  renownLevel?: number;
  renownReputationEarned?: number;
  renownLevelThreshold?: number;
  isWeeklyCapped?: boolean;
}

interface SnapshotMajorFactions {
  factions: SnapshotMajorFaction[];
}

interface SnapshotClientInfo {
  addonVersion?: string;
  interfaceVersion?: number;
  gameVersion?: string;
  buildNumber?: string;
  buildDate?: string;
  tocVersion?: number;
  expansion?: string;
  locale?: string;
}

interface SnapshotData {
  takenAt: number;
  level: number;
  spec: string;
  role: Role;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  playtimeThisLevelSeconds?: number;
  mythicPlusScore: number;
  seasonID?: number;
  ownedKeystone?: {
    level: number;
    mapChallengeModeID?: number;
    mapName?: string;
  };
  currencies: {
    adventurerDawncrest: number;
    veteranDawncrest: number;
    championDawncrest: number;
    heroDawncrest: number;
    mythDawncrest: number;
    radiantSparkDust: number;
  };
  currencyDetails?: SnapshotCurrencyDetails;
  stats: {
    stamina: number;
    strength: number;
    agility: number;
    intellect: number;
    critRating?: number;
    critPercent: number;
    hasteRating?: number;
    hastePercent: number;
    masteryRating?: number;
    masteryPercent: number;
    versatilityRating?: number;
    versatilityPercent: number;
    speedRating?: number;
    speedPercent?: number;
    leechRating?: number;
    leechPercent?: number;
    avoidanceRating?: number;
    avoidancePercent?: number;
  };
  equipment?: SnapshotEquipment;
  weeklyRewards?: SnapshotWeeklyRewards;
  majorFactions?: SnapshotMajorFactions;
  clientInfo?: SnapshotClientInfo;
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

function getSnapshotCompletenessScore(snapshot: SnapshotData): number {
  let score = 0;

  if (snapshot.playtimeSeconds > 0) score += 1;
  if (snapshot.playtimeThisLevelSeconds !== undefined) score += 1;
  if (snapshot.seasonID !== undefined) score += 1;
  if (snapshot.ownedKeystone !== undefined) score += 1;
  if (snapshot.currencyDetails !== undefined) score += 1;
  if (snapshot.equipment !== undefined) score += 2;
  if (snapshot.weeklyRewards !== undefined) score += 1;
  if (snapshot.majorFactions !== undefined) score += 1;
  if (snapshot.clientInfo !== undefined) score += 1;
  if (snapshot.stats.critRating !== undefined) score += 1;
  if (snapshot.stats.hasteRating !== undefined) score += 1;
  if (snapshot.stats.masteryRating !== undefined) score += 1;
  if (snapshot.stats.versatilityRating !== undefined) score += 1;
  if (snapshot.stats.speedRating !== undefined) score += 1;
  if (snapshot.stats.leechRating !== undefined) score += 1;
  if (snapshot.stats.avoidanceRating !== undefined) score += 1;
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
    playtimeSeconds:
      preferred.playtimeSeconds > 0 ? preferred.playtimeSeconds : fallback.playtimeSeconds,
    playtimeThisLevelSeconds:
      preferred.playtimeThisLevelSeconds ?? fallback.playtimeThisLevelSeconds,
    seasonID: preferred.seasonID ?? fallback.seasonID,
    ownedKeystone: preferred.ownedKeystone ?? fallback.ownedKeystone,
    currencyDetails: preferred.currencyDetails ?? fallback.currencyDetails,
    equipment: preferred.equipment ?? fallback.equipment,
    weeklyRewards: preferred.weeklyRewards ?? fallback.weeklyRewards,
    majorFactions: preferred.majorFactions ?? fallback.majorFactions,
    clientInfo: preferred.clientInfo ?? fallback.clientInfo,
    stats: {
      ...preferred.stats,
      critRating: preferred.stats.critRating ?? fallback.stats.critRating,
      hasteRating: preferred.stats.hasteRating ?? fallback.stats.hasteRating,
      masteryRating: preferred.stats.masteryRating ?? fallback.stats.masteryRating,
      versatilityRating: preferred.stats.versatilityRating ?? fallback.stats.versatilityRating,
      speedRating: preferred.stats.speedRating ?? fallback.stats.speedRating,
      leechRating: preferred.stats.leechRating ?? fallback.stats.leechRating,
      avoidanceRating: preferred.stats.avoidanceRating ?? fallback.stats.avoidanceRating,
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

function normalizeCurrencyDetails(value: unknown): SnapshotCurrencyDetails | undefined {
  if (!isRecord(value)) return undefined;

  const details: SnapshotCurrencyDetails = {};
  for (const [key, rawInfo] of Object.entries(value)) {
    if (!isRecord(rawInfo)) continue;
    const currencyID = toOptionalNumber(rawInfo.currencyID);
    const quantity = toOptionalNumber(rawInfo.quantity);
    if (currencyID === undefined || quantity === undefined) continue;

    details[key] = {
      currencyID,
      quantity,
      ...(toOptionalString(rawInfo.name) !== undefined
        ? { name: toOptionalString(rawInfo.name) }
        : {}),
      ...(toOptionalNumber(rawInfo.iconFileID) !== undefined
        ? { iconFileID: toOptionalNumber(rawInfo.iconFileID) }
        : {}),
      ...(toOptionalNumber(rawInfo.maxQuantity) !== undefined
        ? { maxQuantity: toOptionalNumber(rawInfo.maxQuantity) }
        : {}),
      ...(toOptionalBoolean(rawInfo.canEarnPerWeek) !== undefined
        ? { canEarnPerWeek: toOptionalBoolean(rawInfo.canEarnPerWeek) }
        : {}),
      ...(toOptionalNumber(rawInfo.quantityEarnedThisWeek) !== undefined
        ? { quantityEarnedThisWeek: toOptionalNumber(rawInfo.quantityEarnedThisWeek) }
        : {}),
      ...(toOptionalNumber(rawInfo.maxWeeklyQuantity) !== undefined
        ? { maxWeeklyQuantity: toOptionalNumber(rawInfo.maxWeeklyQuantity) }
        : {}),
      ...(toOptionalNumber(rawInfo.totalEarned) !== undefined
        ? { totalEarned: toOptionalNumber(rawInfo.totalEarned) }
        : {}),
      ...(toOptionalBoolean(rawInfo.discovered) !== undefined
        ? { discovered: toOptionalBoolean(rawInfo.discovered) }
        : {}),
      ...(toOptionalNumber(rawInfo.quality) !== undefined
        ? { quality: toOptionalNumber(rawInfo.quality) }
        : {}),
      ...(toOptionalBoolean(rawInfo.useTotalEarnedForMaxQty) !== undefined
        ? { useTotalEarnedForMaxQty: toOptionalBoolean(rawInfo.useTotalEarnedForMaxQty) }
        : {}),
    };
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

function normalizeSnapshotEquipment(value: unknown): SnapshotEquipment | undefined {
  if (!isRecord(value)) return undefined;

  const equipment: SnapshotEquipment = {};
  for (const [key, rawItem] of Object.entries(value)) {
    if (!isRecord(rawItem)) continue;
    const slot = toOptionalString(rawItem.slot) ?? key;
    const slotID = toOptionalNumber(rawItem.slotID);
    if (slotID === undefined) continue;

    equipment[key] = {
      slot,
      slotID,
      ...(toOptionalNumber(rawItem.itemID) !== undefined
        ? { itemID: toOptionalNumber(rawItem.itemID) }
        : {}),
      ...(toOptionalString(rawItem.itemName) !== undefined
        ? { itemName: toOptionalString(rawItem.itemName) }
        : {}),
      ...(toOptionalString(rawItem.itemLink) !== undefined
        ? { itemLink: toOptionalString(rawItem.itemLink) }
        : {}),
      ...(toOptionalNumber(rawItem.itemLevel) !== undefined
        ? { itemLevel: toOptionalNumber(rawItem.itemLevel) }
        : {}),
      ...(toOptionalNumber(rawItem.quality) !== undefined
        ? { quality: toOptionalNumber(rawItem.quality) }
        : {}),
      ...(toOptionalNumber(rawItem.iconFileID) !== undefined
        ? { iconFileID: toOptionalNumber(rawItem.iconFileID) }
        : {}),
    };
  }

  return Object.keys(equipment).length > 0 ? equipment : undefined;
}

function normalizeWeeklyRewards(value: unknown): SnapshotWeeklyRewards | undefined {
  if (!isRecord(value)) return undefined;

  const activitiesRaw = Array.isArray(value.activities) ? value.activities : [];
  const activities: SnapshotWeeklyRewardActivity[] = [];
  for (const [index, rawActivity] of activitiesRaw.entries()) {
    if (!isRecord(rawActivity)) continue;
    const activity = {
      ...(toOptionalNumber(rawActivity.type) !== undefined
        ? { type: toOptionalNumber(rawActivity.type) }
        : {}),
      ...(toOptionalNumber(rawActivity.index) !== undefined
        ? { index: toOptionalNumber(rawActivity.index) }
        : { index: index + 1 }),
      ...(toOptionalNumber(rawActivity.id) !== undefined
        ? { id: toOptionalNumber(rawActivity.id) }
        : {}),
      ...(toOptionalNumber(rawActivity.level) !== undefined
        ? { level: toOptionalNumber(rawActivity.level) }
        : {}),
      ...(toOptionalNumber(rawActivity.threshold) !== undefined
        ? { threshold: toOptionalNumber(rawActivity.threshold) }
        : {}),
      ...(toOptionalNumber(rawActivity.progress) !== undefined
        ? { progress: toOptionalNumber(rawActivity.progress) }
        : {}),
      ...(toOptionalNumber(rawActivity.activityTierID) !== undefined
        ? { activityTierID: toOptionalNumber(rawActivity.activityTierID) }
        : {}),
      ...(toOptionalNumber(rawActivity.itemLevel) !== undefined
        ? { itemLevel: toOptionalNumber(rawActivity.itemLevel) }
        : {}),
      ...(toOptionalString(rawActivity.name) !== undefined
        ? { name: toOptionalString(rawActivity.name) }
        : {}),
    };
    activities.push(activity);
  }

  if (activities.length === 0) return undefined;

  return {
    ...(toOptionalBoolean(value.canClaimRewards) !== undefined
      ? { canClaimRewards: toOptionalBoolean(value.canClaimRewards) }
      : {}),
    ...(toOptionalBoolean(value.isCurrentPeriod) !== undefined
      ? { isCurrentPeriod: toOptionalBoolean(value.isCurrentPeriod) }
      : {}),
    activities,
  };
}

function normalizeMajorFactions(value: unknown): SnapshotMajorFactions | undefined {
  if (!isRecord(value)) return undefined;

  const factionsRaw = Array.isArray(value.factions) ? value.factions : [];
  const factions: SnapshotMajorFaction[] = [];
  for (const rawFaction of factionsRaw) {
    if (!isRecord(rawFaction)) continue;
    const factionID = toOptionalNumber(rawFaction.factionID);
    if (factionID === undefined) continue;

    factions.push({
      factionID,
      ...(toOptionalString(rawFaction.name) !== undefined
        ? { name: toOptionalString(rawFaction.name) }
        : {}),
      ...(toOptionalNumber(rawFaction.expansionID) !== undefined
        ? { expansionID: toOptionalNumber(rawFaction.expansionID) }
        : {}),
      ...(toOptionalBoolean(rawFaction.isUnlocked) !== undefined
        ? { isUnlocked: toOptionalBoolean(rawFaction.isUnlocked) }
        : {}),
      ...(toOptionalNumber(rawFaction.renownLevel) !== undefined
        ? { renownLevel: toOptionalNumber(rawFaction.renownLevel) }
        : {}),
      ...(toOptionalNumber(rawFaction.renownReputationEarned) !== undefined
        ? { renownReputationEarned: toOptionalNumber(rawFaction.renownReputationEarned) }
        : {}),
      ...(toOptionalNumber(rawFaction.renownLevelThreshold) !== undefined
        ? { renownLevelThreshold: toOptionalNumber(rawFaction.renownLevelThreshold) }
        : {}),
      ...(toOptionalBoolean(rawFaction.isWeeklyCapped) !== undefined
        ? { isWeeklyCapped: toOptionalBoolean(rawFaction.isWeeklyCapped) }
        : {}),
    });
  }

  return factions.length > 0 ? { factions } : undefined;
}

function normalizeClientInfo(value: unknown): SnapshotClientInfo | undefined {
  if (!isRecord(value)) return undefined;

  const clientInfo: SnapshotClientInfo = {
    ...(toOptionalString(value.addonVersion) !== undefined
      ? { addonVersion: toOptionalString(value.addonVersion) }
      : {}),
    ...(toOptionalNumber(value.interfaceVersion) !== undefined
      ? { interfaceVersion: toOptionalNumber(value.interfaceVersion) }
      : {}),
    ...(toOptionalString(value.gameVersion) !== undefined
      ? { gameVersion: toOptionalString(value.gameVersion) }
      : {}),
    ...(toOptionalString(value.buildNumber) !== undefined
      ? { buildNumber: toOptionalString(value.buildNumber) }
      : {}),
    ...(toOptionalString(value.buildDate) !== undefined
      ? { buildDate: toOptionalString(value.buildDate) }
      : {}),
    ...(toOptionalNumber(value.tocVersion) !== undefined
      ? { tocVersion: toOptionalNumber(value.tocVersion) }
      : {}),
    ...(toOptionalString(value.expansion) !== undefined
      ? { expansion: toOptionalString(value.expansion) }
      : {}),
    ...(toOptionalString(value.locale) !== undefined
      ? { locale: toOptionalString(value.locale) }
      : {}),
  };

  return Object.keys(clientInfo).length > 0 ? clientInfo : undefined;
}

function isTemporaryAttemptFingerprint(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("attempt|");
}

function hasRunCompletionEvidence(run: Partial<MythicPlusRunData>): boolean {
  return (
    run.completed === true ||
    getSanitizedRunDurationMs(run) !== undefined ||
    run.runScore !== undefined ||
    run.completedAt !== undefined
  );
}

function hasRunAbandonmentEvidence(run: Partial<MythicPlusRunData>): boolean {
  return (
    run.abandonedAt !== undefined ||
    run.abandonReason !== undefined ||
    (run.endedAt !== undefined && !hasRunCompletionEvidence(run))
  );
}

function getMythicPlusRunStatus(
  run: Partial<MythicPlusRunData>,
): MythicPlusRunData["status"] | undefined {
  if (run.status === "active" || run.status === "completed" || run.status === "abandoned") {
    return run.status;
  }
  if (hasRunCompletionEvidence(run)) {
    return "completed";
  }
  if (hasRunAbandonmentEvidence(run)) {
    return "abandoned";
  }
  return undefined;
}

function getMythicPlusRunStatusPriority(status: MythicPlusRunData["status"] | undefined): number {
  if (status === "completed") return 3;
  if (status === "abandoned") return 2;
  if (status === "active") return 1;
  return 0;
}

function normalizeRunMemberRole(value: unknown): Role | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "TANK") return "tank";
  if (normalized === "HEALER") return "healer";
  if (normalized === "DAMAGER" || normalized === "DAMAGE" || normalized === "DPS") return "dps";
  return undefined;
}

function normalizeClassTag(value: unknown, classId?: number): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized !== "") {
      return normalized.toUpperCase().replace(/[\s_-]/g, "");
    }
  }

  if (typeof classId === "number" && Number.isFinite(classId)) {
    return CLASS_TAG_BY_ID[classId];
  }

  return undefined;
}

function normalizeMemberIdentity(
  nameValue: unknown,
  realmValue?: unknown,
): { name: string; realm?: string } | null {
  if (typeof nameValue !== "string") {
    return null;
  }

  let name = nameValue.trim();
  if (name === "") {
    return null;
  }

  let realm = typeof realmValue === "string" ? realmValue.trim() : undefined;
  if (realm === "") {
    realm = undefined;
  }

  if (!realm) {
    const separatorIndex = name.indexOf("-");
    if (separatorIndex > 0 && separatorIndex < name.length - 1) {
      realm = name.slice(separatorIndex + 1).trim() || undefined;
      name = name.slice(0, separatorIndex).trim();
    }
  }

  return name === "" ? null : { name, realm };
}

function normalizeMythicPlusRunMember(value: unknown): MythicPlusRunMemberData | null {
  if (!isRecord(value)) {
    return null;
  }

  const identity = normalizeMemberIdentity(
    value.name ?? value.playerName ?? value.fullName ?? value.unitName,
    value.realm ?? value.realmName ?? value.server ?? value.realmSlug,
  );
  if (!identity) {
    return null;
  }

  const classId = toOptionalNumber(value.classID ?? value.classId);
  const classTag = normalizeClassTag(
    value.classTag ?? value.classFile ?? value.classFilename ?? value.class ?? value.englishClass,
    classId,
  );
  const role =
    normalizeRunMemberRole(value.role ?? value.assignedRole ?? value.combatRole) ??
    normalizeRunMemberRole(value.specRole);

  return {
    name: identity.name,
    realm: identity.realm,
    classTag,
    role,
  };
}

function normalizeMythicPlusRunMembers(value: unknown): MythicPlusRunMemberData[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const members: MythicPlusRunMemberData[] = [];
  const seenMembers = new Set<string>();

  for (const rawMember of value) {
    const member = normalizeMythicPlusRunMember(rawMember);
    if (!member) {
      continue;
    }

    const memberKey = `${member.name.toLowerCase()}|${member.realm?.toLowerCase() ?? ""}`;
    if (seenMembers.has(memberKey)) {
      continue;
    }

    seenMembers.add(memberKey);
    members.push(member);
  }

  return members.length > 0 ? members : undefined;
}

function getNormalizedRunMemberName(member: MythicPlusRunMemberData) {
  return member.name.trim().toLowerCase();
}

function getNormalizedRunMemberRealm(member: MythicPlusRunMemberData) {
  return member.realm?.trim().toLowerCase() ?? "";
}

function findMergeableRunMemberIndex(
  members: MythicPlusRunMemberData[],
  candidateMember: MythicPlusRunMemberData,
) {
  const candidateName = getNormalizedRunMemberName(candidateMember);
  const candidateRealm = getNormalizedRunMemberRealm(candidateMember);
  let exactIndex: number | undefined;
  let unresolvedIndex: number | undefined;
  let unresolvedCount = 0;
  let sameNameIndex: number | undefined;
  let sameNameCount = 0;

  for (let index = 0; index < members.length; index += 1) {
    const currentMember = members[index]!;
    if (getNormalizedRunMemberName(currentMember) !== candidateName) {
      continue;
    }

    sameNameCount += 1;
    sameNameIndex ??= index;
    const currentRealm = getNormalizedRunMemberRealm(currentMember);
    if (currentRealm === candidateRealm) {
      exactIndex = index;
      break;
    }
    if (currentRealm === "") {
      unresolvedIndex = index;
      unresolvedCount += 1;
    }
  }

  if (exactIndex !== undefined) {
    return exactIndex;
  }
  if (candidateRealm === "") {
    return sameNameCount === 1 ? (unresolvedIndex ?? sameNameIndex) : undefined;
  }

  return unresolvedCount === 1 ? unresolvedIndex : undefined;
}

function mergeMythicPlusRunMember(
  currentMember: MythicPlusRunMemberData | undefined,
  candidateMember: MythicPlusRunMemberData,
): MythicPlusRunMemberData {
  return {
    name: candidateMember.name,
    realm: candidateMember.realm ?? currentMember?.realm,
    classTag: candidateMember.classTag ?? currentMember?.classTag,
    role: candidateMember.role ?? currentMember?.role,
  };
}

function mergeMythicPlusRunMembers(
  currentMembers: MythicPlusRunMemberData[] | undefined,
  candidateMembers: MythicPlusRunMemberData[] | undefined,
) {
  if (
    (!currentMembers || currentMembers.length === 0) &&
    (!candidateMembers || candidateMembers.length === 0)
  ) {
    return undefined;
  }

  const mergedMembers: MythicPlusRunMemberData[] = [];

  for (const members of [candidateMembers, currentMembers]) {
    for (const member of members ?? []) {
      const mergedIndex = findMergeableRunMemberIndex(mergedMembers, member);
      if (mergedIndex === undefined) {
        mergedMembers.push(member);
        continue;
      }

      mergedMembers[mergedIndex] = mergeMythicPlusRunMember(mergedMembers[mergedIndex], member);
    }
  }

  return mergedMembers.length > 0 ? mergedMembers : undefined;
}

function getMythicPlusRunMemberCompletenessScore(
  members: MythicPlusRunMemberData[] | undefined,
): number {
  if (!members || members.length === 0) {
    return 0;
  }

  let score = 0;
  for (const member of members) {
    if (member.name) score += 1;
    if (member.realm) score += 1;
    if (member.classTag) score += 2;
    if (member.role) score += 2;
  }

  return score;
}

function getImprovedMythicPlusRunMembers(
  currentMembers: MythicPlusRunMemberData[] | undefined,
  candidateMembers: MythicPlusRunMemberData[] | undefined,
) {
  const mergedMembers = mergeMythicPlusRunMembers(currentMembers, candidateMembers);
  if (!mergedMembers || mergedMembers.length === 0) {
    return undefined;
  }

  const currentCount = currentMembers?.length ?? 0;
  if (mergedMembers.length > currentCount) {
    return mergedMembers;
  }

  return getMythicPlusRunMemberCompletenessScore(mergedMembers) >
    getMythicPlusRunMemberCompletenessScore(currentMembers)
    ? mergedMembers
    : undefined;
}

function normalizeSnapshotSpec(value: unknown): string {
  if (typeof value !== "string") {
    return "Unknown";
  }

  const normalized = value.trim();
  return normalized === "" ? "Unknown" : normalized;
}

function toOptionalMythicPlusTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return undefined;
    return value >= 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
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
  const timestampMs = Date.UTC(fullYear, month, day + 1, hour, minute, second);

  return Number.isFinite(timestampMs) ? Math.floor(timestampMs / 1000) : undefined;
}

function toFingerprintToken(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

function getRunMapFingerprintTokens(run: Partial<MythicPlusRunData>): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const pushToken = (value: string | undefined) => {
    if (!value || value === "" || seen.has(value)) return;
    seen.add(value);
    tokens.push(value);
  };

  if (run.mapChallengeModeID !== undefined) {
    pushToken(toFingerprintToken(run.mapChallengeModeID));
  }

  if (typeof run.mapName === "string") {
    const normalizedName = run.mapName.trim().toLowerCase();
    if (normalizedName !== "") pushToken(normalizedName);
  }

  return tokens;
}

function getRunMapFingerprintToken(run: Partial<MythicPlusRunData>): string {
  return getRunMapFingerprintTokens(run)[0] ?? "";
}

function normalizeAttemptId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
}

function normalizeCanonicalKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized === "") return undefined;
  if (!normalized.startsWith("aid|") && !normalized.startsWith("run|")) {
    return undefined;
  }
  return normalized;
}

function normalizeLifecycleTimestamp(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function buildRunAttemptIdFromStartDate(run: Partial<MythicPlusRunData>): string | undefined {
  const mapToken = getRunMapFingerprintToken(run);
  const startDate = run.startDate;
  if (
    mapToken === "" ||
    run.level === undefined ||
    startDate === undefined ||
    !Number.isFinite(startDate) ||
    startDate <= 0
  ) {
    return undefined;
  }

  return [
    "attempt",
    toFingerprintToken(run.seasonID),
    mapToken,
    toFingerprintToken(run.level),
    toFingerprintToken(Math.floor(startDate)),
  ].join("|");
}

function getRunAttemptId(run: Partial<MythicPlusRunData>): string | undefined {
  const explicitAttemptId = normalizeAttemptId(run.attemptId);
  if (explicitAttemptId) {
    return explicitAttemptId;
  }

  const fingerprintAttemptId = normalizeAttemptId(run.fingerprint);
  if (fingerprintAttemptId && isTemporaryAttemptFingerprint(fingerprintAttemptId)) {
    return fingerprintAttemptId;
  }

  return buildRunAttemptIdFromStartDate(run);
}

function getRunSeasonTokens(run: Partial<MythicPlusRunData>): string[] {
  const seasonToken = run.seasonID !== undefined ? toFingerprintToken(run.seasonID) : "";
  return seasonToken === "" ? [""] : [seasonToken, ""];
}

const MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS = 4 * 60 * 60 * 1000;
const LEGACY_DST_SHIFT_SECONDS = 60 * 60;

function getSanitizedRunDurationMs(run: Partial<MythicPlusRunData>): number | undefined {
  const durationMs = run.durationMs;
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined;
  }
  if (durationMs <= MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS) {
    return Math.floor(durationMs);
  }

  const runEndAt = run.completedAt ?? run.endedAt ?? run.abandonedAt;
  if (run.startDate !== undefined && runEndAt !== undefined && runEndAt >= run.startDate) {
    const derivedDurationMs = (runEndAt - run.startDate) * 1000;
    if (
      Number.isFinite(derivedDurationMs) &&
      derivedDurationMs > 0 &&
      derivedDurationMs <= MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS
    ) {
      return Math.floor(derivedDurationMs);
    }
  }

  return undefined;
}

function getRunDurationSeconds(run: Partial<MythicPlusRunData>): number | undefined {
  const durationMs = getSanitizedRunDurationMs(run);
  if (durationMs === undefined) return undefined;
  return Math.floor(durationMs / 1000 + 0.5);
}

function getRunDerivedStartTimestamp(run: Partial<MythicPlusRunData>): number | undefined {
  if (run.startDate !== undefined) return run.startDate;
  const durationSeconds = getRunDurationSeconds(run);
  const endAt = run.completedAt ?? run.endedAt ?? run.abandonedAt;
  if (durationSeconds !== undefined && endAt !== undefined) {
    return endAt - durationSeconds;
  }
  return undefined;
}

function getRunDerivedEndTimestamp(run: Partial<MythicPlusRunData>): number | undefined {
  if (run.completedAt !== undefined) return run.completedAt;
  if (run.endedAt !== undefined) return run.endedAt;
  if (run.abandonedAt !== undefined) return run.abandonedAt;
  const durationSeconds = getRunDurationSeconds(run);
  if (durationSeconds !== undefined && run.startDate !== undefined) {
    return run.startDate + durationSeconds;
  }
  return undefined;
}

function hasStrongCompletedRunIdentitySignature(run: Partial<MythicPlusRunData>): boolean {
  return (
    run.level !== undefined &&
    getRunMapFingerprintToken(run) !== "" &&
    getSanitizedRunDurationMs(run) !== undefined &&
    run.runScore !== undefined
  );
}

function shouldApplyLegacyHistoryDstForwardShift(run: Partial<MythicPlusRunData>): boolean {
  if (getRunAttemptId(run) !== undefined) {
    return false;
  }
  if (run.startDate !== undefined) {
    return false;
  }
  if (!hasStrongCompletedRunIdentitySignature(run)) {
    return false;
  }
  const primaryTimestamp = run.endedAt ?? run.abandonedAt ?? run.completedAt;
  if (primaryTimestamp === undefined) {
    return false;
  }
  if (run.observedAt !== undefined && Math.abs(run.observedAt - primaryTimestamp) <= 6 * 3600) {
    return false;
  }

  return true;
}

function getRunIdentityCandidates(run: Partial<MythicPlusRunData>): number[] {
  const candidates: number[] = [];
  const seen = new Set<number>();

  const pushCandidate = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return;
    const normalized = Math.floor(value);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  const derivedStart = getRunDerivedStartTimestamp(run);
  const derivedEnd = getRunDerivedEndTimestamp(run);
  pushCandidate(run.startDate);
  pushCandidate(run.completedAt);
  pushCandidate(run.endedAt);
  pushCandidate(run.abandonedAt);
  pushCandidate(derivedStart);
  pushCandidate(derivedEnd);
  const likelyPlayedAt = getLikelyPlayedAtTimestamp(run);
  pushCandidate(likelyPlayedAt);
  if (likelyPlayedAt > 0) {
    pushCandidate(Math.floor(likelyPlayedAt / 60) * 60);
  }

  if (run.startDate === undefined && hasStrongCompletedRunIdentitySignature(run)) {
    const shiftSources = [run.completedAt, run.endedAt, run.abandonedAt, derivedEnd];
    for (const source of shiftSources) {
      if (source === undefined || source === null) continue;
      pushCandidate(source - LEGACY_DST_SHIFT_SECONDS);
      pushCandidate(source + LEGACY_DST_SHIFT_SECONDS);
    }
  }

  return candidates;
}

function getLikelyPlayedAtTimestamp(run: Partial<MythicPlusRunData>): number {
  const primaryTimestamp = run.endedAt ?? run.abandonedAt ?? run.completedAt ?? run.startDate;
  if (primaryTimestamp === undefined) {
    return run.observedAt ?? 0;
  }

  const observedAt = run.observedAt;
  if (observedAt !== undefined) {
    const driftSeconds = observedAt - primaryTimestamp;
    const roundedHourDriftSeconds = Math.round(driftSeconds / 3600) * 3600;
    const looksLikeLegacyUtcDrift =
      roundedHourDriftSeconds >= 3600 &&
      roundedHourDriftSeconds <= 3 * 3600 &&
      Math.abs(driftSeconds - roundedHourDriftSeconds) <= 10 * 60;

    if (looksLikeLegacyUtcDrift) {
      return primaryTimestamp + roundedHourDriftSeconds;
    }
  }

  if (shouldApplyLegacyHistoryDstForwardShift(run)) {
    return primaryTimestamp + LEGACY_DST_SHIFT_SECONDS;
  }

  return primaryTimestamp;
}

function buildRunFingerprintWithIdentity(
  run: Partial<MythicPlusRunData>,
  identityTimestamp: number,
  options?: {
    seasonToken?: string;
    mapToken?: string;
  },
): string | undefined {
  const mapToken = options?.mapToken ?? getRunMapFingerprintToken(run);
  if (mapToken === "" || run.level === undefined) {
    return undefined;
  }

  const seasonToken = options?.seasonToken ?? toFingerprintToken(run.seasonID);
  return [
    seasonToken,
    mapToken,
    toFingerprintToken(run.level),
    toFingerprintToken(identityTimestamp),
  ].join("|");
}

function getRunCanonicalEventTimestamp(run: Partial<MythicPlusRunData>): number | undefined {
  const explicitTimestamps = [run.startDate, run.completedAt, run.endedAt, run.abandonedAt];
  for (const timestamp of explicitTimestamps) {
    const normalized = normalizeLifecycleTimestamp(timestamp);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  const derivedCandidates = [getRunDerivedStartTimestamp(run), getRunDerivedEndTimestamp(run)];
  for (const timestamp of derivedCandidates) {
    const normalized = normalizeLifecycleTimestamp(timestamp);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  return undefined;
}

function buildRunCanonicalKeyWithIdentityTimestamp(
  run: Partial<MythicPlusRunData>,
  identityTimestamp: number,
): string | undefined {
  const mapToken = getRunMapFingerprintToken(run);
  if (mapToken === "" || run.level === undefined) {
    return undefined;
  }

  return [
    "run",
    toFingerprintToken(run.seasonID),
    mapToken,
    toFingerprintToken(run.level),
    toFingerprintToken(identityTimestamp),
  ].join("|");
}

function getMythicPlusRunCanonicalKey(run: Partial<MythicPlusRunData>): string | undefined {
  const explicitCanonicalKey = normalizeCanonicalKey(run.canonicalKey);
  if (explicitCanonicalKey !== undefined) {
    return explicitCanonicalKey;
  }

  const attemptId = getRunAttemptId(run);
  if (attemptId) {
    return `aid|${attemptId}`;
  }

  const identityTimestamp = getRunCanonicalEventTimestamp(run);
  if (identityTimestamp === undefined) {
    return undefined;
  }

  return buildRunCanonicalKeyWithIdentityTimestamp(run, identityTimestamp);
}

function buildCanonicalMythicPlusRunFingerprint(
  run: Partial<MythicPlusRunData>,
): string | undefined {
  return getMythicPlusRunCanonicalKey(run);
}

function buildRunFingerprint(run: Partial<MythicPlusRunData>): string {
  return [
    toFingerprintToken(getRunAttemptId(run)),
    toFingerprintToken(run.seasonID),
    toFingerprintToken(run.mapChallengeModeID),
    toFingerprintToken(run.level),
    toFingerprintToken(run.status),
    toFingerprintToken(run.completed),
    toFingerprintToken(run.completedInTime),
    toFingerprintToken(run.durationMs),
    toFingerprintToken(run.runScore),
    toFingerprintToken(run.endedAt),
    toFingerprintToken(run.abandonedAt),
    toFingerprintToken(run.abandonReason),
    toFingerprintToken(run.completedAt),
    toFingerprintToken(run.startDate),
  ].join("|");
}

function getRunLegacyFingerprintAliasesForTimestamp(
  run: Partial<MythicPlusRunData>,
  identityTimestamp: number,
): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  const mapTokens = getRunMapFingerprintTokens(run);
  const seasonTokens = getRunSeasonTokens(run);
  const pushAlias = (value: string | undefined) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    aliases.push(value);
  };

  pushAlias(buildRunFingerprintWithIdentity(run, identityTimestamp));
  for (const mapToken of mapTokens) {
    for (const seasonToken of seasonTokens) {
      pushAlias(buildRunFingerprintWithIdentity(run, identityTimestamp, { seasonToken, mapToken }));
    }
  }

  return aliases;
}

function getRunLegacyDstShiftCompatibilityTimestamps(run: Partial<MythicPlusRunData>): number[] {
  if (run.startDate !== undefined || !hasStrongCompletedRunIdentitySignature(run)) {
    return [];
  }

  const derivedEnd = getRunDerivedEndTimestamp(run);
  const shiftSources = [run.completedAt, run.endedAt, run.abandonedAt, derivedEnd];
  const shiftedTimestamps: number[] = [];
  const seen = new Set<number>();
  for (const source of shiftSources) {
    const normalizedSource = normalizeLifecycleTimestamp(source);
    if (normalizedSource === undefined) {
      continue;
    }
    for (const shiftedTimestamp of [
      normalizedSource - LEGACY_DST_SHIFT_SECONDS,
      normalizedSource + LEGACY_DST_SHIFT_SECONDS,
    ]) {
      const normalizedShifted = normalizeLifecycleTimestamp(shiftedTimestamp);
      if (normalizedShifted === undefined || seen.has(normalizedShifted)) {
        continue;
      }
      seen.add(normalizedShifted);
      shiftedTimestamps.push(normalizedShifted);
    }
  }

  return shiftedTimestamps;
}

function getMythicPlusRunCompatibilityLookupAliases(run: Partial<MythicPlusRunData>): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  const pushAlias = (value: string | undefined) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    aliases.push(value);
  };

  for (const timestamp of getRunIdentityCandidates(run)) {
    for (const alias of getRunLegacyFingerprintAliasesForTimestamp(run, timestamp)) {
      pushAlias(alias);
    }
  }

  for (const timestamp of getRunLegacyDstShiftCompatibilityTimestamps(run)) {
    for (const alias of getRunLegacyFingerprintAliasesForTimestamp(run, timestamp)) {
      pushAlias(alias);
    }
  }

  pushAlias(run.fingerprint);
  return aliases;
}

function getMythicPlusRunDedupKeys(run: Partial<MythicPlusRunData>): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const pushKey = (value: string | undefined) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    keys.push(value);
  };

  const attemptId = getRunAttemptId(run);
  if (attemptId !== undefined) {
    pushKey(attemptId);
  }

  pushKey(getMythicPlusRunCanonicalKey(run));
  for (const alias of getMythicPlusRunCompatibilityLookupAliases(run)) {
    pushKey(alias);
  }
  return keys;
}

function getMythicPlusRunDedupKey(run: Partial<MythicPlusRunData>): string {
  return (
    getMythicPlusRunCanonicalKey(run) ??
    getMythicPlusRunDedupKeys(run)[0] ??
    buildRunFingerprint(run)
  );
}

function getRunStrictEventTimestamps(run: Partial<MythicPlusRunData>): number[] {
  const timestamps: number[] = [];
  const seen = new Set<number>();
  const pushTimestamp = (value: number | null | undefined) => {
    const normalized = normalizeLifecycleTimestamp(value);
    if (normalized === undefined || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    timestamps.push(normalized);
  };

  pushTimestamp(run.startDate);
  pushTimestamp(run.completedAt);
  pushTimestamp(run.endedAt);
  pushTimestamp(run.abandonedAt);

  if (run.startDate === undefined) {
    pushTimestamp(getRunDerivedStartTimestamp(run));
  }
  if (run.completedAt === undefined && run.endedAt === undefined && run.abandonedAt === undefined) {
    pushTimestamp(getRunDerivedEndTimestamp(run));
  }

  return timestamps;
}

function areRunCoreIdentityFieldsCompatible(
  leftRun: Partial<MythicPlusRunData>,
  rightRun: Partial<MythicPlusRunData>,
): boolean {
  const leftMapToken = getRunMapFingerprintToken(leftRun);
  const rightMapToken = getRunMapFingerprintToken(rightRun);
  if (leftMapToken === "" || rightMapToken === "" || leftMapToken !== rightMapToken) {
    return false;
  }

  if (
    leftRun.level === undefined ||
    rightRun.level === undefined ||
    leftRun.level !== rightRun.level
  ) {
    return false;
  }

  const leftSeasonToken = toFingerprintToken(leftRun.seasonID);
  const rightSeasonToken = toFingerprintToken(rightRun.seasonID);
  if (leftSeasonToken !== "" && rightSeasonToken !== "" && leftSeasonToken !== rightSeasonToken) {
    return false;
  }

  return true;
}

function hasSharedStrictCompatibilityTimestamp(
  leftRun: Partial<MythicPlusRunData>,
  rightRun: Partial<MythicPlusRunData>,
): boolean {
  const leftTimestamps = new Set(getRunStrictEventTimestamps(leftRun));
  for (const timestamp of getRunStrictEventTimestamps(rightRun)) {
    if (leftTimestamps.has(timestamp)) {
      return true;
    }
  }
  return false;
}

function hasCompatibleLegacyDstShift(
  leftRun: Partial<MythicPlusRunData>,
  rightRun: Partial<MythicPlusRunData>,
): boolean {
  if (
    !hasStrongCompletedRunIdentitySignature(leftRun) ||
    !hasStrongCompletedRunIdentitySignature(rightRun)
  ) {
    return false;
  }

  const leftTimestamps = getRunStrictEventTimestamps(leftRun);
  const rightTimestamps = getRunStrictEventTimestamps(rightRun);
  if (leftTimestamps.length === 0 || rightTimestamps.length === 0) {
    return false;
  }

  const leftDuration = getSanitizedRunDurationMs(leftRun);
  const rightDuration = getSanitizedRunDurationMs(rightRun);
  if (leftDuration !== undefined && rightDuration !== undefined && leftDuration !== rightDuration) {
    return false;
  }

  if (
    leftRun.runScore !== undefined &&
    rightRun.runScore !== undefined &&
    leftRun.runScore !== rightRun.runScore
  ) {
    return false;
  }

  for (const leftTimestamp of leftTimestamps) {
    for (const rightTimestamp of rightTimestamps) {
      if (Math.abs(leftTimestamp - rightTimestamp) === LEGACY_DST_SHIFT_SECONDS) {
        return true;
      }
    }
  }

  return false;
}

function canUseMythicPlusRunCompatibilityAliasMatch(
  existingRun: Partial<MythicPlusRunData>,
  candidateRun: Partial<MythicPlusRunData>,
): boolean {
  const existingAttemptId = getRunAttemptId(existingRun);
  const candidateAttemptId = getRunAttemptId(candidateRun);
  if (existingAttemptId !== undefined && candidateAttemptId !== undefined) {
    return existingAttemptId === candidateAttemptId;
  }

  if (!areRunCoreIdentityFieldsCompatible(existingRun, candidateRun)) {
    return false;
  }

  if (hasSharedStrictCompatibilityTimestamp(existingRun, candidateRun)) {
    return true;
  }

  return hasCompatibleLegacyDstShift(existingRun, candidateRun);
}

type MythicPlusRunLookups = {
  byAttemptId: Map<string, MythicPlusRunData>;
  byCanonicalKey: Map<string, MythicPlusRunData>;
  byCompatibilityAlias: Map<string, MythicPlusRunData>;
};

function createMythicPlusRunLookups(): MythicPlusRunLookups {
  return {
    byAttemptId: new Map<string, MythicPlusRunData>(),
    byCanonicalKey: new Map<string, MythicPlusRunData>(),
    byCompatibilityAlias: new Map<string, MythicPlusRunData>(),
  };
}

function setPreferredRunLookup(
  map: Map<string, MythicPlusRunData>,
  key: string | undefined,
  run: MythicPlusRunData,
) {
  if (!key) {
    return;
  }

  const current = map.get(key);
  if (shouldReplaceMythicPlusRun(current, run)) {
    map.set(key, run);
  }
}

function registerMythicPlusRunLookups(
  lookups: MythicPlusRunLookups,
  run: MythicPlusRunData,
  aliases: Array<string | undefined> = [],
) {
  setPreferredRunLookup(lookups.byAttemptId, getRunAttemptId(run), run);
  setPreferredRunLookup(lookups.byCanonicalKey, getMythicPlusRunCanonicalKey(run), run);

  const compatibilityAliases = new Set<string>();
  for (const alias of getMythicPlusRunCompatibilityLookupAliases(run)) {
    compatibilityAliases.add(alias);
  }
  for (const alias of aliases) {
    if (alias) {
      compatibilityAliases.add(alias);
    }
  }

  for (const compatibilityAlias of compatibilityAliases) {
    setPreferredRunLookup(lookups.byCompatibilityAlias, compatibilityAlias, run);
  }
}

function findMatchingMythicPlusRunByIdentity(
  lookups: MythicPlusRunLookups,
  run: MythicPlusRunData,
): MythicPlusRunData | undefined {
  const attemptId = getRunAttemptId(run);
  if (attemptId) {
    const attemptMatch = lookups.byAttemptId.get(attemptId);
    if (attemptMatch) {
      return attemptMatch;
    }
  }

  const canonicalKey = getMythicPlusRunCanonicalKey(run);
  if (canonicalKey) {
    const canonicalMatch = lookups.byCanonicalKey.get(canonicalKey);
    if (canonicalMatch) {
      return canonicalMatch;
    }
  }

  for (const compatibilityAlias of getMythicPlusRunCompatibilityLookupAliases(run)) {
    const candidate = lookups.byCompatibilityAlias.get(compatibilityAlias);
    if (!candidate) {
      continue;
    }
    if (!canUseMythicPlusRunCompatibilityAliasMatch(candidate, run)) {
      continue;
    }
    const candidateCanonicalKey = getMythicPlusRunCanonicalKey(candidate);
    if (canonicalKey && candidateCanonicalKey && canonicalKey !== candidateCanonicalKey) {
      continue;
    }
    return candidate;
  }

  return undefined;
}

function getMythicPlusRunCompletionEstimate(run: Partial<MythicPlusRunData>): number | undefined {
  const durationMs = getSanitizedRunDurationMs(run);
  return (
    run.endedAt ??
    run.abandonedAt ??
    run.completedAt ??
    (run.startDate !== undefined && durationMs !== undefined
      ? run.startDate + Math.floor(durationMs / 1000 + 0.5)
      : undefined)
  );
}

function getMythicPlusRunSortValue(run: Partial<MythicPlusRunData>): number {
  return getLikelyPlayedAtTimestamp(run);
}

function mergeLifecycleTimestamp(
  preferredValue: number | undefined,
  fallbackValue: number | undefined,
): number | undefined {
  if (preferredValue === undefined) {
    return fallbackValue;
  }
  if (fallbackValue === undefined) {
    return preferredValue;
  }

  const preferredTimestamp = Math.floor(preferredValue);
  const fallbackTimestamp = Math.floor(fallbackValue);
  if (preferredTimestamp === fallbackTimestamp) {
    return preferredTimestamp;
  }

  if (Math.abs(preferredTimestamp - fallbackTimestamp) === LEGACY_DST_SHIFT_SECONDS) {
    return Math.max(preferredTimestamp, fallbackTimestamp);
  }

  return preferredValue;
}

function getMythicPlusRunCompletenessScore(run: Partial<MythicPlusRunData>): number {
  let score = 0;
  const status = getMythicPlusRunStatus(run);
  const durationMs = getSanitizedRunDurationMs(run);

  if (run.seasonID !== undefined) score += 1;
  if (run.mapChallengeModeID !== undefined) score += 3;
  if (typeof run.mapName === "string" && run.mapName.trim() !== "") score += 1;
  if (run.level !== undefined) score += 2;
  if (getRunAttemptId(run) !== undefined) score += 4;
  if (getMythicPlusRunCanonicalKey(run) !== undefined) score += 4;
  if (status === "active") score += 2;
  if (status === "abandoned") score += 3;
  if (status === "completed") score += 4;
  if (run.startDate !== undefined) score += 4;
  if (run.completedAt !== undefined) score += 4;
  if (run.endedAt !== undefined) score += 3;
  if (run.abandonedAt !== undefined) score += 2;
  if (run.abandonReason !== undefined) score += 1;
  if (durationMs !== undefined) score += 3;
  if (run.runScore !== undefined) score += 3;
  if (run.completedInTime !== undefined) score += 2;
  if (run.completed !== undefined) score += 1;
  if (run.thisWeek !== undefined) score += 1;
  if ((run.members?.length ?? 0) > 0) score += 3;

  return score;
}

function shouldReplaceMythicPlusRun(
  currentRun: MythicPlusRunData | undefined,
  candidateRun: MythicPlusRunData,
): boolean {
  if (!currentRun) {
    return true;
  }

  const currentStatus = getMythicPlusRunStatus(currentRun);
  const candidateStatus = getMythicPlusRunStatus(candidateRun);
  const currentStatusPriority = getMythicPlusRunStatusPriority(currentStatus);
  const candidateStatusPriority = getMythicPlusRunStatusPriority(candidateStatus);
  if (candidateStatusPriority !== currentStatusPriority) {
    return candidateStatusPriority > currentStatusPriority;
  }

  const currentCanonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(currentRun);
  const candidateCanonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(candidateRun);
  if (
    currentCanonicalFingerprint &&
    candidateCanonicalFingerprint &&
    currentCanonicalFingerprint === candidateCanonicalFingerprint
  ) {
    const currentIsTemporary = isTemporaryAttemptFingerprint(currentRun.fingerprint);
    const candidateIsTemporary = isTemporaryAttemptFingerprint(candidateRun.fingerprint);
    if (currentIsTemporary !== candidateIsTemporary) {
      return !candidateIsTemporary;
    }
  }

  const currentScore = getMythicPlusRunCompletenessScore(currentRun);
  const candidateScore = getMythicPlusRunCompletenessScore(candidateRun);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  const currentSortValue = getMythicPlusRunSortValue(currentRun);
  const candidateSortValue = getMythicPlusRunSortValue(candidateRun);
  if (candidateSortValue !== currentSortValue) {
    return candidateSortValue > currentSortValue;
  }

  return (candidateRun.observedAt ?? 0) > (currentRun.observedAt ?? 0);
}

function mergeMythicPlusRunData(
  currentRun: MythicPlusRunData | undefined,
  candidateRun: MythicPlusRunData,
): MythicPlusRunData {
  if (!currentRun) {
    const mergedRun = {
      ...candidateRun,
      attemptId: getRunAttemptId(candidateRun),
      canonicalKey: getMythicPlusRunCanonicalKey(candidateRun),
      fingerprint: candidateRun.fingerprint,
    };
    mergedRun.canonicalKey = getMythicPlusRunCanonicalKey(mergedRun);
    mergedRun.fingerprint =
      buildCanonicalMythicPlusRunFingerprint(mergedRun) ??
      mergedRun.canonicalKey ??
      candidateRun.fingerprint;
    const status = getMythicPlusRunStatus(mergedRun);
    if (status !== undefined) {
      mergedRun.status = status;
      if (status === "completed") {
        mergedRun.completed = true;
        mergedRun.endedAt = mergedRun.endedAt ?? mergedRun.completedAt;
      } else if (status === "abandoned") {
        mergedRun.endedAt = mergedRun.endedAt ?? mergedRun.abandonedAt;
        mergedRun.abandonedAt = mergedRun.abandonedAt ?? mergedRun.endedAt;
      }
    }
    return mergedRun;
  }

  const candidatePreferred = shouldReplaceMythicPlusRun(currentRun, candidateRun);
  const preferredRun = candidatePreferred ? candidateRun : currentRun;
  const fallbackRun = candidatePreferred ? currentRun : candidateRun;

  const preferredObservedAt = preferredRun.observedAt ?? 0;
  const fallbackObservedAt = fallbackRun.observedAt ?? 0;
  const mergedObservedAt =
    preferredObservedAt > 0 && fallbackObservedAt > 0
      ? Math.min(preferredObservedAt, fallbackObservedAt)
      : preferredObservedAt > 0
        ? preferredObservedAt
        : fallbackObservedAt;

  const mergedRun: MythicPlusRunData = {
    fingerprint:
      buildCanonicalMythicPlusRunFingerprint(preferredRun) ??
      getMythicPlusRunCanonicalKey(preferredRun) ??
      buildCanonicalMythicPlusRunFingerprint(fallbackRun) ??
      getMythicPlusRunCanonicalKey(fallbackRun) ??
      preferredRun.fingerprint ??
      fallbackRun.fingerprint,
    attemptId: getRunAttemptId(preferredRun) ?? getRunAttemptId(fallbackRun),
    canonicalKey:
      getMythicPlusRunCanonicalKey(preferredRun) ?? getMythicPlusRunCanonicalKey(fallbackRun),
    observedAt: mergedObservedAt,
    seasonID: preferredRun.seasonID ?? fallbackRun.seasonID,
    mapChallengeModeID: preferredRun.mapChallengeModeID ?? fallbackRun.mapChallengeModeID,
    mapName: preferredRun.mapName ?? fallbackRun.mapName,
    level: preferredRun.level ?? fallbackRun.level,
    status: preferredRun.status ?? fallbackRun.status,
    completed: preferredRun.completed ?? fallbackRun.completed,
    completedInTime: preferredRun.completedInTime ?? fallbackRun.completedInTime,
    durationMs: preferredRun.durationMs ?? fallbackRun.durationMs,
    runScore: preferredRun.runScore ?? fallbackRun.runScore,
    startDate: mergeLifecycleTimestamp(preferredRun.startDate, fallbackRun.startDate),
    completedAt: mergeLifecycleTimestamp(preferredRun.completedAt, fallbackRun.completedAt),
    endedAt: mergeLifecycleTimestamp(preferredRun.endedAt, fallbackRun.endedAt),
    abandonedAt: mergeLifecycleTimestamp(preferredRun.abandonedAt, fallbackRun.abandonedAt),
    abandonReason: preferredRun.abandonReason ?? fallbackRun.abandonReason,
    thisWeek: preferredRun.thisWeek ?? fallbackRun.thisWeek,
    members: mergeMythicPlusRunMembers(currentRun.members, candidateRun.members),
  };

  const mergedStatus = getMythicPlusRunStatus(mergedRun);
  if (mergedStatus !== undefined) {
    mergedRun.status = mergedStatus;
    if (mergedStatus === "completed") {
      mergedRun.completed = true;
      mergedRun.endedAt = mergedRun.endedAt ?? mergedRun.completedAt;
    } else if (mergedStatus === "abandoned") {
      mergedRun.endedAt = mergedRun.endedAt ?? mergedRun.abandonedAt;
      mergedRun.abandonedAt = mergedRun.abandonedAt ?? mergedRun.endedAt;
    }
  }

  const canonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(mergedRun);
  if (canonicalFingerprint) {
    mergedRun.fingerprint = canonicalFingerprint;
  }
  mergedRun.attemptId = getRunAttemptId(mergedRun);
  mergedRun.canonicalKey = getMythicPlusRunCanonicalKey(mergedRun);
  return mergedRun;
}

function normalizeStoredMythicPlusRun(runRaw: LuaTable): MythicPlusRunData {
  const legacyRaw = isRecord(runRaw.raw) ? runRaw.raw : null;
  const startDate =
    toOptionalMythicPlusTimestamp(runRaw.startDate) ??
    toOptionalMythicPlusTimestamp(runRaw.startedAt);
  const completedAt =
    toOptionalMythicPlusTimestamp(runRaw.completedAt) ??
    toOptionalMythicPlusTimestamp(runRaw.completionDate) ??
    toOptionalMythicPlusTimestamp(runRaw.completedDate) ??
    toOptionalMythicPlusTimestamp(runRaw.endTime);
  const endedAt =
    toOptionalMythicPlusTimestamp(runRaw.endedAt) ??
    toOptionalMythicPlusTimestamp(runRaw.abandonedAt);
  const abandonedAt =
    toOptionalMythicPlusTimestamp(runRaw.abandonedAt) ??
    toOptionalMythicPlusTimestamp(runRaw.endedAt);

  const readDurationCandidateMs = (...values: unknown[]) => {
    for (const value of values) {
      const numericValue = toOptionalNumber(value);
      if (numericValue !== undefined && numericValue > 0) {
        return Math.round(numericValue);
      }
    }
    return undefined;
  };
  const readDurationCandidateSeconds = (...values: unknown[]) => {
    for (const value of values) {
      const numericValue = toOptionalNumber(value);
      if (numericValue !== undefined && numericValue > 0) {
        return Math.round(numericValue * 1000);
      }
    }
    return undefined;
  };
  const durationMsCandidate =
    readDurationCandidateMs(
      runRaw.durationMs,
      runRaw.completionMilliseconds,
      runRaw.mapChallengeModeDuration,
      runRaw.runDurationMs,
      legacyRaw?.durationMs,
      legacyRaw?.completionMilliseconds,
      legacyRaw?.mapChallengeModeDuration,
      legacyRaw?.runDurationMs,
    ) ??
    readDurationCandidateSeconds(
      runRaw.durationSec,
      runRaw.durationSeconds,
      runRaw.time,
      runRaw.runDuration,
      legacyRaw?.durationSec,
      legacyRaw?.durationSeconds,
      legacyRaw?.time,
      legacyRaw?.runDuration,
    );

  const run: MythicPlusRunData = {
    fingerprint: "",
    attemptId:
      normalizeAttemptId(runRaw.attemptId) ??
      normalizeAttemptId(runRaw.attemptID) ??
      (legacyRaw ? normalizeAttemptId(legacyRaw.attemptId ?? legacyRaw.attemptID) : undefined) ??
      undefined,
    canonicalKey:
      normalizeCanonicalKey(runRaw.canonicalKey) ??
      normalizeCanonicalKey(runRaw.runCanonicalKey) ??
      (legacyRaw
        ? normalizeCanonicalKey(legacyRaw.canonicalKey ?? legacyRaw.runCanonicalKey)
        : undefined) ??
      undefined,
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
      (legacyRaw
        ? toOptionalNumber(
            legacyRaw.mapChallengeModeID ?? legacyRaw.challengeModeID ?? legacyRaw.mapID,
          )
        : undefined),
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
    status: (() => {
      const statusValue = toOptionalString(runRaw.status);
      if (statusValue === "active" || statusValue === "completed" || statusValue === "abandoned") {
        return statusValue;
      }
      return undefined;
    })(),
    completed:
      toOptionalBoolean(runRaw.completed) ??
      toOptionalBoolean(runRaw.finishedSuccess) ??
      toOptionalBoolean(runRaw.isCompleted),
    completedInTime:
      toOptionalBoolean(runRaw.completedInTime) ??
      toOptionalBoolean(runRaw.intime) ??
      toOptionalBoolean(runRaw.onTime),
    durationMs: undefined,
    runScore:
      toOptionalNumber(runRaw.runScore) ??
      toOptionalNumber(runRaw.score) ??
      toOptionalNumber(runRaw.mythicRating),
    startDate,
    completedAt,
    endedAt,
    abandonedAt,
    abandonReason: (() => {
      const reasonValue = toOptionalString(runRaw.abandonReason);
      if (
        reasonValue === "challenge_mode_reset" ||
        reasonValue === "left_instance" ||
        reasonValue === "leaver_timer" ||
        reasonValue === "history_incomplete" ||
        reasonValue === "stale_recovery" ||
        reasonValue === "unknown"
      ) {
        return reasonValue;
      }
      return undefined;
    })(),
    thisWeek: toOptionalBoolean(runRaw.thisWeek) ?? toOptionalBoolean(runRaw.isThisWeek),
    members:
      normalizeMythicPlusRunMembers(
        runRaw.members ?? runRaw.partyMembers ?? runRaw.groupMembers ?? runRaw.roster,
      ) ??
      (legacyRaw
        ? normalizeMythicPlusRunMembers(
            legacyRaw.members ??
              legacyRaw.partyMembers ??
              legacyRaw.groupMembers ??
              legacyRaw.roster,
          )
        : undefined),
  };

  run.durationMs = getSanitizedRunDurationMs({
    ...run,
    durationMs: durationMsCandidate,
  });

  if (
    run.completed !== true &&
    (run.durationMs !== undefined || run.runScore !== undefined || run.completedAt !== undefined)
  ) {
    run.completed = true;
  }

  const derivedStatus = getMythicPlusRunStatus(run);
  if (derivedStatus !== undefined) {
    run.status = derivedStatus;
    if (derivedStatus === "completed") {
      run.completed = true;
      run.endedAt = run.endedAt ?? run.completedAt;
    } else if (derivedStatus === "abandoned") {
      run.endedAt = run.endedAt ?? run.abandonedAt;
      run.abandonedAt = run.abandonedAt ?? run.endedAt;
    }
  }

  run.fingerprint =
    (toOptionalString(runRaw.fingerprint) &&
    isTemporaryAttemptFingerprint(toOptionalString(runRaw.fingerprint))
      ? toOptionalString(runRaw.fingerprint)
      : undefined) ??
    buildCanonicalMythicPlusRunFingerprint(run) ??
    run.canonicalKey ??
    toOptionalString(runRaw.fingerprint) ??
    buildRunFingerprint(run);
  run.attemptId = getRunAttemptId(run);
  run.canonicalKey = getMythicPlusRunCanonicalKey(run);
  return run;
}

function reconcilePendingMembers(
  runs: MythicPlusRunData[],
  pending: Record<string, unknown>,
): boolean {
  const capturedAt = toOptionalNumber(pending.capturedAt);
  if (capturedAt === undefined) return false;
  const pendingMembersRaw = pending.members;
  if (!Array.isArray(pendingMembersRaw) || pendingMembersRaw.length === 0) return false;
  const pendingMembers = normalizeMythicPlusRunMembers(pendingMembersRaw);
  if (!pendingMembers || pendingMembers.length === 0) return false;

  const pendingMap = toOptionalNumber(pending.mapChallengeModeID);
  const pendingLevel = toOptionalNumber(pending.level);
  const pendingDurationMs = toOptionalNumber(pending.durationMs);
  const pendingCompletedInTime = toOptionalBoolean(pending.completedInTime);
  const pendingLatestRunFingerprint = toOptionalString(pending.latestKnownRunFingerprint);
  const pendingLatestRunSortValue = toOptionalNumber(pending.latestKnownRunSortValue);

  let bestIdx = -1;
  let bestDiff = Infinity;
  let bestMembers: MythicPlusRunMemberData[] | undefined;
  const MATCH_WINDOW = 5 * 60; // 5 minutes

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (pendingMap !== undefined && run.mapChallengeModeID !== pendingMap) {
      continue;
    }
    if (pendingLevel !== undefined && run.level !== pendingLevel) {
      continue;
    }

    const improvedMembers = getImprovedMythicPlusRunMembers(run.members, pendingMembers);
    if (!improvedMembers) {
      continue;
    }

    const runCompletedAt = getMythicPlusRunCompletionEstimate(run);
    if (runCompletedAt !== undefined) {
      const diff = Math.abs(runCompletedAt - capturedAt);
      if (diff <= MATCH_WINDOW && diff < bestDiff) {
        bestIdx = i;
        bestDiff = diff;
        bestMembers = improvedMembers;
      }
    }
  }

  if (bestIdx >= 0) {
    runs[bestIdx]!.members = bestMembers;
    return true;
  }

  const fallbackCandidates: Array<{
    index: number;
    durationDiff: number | undefined;
    completionDiff: number | undefined;
    outcomeMatches: boolean;
    mergedMembers: MythicPlusRunMemberData[];
    thisWeek: boolean;
  }> = [];

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (pendingMap !== undefined && run.mapChallengeModeID !== pendingMap) {
      continue;
    }
    if (pendingLevel !== undefined && run.level !== pendingLevel) {
      continue;
    }

    const improvedMembers = getImprovedMythicPlusRunMembers(run.members, pendingMembers);
    if (!improvedMembers) {
      continue;
    }

    let isAfterCapture = true;
    if (pendingLatestRunSortValue !== undefined || pendingLatestRunFingerprint) {
      isAfterCapture = false;
      const runSortValue = getMythicPlusRunSortValue(run);
      if (pendingLatestRunSortValue !== undefined && runSortValue > pendingLatestRunSortValue) {
        isAfterCapture = true;
      } else if (
        pendingLatestRunSortValue === undefined &&
        pendingLatestRunFingerprint &&
        run.fingerprint !== pendingLatestRunFingerprint
      ) {
        isAfterCapture = true;
      }
    }

    if (!isAfterCapture) {
      continue;
    }

    const durationDiff =
      pendingDurationMs !== undefined && run.durationMs !== undefined
        ? Math.abs(run.durationMs - pendingDurationMs)
        : undefined;
    const runCompletedAt = getMythicPlusRunCompletionEstimate(run);
    const completionDiff =
      runCompletedAt !== undefined ? Math.abs(runCompletedAt - capturedAt) : undefined;

    fallbackCandidates.push({
      index: i,
      durationDiff,
      completionDiff,
      outcomeMatches:
        pendingCompletedInTime === undefined ||
        run.completedInTime === undefined ||
        run.completedInTime === pendingCompletedInTime,
      mergedMembers: improvedMembers,
      thisWeek: run.thisWeek === true,
    });
  }

  const filteredFallbackCandidates =
    pendingDurationMs === undefined
      ? fallbackCandidates
      : fallbackCandidates.filter(
          (candidate) =>
            candidate.durationDiff === undefined || candidate.durationDiff <= 2 * 60 * 1000,
        );
  const rankedFallbackCandidates =
    filteredFallbackCandidates.length > 0 ? filteredFallbackCandidates : fallbackCandidates;

  rankedFallbackCandidates.sort((left, right) => {
    if (
      left.completionDiff !== undefined &&
      right.completionDiff !== undefined &&
      left.completionDiff !== right.completionDiff
    ) {
      return left.completionDiff - right.completionDiff;
    }
    if (left.completionDiff !== undefined && right.completionDiff === undefined) {
      return -1;
    }
    if (left.completionDiff === undefined && right.completionDiff !== undefined) {
      return 1;
    }

    if (
      left.durationDiff !== undefined &&
      right.durationDiff !== undefined &&
      left.durationDiff !== right.durationDiff
    ) {
      return left.durationDiff - right.durationDiff;
    }
    if (left.durationDiff !== undefined && right.durationDiff === undefined) {
      return -1;
    }
    if (left.durationDiff === undefined && right.durationDiff !== undefined) {
      return 1;
    }

    if (left.outcomeMatches !== right.outcomeMatches) {
      return left.outcomeMatches ? -1 : 1;
    }
    if (left.thisWeek !== right.thisWeek) {
      return left.thisWeek ? -1 : 1;
    }

    return left.index - right.index;
  });

  const bestCandidate = rankedFallbackCandidates[0];
  const secondCandidate = rankedFallbackCandidates[1];
  let fallbackUnique = rankedFallbackCandidates.length === 1;

  if (!fallbackUnique && bestCandidate) {
    const uniqueByCompletion =
      bestCandidate.completionDiff !== undefined &&
      bestCandidate.completionDiff <= 3 * 60 * 60 &&
      (secondCandidate?.completionDiff === undefined ||
        secondCandidate.completionDiff - bestCandidate.completionDiff > 15 * 60);
    const uniqueByDuration =
      bestCandidate.durationDiff !== undefined &&
      bestCandidate.durationDiff <= 2 * 60 * 1000 &&
      (secondCandidate?.durationDiff === undefined ||
        secondCandidate.durationDiff - bestCandidate.durationDiff > 60 * 1000);
    const uniqueByWeek =
      bestCandidate.thisWeek &&
      (secondCandidate === undefined || secondCandidate.thisWeek !== true);

    fallbackUnique = uniqueByCompletion || uniqueByDuration || uniqueByWeek;
  }

  if (fallbackUnique && bestCandidate) {
    runs[bestCandidate.index]!.members = bestCandidate.mergedMembers;
    return true;
  }

  return false;
}

function getCharacterMergeKey(character: Pick<CharacterData, "region" | "name" | "realm">): string {
  return [
    character.region.trim().toLowerCase(),
    character.name.trim().toLowerCase(),
    character.realm.trim().toLowerCase(),
  ].join("|");
}

function getMythicPlusRunSortTieBreaker(run: MythicPlusRunData): string {
  return getMythicPlusRunDedupKey(run);
}

function compareMythicPlusRunsForDisplay(leftRun: MythicPlusRunData, rightRun: MythicPlusRunData) {
  const timeDiff = getMythicPlusRunSortValue(rightRun) - getMythicPlusRunSortValue(leftRun);
  if (timeDiff !== 0) return timeDiff;

  const observedDiff = (rightRun.observedAt ?? 0) - (leftRun.observedAt ?? 0);
  if (observedDiff !== 0) return observedDiff;

  return getMythicPlusRunSortTieBreaker(rightRun).localeCompare(
    getMythicPlusRunSortTieBreaker(leftRun),
  );
}

function sortMythicPlusRunsInPlace(runs: MythicPlusRunData[]) {
  runs.sort(compareMythicPlusRunsForDisplay);
}

function buildMythicPlusRunLookups(runs: MythicPlusRunData[]): MythicPlusRunLookups {
  const lookups = createMythicPlusRunLookups();
  for (const run of runs) {
    registerMythicPlusRunLookups(lookups, run);
  }
  return lookups;
}

function upsertMythicPlusRunByIdentity(
  runs: MythicPlusRunData[],
  lookups: MythicPlusRunLookups,
  incomingRun: MythicPlusRunData,
) {
  const existingRun = findMatchingMythicPlusRunByIdentity(lookups, incomingRun);
  if (!existingRun) {
    runs.push(incomingRun);
    registerMythicPlusRunLookups(lookups, incomingRun);
    return;
  }

  const mergedRun = mergeMythicPlusRunData(existingRun, incomingRun);
  Object.assign(existingRun, mergedRun);
  registerMythicPlusRunLookups(lookups, existingRun, [
    incomingRun.fingerprint,
    mergedRun.fingerprint,
  ]);
}

function extractCharacters(db: Record<string, unknown>): CharacterData[] {
  const characters = (db.characters ?? {}) as Record<string, unknown>;
  const pendingMembersStore = isRecord(db.pendingMythicPlusMembers)
    ? db.pendingMythicPlusMembers
    : {};
  const result: CharacterData[] = [];
  const validRegions: Region[] = ["us", "eu", "kr", "tw"];

  for (const [charKey, charRaw] of Object.entries(characters)) {
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
      const ownedKeystoneRaw = isRecord(snap.ownedKeystone) ? snap.ownedKeystone : null;
      const ownedKeystoneLevel = ownedKeystoneRaw
        ? toOptionalNumber(ownedKeystoneRaw.level)
        : undefined;

      snapshots.push({
        takenAt: Number(snap.takenAt),
        level: Number(snap.level),
        spec: normalizeSnapshotSpec(snap.spec),
        role,
        itemLevel: Number(snap.itemLevel),
        gold: Number(snap.gold),
        playtimeSeconds: Number(snap.playtimeSeconds),
        playtimeThisLevelSeconds: toOptionalNumber(snap.playtimeThisLevelSeconds),
        mythicPlusScore: Number(snap.mythicPlusScore),
        seasonID: toOptionalNumber(snap.seasonID),
        ownedKeystone:
          ownedKeystoneLevel && ownedKeystoneLevel > 0
            ? {
                level: ownedKeystoneLevel,
                mapChallengeModeID: toOptionalNumber(ownedKeystoneRaw?.mapChallengeModeID),
                mapName: toOptionalString(ownedKeystoneRaw?.mapName),
              }
            : undefined,
        currencies: {
          adventurerDawncrest: Number(currencies.adventurerDawncrest ?? 0),
          veteranDawncrest: Number(currencies.veteranDawncrest ?? 0),
          championDawncrest: Number(currencies.championDawncrest ?? 0),
          heroDawncrest: Number(currencies.heroDawncrest ?? 0),
          mythDawncrest: Number(currencies.mythDawncrest ?? 0),
          radiantSparkDust: Number(currencies.radiantSparkDust ?? 0),
        },
        currencyDetails: normalizeCurrencyDetails(snap.currencyDetails),
        stats: {
          stamina: Number(stats.stamina ?? 0),
          strength: Number(stats.strength ?? 0),
          agility: Number(stats.agility ?? 0),
          intellect: Number(stats.intellect ?? 0),
          critRating: toOptionalNumber(stats.critRating),
          critPercent: Number(stats.critPercent ?? 0),
          hasteRating: toOptionalNumber(stats.hasteRating),
          hastePercent: Number(stats.hastePercent ?? 0),
          masteryRating: toOptionalNumber(stats.masteryRating),
          masteryPercent: Number(stats.masteryPercent ?? 0),
          versatilityRating: toOptionalNumber(stats.versatilityRating),
          versatilityPercent: Number(stats.versatilityPercent ?? 0),
          speedRating: toOptionalNumber(stats.speedRating),
          speedPercent: toOptionalNumber(stats.speedPercent),
          leechRating: toOptionalNumber(stats.leechRating),
          leechPercent: toOptionalNumber(stats.leechPercent),
          avoidanceRating: toOptionalNumber(stats.avoidanceRating),
          avoidancePercent: toOptionalNumber(stats.avoidancePercent),
        },
        equipment: normalizeSnapshotEquipment(snap.equipment),
        weeklyRewards: normalizeWeeklyRewards(snap.weeklyRewards),
        majorFactions: normalizeMajorFactions(snap.majorFactions),
        clientInfo: normalizeClientInfo(snap.clientInfo),
      });
    }

    const mythicPlusRuns: MythicPlusRunData[] = [];
    const mythicPlusRunLookups = createMythicPlusRunLookups();
    for (const runRaw of (char.mythicPlusRuns as unknown[]) ?? []) {
      if (!isRecord(runRaw)) continue;
      const run = normalizeStoredMythicPlusRun(runRaw);
      upsertMythicPlusRunByIdentity(mythicPlusRuns, mythicPlusRunLookups, run);
    }
    sortMythicPlusRunsInPlace(mythicPlusRuns);

    // Reconcile pending members from durable SavedVariables store
    const pendingPayload = pendingMembersStore[charKey];
    if (isRecord(pendingPayload)) {
      reconcilePendingMembers(mythicPlusRuns, pendingPayload);
    }

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

async function findAndParseAddonData(retailPath: string): Promise<{
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
      const key = getCharacterMergeKey(char);
      const existing = allChars.get(key);
      if (!existing) {
        allChars.set(key, char);
      } else {
        const snapshotsByTime = new Map(
          existing.snapshots.map((snapshot) => [snapshot.takenAt, snapshot]),
        );
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

        const existingRunLookups = buildMythicPlusRunLookups(existing.mythicPlusRuns);
        for (const run of char.mythicPlusRuns) {
          upsertMythicPlusRunByIdentity(existing.mythicPlusRuns, existingRunLookups, run);
        }
        sortMythicPlusRunsInPlace(existing.mythicPlusRuns);
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
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    handleBlockedRendererNavigation(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url)) {
      return;
    }
    event.preventDefault();
    handleBlockedRendererNavigation(url);
  });

  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (isTrustedRendererUrl(url)) {
      return;
    }
    event.preventDefault();
    handleBlockedRendererNavigation(url);
  });

  if (RENDERER_DEV_URL) {
    mainWindow.loadURL(RENDERER_DEV_URL);
  } else {
    mainWindow.loadFile(RENDERER_FILE_PATH);
  }

  mainWindow.once("ready-to-show", () => {
    mainWindowReady = true;

    if (!isQuitting && (process.platform !== "win32" || pendingWindowReveal)) {
      pendingWindowReveal = false;
      mainWindow?.setSkipTaskbar(false);
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  mainWindow.on("query-session-end", () => {
    prepareForQuit({ windowsSessionEnding: true });
  });

  mainWindow.on("session-end", () => {
    prepareForQuit({ windowsSessionEnding: true });
  });

  // Use the cached close behavior so event.preventDefault() is called synchronously.
  // Awaiting inside a close handler is too late — Electron processes the event before
  // the async callback resumes, so the window would be destroyed even with preventDefault.
  mainWindow.on("close", (event) => {
    if (isQuitting || isInstallingAppUpdate || isEndingWindowsSession) return;
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

        // Exchange the one-time code for the long-lived API bearer token.
        net
          .fetch(getApiAuthUrl("/auth/redeem-code"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          })
          .then(async (resp) => {
            if (!resp.ok) throw new Error(`Code exchange failed: ${resp.status}`);
            const data = (await resp.json()) as { token?: string; error?: string };
            if (!data.token) throw new Error(data.error ?? "No token in response");
            storedSessionToken = data.token;
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

// Auth
ipcMain.handle("auth:login", () => {
  return new Promise<boolean>((resolve, reject) => {
    const loginUrl = getElectronLoginUrl();
    let settled = false;

    const finalizeSuccess = (token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pendingLoginResolve = null;
      pendingLoginReject = null;
      if (token) {
        persistDesktopSessionToken(token);
      }
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      if (ELECTRON_TAURI_MIGRATION_BRIDGE) {
        void getSettings()
          .then((settings) => maybeStartTauriMigrationBridge(settings))
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            console.warn("[wow-dashboard] Tauri migration bridge login handoff failed:", message);
          });
      }
      resolve(true);
    };

    const finalizeError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pendingLoginResolve = null;
      pendingLoginReject = null;
      reject(error);
    };

    // Set up pending deep-link resolution with a 10-minute timeout.
    const timeout = setTimeout(
      () => {
        finalizeError(new Error("Login timed out"));
      },
      10 * 60 * 1000,
    );

    pendingLoginResolve = (token: string) => {
      finalizeSuccess(token);
    };
    pendingLoginReject = (err: Error) => {
      finalizeError(err);
    };

    // Open the login page in the browser. The browser initiates the OAuth flow so the
    // state cookie lands in the browser session (not Electron's), which means better-auth
    // can validate the callback and honour the callbackURL → /auth/electron-callback.
    void openUrlInExternalBrowser(loginUrl).catch((error: Error) => {
      finalizeError(error);
    });
  });
});

ipcMain.handle("auth:getSession", async () => {
  if (!storedSessionToken) {
    return {
      status: "unauthenticated",
    } satisfies DesktopAuthSessionState;
  }

  try {
    const resp = await session.defaultSession.fetch(getApiAuthUrl("/auth/get-session"), {
      headers: {
        Origin: SITE_URL,
        ...(storedSessionToken ? { Authorization: `Bearer ${storedSessionToken}` } : {}),
      },
    });
    if (!resp.ok) {
      if (resp.status === 401) {
        saveSessionToken(null);
        return {
          status: "unauthenticated",
        } satisfies DesktopAuthSessionState;
      }
      return {
        status: "unknown",
      } satisfies DesktopAuthSessionState;
    }
    return {
      status: "valid",
      session: await resp.json(),
    } satisfies DesktopAuthSessionState;
  } catch {
    return {
      status: "unknown",
    } satisfies DesktopAuthSessionState;
  }
});

ipcMain.handle("auth:logout", async () => {
  const sessionToken = storedSessionToken;
  storedSessionToken = null;
  saveSessionToken(null);
  try {
    await session.defaultSession.fetch(getApiAuthUrl("/auth/sign-out"), {
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

ipcMain.handle(
  "api:fetch",
  async (_, request: MainApiFetchRequest): Promise<MainApiFetchResponse> => {
    if (!request || typeof request.url !== "string" || !isTrustedApiUrl(request.url)) {
      throw new Error("Blocked untrusted API request");
    }

    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST" && method !== "PATCH") {
      throw new Error(`Blocked unsupported API method: ${method}`);
    }

    const response = await session.defaultSession.fetch(request.url, {
      method,
      headers: buildApiProxyHeaders(request.headers),
      ...(method !== "GET" && request.body !== undefined ? { body: request.body } : {}),
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(response.headers.entries()),
      body: await response.text(),
    };
  },
);

// WoW addon data
function getStoredRetailPath(settings: Record<string, unknown>): string | null {
  const retailPath = settings.retailPath;
  return typeof retailPath === "string" && retailPath.length > 0 ? retailPath : null;
}

function isRetailFolderPath(retailPath: string): boolean {
  const lastSegment =
    retailPath
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() ?? "";
  return lastSegment.toLowerCase() === "_retail_";
}

async function resolveRetailPathFromSettings(): Promise<{
  retailPath: string | null;
  validatedRetailPath: string | null;
  error: string | null;
  reason: "missing" | "invalid" | null;
}> {
  const settings = await getSettings();
  const retailPath = getStoredRetailPath(settings);
  if (!retailPath) {
    return {
      retailPath: null,
      validatedRetailPath: null,
      error: null,
      reason: "missing",
    };
  }

  if (!isRetailFolderPath(retailPath)) {
    return {
      retailPath,
      validatedRetailPath: null,
      error: "Configured WoW folder must point to the _retail_ directory.",
      reason: "invalid",
    };
  }

  return {
    retailPath,
    validatedRetailPath: retailPath,
    error: null,
    reason: null,
  };
}

async function getValidatedRetailPathFromSettings(): Promise<string | null> {
  const { validatedRetailPath } = await resolveRetailPathFromSettings();
  return validatedRetailPath;
}

function getAddonRetailPathStatus(
  reason: "missing" | "invalid" | null,
): "noRetailPath" | "invalidRetailPath" {
  return reason === "invalid" ? "invalidRetailPath" : "noRetailPath";
}

ipcMain.handle("wow:getRetailPath", async () => {
  const settings = await getSettings();
  return getStoredRetailPath(settings);
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
  if (!folder || !isRetailFolderPath(folder)) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Invalid WoW folder",
      message: "Please choose your World of Warcraft _retail_ folder.",
      detail: "The selected path must end with _retail_.",
    });
    return getStoredRetailPath(settings);
  }
  settings.retailPath = folder;
  await saveSettings(settings);
  void stageLatestAddonUpdate().catch((error) => {
    console.warn("[wow-dashboard] Failed to stage addon update after folder selection:", error);
  });
  return folder;
});

ipcMain.handle("wow:readAddonData", async () => {
  const retailPath = await getValidatedRetailPathFromSettings();
  if (!retailPath) return null;
  return findAndParseAddonData(retailPath);
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
  const retailPath = await getValidatedRetailPathFromSettings();
  if (!retailPath) return false;
  const watchPath = join(retailPath, "WTF", "Account");
  try {
    await fs.promises.access(watchPath, fs.constants.F_OK);
    addonWatcher = fs.watch(watchPath, { recursive: true }, (_event, filename) => {
      if (!filename?.endsWith("wow-dashboard.lua")) return;
      if (addonWatchDebounce) clearTimeout(addonWatchDebounce);
      addonWatchDebounce = setTimeout(() => {
        mainWindow?.webContents.send("wow:addonFileChanged");
      }, 2000);
    });
    return true;
  } catch (e) {
    console.warn("[wow-dashboard] Failed to watch addon file:", e);
    stopAddonWatcher();
    return false;
  }
});

ipcMain.handle("wow:unwatchAddonFile", () => {
  stopAddonWatcher();
});

// Addon installation
const GITHUB_REPO = "zirkumflex-group/wow-dashboard";

interface AddonReleaseInfo {
  url: string;
  checksumUrl: string;
  version: string;
}

interface StagedAddonUpdate {
  version: string;
  checksumUrl: string;
  downloadedAt: number;
}

interface ExposedAddonReleaseInfo {
  version: string;
}

function getAddonPath(retailPath: string): string {
  return join(retailPath, "Interface", "AddOns", "wow-dashboard");
}

function getAddonTocPath(retailPath: string): string {
  return join(getAddonPath(retailPath), "wow-dashboard.toc");
}

function getAddonUpdateStageDir(): string {
  return join(app.getPath("userData"), "addon-update");
}

function getStagedAddonZipPath(): string {
  return join(getAddonUpdateStageDir(), "wow-dashboard.zip");
}

function getStagedAddonChecksumPath(): string {
  return join(getAddonUpdateStageDir(), "wow-dashboard.zip.sha256");
}

function getStagedAddonMetaPath(): string {
  return join(getAddonUpdateStageDir(), "staged.json");
}

function isOutdatedVersion(installed: string, latest: string): boolean {
  const a = installed.split(".").map(Number);
  const b = latest.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai < bi) return true;
    if (ai > bi) return false;
  }
  return false;
}

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

async function isAddonInstalledForRetailPath(retailPath: string): Promise<boolean> {
  try {
    await fs.promises.access(getAddonPath(retailPath), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function getInstalledAddonVersionForRetailPath(retailPath: string): Promise<string | null> {
  try {
    const content = await fs.promises.readFile(getAddonTocPath(retailPath), "utf-8");
    const match = content.match(/^##\s*Version:\s*(.+)$/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function validateOfficialAddonReleaseUrl(url: string, tagName: string, assetName: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  const [repoOwner, repoName] = GITHUB_REPO.split("/");
  if (!repoOwner || !repoName) {
    throw new Error("Invalid GitHub repository configuration");
  }
  const pathSegments = parsedUrl.pathname.split("/").map((segment) => decodeURIComponent(segment));
  const expectedSegments = ["", repoOwner, repoName, "releases", "download", tagName, assetName];
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "github.com" ||
    pathSegments.length !== expectedSegments.length ||
    pathSegments.some((segment, index) => segment !== expectedSegments[index])
  ) {
    throw new Error(`Untrusted addon release asset URL: ${url}`);
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

async function verifyAddonPackage(zipPath: string, checksumPath: string): Promise<void> {
  const checksumContent = await fs.promises.readFile(checksumPath, "utf-8");
  const expectedHash = checksumContent.trim().split(/\s+/)[0] ?? "";
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
    throw new Error("Invalid addon checksum format");
  }
  const actualHash = await computeFileSha256(zipPath);
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(
      `Checksum mismatch - addon package may be corrupted or tampered with.\nExpected: ${expectedHash}\nGot: ${actualHash}`,
    );
  }
}

async function downloadAddonPackage(
  downloadUrl: string,
  checksumUrl: string,
  zipPath: string,
  checksumPath: string,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(zipPath), { recursive: true });
  await downloadFile(downloadUrl, zipPath);

  await downloadFile(checksumUrl, checksumPath);
  await verifyAddonPackage(zipPath, checksumPath);
}

async function installAddonFromPackage(retailPath: string, zipPath: string, checksumPath: string) {
  await verifyAddonPackage(zipPath, checksumPath);

  const extractDir = await fs.promises.mkdtemp(join(os.tmpdir(), "wow-dashboard-addon-extract-"));
  const addonsDir = join(retailPath, "Interface", "AddOns");
  const addonDest = join(addonsDir, "wow-dashboard");

  try {
    await extractZip(zipPath, extractDir);

    const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory());
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
    await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function fetchLatestAddonRelease(): Promise<AddonReleaseInfo> {
  const res = await net.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const releases = (await res.json()) as any[];
  const addonRelease = releases.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (release: any) =>
      typeof release.tag_name === "string" &&
      release.tag_name.startsWith("addon-v") &&
      !release.draft &&
      !release.prerelease,
  );
  if (!addonRelease) throw new Error("No addon release found on GitHub");
  const tagName = addonRelease.tag_name as string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asset = addonRelease.assets.find((asset: any) => asset.name === "wow-dashboard.zip");
  if (!asset) throw new Error("No wow-dashboard.zip asset found in latest addon release");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checksumAsset = addonRelease.assets.find(
    (asset: any) => asset.name === "wow-dashboard.zip.sha256",
  );
  if (!checksumAsset) {
    throw new Error("No wow-dashboard.zip.sha256 asset found in latest addon release");
  }
  const url = asset.browser_download_url as string;
  const checksumUrl = checksumAsset.browser_download_url as string;
  validateOfficialAddonReleaseUrl(url, tagName, "wow-dashboard.zip");
  validateOfficialAddonReleaseUrl(checksumUrl, tagName, "wow-dashboard.zip.sha256");
  return {
    url,
    checksumUrl,
    version: tagName.replace("addon-v", ""),
  };
}

function exposeAddonReleaseInfo(release: AddonReleaseInfo): ExposedAddonReleaseInfo {
  return {
    version: release.version,
  };
}

async function readStagedAddonUpdate(): Promise<StagedAddonUpdate | null> {
  try {
    const raw = await fs.promises.readFile(getStagedAddonMetaPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<StagedAddonUpdate>;
    if (typeof parsed.version !== "string") return null;
    if (typeof parsed.checksumUrl !== "string") return null;
    return {
      version: parsed.version,
      checksumUrl: parsed.checksumUrl,
      downloadedAt: typeof parsed.downloadedAt === "number" ? parsed.downloadedAt : 0,
    };
  } catch {
    return null;
  }
}

async function writeStagedAddonUpdate(update: StagedAddonUpdate): Promise<void> {
  await fs.promises.mkdir(getAddonUpdateStageDir(), { recursive: true });
  await fs.promises.writeFile(getStagedAddonMetaPath(), JSON.stringify(update, null, 2), "utf-8");
}

async function clearStagedAddonUpdate(): Promise<void> {
  await fs.promises.rm(getAddonUpdateStageDir(), { recursive: true, force: true }).catch(() => {});
}

async function stagedAddonPayloadExists(): Promise<boolean> {
  try {
    await fs.promises.access(getStagedAddonZipPath(), fs.constants.F_OK);
    await fs.promises.access(getStagedAddonChecksumPath(), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function downloadAndInstallAddonRelease(
  release: AddonReleaseInfo,
  retailPath: string,
): Promise<void> {
  const downloadDir = await fs.promises.mkdtemp(join(os.tmpdir(), "wow-dashboard-addon-download-"));
  const zipPath = join(downloadDir, "wow-dashboard.zip");
  const checksumPath = join(downloadDir, "wow-dashboard.zip.sha256");
  try {
    await downloadAddonPackage(release.url, release.checksumUrl, zipPath, checksumPath);
    await installAddonFromPackage(retailPath, zipPath, checksumPath);
  } finally {
    await fs.promises.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getUsableStagedAddonUpdate(): Promise<StagedAddonUpdate | null> {
  const staged = await readStagedAddonUpdate();
  if (!staged) return null;
  if (await stagedAddonPayloadExists()) {
    return staged;
  }
  await clearStagedAddonUpdate();
  updateAddonUpdateState({ stagedVersion: null });
  return null;
}

async function applyStagedAddonUpdateIfReady(): Promise<AddonApplyStagedResult> {
  if (applyingStagedAddonUpdate) {
    return {
      outcome: "notReady",
      error: null,
      stagedVersion: addonUpdateState.stagedVersion,
    };
  }
  applyingStagedAddonUpdate = true;
  try {
    const staged = await getUsableStagedAddonUpdate();
    if (!staged) {
      return {
        outcome: "notReady",
        error: null,
        stagedVersion: null,
      };
    }

    const {
      validatedRetailPath,
      error: retailPathError,
      reason,
    } = await resolveRetailPathFromSettings();
    if (!validatedRetailPath) {
      updateAddonUpdateState({
        status: getAddonRetailPathStatus(reason),
        stagedVersion: staged.version,
        error: retailPathError,
      });
      return {
        outcome: "notReady",
        error: null,
        stagedVersion: staged.version,
      };
    }

    const installedVersion = await getInstalledAddonVersionForRetailPath(validatedRetailPath);
    if (!installedVersion) {
      await clearStagedAddonUpdate();
      updateAddonUpdateState({
        status: "notInstalled",
        installedVersion: null,
        stagedVersion: null,
        error: null,
      });
      return {
        outcome: "notReady",
        error: null,
        stagedVersion: null,
      };
    }

    if (!isOutdatedVersion(installedVersion, staged.version)) {
      await clearStagedAddonUpdate();
      updateAddonUpdateState({
        status: "upToDate",
        installedVersion,
        latestVersion: staged.version,
        stagedVersion: null,
        error: null,
      });
      return {
        outcome: "notReady",
        error: null,
        stagedVersion: null,
      };
    }

    try {
      await installAddonFromPackage(
        validatedRetailPath,
        getStagedAddonZipPath(),
        getStagedAddonChecksumPath(),
      );
      await clearStagedAddonUpdate();
      broadcastToRenderers("wow:addonUpdateApplied", staged.version);
      updateAddonUpdateState({
        status: "applied",
        installedVersion: staged.version,
        latestVersion: staged.version,
        stagedVersion: null,
        error: null,
      });
      return {
        outcome: "applied",
        error: null,
        stagedVersion: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[wow-dashboard] Failed to apply staged addon update:", error);
      if (message.includes("Checksum mismatch")) {
        await clearStagedAddonUpdate();
      }
      const remainingStaged = await getUsableStagedAddonUpdate();
      updateAddonUpdateState({
        status: "error",
        installedVersion,
        latestVersion: staged.version,
        stagedVersion: remainingStaged?.version ?? null,
        error: message,
      });
      return {
        outcome: remainingStaged ? "retryableError" : "fatalError",
        error: message,
        stagedVersion: remainingStaged?.version ?? null,
      };
    }
  } finally {
    applyingStagedAddonUpdate = false;
  }
}

async function stageLatestAddonUpdate(): Promise<AddonUpdateCheckResult> {
  if (addonUpdateCheckInFlight) {
    return addonUpdateCheckInFlight;
  }

  const updateCheckPromise: Promise<AddonUpdateCheckResult> =
    (async (): Promise<AddonUpdateCheckResult> => {
      if (stagingAddonUpdate) {
        return {
          status: addonUpdateState.status === "applied" ? "applied" : "staged",
          installedVersion: addonUpdateState.installedVersion,
          latestVersion: addonUpdateState.latestVersion,
          stagedVersion: addonUpdateState.stagedVersion,
          error: addonUpdateState.error,
        } satisfies AddonUpdateCheckResult;
      }

      stagingAddonUpdate = true;
      const startedAt = Date.now();

      try {
        const stagedAtStart = await getUsableStagedAddonUpdate();
        updateAddonUpdateState({
          status: "checking",
          stagedVersion: stagedAtStart?.version ?? null,
          error: null,
          lastCheckedAt: startedAt,
        });

        const {
          validatedRetailPath,
          error: retailPathError,
          reason,
        } = await resolveRetailPathFromSettings();

        if (!validatedRetailPath) {
          const status = getAddonRetailPathStatus(reason);
          updateAddonUpdateState({
            status,
            installedVersion: null,
            error: retailPathError,
            lastCheckedAt: startedAt,
          });
          return {
            status,
            installedVersion: null,
            latestVersion: addonUpdateState.latestVersion,
            stagedVersion: stagedAtStart?.version ?? null,
            error: retailPathError,
          } satisfies AddonUpdateCheckResult;
        }

        const installedVersion = await getInstalledAddonVersionForRetailPath(validatedRetailPath);
        updateAddonUpdateState({
          installedVersion,
          error: null,
          lastCheckedAt: startedAt,
        });

        if (!installedVersion) {
          await clearStagedAddonUpdate();
          updateAddonUpdateState({
            status: "notInstalled",
            stagedVersion: null,
            latestVersion: null,
          });
          return {
            status: "notInstalled",
            installedVersion: null,
            latestVersion: null,
            stagedVersion: null,
            error: null,
          };
        }

        const latestRelease = await fetchLatestAddonRelease();
        updateAddonUpdateState({
          latestVersion: latestRelease.version,
          error: null,
          lastCheckedAt: startedAt,
        });

        if (!isOutdatedVersion(installedVersion, latestRelease.version)) {
          const staged = await getUsableStagedAddonUpdate();
          if (staged && !isOutdatedVersion(installedVersion, staged.version)) {
            await clearStagedAddonUpdate();
          }
          updateAddonUpdateState({
            status: "upToDate",
            installedVersion,
            latestVersion: latestRelease.version,
            stagedVersion: null,
            error: null,
          });
          return {
            status: "upToDate",
            installedVersion,
            latestVersion: latestRelease.version,
            stagedVersion: null,
            error: null,
          };
        }

        updateAddonUpdateState({
          status: "updating",
          installedVersion,
          latestVersion: latestRelease.version,
          error: null,
        });

        const staged = await getUsableStagedAddonUpdate();
        if (
          staged &&
          staged.version === latestRelease.version &&
          staged.checksumUrl === latestRelease.checksumUrl
        ) {
          updateAddonUpdateState({
            status: "staged",
            stagedVersion: staged.version,
            error: null,
          });
        } else {
          await downloadAddonPackage(
            latestRelease.url,
            latestRelease.checksumUrl,
            getStagedAddonZipPath(),
            getStagedAddonChecksumPath(),
          );
          await writeStagedAddonUpdate({
            version: latestRelease.version,
            checksumUrl: latestRelease.checksumUrl,
            downloadedAt: Date.now(),
          });
          broadcastToRenderers("wow:addonUpdateStaged", latestRelease.version);
          updateAddonUpdateState({
            status: "staged",
            stagedVersion: latestRelease.version,
            error: null,
          });
        }

        const applyResult = await applyStagedAddonUpdateIfReady();
        if (applyResult.outcome === "applied") {
          return {
            status: "applied",
            installedVersion: latestRelease.version,
            latestVersion: latestRelease.version,
            stagedVersion: null,
            error: null,
          };
        }

        if (applyResult.outcome === "retryableError" || applyResult.outcome === "fatalError") {
          const postInstallVersion =
            await getInstalledAddonVersionForRetailPath(validatedRetailPath);
          return {
            status: "error",
            installedVersion: postInstallVersion,
            latestVersion: latestRelease.version,
            stagedVersion: applyResult.stagedVersion,
            error: applyResult.error,
          };
        }

        const currentAddonUpdateState = getAddonUpdateStateSnapshot();
        if (
          currentAddonUpdateState.status === "noRetailPath" ||
          currentAddonUpdateState.status === "invalidRetailPath" ||
          currentAddonUpdateState.status === "notInstalled" ||
          currentAddonUpdateState.status === "upToDate"
        ) {
          return {
            status: currentAddonUpdateState.status,
            installedVersion: currentAddonUpdateState.installedVersion,
            latestVersion: currentAddonUpdateState.latestVersion ?? latestRelease.version,
            stagedVersion: currentAddonUpdateState.stagedVersion,
            error: currentAddonUpdateState.error,
          };
        }

        const remainingStaged = await getUsableStagedAddonUpdate();
        if (remainingStaged && currentAddonUpdateState.status !== "error") {
          updateAddonUpdateState({
            status: "staged",
            stagedVersion: remainingStaged.version,
            installedVersion,
            latestVersion: latestRelease.version,
            error: null,
          });
          return {
            status: "staged",
            installedVersion,
            latestVersion: latestRelease.version,
            stagedVersion: remainingStaged.version,
            error: null,
          };
        }

        const postInstallVersion = await getInstalledAddonVersionForRetailPath(validatedRetailPath);
        const errorMessage = addonUpdateState.error ?? "Addon update could not be applied.";
        updateAddonUpdateState({
          status: "error",
          installedVersion: postInstallVersion,
          latestVersion: latestRelease.version,
          stagedVersion: null,
          error: errorMessage,
        });
        return {
          status: "error",
          installedVersion: postInstallVersion,
          latestVersion: latestRelease.version,
          stagedVersion: null,
          error: errorMessage,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const staged = await getUsableStagedAddonUpdate();
        updateAddonUpdateState({
          status: "error",
          stagedVersion: staged?.version ?? null,
          error: message,
          lastCheckedAt: startedAt,
        });
        return {
          status: "error",
          installedVersion: addonUpdateState.installedVersion,
          latestVersion: addonUpdateState.latestVersion,
          stagedVersion: staged?.version ?? null,
          error: message,
        };
      } finally {
        stagingAddonUpdate = false;
      }
    })().finally(() => {
      addonUpdateCheckInFlight = null;
    });

  addonUpdateCheckInFlight = updateCheckPromise;
  return updateCheckPromise;
}

ipcMain.handle("wow:checkAddonInstalled", async () => {
  const retailPath = await getValidatedRetailPathFromSettings();
  if (!retailPath) return false;
  return isAddonInstalledForRetailPath(retailPath);
});

ipcMain.handle("wow:getInstalledAddonVersion", async () => {
  const retailPath = await getValidatedRetailPathFromSettings();
  if (!retailPath) return null;
  return getInstalledAddonVersionForRetailPath(retailPath);
});

ipcMain.handle("wow:installAddon", async () => {
  const { validatedRetailPath, error } = await resolveRetailPathFromSettings();
  if (!validatedRetailPath) {
    throw new Error(error ?? "WoW retail path is not configured");
  }

  const latestRelease = await fetchLatestAddonRelease();
  await downloadAndInstallAddonRelease(latestRelease, validatedRetailPath);
  await clearStagedAddonUpdate();
  updateAddonUpdateState({
    status: "applied",
    installedVersion: latestRelease.version,
    latestVersion: latestRelease.version,
    stagedVersion: null,
    error: null,
  });
  return exposeAddonReleaseInfo(latestRelease);
});

ipcMain.handle("wow:getLatestAddonRelease", async () =>
  exposeAddonReleaseInfo(await fetchLatestAddonRelease()),
);

ipcMain.handle("wow:getAddonUpdateStatus", async () => {
  const staged = await getUsableStagedAddonUpdate();
  updateAddonUpdateState({
    stagedVersion: staged?.version ?? null,
  });
  return {
    ...getAddonUpdateStateSnapshot(),
    stagedVersion: staged?.version ?? null,
  };
});

ipcMain.handle("wow:triggerAddonUpdateCheck", async () => {
  return stageLatestAddonUpdate();
});

function registerAppUpdaterListeners(): void {
  if (appUpdaterListenersRegistered) return;
  appUpdaterListenersRegistered = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    updateAppUpdateState({
      status: "checking",
      error: null,
      progressPercent: null,
      lastCheckedAt: Date.now(),
    });
  });

  autoUpdater.on("update-available", (info: { version: string }) => {
    updateAppUpdateState({
      status: "available",
      availableVersion: info.version,
      downloadedVersion: null,
      progressPercent: 0,
      error: null,
      lastCheckedAt: Date.now(),
    });
    broadcastToRenderers("app:updateAvailable", info.version);
  });

  autoUpdater.on("download-progress", (progress: { percent: number }) => {
    updateAppUpdateState({
      status: "downloading",
      progressPercent: progress.percent,
      error: null,
    });
  });

  autoUpdater.on("update-downloaded", (info: { version: string }) => {
    updateAppUpdateState({
      status: "downloaded",
      availableVersion: info.version,
      downloadedVersion: info.version,
      progressPercent: 100,
      error: null,
      lastCheckedAt: Date.now(),
    });
    broadcastToRenderers("app:updateDownloaded", info.version);
  });

  autoUpdater.on("update-not-available", () => {
    updateAppUpdateState({
      status: "upToDate",
      availableVersion: null,
      downloadedVersion: null,
      progressPercent: null,
      error: null,
      lastCheckedAt: Date.now(),
    });
    broadcastToRenderers("app:updateNotAvailable");
  });

  autoUpdater.on("error", (error: Error) => {
    updateAppUpdateState({
      status: "error",
      progressPercent: null,
      error: error.message,
      lastCheckedAt: Date.now(),
    });
  });
}

async function triggerAppUpdateCheck(): Promise<void> {
  if (!app.isPackaged) {
    updateAppUpdateState({
      status: "unsupported",
      availableVersion: null,
      downloadedVersion: null,
      progressPercent: null,
      error: null,
      lastCheckedAt: Date.now(),
    });
    return;
  }

  registerAppUpdaterListeners();

  if (appUpdateCheckInFlight) {
    return appUpdateCheckInFlight;
  }

  if (
    appUpdateState.status === "checking" ||
    appUpdateState.status === "available" ||
    appUpdateState.status === "downloading" ||
    appUpdateState.status === "downloaded"
  ) {
    return;
  }

  appUpdateCheckInFlight = autoUpdater
    .checkForUpdates()
    .then(() => undefined)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      updateAppUpdateState({
        status: "error",
        progressPercent: null,
        error: message,
        lastCheckedAt: Date.now(),
      });
    })
    .finally(() => {
      appUpdateCheckInFlight = null;
    });

  return appUpdateCheckInFlight;
}

interface TauriUpdatePlatform {
  url: string;
  signature: string;
  sha256?: string;
}

interface TauriUpdateManifest {
  version?: string;
  platforms?: Record<string, TauriUpdatePlatform | undefined>;
}

interface TauriMigrationRelease {
  version: string;
  url: string;
  sha256: string;
}

function isHexSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function validateTauriInstallerUrl(url: string, version: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid Tauri installer URL");
  }

  const [repoOwner, repoName] = GITHUB_REPO.split("/");
  const pathSegments = parsedUrl.pathname.split("/");
  const expectedSegments = [
    "",
    repoOwner,
    repoName,
    "releases",
    "download",
    `app-v${version}`,
    TAURI_INSTALLER_ASSET_NAME,
  ];
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "github.com" ||
    pathSegments.length !== expectedSegments.length ||
    pathSegments.some((segment, index) => segment !== expectedSegments[index])
  ) {
    throw new Error("Untrusted Tauri installer URL");
  }
}

async function fetchTauriMigrationRelease(): Promise<TauriMigrationRelease> {
  const response = await session.defaultSession.fetch(TAURI_UPDATE_MANIFEST_URL, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Tauri update manifest request failed with status ${response.status}`);
  }

  const manifest = (await response.json()) as TauriUpdateManifest;
  const version = typeof manifest.version === "string" ? manifest.version.trim() : "";
  const platform = manifest.platforms?.[TAURI_WINDOWS_PLATFORM];
  if (!version || !platform) {
    throw new Error("Tauri update manifest does not contain a Windows x64 release");
  }
  const sha256 = typeof platform.sha256 === "string" ? platform.sha256.trim() : "";
  if (!isHexSha256(sha256)) {
    throw new Error("Tauri update manifest is missing a valid SHA-256 checksum");
  }
  validateTauriInstallerUrl(platform.url, version);
  return {
    version,
    url: platform.url,
    sha256: sha256.toLowerCase(),
  };
}

async function createTauriMigrationLoginCode(token: string): Promise<string> {
  const response = await session.defaultSession.fetch(getApiAuthUrl("/auth/login-code"), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      Origin: SITE_URL,
    },
  });
  if (!response.ok) {
    throw new Error(`Tauri migration login-code request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code : "";
  if (!code || code.length > 512 || /\s/.test(code)) {
    throw new Error("Tauri migration login-code response was invalid");
  }
  return code;
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function writeAndStartTauriMigrationScript(
  installerPath: string,
  authUrl: string,
): Promise<void> {
  const scriptPath = join(path.dirname(installerPath), "install-wow-dashboard-tauri.ps1");
  const script = `
$ErrorActionPreference = "Stop"
$scriptPath = ${quotePowerShellString(scriptPath)}
$installerPath = ${quotePowerShellString(installerPath)}
$authUrl = ${quotePowerShellString(authUrl)}
$electronPid = ${process.pid}
try {
  Wait-Process -Id $electronPid -Timeout 30 -ErrorAction SilentlyContinue
  Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait
  Start-Sleep -Seconds 2
  if ($authUrl.Length -gt 0) {
    Start-Process -FilePath $authUrl
  }
} finally {
  Remove-Item -LiteralPath $scriptPath -Force -ErrorAction SilentlyContinue
}
`;
  await fs.promises.writeFile(scriptPath, script, "utf-8");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
}

async function maybeStartTauriMigrationBridge(settings: Record<string, unknown>): Promise<boolean> {
  if (!ELECTRON_TAURI_MIGRATION_BRIDGE || !storedSessionToken) {
    return false;
  }

  const lastStartedAt =
    typeof settings.tauriMigrationBridgeStartedAt === "number"
      ? settings.tauriMigrationBridgeStartedAt
      : 0;
  if (Date.now() - lastStartedAt < 30 * 60 * 1000) {
    return false;
  }

  try {
    const release = await fetchTauriMigrationRelease();
    const downloadDir = await fs.promises.mkdtemp(join(os.tmpdir(), "wow-dashboard-tauri-"));
    const installerPath = join(downloadDir, TAURI_INSTALLER_ASSET_NAME);
    await downloadFile(release.url, installerPath);
    const actualHash = await computeFileSha256(installerPath);
    if (actualHash.toLowerCase() !== release.sha256) {
      throw new Error("Downloaded Tauri installer checksum did not match latest.json");
    }

    const code = await createTauriMigrationLoginCode(storedSessionToken);
    const authUrl = `wow-dashboard://auth?code=${encodeURIComponent(code)}`;
    settings.tauriMigrationBridgeStartedAt = Date.now();
    settings.tauriMigrationTargetVersion = release.version;
    delete settings.tauriMigrationBridgeError;
    await saveSettings(settings);
    await writeAndStartTauriMigrationScript(installerPath, authUrl);
    prepareForQuit();
    app.quit();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[wow-dashboard] Tauri migration bridge failed:", message);
    settings.tauriMigrationBridgeError = message;
    await saveSettings(settings).catch(() => {});
    return false;
  }
}

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
ipcMain.handle("app:getUpdateStatus", () => getAppUpdateStateSnapshot());

// Trigger a silent install and relaunch immediately if the user explicitly asks for it.
ipcMain.handle("app:installUpdate", () => {
  return installDownloadedAppUpdate();
});

// Manually trigger an update check — used by the "Check for Updates" button in the renderer.
ipcMain.handle("app:checkForUpdates", () => {
  return triggerAppUpdateCheck();
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
  const instanceLabel = app.isPackaged ? "instance" : "dev instance";
  console.warn(`[wow-dashboard] Another WoW Dashboard ${instanceLabel} is already running.`);
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
  if (await maybeStartTauriMigrationBridge(settings)) {
    return;
  }
  closeBehaviorCache = (settings.closeBehavior as "tray" | "exit") ?? "tray";
  launchMinimizedCache = (settings.launchMinimized as boolean) ?? true;
  if (process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: (settings.autostart as boolean) ?? false });
    if (!launchMinimizedCache) {
      pendingWindowReveal = true;
    }
  }

  const [{ retailPath, validatedRetailPath, error: retailPathError }, stagedAddon] =
    await Promise.all([resolveRetailPathFromSettings(), getUsableStagedAddonUpdate()]);
  const installedAddonVersion = validatedRetailPath
    ? await getInstalledAddonVersionForRetailPath(validatedRetailPath)
    : null;
  updateAddonUpdateState({
    status: validatedRetailPath
      ? installedAddonVersion
        ? "idle"
        : "notInstalled"
      : getAddonRetailPathStatus(retailPath ? "invalid" : "missing"),
    installedVersion: installedAddonVersion,
    stagedVersion: stagedAddon?.version ?? null,
    error: retailPathError,
    lastCheckedAt: addonUpdateState.lastCheckedAt,
  });

  if (app.isPackaged) {
    registerAppUpdaterListeners();
    updateAppUpdateState({
      status: "idle",
      availableVersion: null,
      downloadedVersion: null,
      progressPercent: null,
      error: null,
    });
  } else {
    updateAppUpdateState({
      status: "unsupported",
      availableVersion: null,
      downloadedVersion: null,
      progressPercent: null,
      error: null,
    });
  }

  await applyStagedAddonUpdateIfReady().catch((error) => {
    console.warn("[wow-dashboard] Failed to apply staged addon update on launch:", error);
  });

  createWindow();
  void createTray().catch((error) => {
    console.warn("[wow-dashboard] Failed to create tray:", error);
  });

  void stageLatestAddonUpdate().catch((error) => {
    console.warn("[wow-dashboard] Failed to stage addon update:", error);
  });
  addonUpdateCheckTimer = setInterval(() => {
    void stageLatestAddonUpdate().catch((error) => {
      console.warn("[wow-dashboard] Failed to stage addon update:", error);
    });
  }, getConfiguredAddonUpdateCheckIntervalMs());
  addonUpdateApplyTimer = setInterval(() => {
    void applyStagedAddonUpdateIfReady().catch((error) => {
      console.warn("[wow-dashboard] Failed to apply staged addon update:", error);
    });
  }, getConfiguredAddonStagedApplyIntervalMs());

  void triggerAppUpdateCheck().catch((error) => {
    console.warn("[wow-dashboard] Failed to check for app updates:", error);
  });
  appUpdateCheckTimer = setInterval(() => {
    void triggerAppUpdateCheck().catch((error) => {
      console.warn("[wow-dashboard] Failed to check for app updates:", error);
    });
  }, getConfiguredAppUpdateCheckIntervalMs());

  app.on("activate", () => {
    showWindow();
  });
});

app.on("before-quit", () => {
  prepareForQuit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
