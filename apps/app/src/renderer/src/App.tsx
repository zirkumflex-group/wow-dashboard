import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConvexReactClient, ConvexProviderWithAuth, useMutation, useQuery } from "convex/react";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import { env } from "@wow-dashboard/env/app";

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

interface PendingUploadCounts {
  snapshots: number;
  mythicPlusRuns: number;
}

interface MythicPlusBackfillStatus {
  needsBackfill: boolean;
  missingMapNameRuns: number;
}

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
        getSession: () => Promise<unknown>;
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
        compactAddonData: (forceIfRunning?: boolean) => Promise<CompactAddonResult>;
        checkAddonInstalled: () => Promise<boolean>;
        getInstalledAddonVersion: () => Promise<string | null>;
        installAddon: (downloadUrl: string, checksumUrl: string | null) => Promise<void>;
        getLatestAddonRelease: () => Promise<{ url: string; checksumUrl: string | null; version: string }>;
        watchAddonFile: () => Promise<void>;
        unwatchAddonFile: () => Promise<void>;
        onAddonFileChanged: (cb: () => void) => void;
      };
      settings: {
        getAppSettings: () => Promise<{ closeBehavior: "tray" | "exit"; autostart: boolean; launchMinimized: boolean; lastSyncedAt: number }>;
        setCloseBehavior: (value: "tray" | "exit") => Promise<void>;
        setAutostart: (value: boolean) => Promise<void>;
        setLaunchMinimized: (value: boolean) => Promise<void>;
        setLastSyncedAt: (value: number) => Promise<void>;
      };
      openExternal: (url: string) => Promise<void>;
      getVersion: () => Promise<string>;
      installUpdate: () => Promise<void>;
      checkForUpdates: () => Promise<void>;
      updates: {
        onUpdateAvailable: (cb: (version: string) => void) => void;
        onUpdateDownloaded: (cb: (version: string) => void) => void;
        onUpdateNotAvailable: (cb: () => void) => void;
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

async function _fetchToken(): Promise<string | null> {
  try {
    const t = await window.electron.auth.getToken();
    _token = t;
    _notify();
    return t;
  } catch {
    _token = null;
    _notify();
    return null;
  }
}

// Kick off initial token fetch as soon as the module loads
_fetchToken();

// ---------------------------------------------------------------------------
// Convex client
// ---------------------------------------------------------------------------
const client = new ConvexReactClient(env.VITE_CONVEX_URL);

// ---------------------------------------------------------------------------
// Custom useAuth hook for ConvexProviderWithAuth
// ---------------------------------------------------------------------------
function useElectronAuth() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const update = () => forceUpdate((n) => n + 1);
    _listeners.add(update);
    return () => {
      _listeners.delete(update);
    };
  }, []);

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken = false } = {}): Promise<string | null> => {
      if (!forceRefreshToken && _token) return _token;
      return _fetchToken();
    },
    [],
  );

  return useMemo(
    () => ({
      isLoading: _token === undefined,
      isAuthenticated: _token !== null && _token !== undefined,
      fetchAccessToken,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [_token, fetchAccessToken],
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

function formatTime(s: number) {
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
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

function hasUploadableSnapshotSpec(spec: string) {
  const normalized = spec.trim();
  return normalized !== "" && normalized !== "Unknown";
}

function isUploadableSnapshot(snapshot: SnapshotData, sinceTs: number) {
  return snapshot.takenAt > sinceTs && hasUploadableSnapshotSpec(snapshot.spec);
}

function getPendingUploadCounts(
  chars: CharacterData[],
  sinceTs: number,
  includeAllMythicPlusRuns = false,
): PendingUploadCounts {
  return chars.reduce(
    (totals, char) => ({
      snapshots: totals.snapshots + char.snapshots.filter((snapshot) => isUploadableSnapshot(snapshot, sinceTs)).length,
      mythicPlusRuns:
        totals.mythicPlusRuns +
        (includeAllMythicPlusRuns
          ? char.mythicPlusRuns.length
          : char.mythicPlusRuns.filter((run) => run.observedAt > sinceTs).length),
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
  const uploadAddon = useMutation(api.addonIngest.ingestAddonData);
  const resync = useMutation(api.characters.resyncCharacters);
  const characters = useQuery(api.characters.getMyCharactersWithSnapshot);
  // The checked-in Convex API typings lag the local module exports, so this
  // query reference is cast until codegen is cleaned up separately.
  const mythicPlusBackfillStatus = useQuery(
    (api as any).addonIngest.getMythicPlusBackfillStatus,
  ) as MythicPlusBackfillStatus | undefined;

  const [syncing, setSyncing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const [retailPath, setRetailPath] = useState<string | null>(null);
  const [closeBehavior, setCloseBehavior] = useState<"tray" | "exit">("tray");
  const [autostart, setAutostart] = useState(false);
  const [launchMinimized, setLaunchMinimized] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState(0);
  const [addonInstalled, setAddonInstalled] = useState<boolean | null>(null);
  const [addonVersion, setAddonVersion] = useState<string | null>(null);
  const [latestAddonVersion, setLatestAddonVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [appUpdateAvailable, setAppUpdateAvailable] = useState<string | null>(null);
  const [appUpdateDownloaded, setAppUpdateDownloaded] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  const [appUpToDate, setAppUpToDate] = useState(false);
  const [checkingAddonUpdate, setCheckingAddonUpdate] = useState(false);
  const [addonUpToDate, setAddonUpToDate] = useState(false);

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
  const [compacting, setCompacting] = useState(false);
  const [compactionResult, setCompactionResult] = useState<CompactAddonResult | null>(null);
  const [compactionError, setCompactionError] = useState<string | null>(null);

  const syncingRef = useRef(false);
  const lastSyncedAtRef = useRef(0);
  // Always points to the latest doUpload closure so stale-closure effects stay current.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doUploadRef = useRef<() => Promise<void>>(null as any);
  const needsMythicPlusBackfill = mythicPlusBackfillStatus?.needsBackfill === true;

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
      setPendingUploadCounts(getPendingUploadCounts(chars, sinceTs, needsMythicPlusBackfill));
      setAddonFileStats(fileStats);
    } catch {
      setPendingUploadCounts({ snapshots: 0, mythicPlusRuns: 0 });
      setAddonFileStats(null);
    }
  }, [needsMythicPlusBackfill, retailPath]);

  // Load persisted settings on mount
  useEffect(() => {
    window.electron.getVersion().then((v) => setAppVersion(v));
    window.electron.wow.getRetailPath().then((p) => setRetailPath(p));
    window.electron.settings.getAppSettings().then((s) => {
      setCloseBehavior(s.closeBehavior);
      setAutostart(s.autostart);
      setLaunchMinimized(s.launchMinimized);
      setLastSyncedAt(s.lastSyncedAt);
      lastSyncedAtRef.current = s.lastSyncedAt;
    });
    window.electron.updates.onUpdateAvailable((v) => setAppUpdateAvailable(v));
    window.electron.updates.onUpdateDownloaded((v) => setAppUpdateDownloaded(v));
    window.electron.updates.onUpdateNotAvailable(() => {
      setCheckingAppUpdate(false);
      setAppUpToDate(true);
      setTimeout(() => setAppUpToDate(false), 3000);
    });
    window.electron.wow
      .getLatestAddonRelease()
      .then(({ version }) => setLatestAddonVersion(version))
      .catch(() => {});
  }, []);

  // Check addon and read file snapshot count whenever retailPath changes
  useEffect(() => {
    if (!retailPath) {
      setAddonInstalled(null);
      setAddonVersion(null);
      setPendingUploadCounts(null);
      setAddonFileStats(null);
      window.electron.wow.unwatchAddonFile();
      setWatchingFile(false);
      return;
    }
    window.electron.wow.watchAddonFile();
    setWatchingFile(true);
    window.electron.wow.checkAddonInstalled().then(setAddonInstalled);
    window.electron.wow.getInstalledAddonVersion().then(setAddonVersion);
    void refreshAddonFileState();
  }, [refreshAddonFileState, retailPath]);

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
    setInstallError(null);
    try {
      const { url, checksumUrl, version } = await window.electron.wow.getLatestAddonRelease();
      await window.electron.wow.installAddon(url, checksumUrl ?? null);
      setAddonInstalled(true);
      setAddonVersion(version);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInstallError(msg);
    } finally {
      setInstalling(false);
    }
  }

  async function handleCheckAppUpdate() {
    setCheckingAppUpdate(true);
    setAppUpToDate(false);
    await window.electron.checkForUpdates();
    // Result comes back via update events. Add a fallback timeout in case no event fires
    // (e.g., in unpackaged dev builds where the updater is disabled).
    setTimeout(() => setCheckingAppUpdate(false), 5000);
  }

  async function handleCheckAddonUpdate() {
    setCheckingAddonUpdate(true);
    setAddonUpToDate(false);
    try {
      const { version } = await window.electron.wow.getLatestAddonRelease();
      setLatestAddonVersion(version);
      if (addonVersion && !isOutdated(addonVersion, version)) {
        setAddonUpToDate(true);
        setTimeout(() => setAddonUpToDate(false), 3000);
      }
    } catch {
      // silently ignore
    } finally {
      setCheckingAddonUpdate(false);
    }
  }

  async function handleSelectFolder() {
    const folder = await window.electron.wow.selectRetailFolder();
    if (folder) {
      setRetailPath(folder);
      setLastUploadResult(null);
      setUploadError(null);
      setUploadWarn(null);
      setPendingUploadCounts(null);
      setCompactionResult(null);
      setCompactionError(null);
      const installed = await window.electron.wow.checkAddonInstalled();
      setAddonInstalled(installed);
    }
  }

  async function handleCompactAddon(forceIfRunning = false) {
    if (!retailPath) return;

    setCompacting(true);
    setCompactionError(null);
    setCompactionResult(null);

    try {
      const result = await window.electron.wow.compactAddonData(forceIfRunning);
      if (result.status === "blocked" && !forceIfRunning) {
        setCompacting(false);
        const confirmed = window.confirm(
          `World of Warcraft appears to be running (${result.wowProcesses.join(", ")}).\n\nCompacting while the game is open is not recommended because the client can overwrite the file. Continue anyway?`,
        );
        if (confirmed) {
          await handleCompactAddon(true);
        }
        return;
      }

      setCompactionResult(result);
      await refreshAddonFileState();
    } catch (e) {
      setCompactionError(e instanceof Error ? e.message : "Compaction failed");
    } finally {
      setCompacting(false);
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
        if (fileStats) setAddonFileStats(fileStats);

        if (addonChars.length === 0) {
          setUploadWarn(
            accountsFound.length === 0
              ? "No wow-dashboard.lua found — run the addon in-game first"
              : `Parsed ${accountsFound.length} account(s) but no characters found`,
          );
        } else {
          // Only send records newer than the last successful sync (60s buffer for clock skew).
          const sinceTs = lastSyncedAtRef.current - 60;
          const pendingChars = addonChars
            .map((c) => ({
              ...c,
              snapshots: c.snapshots.filter((snapshot) => isUploadableSnapshot(snapshot, sinceTs)),
              mythicPlusRuns: needsMythicPlusBackfill
                ? c.mythicPlusRuns
                : c.mythicPlusRuns.filter((run) => run.observedAt > sinceTs),
            }))
            .filter((c) => c.snapshots.length > 0 || c.mythicPlusRuns.length > 0);

          setPendingUploadCounts(
            getPendingUploadCounts(addonChars, sinceTs, needsMythicPlusBackfill),
          );

          if (pendingChars.length > 0) {
            const result = await uploadAddon({
              characters: pendingChars as Parameters<typeof uploadAddon>[0]["characters"],
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
            await refreshAddonFileState();
          } else {
            setLastUploadResult({ newChars: 0, newSnapshots: 0, newMythicPlusRuns: 0 });
          }
        }
      } else {
        setUploadWarn("No WoW folder set — select the folder first");
      }

      // Resync from Battle.net
      await resync();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("RateLimited") || msg.includes("Too many")) {
        setUploadError("Too many requests — please wait a moment before trying again.");
      } else {
        setUploadError(`Upload failed: ${msg}`);
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      setTimeLeft(15 * 60);
    }
  }

  // Keep ref current so effects with empty deps always call the latest closure.
  doUploadRef.current = doUpload;

  // 15-minute fallback sync; primary sync is triggered by the file watcher.
  useEffect(() => {
    let count = 15 * 60;
    const id = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        doUploadRef.current();
        count = 15 * 60;
      }
      setTimeLeft(count);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Register file-change listener once on mount.
  useEffect(() => {
    window.electron.wow.onAddonFileChanged(() => {
      doUploadRef.current();
    });
  }, []);

  const retailPathValid = retailPath ? isValidRetailPath(retailPath) : true;
  const showAddonOutdated =
    addonInstalled && addonVersion && latestAddonVersion
      ? isOutdated(addonVersion, latestAddonVersion)
      : false;

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
        {appUpdateDownloaded && (
          <div className="flex items-center justify-between rounded-lg border border-green-700 bg-green-950 px-4 py-3 text-sm text-green-300">
            <span>App v{appUpdateDownloaded} downloaded — restart to apply the update.</span>
            <button
              onClick={() => window.electron.installUpdate()}
              className="ml-4 rounded bg-green-700 px-3 py-1 text-xs font-medium hover:bg-green-600"
            >
              Restart Now
            </button>
          </div>
        )}
        {appUpdateAvailable && !appUpdateDownloaded && (
          <div className="rounded-lg border border-blue-700 bg-blue-950 px-4 py-3 text-sm text-blue-300">
            App update v{appUpdateAvailable} is available and downloading…
          </div>
        )}

        {/* Addon update banner */}
        {showAddonOutdated && (
          <div className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-3 text-sm text-yellow-300">
            Addon update available: v{addonVersion} → v{latestAddonVersion}.{" "}
            <button
              onClick={handleInstallAddon}
              disabled={installing}
              className="underline hover:text-yellow-100 disabled:opacity-50"
            >
              Update Addon
            </button>
          </div>
        )}

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
                <p className="mt-0.5 text-xs">
                  {addonInstalled ? (
                    <span className="text-green-400">
                      Installed{addonVersion ? ` v${addonVersion}` : ""}
                    </span>
                  ) : (
                    <span className="text-yellow-400">Not installed</span>
                  )}
                </p>
              )}
            </div>
            {retailPath ? (
              <div className="flex items-center gap-2">
                {addonInstalled && (
                  <button
                    onClick={handleCheckAddonUpdate}
                    disabled={checkingAddonUpdate || installing}
                    className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-600 disabled:opacity-50"
                  >
                    {checkingAddonUpdate ? "Checking…" : addonUpToDate ? "Up to date" : "Check for Updates"}
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
          {installError && <p className="text-xs text-red-400">{installError}</p>}
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
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleCompactAddon()}
                disabled={compacting || syncing || !retailPath}
                className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-600 disabled:opacity-50"
              >
                {compacting ? "Compacting..." : "Compact File"}
              </button>
              <button
                onClick={() => doUpload()}
                disabled={syncing || compacting}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Sync Now"}
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Manual sync uploads addon snapshots and Mythic+ runs, then refreshes Battle.net character data.
          </p>
          <p className="text-xs text-gray-500">
            Fallback sync in {formatTime(timeLeft)} if no addon file change is detected.
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

          {compactionError && (
            <div className="rounded border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400">
              {compactionError}
            </div>
          )}

          {compactionResult?.status === "completed" && (
            <div className="rounded border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-400">
              Compaction: {compactionResult.filesChanged}/{compactionResult.filesProcessed} file
              {compactionResult.filesProcessed !== 1 ? "s" : ""} rewritten, {formatBytes(compactionResult.bytesBefore)} to{" "}
              {formatBytes(compactionResult.bytesAfter)}, snapshots {compactionResult.snapshotsBefore.toLocaleString()} to{" "}
              {compactionResult.snapshotsAfter.toLocaleString()}, M+ runs {compactionResult.mythicPlusRunsBefore.toLocaleString()} to{" "}
              {compactionResult.mythicPlusRunsAfter.toLocaleString()}.
            </div>
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
                {lastSyncedAt > 0 ? formatDateTime(lastSyncedAt * 1000) : "Never"}
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
          {appVersion && <p className="text-xs text-gray-600">v{appVersion}</p>}
          <button
            onClick={handleCheckAppUpdate}
            disabled={checkingAppUpdate || !!appUpdateAvailable || !!appUpdateDownloaded}
            className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
          >
            {checkingAppUpdate ? "Checking…" : appUpToDate ? "Up to date" : "Check for Updates"}
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
  async function handleLogin() {
    await window.electron.auth.login();
    await _fetchToken();
  }

  async function handleLogout() {
    await window.electron.auth.logout();
    _token = null;
    _notify();
  }

  const authState = useElectronAuth();

  return (
    <ConvexProviderWithAuth client={client} useAuth={useElectronAuth}>
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
    </ConvexProviderWithAuth>
  );
}
