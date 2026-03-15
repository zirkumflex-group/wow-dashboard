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
  };
}

interface CharacterData {
  name: string;
  realm: string;
  region: "us" | "eu" | "kr" | "tw";
  class: string;
  race: string;
  faction: "alliance" | "horde";
  snapshots: SnapshotData[];
}

// ---------------------------------------------------------------------------
// Type augmentation for window.electron
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    electron: {
      version: string;
      auth: {
        login: (siteUrl: string) => Promise<boolean>;
        getToken: (siteUrl: string) => Promise<string | null>;
        getSession: (siteUrl: string) => Promise<unknown>;
        logout: (siteUrl: string) => Promise<boolean>;
      };
      wow: {
        getRetailPath: () => Promise<string | null>;
        selectRetailFolder: () => Promise<string | null>;
        readAddonData: (retailPath: string) => Promise<{
          characters: CharacterData[];
          accountsFound: string[];
        }>;
        checkAddonInstalled: (retailPath: string) => Promise<boolean>;
        getInstalledAddonVersion: (retailPath: string) => Promise<string | null>;
        installAddon: (retailPath: string, downloadUrl: string) => Promise<void>;
        getLatestAddonRelease: () => Promise<{ url: string; version: string }>;
      };
      settings: {
        getAppSettings: () => Promise<{ closeBehavior: "tray" | "exit"; autostart: boolean }>;
        setCloseBehavior: (value: "tray" | "exit") => Promise<void>;
        setAutostart: (value: boolean) => Promise<void>;
      };
      openExternal: (url: string) => Promise<void>;
      updates: {
        onUpdateAvailable: (cb: (version: string) => void) => void;
        onUpdateDownloaded: (cb: (version: string) => void) => void;
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
    const t = await window.electron.auth.getToken(env.VITE_SITE_URL);
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

type LogLevel = "info" | "success" | "warn" | "error";

interface LogEntry {
  id: number;
  time: Date;
  level: LogLevel;
  message: string;
}

const LOG_COLORS: Record<LogLevel, string> = {
  info: "text-gray-300",
  success: "text-green-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

let _logId = 0;

function Dashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const resync = useMutation(api.characters.resyncCharacters);
  const ingestAddon = useMutation(api.addonIngest.ingestAddonData);
  const characters = useQuery(api.characters.getMyCharactersWithSnapshot);

  const [syncing, setSyncing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [retailPath, setRetailPath] = useState<string | null>(null);
  const [closeBehavior, setCloseBehavior] = useState<"tray" | "exit">("exit");
  const [autostart, setAutostart] = useState(false);
  const [addonInstalled, setAddonInstalled] = useState<boolean | null>(null);
  const [addonVersion, setAddonVersion] = useState<string | null>(null);
  const [latestAddonVersion, setLatestAddonVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [appUpdateAvailable, setAppUpdateAvailable] = useState<string | null>(null);
  const [appUpdateDownloaded, setAppUpdateDownloaded] = useState<string | null>(null);

  const syncingRef = useRef(false);
  const prevCharCountRef = useRef<number | null>(null);

  function addLog(message: string, level: LogLevel = "info") {
    _logId += 1;
    const entry: LogEntry = { id: _logId, time: new Date(), level, message };
    setLog((prev) => [entry, ...prev].slice(0, 100));
  }

  // Load persisted settings on mount
  useEffect(() => {
    window.electron.wow.getRetailPath().then((p) => setRetailPath(p));
    window.electron.settings.getAppSettings().then((s) => {
      setCloseBehavior(s.closeBehavior);
      setAutostart(s.autostart);
    });
    window.electron.updates.onUpdateAvailable((v) => {
      setAppUpdateAvailable(v);
      addLog(`App update v${v} available — downloading…`, "info");
    });
    window.electron.updates.onUpdateDownloaded((v) => {
      setAppUpdateDownloaded(v);
      addLog(`App update v${v} downloaded — restart to apply`, "success");
    });
    // Fetch latest addon release version once on mount
    window.electron.wow
      .getLatestAddonRelease()
      .then(({ version }) => setLatestAddonVersion(version))
      .catch(() => {});
  }, []);

  // Check addon installation and version whenever retailPath changes
  useEffect(() => {
    if (!retailPath) {
      setAddonInstalled(null);
      setAddonVersion(null);
      return;
    }
    window.electron.wow.checkAddonInstalled(retailPath).then(setAddonInstalled);
    window.electron.wow.getInstalledAddonVersion(retailPath).then(setAddonVersion);
  }, [retailPath]);

  async function handleCloseBehaviorChange(value: "tray" | "exit") {
    setCloseBehavior(value);
    await window.electron.settings.setCloseBehavior(value);
  }

  async function handleAutostartChange(value: boolean) {
    setAutostart(value);
    await window.electron.settings.setAutostart(value);
  }

  async function handleInstallAddon() {
    if (!retailPath) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const { url, version } = await window.electron.wow.getLatestAddonRelease();
      await window.electron.wow.installAddon(retailPath, url);
      setAddonInstalled(true);
      setAddonVersion(version);
      addLog(`Addon v${version} installed successfully`, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInstallError(msg);
      addLog(`Addon install failed: ${msg}`, "error");
    } finally {
      setInstalling(false);
    }
  }

  async function handleSelectFolder() {
    const folder = await window.electron.wow.selectRetailFolder();
    if (folder) {
      setRetailPath(folder);
      addLog(`WoW folder set: ${folder}`, "info");
      const installed = await window.electron.wow.checkAddonInstalled(folder);
      setAddonInstalled(installed);
    }
  }

  async function doIngest(source: "manual" | "auto") {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    addLog(`${source === "manual" ? "Manual" : "Auto"} ingest triggered`);
    try {
      // Step 1: read addon SavedVariables from disk
      if (retailPath) {
        const { characters: addonChars, accountsFound } =
          await window.electron.wow.readAddonData(retailPath);

        if (addonChars.length === 0) {
          addLog(
            accountsFound.length === 0
              ? "No wow-dashboard.lua found — run the addon in-game first"
              : `Parsed ${accountsFound.length} account(s) but no characters found`,
            "warn",
          );
        } else {
          addLog(`Read ${addonChars.length} character(s) from ${accountsFound.length} account(s)`);
          const result = await ingestAddon({ characters: addonChars });
          addLog(
            `Addon ingest done — ${result.newChars} new char(s), ${result.newSnapshots} new snapshot(s)`,
            "success",
          );
        }
      } else {
        addLog("No WoW folder set — skipping addon ingest", "warn");
      }

      // Step 2: resync from Battle.net
      await resync();
    } catch (e) {
      addLog(`Ingest error: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      setTimeLeft(15 * 60);
    }
  }

  // 15-minute countdown; auto-ingest at 0.
  useEffect(() => {
    let count = 15 * 60;
    const id = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        doIngest("auto");
        count = 15 * 60;
      }
      setTimeLeft(count);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Log when character list updates
  useEffect(() => {
    if (characters === undefined) return;
    const count = characters?.length ?? 0;
    if (prevCharCountRef.current !== null && prevCharCountRef.current !== count) {
      addLog(`Sync complete — ${count} character${count !== 1 ? "s" : ""} found`, "success");
    }
    prevCharCountRef.current = count;
  }, [characters]);

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
          <div className="rounded-lg border border-green-700 bg-green-950 px-4 py-3 text-sm text-green-300">
            App v{appUpdateDownloaded} downloaded — restart to apply the update.
          </div>
        )}
        {appUpdateAvailable && !appUpdateDownloaded && (
          <div className="rounded-lg border border-blue-700 bg-blue-950 px-4 py-3 text-sm text-blue-300">
            App update v{appUpdateAvailable} is available and downloading…
          </div>
        )}

        {/* Addon update banner */}
        {addonInstalled &&
          addonVersion &&
          latestAddonVersion &&
          isOutdated(addonVersion, latestAddonVersion) && (
            <div className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-3 text-sm text-yellow-300">
              Addon update available: v{addonVersion} → v{latestAddonVersion}. Click{" "}
              <button
                onClick={handleInstallAddon}
                disabled={installing}
                className="underline hover:text-yellow-100 disabled:opacity-50"
              >
                Update Addon
              </button>{" "}
              to install.
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
            <p className="break-all font-mono text-xs text-green-400">{retailPath}</p>
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
              <button
                onClick={handleInstallAddon}
                disabled={installing}
                className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-600 disabled:opacity-50"
              >
                {installing ? "Installing…" : addonInstalled ? "Reinstall" : "Install Addon"}
              </button>
            ) : (
              <span className="text-xs text-gray-500">Select WoW folder first</span>
            )}
          </div>
          {installError && <p className="text-xs text-red-400">{installError}</p>}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 rounded-lg border border-gray-800 p-4">
          <button
            onClick={() => doIngest("manual")}
            disabled={syncing}
            className="rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? "Ingesting…" : "Force Ingest"}
          </button>
          <span className="text-sm text-gray-400">
            Next auto-ingest in <span className="font-mono text-white">{formatTime(timeLeft)}</span>
          </span>
        </div>

        {/* Log */}
        <div className="rounded-lg border border-gray-800 p-4">
          <h2 className="mb-3 font-medium text-gray-300">Log</h2>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {log.length === 0 ? (
              <p className="text-sm text-gray-500">No activity yet.</p>
            ) : (
              log.map((entry) => (
                <div key={entry.id} className="flex gap-3 text-sm">
                  <span className="shrink-0 font-mono text-xs text-gray-500">
                    {entry.time.toLocaleTimeString()}
                  </span>
                  <span className={LOG_COLORS[entry.level]}>{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Settings */}
        <div className="rounded-lg border border-gray-800 p-4 space-y-4">
          <h2 className="font-medium text-gray-300">Settings</h2>

          {/* Close behavior */}
          <div className="space-y-2">
            <p className="text-sm text-gray-400">When closing the window</p>
            <div className="flex gap-3">
              <button
                onClick={() => handleCloseBehaviorChange("tray")}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  closeBehavior === "tray"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                Minimize to tray
              </button>
              <button
                onClick={() => handleCloseBehaviorChange("exit")}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  closeBehavior === "exit"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                Exit application
              </button>
            </div>
          </div>

          {/* Autostart */}
          <label className="flex cursor-pointer items-center gap-3">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only"
                checked={autostart}
                onChange={(e) => handleAutostartChange(e.target.checked)}
              />
              <div
                className={`h-5 w-9 rounded-full transition-colors ${autostart ? "bg-blue-600" : "bg-gray-600"}`}
              />
              <div
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${autostart ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </div>
            <span className="text-sm text-gray-300">Launch on Windows login</span>
          </label>
        </div>

        {/* Character count */}
        {characters !== undefined && (
          <p className="text-sm text-gray-500">
            {characters === null || characters.length === 0
              ? "No characters found."
              : `${characters.length} character${characters.length !== 1 ? "s" : ""} tracked.`}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------
export default function App() {
  async function handleLogin() {
    await window.electron.auth.login(env.VITE_SITE_URL);
    await _fetchToken();
  }

  async function handleLogout() {
    await window.electron.auth.logout(env.VITE_SITE_URL);
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
    </ConvexProviderWithAuth>
  );
}
