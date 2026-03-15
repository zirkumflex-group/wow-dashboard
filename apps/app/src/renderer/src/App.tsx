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

interface LogEntry {
  id: number;
  time: Date;
  message: string;
}

let _logId = 0;

function Dashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const resync = useMutation(api.characters.resyncCharacters);
  const ingestAddon = useMutation(api.addonIngest.ingestAddonData);
  const characters = useQuery(api.characters.getMyCharactersWithSnapshot);

  const [syncing, setSyncing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [retailPath, setRetailPath] = useState<string | null>(null);

  const syncingRef = useRef(false);
  const prevCharCountRef = useRef<number | null>(null);

  function addLog(message: string) {
    _logId += 1;
    const entry: LogEntry = { id: _logId, time: new Date(), message };
    setLog((prev) => [entry, ...prev].slice(0, 100));
  }

  // Load persisted retail path on mount
  useEffect(() => {
    window.electron.wow.getRetailPath().then((p) => setRetailPath(p));
  }, []);

  async function handleSelectFolder() {
    const folder = await window.electron.wow.selectRetailFolder();
    if (folder) {
      setRetailPath(folder);
      addLog(`WoW folder set: ${folder}`);
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
          );
        } else {
          addLog(`Read ${addonChars.length} character(s) from ${accountsFound.length} account(s)`);
          const result = await ingestAddon({ characters: addonChars });
          addLog(
            `Addon ingest done — ${result.newChars} new char(s), ${result.newSnapshots} new snapshot(s)`,
          );
        }
      } else {
        addLog("No WoW folder set — skipping addon ingest");
      }

      // Step 2: resync from Battle.net
      await resync();
    } catch (e) {
      addLog(`Ingest error: ${e instanceof Error ? e.message : String(e)}`);
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
      addLog(`Sync complete — ${count} character${count !== 1 ? "s" : ""} found`);
    }
    prevCharCountRef.current = count;
  }, [characters]);

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
          <button onClick={onLogout} className="text-sm text-gray-400 hover:text-white">
            Sign out
          </button>
        </div>

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

        {/* Ingest log */}
        <div className="rounded-lg border border-gray-800 p-4">
          <h2 className="mb-3 font-medium text-gray-300">Ingest Log</h2>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {log.length === 0 ? (
              <p className="text-sm text-gray-500">No activity yet.</p>
            ) : (
              log.map((entry) => (
                <div key={entry.id} className="flex gap-3 text-sm">
                  <span className="shrink-0 font-mono text-xs text-gray-500">
                    {entry.time.toLocaleTimeString()}
                  </span>
                  <span className="text-gray-200">{entry.message}</span>
                </div>
              ))
            )}
          </div>
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
