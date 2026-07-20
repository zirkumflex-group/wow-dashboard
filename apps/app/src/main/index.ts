import {
  app,
  autoUpdater as nativeAutoUpdater,
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
import {
  buildCanonicalMythicPlusRunFingerprint as buildSharedCanonicalMythicPlusRunFingerprint,
  canUseMythicPlusRunCompatibilityAliasMatch as canUseSharedMythicPlusRunCompatibilityAliasMatch,
  getMythicPlusRunAttemptId as getSharedMythicPlusRunAttemptId,
  getMythicPlusRunCanonicalKey as getSharedMythicPlusRunCanonicalKey,
  getMythicPlusRunCompatibilityLookupAliases as getSharedMythicPlusRunCompatibilityLookupAliases,
  getMythicPlusRunLifecycleStatus as getSharedMythicPlusRunLifecycleStatus,
  mergeMythicPlusRunMembers as mergeSharedMythicPlusRunMembers,
  pickMergedMythicPlusSeasonID,
  shouldReplaceMythicPlusRun as shouldReplaceSharedMythicPlusRun,
} from "@wow-dashboard/mythic-plus";
import { execFile } from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { join, resolve, sep } from "path";
import * as crypto from "crypto";
import * as os from "os";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type {
  AddonApplyStagedResult,
  AddonUpdateCheckResult,
  AddonUpdateState,
  AppInstallUpdateResult,
  AppUpdateState,
} from "../shared/update";
import { replaceDirectoryAtomically } from "./atomicAddonInstall";
import { loadEncryptedSessionToken, saveEncryptedSessionToken } from "./authTokenStorage";
import { findDesktopAuthDeepLink, readDesktopAuthCode } from "./desktopAuthLink";
import {
  compareVersionStrings,
  parseAddonReleaseTags,
  parseAddonTocManifest,
  parseLatestAddonRelease,
  parseStagedAddonUpdate,
  validateAddonDownloadRedirect,
  type AddonReleaseInfo,
  type StagedAddonUpdate,
} from "./addonUpdateValidation";
import { LuaParser } from "./luaParser";
import { resolveDesktopAuthSessionState, type DesktopAuthSessionState } from "../shared/auth";
import { desktopConfig } from "../shared/config";
import type {
  AddonFileState,
  AddonFileStats,
  AddonIngestResponse,
  AddonSyncError,
  AddonSyncResult,
  PendingUploadCounts,
} from "../shared/sync";

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
let addonSyncDebounce: ReturnType<typeof setTimeout> | null = null;
let storedSessionToken: string | null = null;
let authTokenPersistenceQueue: Promise<void> = Promise.resolve();
let pendingLoginResolve: (() => void) | null = null;
let pendingLoginReject: ((err: Error) => void) | null = null;
let desktopLoginInFlight: Promise<boolean> | null = null;
let desktopAuthCodeExchangeInFlight: Promise<void> | null = null;
let queuedDesktopAuthDeepLink: string | null = null;
let desktopAuthRuntimeReady = false;
let stagingAddonUpdate = false;
let applyingStagedAddonUpdate = false;
let appUpdateCheckInFlight: Promise<void> | null = null;
let addonUpdateCheckInFlight: Promise<AddonUpdateCheckResult> | null = null;
let appUpdaterListenersRegistered = false;
let addonUpdateCheckTimer: ReturnType<typeof setInterval> | null = null;
let addonUpdateApplyTimer: ReturnType<typeof setInterval> | null = null;
let appUpdateCheckTimer: ReturnType<typeof setInterval> | null = null;
let appUpdateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let addonSyncTimer: ReturnType<typeof setInterval> | null = null;
let addonSyncInFlight: Promise<AddonSyncResult> | null = null;
let addonSyncRerunAfterInFlight = false;
type DesktopAutoUpdater = (typeof import("electron-updater"))["autoUpdater"];
let desktopAutoUpdater: DesktopAutoUpdater | null = null;
let desktopAutoUpdaterLoad: Promise<DesktopAutoUpdater> | null = null;
let appUpdaterRegistration: Promise<void> | null = null;

const DEFAULT_APP_UPDATE_CHECK_INTERVAL_MINUTES = 60;
const DEFAULT_ADDON_UPDATE_CHECK_INTERVAL_MINUTES = 60;
const DEFAULT_ADDON_UPDATE_APPLY_INTERVAL_MINUTES = 1;
const DEFAULT_ADDON_SYNC_INTERVAL_MINUTES = 15;
const ADDON_FILE_SYNC_DEBOUNCE_MS = 5_000;
const ADDON_STARTUP_SYNC_DELAY_MS = 3_000;
const APP_UPDATE_STARTUP_DELAY_MS = 5_000;
const MYTHIC_PLUS_UPLOAD_LOOKBACK_SECONDS = 2 * 60 * 60;
const MYTHIC_PLUS_MEMBER_UPLOAD_LOOKBACK_SECONDS = 48 * 60 * 60;
const MYTHIC_PLUS_MISSING_SCORE_UPLOAD_LOOKBACK_SECONDS = 48 * 60 * 60;
const ADDON_UPLOAD_CHARACTERS_PER_BATCH = 20;
const ADDON_UPLOAD_SNAPSHOTS_PER_CHARACTER = 100;
const ADDON_UPLOAD_RUNS_PER_CHARACTER = 150;
const ADDON_UPLOAD_MAX_BATCH_BODY_BYTES = 768 * 1024;
const MAX_MYTHIC_PLUS_RUN_MEMBERS = 5;
const NETWORK_REQUEST_TIMEOUT_MS = 15_000;
const NETWORK_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_ADDON_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_ADDON_CHECKSUM_BYTES = 64 * 1024;
const MAX_ADDON_ARCHIVE_ENTRIES = 1_000;
const MAX_ADDON_EXTRACTED_BYTES = 100 * 1024 * 1024;
const MAX_ADDON_SAVED_VARIABLES_BYTES = 64 * 1024 * 1024;
const MAX_ADDON_DOWNLOAD_REDIRECTS = 5;

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
const SITE_URL = desktopConfig.siteUrl;
const API_URL = desktopConfig.apiUrl;
const DESKTOP_CLIENT_HEADER = "X-Wow-Dashboard-Client";
const DESKTOP_CLIENT_HEADER_VALUE = "desktop";
const RENDERER_DEV_URL = process.env["ELECTRON_RENDERER_URL"] ?? null;
const RENDERER_FILE_PATH = join(__dirname, "../renderer/index.html");
const RENDERER_DIR = resolve(__dirname, "../renderer");

function withNetworkTimeout(
  init: RequestInit = {},
  timeoutMs = NETWORK_REQUEST_TIMEOUT_MS,
): RequestInit {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal,
  };
}

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

function buildApiProxyHeaders(inputHeaders: Array<[string, string]> | undefined): Headers {
  const headers = new Headers();
  for (const [name, value] of inputHeaders ?? []) {
    const normalizedName = name.toLowerCase();
    if (normalizedName === "accept" || normalizedName === "content-type") {
      headers.set(name, value);
    }
  }

  headers.set("Origin", SITE_URL);
  headers.set(DESKTOP_CLIENT_HEADER, DESKTOP_CLIENT_HEADER_VALUE);
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

function parseJsonResponseText(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === "") {
    return { ok: false };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(text) as unknown,
    };
  } catch {
    return { ok: false };
  }
}

async function persistDesktopSessionToken(token: string) {
  const result = await saveSessionToken(token);
  if (result === "encryption-unavailable") {
    console.warn(
      "[wow-dashboard] Secure credential storage is unavailable; the desktop session cannot persist after exit.",
    );
  } else if (result === "failed") {
    console.warn("[wow-dashboard] Failed to persist the desktop session credential.");
  }
  broadcastToRenderers("auth:sessionChanged");
  return result;
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

async function loadStoredAuth(): Promise<void> {
  storedSessionToken = await loadEncryptedSessionToken(getTokenPath(), safeStorage);
}

async function saveSessionToken(token: string | null) {
  storedSessionToken = token;
  // Serialize replacement and removal so a reconnect racing with logout can
  // never write an older credential after the user has signed out.
  const operation = authTokenPersistenceQueue.then(() =>
    saveEncryptedSessionToken(getTokenPath(), token, safeStorage),
  );
  authTokenPersistenceQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function clearDesktopSessionToken() {
  const result = await saveSessionToken(null);
  if (result === "failed") {
    console.warn("[wow-dashboard] Failed to remove the desktop session credential.");
  }
  broadcastToRenderers("auth:sessionChanged");
  return result;
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

function getConfiguredAddonSyncIntervalMs(): number {
  return DEFAULT_ADDON_SYNC_INTERVAL_MINUTES * 60 * 1000;
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
  if (appUpdateStartupTimer) {
    clearTimeout(appUpdateStartupTimer);
    appUpdateStartupTimer = null;
  }
  if (addonSyncTimer) {
    clearInterval(addonSyncTimer);
    addonSyncTimer = null;
  }
  if (addonSyncDebounce) {
    clearTimeout(addonSyncDebounce);
    addonSyncDebounce = null;
  }
}

function prepareForQuit(options?: { windowsSessionEnding?: boolean }): void {
  isQuitting = true;

  if (options?.windowsSessionEnding) {
    isEndingWindowsSession = true;
    if (desktopAutoUpdater) {
      desktopAutoUpdater.autoInstallOnAppQuit = false;
    }
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

function destroyWindowToTray(): void {
  const windowToDestroy = mainWindow;
  if (!windowToDestroy) return;

  mainWindowReady = false;
  pendingWindowReveal = false;
  mainWindow = null;
  windowToDestroy.setSkipTaskbar(true);
  windowToDestroy.destroy();
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
  if (!desktopAutoUpdater) {
    return {
      ok: false,
      status: "notDownloaded",
      message: "The downloaded update is not available in this app session.",
    };
  }
  const updater = desktopAutoUpdater;

  updateAppUpdateState({
    status: "installing",
    error: null,
  });
  isInstallingAppUpdate = true;
  prepareForQuit();
  setImmediate(() => {
    updater.quitAndInstall(true, true);
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

let settingsCache: Record<string, unknown> | null = null;
let settingsLoadInFlight: Promise<Record<string, unknown>> | null = null;
let settingsWriteChain: Promise<void> = Promise.resolve();

async function getSettings(): Promise<Record<string, unknown>> {
  if (settingsCache) {
    return settingsCache;
  }

  settingsLoadInFlight ??= (async () => {
    let loaded: Record<string, unknown>;
    try {
      const raw = await fs.promises.readFile(settingsPath(), "utf-8");
      const parsed: unknown = JSON.parse(raw);
      loaded =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      loaded = {};
    }

    settingsCache = loaded;
    return loaded;
  })();

  return settingsLoadInFlight;
}

async function saveSettings(data: Record<string, unknown>): Promise<void> {
  settingsCache = data;
  const targetPath = settingsPath();
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  const serialized = JSON.stringify(data, null, 2);
  const write = settingsWriteChain.then(async () => {
    try {
      await fs.promises.writeFile(temporaryPath, serialized, "utf-8");
      await fs.promises.rename(temporaryPath, targetPath);
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  });
  settingsWriteChain = write.catch(() => {});
  await write;
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

interface AddonSignatureData {
  algorithm: string;
  installId: string;
  secret: string;
  payloadHash: string;
  signature: string;
  signedAt?: number;
}

interface AddonSigningData {
  algorithm: string;
  installId: string;
  secret: string;
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
  addonSignature?: AddonSignatureData;
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
  addonSignature?: AddonSignatureData;
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
    addonSignature: preferred.addonSignature ?? fallback.addonSignature,
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

function normalizeAddonSigning(value: unknown): AddonSigningData | undefined {
  if (!isRecord(value)) return undefined;

  const algorithm = toOptionalString(value.algorithm);
  const installId = toOptionalString(value.installId);
  const secret = toOptionalString(value.secret);
  if (!algorithm || !installId || !secret) return undefined;

  return { algorithm, installId, secret };
}

function normalizeAddonSignature(
  value: unknown,
  signing: AddonSigningData | undefined,
): AddonSignatureData | undefined {
  if (!isRecord(value) || !signing) return undefined;

  const algorithm = toOptionalString(value.algorithm) ?? signing.algorithm;
  const installId = toOptionalString(value.installId) ?? signing.installId;
  const payloadHash = toOptionalString(value.payloadHash);
  const signature = toOptionalString(value.signature);
  if (!algorithm || !installId || !payloadHash || !signature) return undefined;

  return {
    algorithm,
    installId,
    secret: signing.secret,
    payloadHash,
    signature,
    signedAt: toOptionalNumber(value.signedAt),
  };
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

function getMythicPlusRunStatus(
  run: Partial<MythicPlusRunData>,
): MythicPlusRunData["status"] | undefined {
  return getSharedMythicPlusRunLifecycleStatus(run);
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
    if (members.length >= MAX_MYTHIC_PLUS_RUN_MEMBERS) {
      break;
    }
  }

  return members.length > 0 ? members : undefined;
}

function mergeMythicPlusRunMembers(
  currentMembers: MythicPlusRunMemberData[] | undefined,
  candidateMembers: MythicPlusRunMemberData[] | undefined,
) {
  return mergeSharedMythicPlusRunMembers(currentMembers, candidateMembers) as
    | MythicPlusRunMemberData[]
    | undefined;
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

function getRunAttemptId(run: Partial<MythicPlusRunData>): string | undefined {
  return getSharedMythicPlusRunAttemptId(run) ?? undefined;
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

function getMythicPlusRunCanonicalKey(run: Partial<MythicPlusRunData>): string | undefined {
  return getSharedMythicPlusRunCanonicalKey(run) ?? undefined;
}

function buildCanonicalMythicPlusRunFingerprint(
  run: Partial<MythicPlusRunData>,
): string | undefined {
  return buildSharedCanonicalMythicPlusRunFingerprint(run) ?? undefined;
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

function getMythicPlusRunCompatibilityLookupAliases(run: Partial<MythicPlusRunData>): string[] {
  return getSharedMythicPlusRunCompatibilityLookupAliases(run);
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

function canUseMythicPlusRunCompatibilityAliasMatch(
  existingRun: Partial<MythicPlusRunData>,
  candidateRun: Partial<MythicPlusRunData>,
): boolean {
  return canUseSharedMythicPlusRunCompatibilityAliasMatch(existingRun, candidateRun);
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

function shouldReplaceMythicPlusRun(
  currentRun: MythicPlusRunData | undefined,
  candidateRun: MythicPlusRunData,
): boolean {
  return shouldReplaceSharedMythicPlusRun(currentRun, candidateRun);
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
    seasonID: pickMergedMythicPlusSeasonID(preferredRun, fallbackRun),
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
    addonSignature: preferredRun.addonSignature ?? fallbackRun.addonSignature,
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

function normalizeStoredMythicPlusRun(
  runRaw: LuaTable,
  signing?: AddonSigningData,
): MythicPlusRunData {
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
    addonSignature: normalizeAddonSignature(runRaw.addonSignature, signing),
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
  const signing = normalizeAddonSigning(db.signing);
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
        addonSignature: normalizeAddonSignature(snap.addonSignature, signing),
      });
    }

    const mythicPlusRuns: MythicPlusRunData[] = [];
    const mythicPlusRunLookups = createMythicPlusRunLookups();
    for (const runRaw of (char.mythicPlusRuns as unknown[]) ?? []) {
      if (!isRecord(runRaw)) continue;
      const run = normalizeStoredMythicPlusRun(runRaw, signing);
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

type ParsedAddonData = {
  characters: CharacterData[];
  accountsFound: string[];
  fileStats: AddonFileStats | null;
};

type AddonFileCandidate = {
  account: string;
  luaPath: string;
  stats: fs.Stats;
};

let parsedAddonDataCache: { signature: string; value: ParsedAddonData } | null = null;
let parsedAddonDataInFlight: { signature: string; promise: Promise<ParsedAddonData> } | null = null;

function mergeParsedCharacter(allCharacters: Map<string, CharacterData>, character: CharacterData) {
  const key = getCharacterMergeKey(character);
  const existing = allCharacters.get(key);
  if (!existing) {
    allCharacters.set(key, character);
    return;
  }

  const snapshotsByTime = new Map(
    existing.snapshots.map((snapshot) => [snapshot.takenAt, snapshot]),
  );
  for (const snapshot of character.snapshots) {
    const current = snapshotsByTime.get(snapshot.takenAt);
    if (!current) {
      existing.snapshots.push(snapshot);
      snapshotsByTime.set(snapshot.takenAt, snapshot);
      continue;
    }

    Object.assign(current, mergeSnapshotData(current, snapshot));
  }

  const existingRunLookups = buildMythicPlusRunLookups(existing.mythicPlusRuns);
  for (const run of character.mythicPlusRuns) {
    upsertMythicPlusRunByIdentity(existing.mythicPlusRuns, existingRunLookups, run);
  }
  sortMythicPlusRunsInPlace(existing.mythicPlusRuns);
}

async function parseAddonFileCandidates(
  candidates: AddonFileCandidate[],
): Promise<{ value: ParsedAddonData; cacheable: boolean }> {
  let cacheable = true;
  const files = await Promise.all(
    candidates.map(async (candidate) => {
      if (candidate.stats.size > MAX_ADDON_SAVED_VARIABLES_BYTES) {
        console.warn(
          `[wow-dashboard] Skipping oversized SavedVariables file (${candidate.stats.size} bytes): ${candidate.luaPath}`,
        );
        return null;
      }

      try {
        return {
          ...candidate,
          content: await fs.promises.readFile(candidate.luaPath, "utf-8"),
        };
      } catch (error) {
        cacheable = false;
        console.warn(`[wow-dashboard] Failed to read ${candidate.luaPath}:`, error);
        return null;
      }
    }),
  );

  const accountsFound: string[] = [];
  const allCharacters = new Map<string, CharacterData>();
  let totalBytes = 0;
  let createdAt = Infinity;
  let modifiedAt = 0;

  for (const file of files) {
    if (!file) continue;
    accountsFound.push(file.account);
    totalBytes += file.stats.size;
    createdAt = Math.min(createdAt, file.stats.birthtimeMs);
    modifiedAt = Math.max(modifiedAt, file.stats.mtimeMs);

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = new LuaParser(file.content).parseFile();
    } catch (error) {
      console.error(`[wow-dashboard] Lua parse error for ${file.luaPath}:`, error);
    }
    if (!parsed) continue;

    for (const character of extractCharacters(parsed)) {
      mergeParsedCharacter(allCharacters, character);
    }
  }

  const characters = Array.from(allCharacters.values());
  const totalSnapshots = characters.reduce((sum, character) => sum + character.snapshots.length, 0);
  const totalMythicPlusRuns = characters.reduce(
    (sum, character) => sum + character.mythicPlusRuns.length,
    0,
  );
  const fileStats =
    accountsFound.length > 0
      ? { totalBytes, createdAt, modifiedAt, totalSnapshots, totalMythicPlusRuns }
      : null;

  return {
    value: { characters, accountsFound, fileStats },
    cacheable,
  };
}

async function findAndParseAddonData(retailPath: string): Promise<ParsedAddonData> {
  const wtfAccountPath = join(retailPath, "WTF", "Account");
  let accounts: string[];
  try {
    accounts = await fs.promises.readdir(wtfAccountPath);
  } catch {
    return { characters: [], accountsFound: [], fileStats: null };
  }

  const candidates = (
    await Promise.all(
      accounts
        .sort((left, right) => left.localeCompare(right))
        .map(async (account): Promise<AddonFileCandidate | null> => {
          const luaPath = join(wtfAccountPath, account, "SavedVariables", "wow-dashboard.lua");
          try {
            return { account, luaPath, stats: await fs.promises.stat(luaPath) };
          } catch {
            return null;
          }
        }),
    )
  ).filter((candidate): candidate is AddonFileCandidate => candidate !== null);

  const signature = JSON.stringify([
    resolve(retailPath),
    ...candidates.map((candidate) => [
      candidate.account,
      candidate.stats.size,
      candidate.stats.mtimeMs,
    ]),
  ]);

  if (parsedAddonDataCache?.signature === signature) {
    return parsedAddonDataCache.value;
  }
  if (parsedAddonDataInFlight?.signature === signature) {
    return parsedAddonDataInFlight.promise;
  }

  const parsePromise = parseAddonFileCandidates(candidates).then(({ value, cacheable }) => {
    if (cacheable) {
      parsedAddonDataCache = { signature, value };
    }
    return value;
  });
  parsedAddonDataInFlight = { signature, promise: parsePromise };

  try {
    return await parsePromise;
  } finally {
    if (parsedAddonDataInFlight?.promise === parsePromise) {
      parsedAddonDataInFlight = null;
    }
  }
}

function hasUploadableSnapshotSpec(spec: string) {
  const normalized = spec.trim();
  return normalized !== "" && normalized !== "Unknown";
}

function isUploadableSnapshot(snapshot: SnapshotData, sinceTs: number) {
  return snapshot.takenAt > sinceTs && hasUploadableSnapshotSpec(snapshot.spec);
}

function normalizePositiveTimestampSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function getMythicPlusRunLastMutationAt(run: MythicPlusRunData): number {
  const candidateTimestamps = [
    run.startDate,
    run.completedAt,
    run.endedAt,
    run.abandonedAt,
    run.observedAt,
  ];
  let latestMutationAt = 0;
  for (const candidate of candidateTimestamps) {
    const normalized = normalizePositiveTimestampSeconds(candidate);
    if (normalized !== null && normalized > latestMutationAt) {
      latestMutationAt = normalized;
    }
  }
  return latestMutationAt;
}

function isCompletedMythicPlusRunMissingScore(run: MythicPlusRunData): boolean {
  return getMythicPlusRunStatus(run) === "completed" && run.runScore === undefined;
}

function isUploadableMythicPlusRun(run: MythicPlusRunData, sinceTs: number) {
  const nowTs = Math.floor(Date.now() / 1000);
  const lookbackSeconds = Math.max(
    MYTHIC_PLUS_UPLOAD_LOOKBACK_SECONDS,
    (run.members?.length ?? 0) > 0 ? MYTHIC_PLUS_MEMBER_UPLOAD_LOOKBACK_SECONDS : 0,
    isCompletedMythicPlusRunMissingScore(run)
      ? MYTHIC_PLUS_MISSING_SCORE_UPLOAD_LOOKBACK_SECONDS
      : 0,
  );
  const effectiveSinceTs = Math.min(sinceTs, nowTs - lookbackSeconds);
  const lastMutationAt = getMythicPlusRunLastMutationAt(run);
  return lastMutationAt > effectiveSinceTs;
}

function getPendingUploadCounts(characters: CharacterData[], sinceTs: number): PendingUploadCounts {
  const counts: PendingUploadCounts = { snapshots: 0, mythicPlusRuns: 0 };
  for (const character of characters) {
    for (const snapshot of character.snapshots) {
      if (isUploadableSnapshot(snapshot, sinceTs)) {
        counts.snapshots += 1;
      }
    }
    for (const run of character.mythicPlusRuns) {
      if (isUploadableMythicPlusRun(run, sinceTs)) {
        counts.mythicPlusRuns += 1;
      }
    }
  }
  return counts;
}

function toAddonFileState(
  addonData: Awaited<ReturnType<typeof findAndParseAddonData>>,
  sinceTs: number,
): AddonFileState {
  return {
    pendingUploadCounts: getPendingUploadCounts(addonData.characters, sinceTs),
    fileStats: addonData.fileStats,
    accountsFound: addonData.accountsFound,
    trackedCharacters: addonData.characters.length,
  };
}

function filterPendingCharacters(characters: CharacterData[], sinceTs: number): CharacterData[] {
  const pendingCharacters: CharacterData[] = [];
  for (const character of characters) {
    const snapshots = character.snapshots.filter((snapshot) =>
      isUploadableSnapshot(snapshot, sinceTs),
    );
    const mythicPlusRuns = character.mythicPlusRuns.filter((run) =>
      isUploadableMythicPlusRun(run, sinceTs),
    );
    if (snapshots.length === 0 && mythicPlusRuns.length === 0) {
      continue;
    }
    pendingCharacters.push({
      ...character,
      snapshots,
      mythicPlusRuns,
    });
  }
  return pendingCharacters;
}

function chunkCharacterForUpload(character: CharacterData): CharacterData[] {
  const chunkCount = Math.max(
    Math.ceil(character.snapshots.length / ADDON_UPLOAD_SNAPSHOTS_PER_CHARACTER),
    Math.ceil(character.mythicPlusRuns.length / ADDON_UPLOAD_RUNS_PER_CHARACTER),
    1,
  );
  const chunks: CharacterData[] = [];

  for (let index = 0; index < chunkCount; index++) {
    const snapshots = character.snapshots.slice(
      index * ADDON_UPLOAD_SNAPSHOTS_PER_CHARACTER,
      (index + 1) * ADDON_UPLOAD_SNAPSHOTS_PER_CHARACTER,
    );
    const mythicPlusRuns = character.mythicPlusRuns.slice(
      index * ADDON_UPLOAD_RUNS_PER_CHARACTER,
      (index + 1) * ADDON_UPLOAD_RUNS_PER_CHARACTER,
    );
    if (snapshots.length === 0 && mythicPlusRuns.length === 0) {
      continue;
    }

    chunks.push({
      ...character,
      snapshots,
      mythicPlusRuns,
    });
  }

  return chunks;
}

function createAddonUploadBatches(characters: CharacterData[]): CharacterData[][] {
  const batches: CharacterData[][] = [];
  let currentBatch: CharacterData[] = [];
  let currentBodyBytes = Buffer.byteLength('{"characters":[]}', "utf8");

  for (const character of characters) {
    for (const chunk of chunkCharacterForUpload(character)) {
      const chunkBytes = Buffer.byteLength(JSON.stringify(chunk), "utf8");
      const separatorBytes = currentBatch.length > 0 ? 1 : 0;
      const candidateBytes = currentBodyBytes + separatorBytes + chunkBytes;
      const exceedsCharacterLimit =
        currentBatch.length > 0 && currentBatch.length + 1 > ADDON_UPLOAD_CHARACTERS_PER_BATCH;
      const exceedsBodyLimit =
        currentBatch.length > 0 && candidateBytes > ADDON_UPLOAD_MAX_BATCH_BODY_BYTES;

      if (exceedsCharacterLimit || exceedsBodyLimit) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBodyBytes = Buffer.byteLength('{"characters":[]}', "utf8");
      }

      currentBatch.push(chunk);
      currentBodyBytes += (currentBatch.length > 1 ? 1 : 0) + chunkBytes;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

async function requestAuthenticatedJson<T>(
  method: "GET" | "POST",
  pathname: string,
  body?: unknown,
): Promise<T> {
  if (!storedSessionToken) {
    throw new Error("No desktop session token available");
  }

  const headers: Array<[string, string]> = [["Accept", "application/json"]];
  if (body !== undefined) {
    headers.push(["Content-Type", "application/json"]);
  }

  const response = await session.defaultSession.fetch(
    getApiAuthUrl(pathname),
    withNetworkTimeout({
      method,
      headers: buildApiProxyHeaders(headers),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  const responseText = await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      await clearDesktopSessionToken();
    }
    throw new Error(
      `API request failed with status ${response.status} ${response.statusText}: ${responseText}`,
    );
  }
  return (responseText ? JSON.parse(responseText) : {}) as T;
}

async function uploadAddonBatch(batch: CharacterData[]): Promise<AddonIngestResponse> {
  return requestAuthenticatedJson<AddonIngestResponse>("POST", "/addon/ingest", {
    characters: batch,
  });
}

async function resyncCharacters(): Promise<void> {
  await requestAuthenticatedJson<unknown>("POST", "/characters/resync");
}

async function syncAddonData(): Promise<AddonSyncResult> {
  const { validatedRetailPath, reason } = await resolveRetailPathFromSettings();
  if (!validatedRetailPath) {
    await resyncCharacters();
    const settings = await getSettings();
    return {
      status: "warning",
      message:
        reason === "invalid"
          ? "Configured WoW folder must point to the _retail_ directory."
          : "No WoW folder set — select the folder first",
      pendingUploadCounts: { snapshots: 0, mythicPlusRuns: 0 },
      fileStats: null,
      accountsFound: [],
      trackedCharacters: 0,
      lastSyncedAt: (settings.lastSyncedAt as number | undefined) ?? 0,
      lastUploadResult: null,
    };
  }

  const settings = await getSettings();
  const sinceTs = ((settings.lastSyncedAt as number | undefined) ?? 0) - 60;
  const addonData = await findAndParseAddonData(validatedRetailPath);
  const fileState = toAddonFileState(addonData, sinceTs);

  if (addonData.characters.length === 0) {
    await resyncCharacters();
    return {
      status: "warning",
      message:
        addonData.accountsFound.length === 0
          ? "No wow-dashboard.lua found — run the addon in-game first"
          : `Parsed ${addonData.accountsFound.length} account(s) but no characters found`,
      ...fileState,
      lastSyncedAt: (settings.lastSyncedAt as number | undefined) ?? 0,
      lastUploadResult: null,
    };
  }

  const pendingCharacters = filterPendingCharacters(addonData.characters, sinceTs);
  const batches = createAddonUploadBatches(pendingCharacters);
  let lastUploadResult: AddonIngestResponse = {
    newChars: 0,
    newSnapshots: 0,
    newMythicPlusRuns: 0,
  };
  let lastSyncedAt = (settings.lastSyncedAt as number | undefined) ?? 0;

  for (const batch of batches) {
    const result = await uploadAddonBatch(batch);
    lastUploadResult = {
      newChars: lastUploadResult.newChars + result.newChars,
      newSnapshots: lastUploadResult.newSnapshots + result.newSnapshots,
      newMythicPlusRuns: lastUploadResult.newMythicPlusRuns + result.newMythicPlusRuns,
    };
  }

  if (batches.length > 0) {
    lastSyncedAt = Math.floor(Date.now() / 1000);
    settings.lastSyncedAt = lastSyncedAt;
    await saveSettings(settings);
    await resyncCharacters();
  }

  return {
    status: "success",
    message: null,
    ...toAddonFileState(addonData, lastSyncedAt - 60),
    lastSyncedAt,
    lastUploadResult,
  };
}

// ─── Window ───────────────────────────────────────────────────────────────────

function broadcastAddonSyncError(error: unknown): void {
  const payload: AddonSyncError = {
    message: error instanceof Error ? error.message : String(error),
  };
  broadcastToRenderers("wow:addonSyncError", payload);
}

function triggerAddonSync(
  options: { broadcast?: boolean; rerunAfterCurrent?: boolean } = {},
): Promise<AddonSyncResult> {
  if (addonSyncInFlight) {
    if (options.rerunAfterCurrent) {
      addonSyncRerunAfterInFlight = true;
    }
    return addonSyncInFlight;
  }

  addonSyncInFlight = syncAddonData()
    .then((result) => {
      if (options.broadcast) {
        broadcastToRenderers("wow:addonSyncResult", result);
      }
      return result;
    })
    .catch((error: unknown) => {
      if (options.broadcast) {
        broadcastAddonSyncError(error);
      }
      throw error;
    })
    .finally(() => {
      addonSyncInFlight = null;
      if (addonSyncRerunAfterInFlight) {
        addonSyncRerunAfterInFlight = false;
        scheduleBackgroundAddonSync("queued addon change", 1_000);
      }
    });

  return addonSyncInFlight;
}

function triggerBackgroundAddonSync(reason: string): void {
  if (!storedSessionToken) return;
  void triggerAddonSync({ broadcast: true, rerunAfterCurrent: true }).catch((error) => {
    console.warn(`[wow-dashboard] Background addon sync failed after ${reason}:`, error);
  });
}

function scheduleBackgroundAddonSync(reason: string, delayMs = ADDON_FILE_SYNC_DEBOUNCE_MS): void {
  if (addonSyncDebounce) {
    clearTimeout(addonSyncDebounce);
  }
  addonSyncDebounce = setTimeout(() => {
    addonSyncDebounce = null;
    triggerBackgroundAddonSync(reason);
  }, delayMs);
}

function configureDefaultSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

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
      webviewTag: false,
      navigateOnDragDrop: false,
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
      destroyWindowToTray();
    }
  });

  mainWindow.on("closed", () => {
    mainWindowReady = false;
    pendingWindowReveal = false;
    mainWindow = null;
  });
}

async function exchangeDesktopAuthCode(code: string): Promise<void> {
  const previousSessionToken = storedSessionToken;
  const response = await net.fetch(
    getApiAuthUrl("/auth/redeem-code"),
    withNetworkTimeout({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }),
  );
  const payload = (await response.json().catch(() => null)) as {
    token?: string;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? `Code exchange failed: ${response.status}`);
  }
  if (!payload?.token) {
    throw new Error(payload?.error ?? "No token in response");
  }

  const persistenceResult = await persistDesktopSessionToken(payload.token);
  if (
    persistenceResult === "saved" &&
    previousSessionToken &&
    previousSessionToken !== payload.token
  ) {
    // A reconnect creates a replacement desktop session. Revoke the previous
    // one only after the new credential is durably stored, so reconnects do not
    // accumulate active sessions or strand the app if local persistence fails.
    void session.defaultSession
      .fetch(
        getApiAuthUrl("/auth/sign-out"),
        withNetworkTimeout({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: SITE_URL,
            [DESKTOP_CLIENT_HEADER]: DESKTOP_CLIENT_HEADER_VALUE,
            Authorization: `Bearer ${previousSessionToken}`,
          },
          body: JSON.stringify({}),
        }),
      )
      .catch(() => null);
  }
  scheduleBackgroundAddonSync("Battle.net login", 1_000);

  const resolve = pendingLoginResolve;
  pendingLoginResolve = null;
  pendingLoginReject = null;
  resolve?.();
  showWindow();
}

function handleDeepLink(url: string): void {
  const code = readDesktopAuthCode(url);
  if (!code) return;

  if (!desktopAuthRuntimeReady) {
    queuedDesktopAuthDeepLink = url;
    return;
  }

  // The OS can deliver the same protocol URL through more than one lifecycle
  // event. The handoff is single-use, so exchange only one at a time.
  if (desktopAuthCodeExchangeInFlight) return;

  const exchange = exchangeDesktopAuthCode(code).catch((error: unknown) => {
    const loginError = error instanceof Error ? error : new Error("Login code exchange failed");
    const reject = pendingLoginReject;
    pendingLoginResolve = null;
    pendingLoginReject = null;
    reject?.(loginError);
    if (!reject) {
      console.warn("[wow-dashboard] Desktop login handoff failed:", loginError.message);
    }
    showWindow();
  });
  desktopAuthCodeExchangeInFlight = exchange.finally(() => {
    desktopAuthCodeExchangeInFlight = null;
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

// Auth
function beginDesktopLogin(): Promise<boolean> {
  if (desktopLoginInFlight) return desktopLoginInFlight;

  const login = new Promise<boolean>((resolve, reject) => {
    const loginUrl = getElectronLoginUrl();
    let settled = false;

    const finalizeSuccess = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pendingLoginResolve = null;
      pendingLoginReject = null;
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
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

    pendingLoginResolve = finalizeSuccess;
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

  const trackedLogin = login.finally(() => {
    if (desktopLoginInFlight === trackedLogin) {
      desktopLoginInFlight = null;
    }
  });
  desktopLoginInFlight = trackedLogin;
  return trackedLogin;
}

ipcMain.handle("auth:login", () => {
  return beginDesktopLogin();
});

ipcMain.handle("auth:getSession", async () => {
  if (!storedSessionToken) {
    return {
      status: "unauthenticated",
    } satisfies DesktopAuthSessionState;
  }

  try {
    const resp = await session.defaultSession.fetch(
      getApiAuthUrl("/auth/get-session"),
      withNetworkTimeout({
        headers: {
          Origin: SITE_URL,
          [DESKTOP_CLIENT_HEADER]: DESKTOP_CLIENT_HEADER_VALUE,
          ...(storedSessionToken ? { Authorization: `Bearer ${storedSessionToken}` } : {}),
        },
      }),
    );
    const responseText = await resp.text();
    if (!resp.ok) {
      if (resp.status === 401) {
        await clearDesktopSessionToken();
        return {
          status: "unauthenticated",
        } satisfies DesktopAuthSessionState;
      }
      return {
        status: "unknown",
      } satisfies DesktopAuthSessionState;
    }

    const parsed = parseJsonResponseText(responseText);
    if (!parsed.ok) {
      return {
        status: "unknown",
      } satisfies DesktopAuthSessionState;
    }

    const sessionState = resolveDesktopAuthSessionState(parsed.value);
    if (sessionState.status === "unauthenticated") {
      await clearDesktopSessionToken();
    }
    return sessionState;
  } catch {
    return {
      status: "unknown",
    } satisfies DesktopAuthSessionState;
  }
});

ipcMain.handle("auth:logout", async () => {
  const sessionToken = storedSessionToken;
  const localResult = await clearDesktopSessionToken();
  try {
    await session.defaultSession.fetch(
      getApiAuthUrl("/auth/sign-out"),
      withNetworkTimeout({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: SITE_URL,
          [DESKTOP_CLIENT_HEADER]: DESKTOP_CLIENT_HEADER_VALUE,
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({}),
      }),
    );
    return localResult === "removed";
  } catch {
    return false;
  }
});

ipcMain.handle("api:getCharacterCount", async () => {
  const response = await requestAuthenticatedJson<{ count?: unknown }>("GET", "/characters/count");
  if (!Number.isSafeInteger(response.count) || Number(response.count) < 0) {
    throw new Error("API returned an invalid character count");
  }
  return Number(response.count);
});

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
  void startAddonWatcher().catch((error) => {
    console.warn("[wow-dashboard] Failed to restart addon watcher after folder selection:", error);
  });
  scheduleBackgroundAddonSync("WoW folder selection", 1_000);
  void stageLatestAddonUpdate().catch((error) => {
    console.warn("[wow-dashboard] Failed to stage addon update after folder selection:", error);
  });
  return folder;
});

ipcMain.handle("wow:getAddonFileState", async (_, sinceTs: number) => {
  const retailPath = await getValidatedRetailPathFromSettings();
  if (!retailPath) return null;
  const addonData = await findAndParseAddonData(retailPath);
  return toAddonFileState(addonData, sinceTs);
});

ipcMain.handle("wow:syncAddonData", async () => {
  return triggerAddonSync();
});

function stopAddonWatcher() {
  if (addonWatcher) {
    addonWatcher.close();
    addonWatcher = null;
  }
}

async function startAddonWatcher(): Promise<boolean> {
  stopAddonWatcher();
  const retailPath = await getValidatedRetailPathFromSettings();
  if (!retailPath) return false;
  const watchPath = join(retailPath, "WTF", "Account");
  try {
    await fs.promises.access(watchPath, fs.constants.F_OK);
    addonWatcher = fs.watch(watchPath, { recursive: true }, (_event, filename) => {
      if (!filename?.endsWith("wow-dashboard.lua")) return;
      scheduleBackgroundAddonSync("SavedVariables change");
    });
    return true;
  } catch (e) {
    console.warn("[wow-dashboard] Failed to watch addon file:", e);
    stopAddonWatcher();
    return false;
  }
}

ipcMain.handle("wow:watchAddonFile", async () => {
  return startAddonWatcher();
});

ipcMain.handle("wow:unwatchAddonFile", () => {
  stopAddonWatcher();
});

// Addon installation
const GITHUB_REPO = "zirkumflex-group/wow-dashboard";

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
  return compareVersionStrings(installed, latest) < 0;
}

async function getAddonDownloadResponse(url: string, signal: AbortSignal): Promise<Response> {
  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= MAX_ADDON_DOWNLOAD_REDIRECTS; redirectCount += 1) {
    validateAddonDownloadRedirect(currentUrl);
    const response = await net.fetch(currentUrl, {
      credentials: "omit",
      redirect: "manual",
      signal,
      headers: { Accept: "application/octet-stream" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Addon download redirect did not include a location");
    if (redirectCount === MAX_ADDON_DOWNLOAD_REDIRECTS) {
      throw new Error(`Addon download exceeded ${MAX_ADDON_DOWNLOAD_REDIRECTS} redirects`);
    }

    const nextUrl = new URL(location, currentUrl).toString();
    validateAddonDownloadRedirect(nextUrl);
    currentUrl = nextUrl;
  }
  throw new Error(`Addon download exceeded ${MAX_ADDON_DOWNLOAD_REDIRECTS} redirects`);
}

async function downloadFile(
  url: string,
  destPath: string,
  maximumBytes: number,
  expectedBytes: number,
): Promise<void> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maximumBytes) {
    throw new Error("Invalid expected addon asset size");
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, NETWORK_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await getAddonDownloadResponse(url, controller.signal);
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`Download failed with status ${response.status}`);
    }
    if (!response.body) throw new Error("Addon download response did not include a body");

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(contentLength) || contentLength !== expectedBytes) {
        await response.body.cancel();
        throw new Error("Addon download size did not match GitHub release metadata");
      }
    }

    let downloadedBytes = 0;
    const byteLimiter = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += Buffer.byteLength(chunk);
        if (downloadedBytes > maximumBytes) {
          callback(new Error(`Download exceeded the ${maximumBytes}-byte size limit`));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      byteLimiter,
      fs.createWriteStream(destPath, { flags: "wx" }),
    );
    if (downloadedBytes !== expectedBytes) {
      throw new Error("Addon download size did not match GitHub release metadata");
    }
  } catch (error) {
    await fs.promises.rm(destPath, { force: true }).catch(() => {});
    if (timedOut) {
      throw new Error(`Download timed out after ${NETWORK_DOWNLOAD_TIMEOUT_MS}ms`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const unzipper = await import("unzipper");
  const resolvedDest = resolve(destDir);
  const directory = await unzipper.Open.file(zipPath);
  if (directory.files.length > MAX_ADDON_ARCHIVE_ENTRIES) {
    throw new Error(`Addon archive contains more than ${MAX_ADDON_ARCHIVE_ENTRIES} entries`);
  }

  let extractedBytes = 0;
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
      const byteLimiter = new Transform({
        transform(chunk, _encoding, callback) {
          extractedBytes += Buffer.byteLength(chunk);
          if (extractedBytes > MAX_ADDON_EXTRACTED_BYTES) {
            callback(
              new Error(`Addon archive expands beyond the ${MAX_ADDON_EXTRACTED_BYTES}-byte limit`),
            );
            return;
          }
          callback(null, chunk);
        },
      });
      await pipeline(file.stream(), byteLimiter, fs.createWriteStream(outPath, { flags: "wx" }));
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

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function verifyAddonPackage(
  zipPath: string,
  checksumPath: string,
  expectedDigest: string | null,
): Promise<void> {
  const checksumContent = await fs.promises.readFile(checksumPath, "utf-8");
  const expectedHash = checksumContent.trim().split(/\s+/)[0] ?? "";
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
    throw new Error("Invalid addon checksum format");
  }
  const actualHash = await computeFileSha256(zipPath);
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("Checksum mismatch - addon package may be corrupted or tampered with");
  }
  if (expectedDigest && expectedDigest !== `sha256:${actualHash.toLowerCase()}`) {
    throw new Error("Addon package digest did not match GitHub release metadata");
  }
}

async function downloadAddonPackage(
  release: AddonReleaseInfo,
  zipPath: string,
  checksumPath: string,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(zipPath), { recursive: true });
  await downloadFile(release.url, zipPath, MAX_ADDON_ARCHIVE_BYTES, release.archiveSize);
  await downloadFile(
    release.checksumUrl,
    checksumPath,
    MAX_ADDON_CHECKSUM_BYTES,
    release.checksumSize,
  );
  await verifyAddonPackage(zipPath, checksumPath, release.archiveDigest);
}

async function resolveExtractedAddonSource(extractDir: string): Promise<string> {
  const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  if (dirs.length !== 1) return extractDir;

  const directory = dirs[0];
  if (!directory) return extractDir;
  const candidate = resolve(extractDir, directory.name);
  if (!candidate.startsWith(resolve(extractDir) + sep)) {
    throw new Error("Path traversal detected in zip archive");
  }
  return candidate;
}

async function validateExtractedAddonSource(
  addonSource: string,
  expectedVersion: string,
): Promise<void> {
  const tocPath = join(addonSource, "wow-dashboard.toc");
  const tocContent = await fs.promises.readFile(tocPath, "utf-8");
  const manifestFiles = parseAddonTocManifest(tocContent, expectedVersion);

  await Promise.all(
    manifestFiles.map(async (manifestPath) => {
      const filePath = resolve(addonSource, ...manifestPath.split("/"));
      const relativePath = path.relative(resolve(addonSource), filePath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(`Addon TOC path escapes the archive: ${manifestPath}`);
      }
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) throw new Error(`Addon TOC entry is not a file: ${manifestPath}`);
    }),
  );
}

async function validateAddonArchive(zipPath: string, expectedVersion: string): Promise<void> {
  const extractDir = await fs.promises.mkdtemp(join(os.tmpdir(), "wow-dashboard-addon-validate-"));
  try {
    await extractZip(zipPath, extractDir);
    await validateExtractedAddonSource(
      await resolveExtractedAddonSource(extractDir),
      expectedVersion,
    );
  } finally {
    await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function installAddonFromPackage(
  retailPath: string,
  zipPath: string,
  checksumPath: string,
  expectedVersion: string,
  expectedDigest: string | null,
) {
  await verifyAddonPackage(zipPath, checksumPath, expectedDigest);

  const extractDir = await fs.promises.mkdtemp(join(os.tmpdir(), "wow-dashboard-addon-extract-"));
  const addonsDir = join(retailPath, "Interface", "AddOns");
  const addonDest = join(addonsDir, "wow-dashboard");
  const installId = `${process.pid}-${crypto.randomUUID()}`;
  const stagedDest = join(addonsDir, `.wow-dashboard-install-${installId}`);
  const backupDest = join(addonsDir, `.wow-dashboard-backup-${installId}`);

  try {
    await extractZip(zipPath, extractDir);
    const addonSrc = await resolveExtractedAddonSource(extractDir);
    await validateExtractedAddonSource(addonSrc, expectedVersion);

    await fs.promises.mkdir(addonsDir, { recursive: true });
    await fs.promises.cp(addonSrc, stagedDest, { recursive: true });
    await replaceDirectoryAtomically({
      rootDirectory: addonsDir,
      targetDirectory: addonDest,
      stagedDirectory: stagedDest,
      backupDirectory: backupDest,
      onCleanupError: (error) => {
        console.warn("[wow-dashboard] Installed addon but could not clean up:", error);
      },
    });
  } finally {
    await fs.promises.rm(stagedDest, { recursive: true, force: true }).catch(() => {});
    await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function fetchLatestAddonRelease(): Promise<AddonReleaseInfo> {
  const requestOptions = withNetworkTimeout({
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const refsResponse = await net.fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/git/matching-refs/tags/addon-v`,
    requestOptions,
  );
  if (!refsResponse.ok) throw new Error(`GitHub API error: ${refsResponse.status}`);
  const releaseTags = parseAddonReleaseTags(await refsResponse.json());
  if (releaseTags.length === 0) throw new Error("No addon release tag found on GitHub");

  for (const tagName of releaseTags.slice(0, 10)) {
    const releaseResponse = await net.fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${encodeURIComponent(tagName)}`,
      withNetworkTimeout({
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }),
    );
    if (releaseResponse.status === 404) {
      await releaseResponse.body?.cancel();
      continue;
    }
    if (!releaseResponse.ok) {
      await releaseResponse.body?.cancel();
      throw new Error(`GitHub API error: ${releaseResponse.status}`);
    }
    return parseLatestAddonRelease([await releaseResponse.json()], GITHUB_REPO, {
      archiveBytes: MAX_ADDON_ARCHIVE_BYTES,
      checksumBytes: MAX_ADDON_CHECKSUM_BYTES,
    });
  }

  throw new Error("No published addon release found for the newest addon tags");
}

function exposeAddonReleaseInfo(release: AddonReleaseInfo): ExposedAddonReleaseInfo {
  return {
    version: release.version,
  };
}

async function readStagedAddonUpdate(): Promise<StagedAddonUpdate | null> {
  try {
    const raw = await fs.promises.readFile(getStagedAddonMetaPath(), "utf-8");
    return parseStagedAddonUpdate(JSON.parse(raw), GITHUB_REPO);
  } catch {
    return null;
  }
}

async function clearStagedAddonUpdate(): Promise<void> {
  await fs.promises.rm(getAddonUpdateStageDir(), { recursive: true, force: true }).catch(() => {});
}

async function stagedAddonPayloadExists(): Promise<boolean> {
  try {
    await Promise.all([
      fs.promises.access(getStagedAddonZipPath(), fs.constants.F_OK),
      fs.promises.access(getStagedAddonChecksumPath(), fs.constants.F_OK),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function stagedAddonDirectoryExists(): Promise<boolean> {
  try {
    await fs.promises.access(getAddonUpdateStageDir(), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function stageAddonRelease(release: AddonReleaseInfo): Promise<void> {
  const userDataDirectory = app.getPath("userData");
  await fs.promises.mkdir(userDataDirectory, { recursive: true });
  const stageId = `${process.pid}-${crypto.randomUUID()}`;
  const stagedDirectory = join(userDataDirectory, `.addon-update-install-${stageId}`);
  const backupDirectory = join(userDataDirectory, `.addon-update-backup-${stageId}`);
  const zipPath = join(stagedDirectory, "wow-dashboard.zip");
  const checksumPath = join(stagedDirectory, "wow-dashboard.zip.sha256");

  await fs.promises.mkdir(stagedDirectory);
  try {
    await downloadAddonPackage(release, zipPath, checksumPath);
    await validateAddonArchive(zipPath, release.version);
    const metadata: StagedAddonUpdate = {
      version: release.version,
      checksumUrl: release.checksumUrl,
      downloadedAt: Date.now(),
      archiveDigest: release.archiveDigest,
    };
    await fs.promises.writeFile(
      join(stagedDirectory, "staged.json"),
      JSON.stringify(metadata, null, 2),
      "utf-8",
    );
    await replaceDirectoryAtomically({
      rootDirectory: userDataDirectory,
      targetDirectory: getAddonUpdateStageDir(),
      stagedDirectory,
      backupDirectory,
      onCleanupError: (error) => {
        console.warn("[wow-dashboard] Staged addon update but could not clean up:", error);
      },
    });
  } finally {
    await fs.promises.rm(stagedDirectory, { recursive: true, force: true }).catch(() => {});
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
    await downloadAddonPackage(release, zipPath, checksumPath);
    await installAddonFromPackage(
      retailPath,
      zipPath,
      checksumPath,
      release.version,
      release.archiveDigest,
    );
  } finally {
    await fs.promises.rm(downloadDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getUsableStagedAddonUpdate(): Promise<StagedAddonUpdate | null> {
  const staged = await readStagedAddonUpdate();
  if (!staged) {
    if (await stagedAddonDirectoryExists()) {
      await clearStagedAddonUpdate();
      updateAddonUpdateState({ stagedVersion: null });
    }
    return null;
  }
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
        staged.version,
        staged.archiveDigest,
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
          staged.checksumUrl === latestRelease.checksumUrl &&
          staged.archiveDigest === latestRelease.archiveDigest
        ) {
          updateAddonUpdateState({
            status: "staged",
            stagedVersion: staged.version,
            error: null,
          });
        } else {
          await stageAddonRelease(latestRelease);
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

async function getDesktopAutoUpdater(): Promise<DesktopAutoUpdater> {
  desktopAutoUpdaterLoad ??= import("electron-updater")
    .then(({ autoUpdater }) => {
      desktopAutoUpdater = autoUpdater;
      return autoUpdater;
    })
    .catch((error) => {
      desktopAutoUpdaterLoad = null;
      throw error;
    });
  return desktopAutoUpdaterLoad;
}

function registerAppUpdaterListeners(): Promise<void> {
  if (appUpdaterRegistration) return appUpdaterRegistration;

  appUpdaterRegistration = (async () => {
    const autoUpdater = await getDesktopAutoUpdater();
    if (appUpdaterListenersRegistered) return;
    appUpdaterListenersRegistered = true;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

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
  })().catch((error) => {
    appUpdaterRegistration = null;
    throw error;
  });

  return appUpdaterRegistration;
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

  let autoUpdater: DesktopAutoUpdater;
  try {
    await registerAppUpdaterListeners();
    autoUpdater = await getDesktopAutoUpdater();
  } catch (error) {
    updateAppUpdateState({
      status: "error",
      progressPercent: null,
      error: error instanceof Error ? error.message : String(error),
      lastCheckedAt: Date.now(),
    });
    throw error;
  }

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

async function initializeAddonRuntime(): Promise<void> {
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

  await applyStagedAddonUpdateIfReady().catch((error) => {
    console.warn("[wow-dashboard] Failed to apply staged addon update on launch:", error);
  });
  if (isQuitting) return;

  void startAddonWatcher().catch((error) => {
    console.warn("[wow-dashboard] Failed to start addon watcher:", error);
  });
  scheduleBackgroundAddonSync("startup catch-up", ADDON_STARTUP_SYNC_DELAY_MS);

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
  addonSyncTimer = setInterval(() => {
    triggerBackgroundAddonSync("fallback interval");
  }, getConfiguredAddonSyncIntervalMs());
}

function initializeAppUpdateRuntime(): void {
  if (!app.isPackaged) {
    updateAppUpdateState({
      status: "unsupported",
      availableVersion: null,
      downloadedVersion: null,
      progressPercent: null,
      error: null,
    });
    return;
  }

  updateAppUpdateState({
    status: "idle",
    availableVersion: null,
    downloadedVersion: null,
    progressPercent: null,
    error: null,
  });

  appUpdateStartupTimer = setTimeout(() => {
    appUpdateStartupTimer = null;
    if (isQuitting) return;
    void triggerAppUpdateCheck().catch((error) => {
      console.warn("[wow-dashboard] Failed to check for app updates:", error);
    });
  }, APP_UPDATE_STARTUP_DELAY_MS);
  appUpdateCheckTimer = setInterval(() => {
    void triggerAppUpdateCheck().catch((error) => {
      console.warn("[wow-dashboard] Failed to check for app updates:", error);
    });
  }, getConfiguredAppUpdateCheckIntervalMs());
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
});

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
    showWindow();
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  configureDefaultSessionSecurity();
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
  await loadStoredAuth();

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

  if (process.platform !== "win32" || !launchMinimizedCache) {
    pendingWindowReveal = true;
    createWindow();
  }
  void createTray().catch((error) => {
    console.warn("[wow-dashboard] Failed to create tray:", error);
  });
  initializeAppUpdateRuntime();
  void initializeAddonRuntime().catch((error) => {
    console.warn("[wow-dashboard] Failed to initialize addon runtime:", error);
  });

  // A protocol URL can launch a new app process (for example after an update)
  // instead of arriving through second-instance. Redeem it after safeStorage
  // and the runtime are ready, even when no renderer login promise survived.
  desktopAuthRuntimeReady = true;
  const startupDeepLink = queuedDesktopAuthDeepLink ?? findDesktopAuthDeepLink(process.argv);
  queuedDesktopAuthDeepLink = null;
  if (startupDeepLink) {
    handleDeepLink(startupDeepLink);
  }

  app.on("activate", () => {
    showWindow();
  });
});

app.on("before-quit", () => {
  prepareForQuit();
});

nativeAutoUpdater.on("before-quit-for-update", () => {
  prepareForQuit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && closeBehaviorCache !== "tray") app.quit();
});
