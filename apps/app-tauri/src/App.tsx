import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { env } from "@wow-dashboard/env/app";
import { apiQueryKeys, apiQueryOptions } from "./lib/api-client";
import type { AddonUpdateState, AppUpdateState, SyncState } from "./lib/desktop";
import { desktop } from "./lib/desktop";

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

const INITIAL_SYNC_STATE: SyncState = {
  status: "idle",
  message: null,
  pendingUploadCounts: null,
  fileStats: null,
  lastSyncedAt: 0,
  lastUploadResult: null,
  accountsFound: [],
  trackedCharacters: 0,
  batchesTotal: 0,
  batchesCompleted: 0,
};

let authState: "authenticated" | null | undefined = undefined;
const authListeners = new Set<() => void>();

function notifyAuthListeners() {
  authListeners.forEach((listener) => listener());
}

async function clearAuth(): Promise<void> {
  try {
    await desktop.auth.logout();
  } catch {
    // Best effort. Local UI state is still cleared.
  }
  authState = null;
  notifyAuthListeners();
}

function formatErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function isAuthErrorMessage(message: string | null | undefined): boolean {
  return message?.includes("401") === true;
}

async function fetchAuthState(): Promise<void> {
  try {
    const session = await desktop.auth.getSession();
    authState = session.status === "unauthenticated" ? null : "authenticated";
  } catch {
    authState = "authenticated";
  }
  notifyAuthListeners();
}

void fetchAuthState();

function useDesktopAuth() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    authListeners.add(listener);
    return () => {
      authListeners.delete(listener);
    };
  }, []);

  return {
    isLoading: authState === undefined,
    isAuthenticated: authState !== null && authState !== undefined,
  };
}

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
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left < right) return true;
    if (left > right) return false;
  }
  return false;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLastSyncTime(lastSyncedAt: number) {
  if (lastSyncedAt <= 0) return "Never";
  return formatDateTime(lastSyncedAt * 1000);
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <p className="text-sm text-gray-400">Loading...</p>
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-6">
      <div className="w-full max-w-xl space-y-6 text-center">
        <div>
          <h1 className="text-4xl font-bold text-white">WoW Dashboard</h1>
          <p className="mt-2 text-gray-400">Sign in to continue</p>
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Opening Battle.net..." : "Login with Battle.net"}
        </button>

        {error && <p className="text-sm text-red-400">{error}</p>}

        {(error || !loading) && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">
              If your browser does not open automatically, open this URL manually:
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

interface SwitchRowProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}

function SwitchRow({ checked, onChange, label }: SwitchRowProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-sm text-gray-300">{label}</span>
      <button
        type="button"
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
  const characters = useQuery(apiQueryOptions.myCharacters()).data;
  const [retailPath, setRetailPath] = useState<string | null>(null);
  const [closeBehavior, setCloseBehavior] = useState<"tray" | "exit">("tray");
  const [autostart, setAutostart] = useState(false);
  const [launchMinimized, setLaunchMinimized] = useState(true);
  const [addonInstalled, setAddonInstalled] = useState<boolean | null>(null);
  const [addonVersion, setAddonVersion] = useState<string | null>(null);
  const [addonUpdateState, setAddonUpdateState] = useState(INITIAL_ADDON_UPDATE_STATE);
  const [appUpdateState, setAppUpdateState] = useState(INITIAL_APP_UPDATE_STATE);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [syncState, setSyncState] = useState(INITIAL_SYNC_STATE);
  const [watchingFile, setWatchingFile] = useState(false);
  const [installingAddon, setInstallingAddon] = useState(false);
  const [addonActionError, setAddonActionError] = useState<string | null>(null);
  const [appActionError, setAppActionError] = useState<string | null>(null);

  const syncing =
    syncState.status === "scanning" ||
    syncState.status === "uploading" ||
    syncState.status === "resyncing";

  function applyAddonUpdateSnapshot(state: AddonUpdateState) {
    setAddonUpdateState(state);
    if (state.installedVersion) {
      setAddonInstalled(true);
      setAddonVersion(state.installedVersion);
    } else if (state.status === "notInstalled") {
      setAddonInstalled(false);
      setAddonVersion(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    void desktop.updates.onUpdateState((state) => {
      if (cancelled) return;
      setAppUpdateState(state);
      setAppVersion(state.currentVersion || null);
      if (state.status !== "error") setAppActionError(null);
    }).then((cleanup) => cleanups.push(cleanup));

    void desktop.wow.onAddonUpdateState((state) => {
      if (cancelled) return;
      applyAddonUpdateSnapshot(state);
      if (state.status !== "error") setAddonActionError(null);
    }).then((cleanup) => cleanups.push(cleanup));

    void desktop.wow.onAddonUpdateStaged((version) => {
      if (cancelled) return;
      setAddonUpdateState((current) => ({
        ...current,
        status: "staged",
        latestVersion: current.latestVersion ?? version,
        stagedVersion: version,
        error: null,
      }));
    }).then((cleanup) => cleanups.push(cleanup));

    void desktop.wow.onAddonUpdateApplied((version) => {
      if (cancelled) return;
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
    }).then((cleanup) => cleanups.push(cleanup));

    void desktop.wow.onSyncState((state) => {
      if (cancelled) return;
      setSyncState(state);
      if (state.status === "success") {
        void queryClient.invalidateQueries({ queryKey: apiQueryKeys.myCharacters() });
      }
      if (state.status === "error" && isAuthErrorMessage(state.message)) {
        void clearAuth().then(() => queryClient.clear());
      }
    }).then((cleanup) => cleanups.push(cleanup));

    void Promise.allSettled([
      desktop.getVersion(),
      desktop.updates.getStatus(),
      desktop.wow.getRetailPath(),
      desktop.settings.getAppSettings(),
      desktop.wow.getAddonUpdateStatus(),
      desktop.wow.getSyncState(),
    ]).then(
      ([
        versionResult,
        appUpdateResult,
        retailPathResult,
        settingsResult,
        addonUpdateResult,
        syncResult,
      ]) => {
        if (cancelled) return;

        if (versionResult.status === "fulfilled") setAppVersion(versionResult.value);
        if (appUpdateResult.status === "fulfilled") {
          setAppUpdateState(appUpdateResult.value);
          setAppVersion((current) => appUpdateResult.value.currentVersion || current);
        }
        if (retailPathResult.status === "fulfilled") setRetailPath(retailPathResult.value);
        if (settingsResult.status === "fulfilled") {
          setCloseBehavior(settingsResult.value.closeBehavior);
          setAutostart(settingsResult.value.autostart);
          setLaunchMinimized(settingsResult.value.launchMinimized);
        }
        if (addonUpdateResult.status === "fulfilled") {
          applyAddonUpdateSnapshot(addonUpdateResult.value);
        }
        if (syncResult.status === "fulfilled") setSyncState(syncResult.value);
      },
    );

    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [queryClient]);

  useEffect(() => {
    if (!retailPath) {
      setAddonInstalled(null);
      setAddonVersion(null);
      setWatchingFile(false);
      void desktop.wow.unwatchAddonFile();
      return;
    }

    let cancelled = false;
    void Promise.allSettled([
      desktop.wow.watchAddonFile(),
      desktop.wow.checkAddonInstalled(),
      desktop.wow.getInstalledAddonVersion(),
      desktop.wow.getAddonUpdateStatus(),
      desktop.wow.refreshFileState(),
    ]).then(([watchResult, installedResult, installedVersionResult, updateStateResult, syncResult]) => {
      if (cancelled) return;
      setWatchingFile(watchResult.status === "fulfilled" ? watchResult.value : false);
      if (installedResult.status === "fulfilled") setAddonInstalled(installedResult.value);
      if (installedVersionResult.status === "fulfilled") setAddonVersion(installedVersionResult.value);
      if (updateStateResult.status === "fulfilled") applyAddonUpdateSnapshot(updateStateResult.value);
      if (syncResult.status === "fulfilled") setSyncState(syncResult.value);
    });

    return () => {
      cancelled = true;
      setWatchingFile(false);
      void desktop.wow.unwatchAddonFile();
    };
  }, [retailPath]);

  useEffect(() => {
    const interval = setInterval(() => {
      void handleSync();
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function handleCloseBehaviorChange(value: boolean) {
    const behavior = value ? "tray" : "exit";
    setCloseBehavior(behavior);
    await desktop.settings.setCloseBehavior(behavior);
  }

  async function handleAutostartChange(value: boolean) {
    setAutostart(value);
    await desktop.settings.setAutostart(value);
  }

  async function handleLaunchMinimizedChange(value: boolean) {
    setLaunchMinimized(value);
    await desktop.settings.setLaunchMinimized(value);
  }

  async function handleInstallAddon() {
    if (!retailPath) return;
    setInstallingAddon(true);
    setAddonActionError(null);
    try {
      const { version } = await desktop.wow.installAddon();
      setAddonInstalled(true);
      setAddonVersion(version);
    } catch (reason) {
      setAddonActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setInstallingAddon(false);
    }
  }

  async function handleCheckAddonUpdate() {
    setAddonActionError(null);
    try {
      const result = await desktop.wow.triggerAddonUpdateCheck();
      if (result.error) setAddonActionError(result.error);
    } catch (reason) {
      setAddonActionError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleSelectFolder() {
    const folder = await desktop.wow.selectRetailFolder();
    if (!folder) return;
    setRetailPath(folder);
    setAddonActionError(null);
    const [installed, state] = await Promise.all([
      desktop.wow.checkAddonInstalled(),
      desktop.wow.refreshFileState(),
    ]);
    setAddonInstalled(installed);
    setSyncState(state);
  }

  async function handleSync() {
    try {
      const state = await desktop.wow.syncNow();
      setSyncState(state);
      if (state.status === "success") {
        await queryClient.invalidateQueries({ queryKey: apiQueryKeys.myCharacters() });
      }
      if (state.status === "error" && isAuthErrorMessage(state.message)) {
        await clearAuth();
        queryClient.clear();
      }
    } catch (reason) {
      const message = formatErrorMessage(reason);
      setSyncState((state) => ({
        ...state,
        status: "error",
        message,
      }));
      if (isAuthErrorMessage(message)) {
        await clearAuth();
        queryClient.clear();
      }
    }
  }

  async function handleCheckAppUpdate() {
    setAppActionError(null);
    try {
      await desktop.checkForUpdates();
    } catch (reason) {
      setAppActionError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleInstallAppUpdate() {
    setAppActionError(null);
    try {
      const result = await desktop.installUpdate();
      if (!result.ok && result.message) setAppActionError(result.message);
    } catch (reason) {
      setAppActionError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const retailPathValid = retailPath ? isValidRetailPath(retailPath) : true;
  const latestAddonVersion = addonUpdateState.latestVersion;
  const addonStagedVersion = addonUpdateState.stagedVersion;
  const showAddonOutdated =
    addonInstalled && addonVersion && latestAddonVersion
      ? isOutdated(addonVersion, latestAddonVersion)
      : false;
  const addonUpdateError =
    addonActionError ??
    (addonUpdateState.status === "error" || addonUpdateState.status === "invalidRetailPath"
      ? addonUpdateState.error
      : null);
  const appUpdateError =
    appActionError ?? (appUpdateState.status === "error" ? appUpdateState.error : null);
  const displayedAppVersion = appUpdateState.currentVersion || appVersion;
  const appCheckDisabled = [
    "checking",
    "available",
    "downloading",
    "downloaded",
    "installing",
    "unsupported",
  ].includes(appUpdateState.status);
  const appCheckButtonLabel =
    appUpdateState.status === "checking"
      ? "Checking..."
      : appUpdateState.status === "downloading"
        ? appUpdateState.progressPercent !== null
          ? `Downloading ${Math.round(appUpdateState.progressPercent)}%`
          : "Downloading..."
        : appUpdateState.status === "installing"
          ? "Installing..."
          : appUpdateState.status === "upToDate"
            ? "Up to date"
            : appUpdateState.status === "downloaded"
              ? "Update ready"
              : appUpdateState.status === "unsupported"
                ? "Updates unavailable in dev"
                : "Check for Updates";
  const checkingAddonUpdate =
    addonUpdateState.status === "checking" || addonUpdateState.status === "updating";
  const addonCheckDisabled = installingAddon || checkingAddonUpdate;
  const addonUpToDate =
    addonUpdateState.status === "upToDate" || addonUpdateState.status === "applied";

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">WoW Dashboard</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => desktop.openExternal(env.VITE_SITE_URL)}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Open Dashboard
            </button>
            <button onClick={onLogout} className="text-sm text-gray-400 hover:text-white">
              Sign out
            </button>
          </div>
        </div>

        {appUpdateState.status === "downloaded" && appUpdateState.downloadedVersion && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-green-700 bg-green-950 px-4 py-3 text-sm text-green-300">
            <p>App v{appUpdateState.downloadedVersion} is ready to install.</p>
            <button
              onClick={handleInstallAppUpdate}
              className="shrink-0 rounded bg-green-400 px-3 py-1.5 text-sm font-medium text-green-950 hover:bg-green-300"
            >
              Install update &amp; restart
            </button>
          </div>
        )}
        {(appUpdateState.status === "available" || appUpdateState.status === "downloading") &&
          appUpdateState.availableVersion && (
            <div className="rounded-lg border border-blue-700 bg-blue-950 px-4 py-3 text-sm text-blue-300">
              App update v{appUpdateState.availableVersion} is downloading in the background
              {appUpdateState.progressPercent !== null
                ? ` (${Math.round(appUpdateState.progressPercent)}%)`
                : ""}
            </div>
          )}
        {appUpdateError && (
          <div className="rounded-lg border border-red-700 bg-red-950 px-4 py-3 text-sm text-red-300">
            {appUpdateError}
          </div>
        )}
        {addonUpdateState.status === "applied" && addonVersion ? (
          <div className="rounded-lg border border-green-700 bg-green-950 px-4 py-3 text-sm text-green-300">
            Addon v{addonVersion} was applied automatically in the background.
          </div>
        ) : addonStagedVersion ? (
          <div className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-3 text-sm text-yellow-300">
            Addon v{addonStagedVersion} is downloaded and will install automatically.
          </div>
        ) : showAddonOutdated ? (
          <div className="rounded-lg border border-yellow-700 bg-yellow-950 px-4 py-3 text-sm text-yellow-300">
            Addon update available: v{addonVersion} to v{latestAddonVersion}.
          </div>
        ) : null}

        <div className="space-y-2 rounded-lg border border-gray-800 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-gray-300">WoW _retail_ Folder</h2>
            <button
              onClick={handleSelectFolder}
              className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-600"
            >
              Select folder...
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
              No folder selected. The addon's SavedVariables will not be read until you pick your
              WoW <span className="font-mono">_retail_</span> folder.
            </p>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-gray-800 p-4">
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
                  {checkingAddonUpdate && (
                    <p className="mt-0.5 text-xs text-blue-400">Checking for addon updates...</p>
                  )}
                  {addonUpToDate && (
                    <p className="mt-0.5 text-xs text-green-400">Addon is up to date.</p>
                  )}
                  {addonUpdateError && (
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
                        ? "Checking..."
                        : addonUpToDate
                          ? "Up to date"
                          : "Check for Updates"}
                  </button>
                )}
                <button
                  onClick={handleInstallAddon}
                  disabled={installingAddon}
                  className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-600 disabled:opacity-50"
                >
                  {installingAddon ? "Installing..." : addonInstalled ? "Reinstall" : "Install Addon"}
                </button>
              </div>
            ) : (
              <span className="text-xs text-gray-500">Select WoW folder first</span>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-gray-800 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-medium text-gray-300">Sync</h2>
              {watchingFile && (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-400" />
                  Watching
                </span>
              )}
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Sync uploads addon snapshots and Mythic+ runs, then refreshes Battle.net character
            data.
          </p>
          <p className="text-xs text-gray-500">
            Last successful sync: {formatLastSyncTime(syncState.lastSyncedAt)}
          </p>

          {syncState.status === "error" ? (
            <div className="rounded border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400">
              {syncState.message ?? "Upload failed"}
            </div>
          ) : syncState.status === "warning" ? (
            <div className="rounded border border-yellow-700 bg-yellow-950 px-3 py-2 text-sm text-yellow-400">
              {syncState.message}
            </div>
          ) : syncing ? (
            <p className="text-sm text-gray-400">
              {syncState.status === "uploading" && syncState.batchesTotal > 0
                ? `Uploading batch ${syncState.batchesCompleted + 1} of ${syncState.batchesTotal}...`
                : "Syncing data..."}
            </p>
          ) : syncState.lastUploadResult ? (
            <div className="flex items-center gap-2">
              <span className="text-base text-green-400">OK</span>
              <p className="text-sm text-green-400">All clear</p>
              {(syncState.lastUploadResult.newSnapshots > 0 ||
                syncState.lastUploadResult.newMythicPlusRuns > 0) && (
                <span className="text-xs text-gray-500">
                  ({syncState.lastUploadResult.newSnapshots} new snapshots,{" "}
                  {syncState.lastUploadResult.newMythicPlusRuns} new M+ runs uploaded)
                </span>
              )}
            </div>
          ) : !retailPath ? (
            <p className="text-sm text-gray-500">Select the WoW folder to enable uploads.</p>
          ) : !syncState.pendingUploadCounts ? (
            <p className="text-sm text-gray-400">Checking file...</p>
          ) : syncState.pendingUploadCounts.snapshots === 0 &&
            syncState.pendingUploadCounts.mythicPlusRuns === 0 ? (
            <p className="text-sm text-gray-500">
              No pending addon data found. Run the addon in-game first or sync after new activity.
            </p>
          ) : (
            <p className="text-sm text-yellow-400">
              {syncState.pendingUploadCounts.snapshots} snapshots and{" "}
              {syncState.pendingUploadCounts.mythicPlusRuns} M+ runs pending upload
            </p>
          )}

          {syncState.fileStats && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-xs text-gray-500">
              <span>Total snapshots</span>
              <span className="text-gray-400">
                {syncState.fileStats.totalSnapshots.toLocaleString()}
              </span>
              <span>Total M+ runs</span>
              <span className="text-gray-400">
                {syncState.fileStats.totalMythicPlusRuns.toLocaleString()}
              </span>
              <span>File size</span>
              <span className="text-gray-400">{formatBytes(syncState.fileStats.totalBytes)}</span>
              <span>Created</span>
              <span className="text-gray-400">{formatDate(syncState.fileStats.createdAt)}</span>
              <span>Last modified</span>
              <span className="text-gray-400">{formatDate(syncState.fileStats.modifiedAt)}</span>
              <span>Last synced</span>
              <span className="text-gray-400">{formatLastSyncTime(syncState.lastSyncedAt)}</span>
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-lg border border-gray-800 p-4">
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

        {characters !== undefined && (
          <p className="text-sm text-gray-500">
            {characters === null || characters.length === 0
              ? "No characters found."
              : `${characters.length} character${characters.length !== 1 ? "s" : ""} tracked.`}
          </p>
        )}

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

export default function App() {
  const queryClient = useQueryClient();
  const auth = useDesktopAuth();

  async function handleLogin() {
    await desktop.auth.login();
    authState = "authenticated";
    notifyAuthListeners();
    await queryClient.invalidateQueries();
  }

  async function handleLogout() {
    await clearAuth();
    queryClient.clear();
  }

  if (auth.isLoading) return <LoadingScreen />;
  if (!auth.isAuthenticated) return <LoginScreen onLogin={handleLogin} />;
  return <Dashboard onLogout={handleLogout} />;
}
