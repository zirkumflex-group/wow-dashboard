import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "@wow-dashboard/api-client";
import { env } from "@wow-dashboard/env/app";
import type { DesktopAuthSessionState } from "../../shared/auth";
import type {
  AddonUpdateCheckResult,
  AddonUpdateState,
  AppInstallUpdateResult,
  AppUpdateState,
} from "../../shared/update";
import { apiClient, apiQueryKeys, apiQueryOptions } from "./lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapshotData {
  takenAt: number;
  level: number;
  spec: string;
  role: "tank" | "healer" | "dps";
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  playtimeThisLevelSeconds?: number;
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
  members?: {
    name: string;
    realm?: string;
    classTag?: string;
    role?: "tank" | "healer" | "dps";
  }[];
}

interface CharacterData {
  name: string;
  realm: string;
  region: "us" | "eu" | "kr" | "tw";
  class: string;
  race: string;
  faction: "alliance" | "horde";
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

interface PendingUploadCounts {
  snapshots: number;
  mythicPlusRuns: number;
}

interface AppSettings {
  closeBehavior: "tray" | "exit";
  autostart: boolean;
  launchMinimized: boolean;
  lastSyncedAt: number;
}

const INITIAL_APP_UPDATE_STATE: AppUpdateState = {
  status: "idle",
  currentVersion: "",
  availableVersion: null,
  downloadedVersion: null,
  progressPercent: null,
  error: null,
  lastCheckedAt: null,
  isPackaged: false,
};

const INITIAL_ADDON_UPDATE_STATE: AddonUpdateState = {
  status: "idle",
  installedVersion: null,
  latestVersion: null,
  stagedVersion: null,
  error: null,
  lastCheckedAt: null,
};

// ---------------------------------------------------------------------------
// Type augmentation for window.electron
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    electron: {
      version: string;
      auth: {
        login: () => Promise<boolean>;
        getToken: () => Promise<string | null>;
        getSession: () => Promise<DesktopAuthSessionState>;
        logout: () => Promise<boolean>;
      };
      wow: {
        getRetailPath: () => Promise<string | null>;
        selectRetailFolder: () => Promise<string | null>;
        readAddonData: () => Promise<{
          characters: CharacterData[];
          accountsFound: string[];
          fileStats: AddonFileStats | null;
        } | null>;
        checkAddonInstalled: () => Promise<boolean>;
        getInstalledAddonVersion: () => Promise<string | null>;
        installAddon: (downloadUrl: string, checksumUrl: string | null) => Promise<void>;
        getLatestAddonRelease: () => Promise<{ url: string; checksumUrl: string | null; version: string }>;
        getAddonUpdateStatus: () => Promise<AddonUpdateState>;
        triggerAddonUpdateCheck: () => Promise<AddonUpdateCheckResult>;
        watchAddonFile: () => Promise<boolean>;
        unwatchAddonFile: () => Promise<void>;
        onAddonFileChanged: (cb: () => void) => () => void;
        onAddonUpdateStaged: (cb: (version: string) => void) => () => void;
        onAddonUpdateApplied: (cb: (version: string) => void) => () => void;
        onAddonUpdateState: (cb: (state: AddonUpdateState) => void) => () => void;
      };
      settings: {
        getAppSettings: () => Promise<AppSettings>;
        setCloseBehavior: (value: "tray" | "exit") => Promise<void>;
        setAutostart: (value: boolean) => Promise<void>;
        setLaunchMinimized: (value: boolean) => Promise<void>;
        setLastSyncedAt: (value: number) => Promise<void>;
      };
      openExternal: (url: string) => Promise<void>;
      getVersion: () => Promise<string>;
      getUpdateStatus: () => Promise<AppUpdateState>;
      installUpdate: () => Promise<AppInstallUpdateResult>;
      checkForUpdates: () => Promise<void>;
      updates: {
        getStatus: () => Promise<AppUpdateState>;
        onUpdateState: (cb: (state: AppUpdateState) => void) => () => void;
        onUpdateAvailable: (cb: (version: string) => void) => () => void;
        onUpdateDownloaded: (cb: (version: string) => void) => () => void;
        onUpdateNotAvailable: (cb: () => void) => () => void;
      };
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level auth token store (shared across hook instances)
// ---------------------------------------------------------------------------
let _token: string | null | undefined = undefined; // undefined = still loading
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((fn) => fn());
}

async function _clearToken(): Promise<void> {
  try {
    await window.electron.auth.logout();
  } catch {
    // Best effort; local auth state is still cleared below.
  }
  _token = null;
  _notify();
}

async function _fetchToken(): Promise<string | null> {
  let token: string | null = null;

  try {
    token = await window.electron.auth.getToken();
    if (!token) {
      _token = null;
      _notify();
      return null;
    }

    const sessionState = await window.electron.auth.getSession();
    if (sessionState.status === "unauthenticated") {
      await _clearToken();
      return null;
    }

    _token = token;
    _notify();
    return token;
  } catch {
    // Preserve the local token on transient validation failures. The API client
    // will still surface request-level auth errors if the session has actually expired.
    _token = token;
    _notify();
    return token;
  }
}

// Kick off initial token fetch as soon as the module loads
_fetchToken();

function useElectronAuth() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const update = () => forceUpdate((n) => n + 1);
    _listeners.add(update);
    return () => {
      _listeners.delete(update);
    };
  }, []);

  return useMemo(
    () => ({
      isLoading: _token === undefined,
      isAuthenticated: _token !== null && _token !== undefined,
    }),
    [_token],
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidRetailPath(path: string): boolean {
  const lastSegment =
    path
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .pop() ?? "";
  return lastSegment.toLowerCase() === "_retail_";
}

function isOutdated(installed: string, latest: string): boolean {
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatLastSyncTime(lastSyncedAt: number) {
  if (lastSyncedAt <= 0) return "Never";
  return formatDateTime(lastSyncedAt * 1000);
}

function hasUploadableSnapshotSpec(spec: string) {
  const normalized = spec.trim();
  return normalized !== "" && normalized !== "Unknown";
}

function isUploadableSnapshot(snapshot: SnapshotData, sinceTs: number) {
  return snapshot.takenAt > sinceTs && hasUploadableSnapshotSpec(snapshot.spec);
}

const MYTHIC_PLUS_UPLOAD_LOOKBACK_SECONDS = 2 * 60 * 60;

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

function isUploadableMythicPlusRun(run: MythicPlusRunData, sinceTs: number) {
  const nowTs = Math.floor(Date.now() / 1000);
  const effectiveSinceTs = Math.min(sinceTs, nowTs - MYTHIC_PLUS_UPLOAD_LOOKBACK_SECONDS);
  const lastMutationAt = getMythicPlusRunLastMutationAt(run);
  return lastMutationAt > effectiveSinceTs;
}

function getPendingUploadCounts(
  chars: CharacterData[],
  sinceTs: number,
): PendingUploadCounts {
  return chars.reduce(
    (totals, char) => ({
      snapshots: totals.snapshots + char.snapshots.filter((snapshot) => isUploadableSnapshot(snapshot, sinceTs)).length,
      mythicPlusRuns:
        totals.mythicPlusRuns +
        char.mythicPlusRuns.filter((run) => isUploadableMythicPlusRun(run, sinceTs)).length,
    }),
    { snapshots: 0, mythicPlusRuns: 0 },
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <p className="text-sm text-gray-400">Loading…</p>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginUrl = new URL("/auth/electron-login", env.VITE_SITE_URL).toString();

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      await onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="space-y-6 text-center">
        <div>
          <h1 className="text-4xl font-bold text-white">WoW Dashboard</h1>
          <p className="mt-2 text-gray-400">Sign in to continue</p>
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Opening Battle.net…" : "Login with Battle.net"}
        </button>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {(error || !loading) && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              If your browser doesn&apos;t open automatically, open this URL manually:
            </p>
            <p className="rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-left font-mono text-xs text-gray-300 select-text break-all">
              {loginUrl}
            </p>
          </div>
        )}

        <p className="text-xs text-gray-600">Requires the web app running on {env.VITE_SITE_URL}</p>
      </div>
    </div>
  );
}

interface Toggle {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
}

function SwitchRow({ checked, onChange, label }: Toggle) {
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-sm text-gray-300">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative focus:outline-none"
      >
        <div
          className={`h-5 w-9 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-gray-600"}`}
        />
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
    </label>
  );
}

function Dashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const uploadAddon = useMutation({
    mutationFn: (input: { characters: CharacterData[] }) =>
      apiClient.ingestAddonData({
        characters: input.characters as Parameters<typeof apiClient.ingestAddonData>[0]["characters"],
      }),
  });
  const resync = useMutation({
    mutationFn: () => apiClient.resyncCharacters(),
  });
  const characters = useQuery(apiQueryOptions.myCharacters()).data;

  const [syncing, setSyncing] = useState(false);
  const [retailPath, setRetailPath] = useState<string | null>(null);
  const [closeBehavior, setCloseBehavior] = useState<"tray" | "exit">("tray");
  const [autostart, setAutostart] = useState(false);
  const [launchMinimized, setLaunchMinimized] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState(0);
  const [addonInstalled, setAddonInstalled] = useState<boolean | null>(null);
  const [addonVersion, setAddonVersion] = useState<string | null>(null);
  const [addonUpdateState, setAddonUpdateState] = useState<AddonUpdateState>(INITIAL_ADDON_UPDATE_STATE);
  const [installing, setInstalling] = useState(false);
  const [addonActionError, setAddonActionError] = useState<string | null>(null);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState>(INITIAL_APP_UPDATE_STATE);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [appActionError, setAppActionError] = useState<string | null>(null);

  // Upload / file status
  const [pendingUploadCounts, setPendingUploadCounts] = useState<PendingUploadCounts | null>(null);
  const [watchingFile, setWatchingFile] = useState(false);
  const [addonFileStats, setAddonFileStats] = useState<AddonFileStats | null>(null);
  const [lastUploadResult, setLastUploadResult] = useState<{
    newChars: number;
    newSnapshots: number;
    newMythicPlusRuns: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadWarn, setUploadWarn] = useState<string | null>(null);

  const syncingRef = useRef(false);
  const lastSyncedAtRef = useRef(0);
  // Always points to the latest doUpload closure so stale-closure effects stay current.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doUploadRef = useRef<() => Promise<void>>(null as any);
  const applyAddonUpdateSnapshot = useCallback((state: AddonUpdateState) => {
    setAddonUpdateState(state);
    if (state.installedVersion) {
      setAddonInstalled(true);
      setAddonVersion(state.installedVersion);
      return;
    }
    if (state.status === "notInstalled") {
      setAddonInstalled(false);
      setAddonVersion(null);
    }
  }, []);
  const applyAddonFileState = useCallback(
    (chars: CharacterData[], fileStats: AddonFileStats | null, sinceTs: number) => {
      setPendingUploadCounts(getPendingUploadCounts(chars, sinceTs));
      setAddonFileStats(fileStats);
    },
    [],
  );
  const refreshAddonFileState = useCallback(async () => {
    if (!retailPath) {
      setPendingUploadCounts(null);
      setAddonFileStats(null);
      return;
    }

    try {
      const addonData = await window.electron.wow.readAddonData();
      if (!addonData) {
        setPendingUploadCounts(null);
        setAddonFileStats(null);
        return;
      }

      const { characters: chars, fileStats } = addonData;
      const sinceTs = lastSyncedAtRef.current - 60;
      applyAddonFileState(chars, fileStats, sinceTs);
    } catch {
      setPendingUploadCounts({ snapshots: 0, mythicPlusRuns: 0 });
      setAddonFileStats(null);
    }
  }, [applyAddonFileState, retailPath]);

  // Load persisted settings on mount
  useEffect(() => {
    let cancelled = false;

    const cleanupFns = [
      window.electron.updates.onUpdateState((state) => {
        if (cancelled) return;
        setAppUpdateState(state);
        setAppVersion(state.currentVersion || null);
        if (state.status !== "error") {
          setAppActionError(null);
        }
      }),
      window.electron.wow.onAddonUpdateState((state) => {
        if (cancelled) return;
        applyAddonUpdateSnapshot(state);
        if (state.status !== "error") {
          setAddonActionError(null);
        }
      }),
      window.electron.wow.onAddonUpdateStaged((version) => {
        if (cancelled) return;
        setAddonActionError(null);
        setAddonUpdateState((current) => ({
          ...current,
          status: "staged",
          latestVersion: current.latestVersion ?? version,
          stagedVersion: version,
          error: null,
        }));
      }),
      window.electron.wow.onAddonUpdateApplied((version) => {
        if (cancelled) return;
        setAddonActionError(null);
        setAddonInstalled(true);
        setAddonVersion(version);
        setAddonUpdateState((current) => ({
          ...current,
          status: "applied",
          installedVersion: version,
          latestVersion: version,
          stagedVersion: null,
          error: null,
        }));
      }),
    ];

    void Promise.allSettled([
      window.electron.getVersion(),
      window.electron.updates.getStatus(),
      window.electron.wow.getRetailPath(),
      window.electron.settings.getAppSettings(),
      window.electron.wow.getAddonUpdateStatus(),
    ]).then(([versionResult, appUpdateResult, retailPathResult, settingsResult, addonUpdateResult]) => {
      if (cancelled) return;

      if (versionResult.status === "fulfilled") {
        setAppVersion(versionResult.value);
      } else {
        console.warn("[wow-dashboard] Failed to hydrate app version:", versionResult.reason);
      }

      if (appUpdateResult.status === "fulfilled") {
        setAppUpdateState(appUpdateResult.value);
        setAppVersion((currentVersion) => appUpdateResult.value.currentVersion || currentVersion);
      } else {
        console.warn(
          "[wow-dashboard] Failed to hydrate desktop update state:",
          appUpdateResult.reason,
        );
      }

      if (retailPathResult.status === "fulfilled") {
        setRetailPath(retailPathResult.value);
      } else {
        console.warn("[wow-dashboard] Failed to hydrate WoW retail path:", retailPathResult.reason);
      }

      if (settingsResult.status === "fulfilled") {
        setCloseBehavior(settingsResult.value.closeBehavior);
        setAutostart(settingsResult.value.autostart);
        setLaunchMinimized(settingsResult.value.launchMinimized);
        setLastSyncedAt(settingsResult.value.lastSyncedAt);
        lastSyncedAtRef.current = settingsResult.value.lastSyncedAt;
      } else {
        console.warn("[wow-dashboard] Failed to hydrate app settings:", settingsResult.reason);
      }

      if (addonUpdateResult.status === "fulfilled") {
        applyAddonUpdateSnapshot(addonUpdateResult.value);
      } else {
        console.warn(
          "[wow-dashboard] Failed to hydrate addon update state:",
          addonUpdateResult.reason,
        );
      }
    });

    return () => {
      cancelled = true;
      cleanupFns.forEach((cleanup) => cleanup());
    };
  }, [applyAddonUpdateSnapshot]);

  // Check addon and read file snapshot count whenever retailPath changes
  useEffect(() => {
    if (!retailPath) {
      setAddonInstalled(null);
      setAddonVersion(null);
      setPendingUploadCounts(null);
      setAddonFileStats(null);
      void window.electron.wow.unwatchAddonFile();
      setWatchingFile(false);
      return;
    }

    let cancelled = false;

    void Promise.allSettled([
      window.electron.wow.watchAddonFile(),
      window.electron.wow.checkAddonInstalled(),
      window.electron.wow.getInstalledAddonVersion(),
      window.electron.wow.getAddonUpdateStatus(),
    ]).then(([watchResult, installedResult, installedVersionResult, updateStateResult]) => {
      if (cancelled) return;

      setWatchingFile(watchResult.status === "fulfilled" ? watchResult.value : false);
      if (watchResult.status === "rejected") {
        console.warn("[wow-dashboard] Failed to start addon watcher:", watchResult.reason);
      }

      if (installedResult.status === "fulfilled") {
        setAddonInstalled(installedResult.value);
      }

      if (installedVersionResult.status === "fulfilled") {
        setAddonVersion(installedVersionResult.value);
      }

      if (updateStateResult.status === "fulfilled") {
        applyAddonUpdateSnapshot(updateStateResult.value);
      }

      void refreshAddonFileState();
    });

    return () => {
      cancelled = true;
      void window.electron.wow.unwatchAddonFile();
      setWatchingFile(false);
    };
  }, [applyAddonUpdateSnapshot, refreshAddonFileState, retailPath]);

  async function handleCloseBehaviorChange(value: boolean) {
    const behavior = value ? "tray" : "exit";
    setCloseBehavior(behavior);
    await window.electron.settings.setCloseBehavior(behavior);
  }

  async function handleAutostartChange(value: boolean) {
    setAutostart(value);
    await window.electron.settings.setAutostart(value);
  }

  async function handleLaunchMinimizedChange(value: boolean) {
    setLaunchMinimized(value);
    await window.electron.settings.setLaunchMinimized(value);
  }

  async function handleInstallAddon() {
    if (!retailPath) return;
    setInstalling(true);
    setAddonActionError(null);
    try {
      const { url, checksumUrl, version } = await window.electron.wow.getLatestAddonRelease();
      await window.electron.wow.installAddon(url, checksumUrl ?? null);
      setAddonInstalled(true);
      setAddonVersion(version);
      setAddonUpdateState((current) => ({
        ...current,
        status: "applied",
        installedVersion: version,
        latestVersion: current.latestVersion ?? version,
        stagedVersion: null,
        error: null,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAddonActionError(msg);
    } finally {
      setInstalling(false);
    }
  }

  async function handleCheckAppUpdate() {
    setAppActionError(null);
    try {
      await window.electron.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAppActionError(message);
    }
  }

  async function handleInstallAppUpdate() {
    setAppActionError(null);
    try {
      const result = await window.electron.installUpdate();
      if (!result.ok && result.message) {
        setAppActionError(result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAppActionError(message);
    }
  }

  async function handleCheckAddonUpdate() {
    setAddonActionError(null);
    try {
      const result = await window.electron.wow.triggerAddonUpdateCheck();
      if (result.error) {
        setAddonActionError(result.error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAddonActionError(message);
    }
  }

  async function handleSelectFolder() {
    const folder = await window.electron.wow.selectRetailFolder();
    if (folder) {
      setRetailPath(folder);
      setLastUploadResult(null);
      setUploadError(null);
      setUploadWarn(null);
      setAddonActionError(null);
      setPendingUploadCounts(null);
      const installed = await window.electron.wow.checkAddonInstalled();
      setAddonInstalled(installed);
    }
  }

  async function doUpload() {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setUploadError(null);
    setUploadWarn(null);
    try {
      if (retailPath) {
        const addonData = await window.electron.wow.readAddonData();
        if (!addonData) return;
        const { characters: addonChars, accountsFound, fileStats } = addonData;
        const preUploadSinceTs = lastSyncedAtRef.current - 60;
        applyAddonFileState(addonChars, fileStats, preUploadSinceTs);

        if (addonChars.length === 0) {
          setUploadWarn(
            accountsFound.length === 0
              ? "No wow-dashboard.lua found — run the addon in-game first"
              : `Parsed ${accountsFound.length} account(s) but no characters found`,
          );
        } else {
          // Only send records newer than the last successful sync (60s buffer for clock skew).
          const sinceTs = preUploadSinceTs;
          const pendingChars = addonChars
            .map((c) => ({
              ...c,
              snapshots: c.snapshots.filter((snapshot) => isUploadableSnapshot(snapshot, sinceTs)),
              mythicPlusRuns: c.mythicPlusRuns.filter((run) => isUploadableMythicPlusRun(run, sinceTs)),
            }))
            .filter((c) => c.snapshots.length > 0 || c.mythicPlusRuns.length > 0);

          if (pendingChars.length > 0) {
            const result = await uploadAddon.mutateAsync({
              characters: pendingChars,
            });
            setLastUploadResult({
              newChars: result.newChars,
              newSnapshots: result.newSnapshots,
              newMythicPlusRuns: result.newMythicPlusRuns,
            });
            const now = Math.floor(Date.now() / 1000);
            setLastSyncedAt(now);
            lastSyncedAtRef.current = now;
            await window.electron.settings.setLastSyncedAt(now);
            applyAddonFileState(addonChars, fileStats, now - 60);
          } else {
            setLastUploadResult({ newChars: 0, newSnapshots: 0, newMythicPlusRuns: 0 });
          }
        }
      } else {
        setUploadWarn("No WoW folder set — select the folder first");
      }

      // Resync from Battle.net
      await resync.mutateAsync();
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.myCharacters(),
      });
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        await _clearToken();
        queryClient.clear();
        setUploadError("Session expired — please sign in again.");
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("RateLimited") || msg.includes("Too many")) {
        setUploadError("Too many requests — please wait a moment before trying again.");
      } else {
        setUploadError(`Upload failed: ${msg}`);
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  // Keep ref current so effects with empty deps always call the latest closure.
  doUploadRef.current = doUpload;

  // 15-minute fallback sync; primary sync is triggered by the file watcher.
  useEffect(() => {
    const id = setInterval(() => {
      void doUploadRef.current();
    }, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Register file-change listener once on mount.
  useEffect(() => {
    const unsubscribe = window.electron.wow.onAddonFileChanged(() => {
      void doUploadRef.current();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const retailPathValid = retailPath ? isValidRetailPath(retailPath) : true;
  const latestAddonVersion = addonUpdateState.latestVersion;
  const addonStagedVersion = addonUpdateState.stagedVersion;
  const appUpdateReadyVersion = appUpdateState.downloadedVersion;
  const showAddonOutdated =
    addonInstalled && addonVersion && latestAddonVersion
      ? isOutdated(addonVersion, latestAddonVersion)
      : false;
  const displayedAppVersion = appUpdateState.currentVersion || appVersion;
  const appUpdateError =
    appActionError ?? (appUpdateState.status === "error" ? appUpdateState.error : null);
  const addonUpdateError =
    addonActionError ??
    (addonUpdateState.status === "error" || addonUpdateState.status === "invalidRetailPath"
      ? addonUpdateState.error
      : null);
  const appCheckDisabled =
    appUpdateState.status === "checking" ||
    appUpdateState.status === "available" ||
    appUpdateState.status === "downloading" ||
    appUpdateState.status === "downloaded" ||
    appUpdateState.status === "installing" ||
    appUpdateState.status === "unsupported";
  const appCheckButtonLabel =
    appUpdateState.status === "checking"
      ? "Checking…"
      : appUpdateState.status === "downloading"
        ? appUpdateState.progressPercent !== null
          ? `Downloading ${Math.round(appUpdateState.progressPercent)}%`
          : "Downloading…"
        : appUpdateState.status === "installing"
          ? "Installing…"
        : appUpdateState.status === "upToDate"
          ? "Up to date"
          : appUpdateState.status === "downloaded"
            ? "Update ready"
            : appUpdateState.status === "unsupported"
              ? "Updates unavailable in dev"
              : "Check for Updates";
  const addonCheckDisabled =
    installing ||
    addonUpdateState.status === "checking" ||
    addonUpdateState.status === "updating";
  const checkingAddonUpdate =
    addonUpdateState.status === "checking" || addonUpdateState.status === "updating";
  const addonUpToDate =
    addonUpdateState.status === "upToDate" || addonUpdateState.status === "applied";

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">WoW Dashboard</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => window.electron.openExternal("https://wow.zirkumflex.io")}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Open Dashboard ↗
            </button>
            <button onClick={onLogout} className="text-sm text-gray-400 hover:text-white">
              Sign out
            </button>
          </div>
        </div>

        {/* App update banners */}
        {appUpdateState.status === "downloaded" && appUpdateReadyVersion && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-green-700 bg-green-950 px-4 py-3 text-sm text-green-300">
            <p>
              App v{appUpdateReadyVersion} is ready to install. It will still install
              automatically the next time WoW Dashboard fully exits.
            </p>
            <button
              onClick={handleInstallAppUpdate}
              className="shrink-0 rounded bg-green-400 px-3 py-1.5 text-sm font-medium text-green-950 hover:bg-green-300"
            >
              Install update &amp; restart
            </button>
          </div>
        )}
        {appUpdateState.status === "installing" && (
          <div className="rounded-lg border border-green-700 bg-green-950 px-4 py-3 text-sm text-green-300">
            Installing the desktop update and restarting WoW Dashboard…
          </div>
        )}
        {(appUpdateState.status === "available" || appUpdateState.status === "downloading") &&
          appUpdateState.availableVersion && (
          <div className="rounded-lg border border-blue-700 bg-blue-950 px-4 py-3 text-sm text-blue-300">
            App update v{appUpdateState.availableVersion} is downloading in the background
            {appUpdateState.status === "downloading" && appUpdateState.progressPercent !== null
              ? ` (${Math.round(appUpdateState.progressPercent)}%)`
              : ""}
          </div>
        )}
        {appUpdateError && (
          <div className="rounded-lg border border-red-700 bg-red-950 px-4 py-3 text-sm text-red-300">
            {appUpdateError}
          </div>
        )}
        {appUpdateState.status === "unsupported" && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-400">
            Desktop app updates are unavailable in development builds.
          </div>
        )}

        {/* Addon update banner */}
        {addonUpdateState.status === "applied" && addonVersion ? (
          <div className="rounded-lg border border-green-700 bg-green-950 px-4 py-3 text-sm text-green-300">
            Addon v{addonVersion} was applied automatically in the background. No app restart is
            required.
          </div>
        ) : addonStagedVersion ? (
          <div className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-3 text-sm text-yellow-300">
            Addon v{addonStagedVersion} is downloaded and will install automatically in the
            background. No app restart is required.
          </div>
        ) : showAddonOutdated ? (
          <div className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-3 text-sm text-yellow-300">
            Addon update available: v{addonVersion} to v{latestAddonVersion}. It will download in
            the background and install automatically.
          </div>
        ) : null}

        {/* WoW folder selector */}
        <div className="rounded-lg border border-gray-800 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-gray-300">WoW _retail_ Folder</h2>
            <button
              onClick={handleSelectFolder}
              className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-600"
            >
              Select folder…
            </button>
          </div>
          {retailPath ? (
            <div className="space-y-1">
              <p
                className={`break-all font-mono text-xs ${retailPathValid ? "text-green-400" : "text-red-400"}`}
              >
                {retailPath}
              </p>
              {!retailPathValid && (
                <p className="text-xs text-red-400">
                  Path should end with <span className="font-mono">_retail_</span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              No folder selected. The addon&apos;s SavedVariables won&apos;t be read until you pick
              your WoW <span className="font-mono">_retail_</span> folder.
            </p>
          )}
        </div>

        {/* Addon installation */}
        <div className="rounded-lg border border-gray-800 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-gray-300">WoW Addon</h2>
              {retailPath && addonInstalled !== null && (
                <>
                  <p className="mt-0.5 text-xs">
                    {addonInstalled ? (
                      <span className="text-green-400">
                        Installed{addonVersion ? ` v${addonVersion}` : ""}
                      </span>
                    ) : (
                      <span className="text-yellow-400">Not installed</span>
                    )}
                  </p>
                  {addonUpdateState.status === "checking" && (
                    <p className="mt-0.5 text-xs text-blue-400">Checking for addon updates…</p>
                  )}
                  {addonUpdateState.status === "updating" && (
                    <p className="mt-0.5 text-xs text-blue-400">
                      Downloading and applying the latest addon update…
                    </p>
                  )}
                  {addonUpdateState.status === "upToDate" && (
                    <p className="mt-0.5 text-xs text-green-400">Addon is up to date.</p>
                  )}
                  {addonUpdateState.status === "staged" && addonStagedVersion && (
                    <p className="mt-0.5 text-xs text-yellow-400">
                      Auto-update staged for v{addonStagedVersion}
                    </p>
                  )}
                  {addonUpdateState.status === "applied" && addonVersion && (
                    <p className="mt-0.5 text-xs text-green-400">
                      Auto-update applied: v{addonVersion}
                    </p>
                  )}
                  {(addonUpdateState.status === "error" ||
                    addonUpdateState.status === "invalidRetailPath") &&
                    addonUpdateError && (
                    <p className="mt-0.5 text-xs text-red-400">{addonUpdateError}</p>
                  )}
                </>
              )}
            </div>
            {retailPath ? (
              <div className="flex items-center gap-2">
                {addonInstalled && (
                  <button
                    onClick={handleCheckAddonUpdate}
                    disabled={addonCheckDisabled}
                    className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-600 disabled:opacity-50"
                  >
                    {addonStagedVersion
                      ? "Staged"
                      : checkingAddonUpdate
                        ? "Checking…"
                        : addonUpToDate
                          ? "Up to date"
                          : "Check for Updates"}
                  </button>
                )}
                <button
                  onClick={handleInstallAddon}
                  disabled={installing}
                  className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-600 disabled:opacity-50"
                >
                  {installing ? "Installing…" : addonInstalled ? "Reinstall" : "Install Addon"}
                </button>
              </div>
            ) : (
              <span className="text-xs text-gray-500">Select WoW folder first</span>
            )}
          </div>
          {addonActionError &&
            addonUpdateState.status !== "error" &&
            addonUpdateState.status !== "invalidRetailPath" && (
              <p className="text-xs text-red-400">{addonActionError}</p>
            )}
        </div>

        {/* Upload / Data Sync */}
        <div className="rounded-lg border border-gray-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-medium text-gray-300">Sync</h2>
              {watchingFile && (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                  Watching
                </span>
              )}
            </div>
            <button
              onClick={() => doUpload()}
              disabled={syncing}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Manual sync uploads addon snapshots and Mythic+ runs, then refreshes Battle.net character data.
          </p>
          <p className="text-xs text-gray-500">
            Last successful sync: {formatLastSyncTime(lastSyncedAt)}
          </p>

          {/* Status area */}
          {uploadError ? (
            <div className="rounded border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400">
              {uploadError}
            </div>
          ) : uploadWarn ? (
            <div className="rounded border border-yellow-700 bg-yellow-950 px-3 py-2 text-sm text-yellow-400">
              {uploadWarn}
            </div>
          ) : syncing ? (
            <p className="text-sm text-gray-400">Syncing data...</p>
          ) : lastUploadResult !== null ? (
            <div className="flex items-center gap-2">
              <span className="text-green-400 text-base">✓</span>
              <p className="text-sm text-green-400">All clear</p>
              {(lastUploadResult.newSnapshots > 0 || lastUploadResult.newMythicPlusRuns > 0) && (
                <span className="text-xs text-gray-500">
                  ({lastUploadResult.newSnapshots} new snapshot
                  {lastUploadResult.newSnapshots !== 1 ? "s" : ""}, {lastUploadResult.newMythicPlusRuns} new M+ run
                  {lastUploadResult.newMythicPlusRuns !== 1 ? "s" : ""} uploaded)
                </span>
              )}
            </div>
          ) : !retailPath ? (
            <p className="text-sm text-gray-500">Select the WoW folder to enable uploads.</p>
          ) : pendingUploadCounts === null ? (
            <p className="text-sm text-gray-400">Checking file…</p>
          ) : pendingUploadCounts.snapshots === 0 && pendingUploadCounts.mythicPlusRuns === 0 ? (
            <p className="text-sm text-gray-500">
              No pending addon data found. Run the addon in-game first or sync after new activity.
            </p>
          ) : (
            <p className="text-sm text-yellow-400">
              {pendingUploadCounts.snapshots} snapshot{pendingUploadCounts.snapshots !== 1 ? "s" : ""} and{" "}
              {pendingUploadCounts.mythicPlusRuns} M+ run
              {pendingUploadCounts.mythicPlusRuns !== 1 ? "s" : ""} pending upload
            </p>
          )}

          {/* Addon file metadata */}
          {addonFileStats && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-xs text-gray-500">
              <span>Total snapshots</span>
              <span className="text-gray-400">{addonFileStats.totalSnapshots.toLocaleString()}</span>
              <span>Total M+ runs</span>
              <span className="text-gray-400">{addonFileStats.totalMythicPlusRuns.toLocaleString()}</span>
              <span>File size</span>
              <span className="text-gray-400">{formatBytes(addonFileStats.totalBytes)}</span>
              <span>Created</span>
              <span className="text-gray-400">{formatDate(addonFileStats.createdAt)}</span>
              <span>Last modified</span>
              <span className="text-gray-400">{formatDate(addonFileStats.modifiedAt)}</span>
              <span>Last synced</span>
              <span className="text-gray-400">
                {formatLastSyncTime(lastSyncedAt)}
              </span>
            </div>
          )}
        </div>

        {/* Settings */}
        <div className="rounded-lg border border-gray-800 p-4 space-y-4">
          <h2 className="font-medium text-gray-300">Settings</h2>
          <SwitchRow
            checked={closeBehavior === "tray"}
            onChange={handleCloseBehaviorChange}
            label="Close Button Minimizes To Tray"
          />
          <SwitchRow
            checked={autostart}
            onChange={handleAutostartChange}
            label="Launch on Windows login"
          />
          <SwitchRow
            checked={launchMinimized}
            onChange={handleLaunchMinimizedChange}
            label="Launch minimized to tray"
          />
        </div>

        {/* Character count */}
        {characters !== undefined && (
          <p className="text-sm text-gray-500">
            {characters === null || characters.length === 0
              ? "No characters found."
              : `${characters.length} character${characters.length !== 1 ? "s" : ""} tracked.`}
          </p>
        )}

        {/* App version + update check */}
        <div className="flex items-center justify-center gap-3">
          {displayedAppVersion && <p className="text-xs text-gray-600">v{displayedAppVersion}</p>}
          <button
            onClick={handleCheckAppUpdate}
            disabled={appCheckDisabled}
            className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
          >
            {appCheckButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------
export default function App() {
  const queryClient = useQueryClient();

  async function handleLogin() {
    await window.electron.auth.login();
    await _fetchToken();
    await queryClient.invalidateQueries();
  }

  async function handleLogout() {
    await _clearToken();
    queryClient.clear();
  }

  const authState = useElectronAuth();

  return (
    <>
      {authState.isLoading ? (
        <LoadingScreen />
      ) : authState.isAuthenticated ? (
        <Dashboard onLogout={handleLogout} />
      ) : (
        <LoginScreen onLogin={handleLogin} />
      )}
      {import.meta.env.DEV && (
        <div className="fixed bottom-2 right-2 z-[9999] rounded bg-orange-500 px-2 py-0.5 text-xs font-bold text-white select-none pointer-events-none opacity-80">
          DEV
        </div>
      )}
    </>
  );
}
