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
      getVersion: () => Promise<string>;
      installUpdate: () => Promise<void>;
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

  const [syncing, setSyncing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const [retailPath, setRetailPath] = useState<string | null>(null);
  const [closeBehavior, setCloseBehavior] = useState<"tray" | "exit">("tray");
  const [autostart, setAutostart] = useState(false);
  const [addonInstalled, setAddonInstalled] = useState<boolean | null>(null);
  const [addonVersion, setAddonVersion] = useState<string | null>(null);
  const [latestAddonVersion, setLatestAddonVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [appUpdateAvailable, setAppUpdateAvailable] = useState<string | null>(null);
  const [appUpdateDownloaded, setAppUpdateDownloaded] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  // Upload / file status
  const [fileSnapshotCount, setFileSnapshotCount] = useState<number | null>(null);
  const [lastUploadResult, setLastUploadResult] = useState<{
    newChars: number;
    newSnapshots: number;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadWarn, setUploadWarn] = useState<string | null>(null);

  const syncingRef = useRef(false);

  // Load persisted settings on mount
  useEffect(() => {
    window.electron.getVersion().then((v) => setAppVersion(v));
    window.electron.wow.getRetailPath().then((p) => setRetailPath(p));
    window.electron.settings.getAppSettings().then((s) => {
      setCloseBehavior(s.closeBehavior);
      setAutostart(s.autostart);
    });
    window.electron.updates.onUpdateAvailable((v) => setAppUpdateAvailable(v));
    window.electron.updates.onUpdateDownloaded((v) => setAppUpdateDownloaded(v));
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
      setFileSnapshotCount(null);
      return;
    }
    window.electron.wow.checkAddonInstalled(retailPath).then(setAddonInstalled);
    window.electron.wow.getInstalledAddonVersion(retailPath).then(setAddonVersion);
    // Read file to get pending snapshot count
    window.electron.wow
      .readAddonData(retailPath)
      .then(({ characters: chars }) => {
        const total = chars.reduce((sum, c) => sum + c.snapshots.length, 0);
        setFileSnapshotCount(total);
      })
      .catch(() => setFileSnapshotCount(0));
  }, [retailPath]);

  async function handleCloseBehaviorChange(value: boolean) {
    const behavior = value ? "tray" : "exit";
    setCloseBehavior(behavior);
    await window.electron.settings.setCloseBehavior(behavior);
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInstallError(msg);
    } finally {
      setInstalling(false);
    }
  }

  async function handleSelectFolder() {
    const folder = await window.electron.wow.selectRetailFolder();
    if (folder) {
      setRetailPath(folder);
      setLastUploadResult(null);
      setUploadError(null);
      setUploadWarn(null);
      setFileSnapshotCount(null);
      const installed = await window.electron.wow.checkAddonInstalled(folder);
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
        const { characters: addonChars, accountsFound } =
          await window.electron.wow.readAddonData(retailPath);

        const total = addonChars.reduce((sum, c) => sum + c.snapshots.length, 0);
        setFileSnapshotCount(total);

        if (addonChars.length === 0) {
          setUploadWarn(
            accountsFound.length === 0
              ? "No wow-dashboard.lua found — run the addon in-game first"
              : `Parsed ${accountsFound.length} account(s) but no characters found`,
          );
        } else {
          const result = await uploadAddon({ characters: addonChars });
          setLastUploadResult({ newChars: result.newChars, newSnapshots: result.newSnapshots });
        }
      } else {
        setUploadWarn("No WoW folder set — select the folder first");
      }

      // Resync from Battle.net
      await resync();
    } catch (e) {
      setUploadError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      setTimeLeft(15 * 60);
    }
  }

  // 15-minute countdown; auto-upload at 0.
  useEffect(() => {
    let count = 15 * 60;
    const id = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        doUpload();
        count = 15 * 60;
      }
      setTimeLeft(count);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

        {/* Upload / Data Sync */}
        <div className="rounded-lg border border-gray-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-gray-300">Sync</h2>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">
                Next sync in <span className="font-mono text-white">{formatTime(timeLeft)}</span>
              </span>
              <button
                onClick={() => doUpload()}
                disabled={syncing}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Sync Now"}
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Manual sync uploads addon snapshots and refreshes Battle.net character data.
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
              {lastUploadResult.newSnapshots > 0 && (
                <span className="text-xs text-gray-500">
                  ({lastUploadResult.newSnapshots} new snapshot
                  {lastUploadResult.newSnapshots !== 1 ? "s" : ""} uploaded)
                </span>
              )}
            </div>
          ) : !retailPath ? (
            <p className="text-sm text-gray-500">Select the WoW folder to enable uploads.</p>
          ) : fileSnapshotCount === null ? (
            <p className="text-sm text-gray-400">Checking file…</p>
          ) : fileSnapshotCount === 0 ? (
            <p className="text-sm text-gray-500">
              No snapshots found in file. Run the addon in-game first.
            </p>
          ) : (
            <p className="text-sm text-yellow-400">
              {fileSnapshotCount} snapshot{fileSnapshotCount !== 1 ? "s" : ""} pending upload
            </p>
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
        </div>

        {/* Character count */}
        {characters !== undefined && (
          <p className="text-sm text-gray-500">
            {characters === null || characters.length === 0
              ? "No characters found."
              : `${characters.length} character${characters.length !== 1 ? "s" : ""} tracked.`}
          </p>
        )}

        {/* App version */}
        {appVersion && <p className="text-center text-xs text-gray-600">v{appVersion}</p>}
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
