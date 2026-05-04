import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type DesktopAuthSessionState =
  | {
      status: "valid";
      session: unknown;
    }
  | {
      status: "unauthenticated";
    }
  | {
      status: "unknown";
    };

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "upToDate"
  | "error"
  | "unsupported";

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  progressPercent: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  isPackaged: boolean;
}

export interface AppInstallUpdateResult {
  ok: boolean;
  status: "installing" | "notDownloaded" | "unsupported";
  message: string | null;
}

export type AddonUpdateStatus =
  | "idle"
  | "checking"
  | "updating"
  | "upToDate"
  | "staged"
  | "applied"
  | "notInstalled"
  | "noRetailPath"
  | "invalidRetailPath"
  | "error";

export interface AddonUpdateState {
  status: AddonUpdateStatus;
  installedVersion: string | null;
  latestVersion: string | null;
  stagedVersion: string | null;
  error: string | null;
  lastCheckedAt: number | null;
}

export interface AddonUpdateCheckResult {
  status:
    | "upToDate"
    | "staged"
    | "applied"
    | "notInstalled"
    | "noRetailPath"
    | "invalidRetailPath"
    | "error";
  installedVersion: string | null;
  latestVersion: string | null;
  stagedVersion: string | null;
  error: string | null;
}

export interface AddonFileStats {
  totalBytes: number;
  createdAt: number;
  modifiedAt: number;
  totalSnapshots: number;
  totalMythicPlusRuns: number;
}

export interface PendingUploadCounts {
  snapshots: number;
  mythicPlusRuns: number;
}

export interface SyncState {
  status: "idle" | "scanning" | "uploading" | "resyncing" | "success" | "warning" | "error";
  message: string | null;
  pendingUploadCounts: PendingUploadCounts | null;
  fileStats: AddonFileStats | null;
  lastSyncedAt: number;
  lastUploadResult: {
    newChars: number;
    newSnapshots: number;
    newMythicPlusRuns: number;
  } | null;
  accountsFound: string[];
  trackedCharacters: number;
  batchesTotal: number;
  batchesCompleted: number;
}

export interface AppSettings {
  closeBehavior: "tray" | "exit";
  autostart: boolean;
  launchMinimized: boolean;
  lastSyncedAt: number;
}

export interface ApiFetchRequest {
  url: string;
  method?: string;
  headers?: Array<[string, string]>;
  body?: string;
}

export interface ApiFetchResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
}

function onEvent<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  return listen<T>(event, ({ payload }) => cb(payload));
}

export const desktop = {
  auth: {
    login: () => invoke<boolean>("auth_login"),
    getSession: () => invoke<DesktopAuthSessionState>("auth_get_session"),
    logout: () => invoke<boolean>("auth_logout"),
  },
  api: {
    fetch: (request: ApiFetchRequest) => invoke<ApiFetchResponse>("api_fetch", { request }),
  },
  wow: {
    getRetailPath: () => invoke<string | null>("wow_get_retail_path"),
    selectRetailFolder: () => invoke<string | null>("wow_select_retail_folder"),
    checkAddonInstalled: () => invoke<boolean>("wow_check_addon_installed"),
    getInstalledAddonVersion: () => invoke<string | null>("wow_get_installed_addon_version"),
    installAddon: () => invoke<{ version: string }>("wow_install_addon"),
    getLatestAddonRelease: () => invoke<{ version: string }>("wow_get_latest_addon_release"),
    getAddonUpdateStatus: () => invoke<AddonUpdateState>("wow_get_addon_update_status"),
    triggerAddonUpdateCheck: () =>
      invoke<AddonUpdateCheckResult>("wow_trigger_addon_update_check"),
    watchAddonFile: () => invoke<boolean>("wow_watch_addon_file"),
    unwatchAddonFile: () => invoke<void>("wow_unwatch_addon_file"),
    refreshFileState: () => invoke<SyncState>("sync_refresh_file_state"),
    syncNow: () => invoke<SyncState>("sync_now"),
    getSyncState: () => invoke<SyncState>("sync_get_state"),
    onSyncState: (cb: (state: SyncState) => void) => onEvent("sync-state", cb),
    onAddonFileChanged: (cb: () => void) => onEvent("addon-file-changed", cb),
    onAddonUpdateStaged: (cb: (version: string) => void) =>
      onEvent("addon-update-staged", cb),
    onAddonUpdateApplied: (cb: (version: string) => void) =>
      onEvent("addon-update-applied", cb),
    onAddonUpdateState: (cb: (state: AddonUpdateState) => void) =>
      onEvent("addon-update-state", cb),
  },
  settings: {
    getAppSettings: () => invoke<AppSettings>("settings_get_app_settings"),
    setCloseBehavior: (value: "tray" | "exit") =>
      invoke<void>("settings_set_close_behavior", { value }),
    setAutostart: (value: boolean) => invoke<void>("settings_set_autostart", { value }),
    setLaunchMinimized: (value: boolean) =>
      invoke<void>("settings_set_launch_minimized", { value }),
  },
  openExternal: (url: string) => invoke<void>("app_open_external", { url }),
  getVersion: () => invoke<string>("app_get_version"),
  getUpdateStatus: () => invoke<AppUpdateState>("app_get_update_status"),
  installUpdate: () => invoke<AppInstallUpdateResult>("app_install_update"),
  checkForUpdates: () => invoke<void>("app_check_for_updates"),
  updates: {
    getStatus: () => invoke<AppUpdateState>("app_get_update_status"),
    onUpdateState: (cb: (state: AppUpdateState) => void) => onEvent("app-update-state", cb),
    onUpdateAvailable: (cb: (version: string) => void) => onEvent("app-update-available", cb),
    onUpdateDownloaded: (cb: (version: string) => void) =>
      onEvent("app-update-downloaded", cb),
    onUpdateNotAvailable: (cb: () => void) => onEvent("app-update-not-available", cb),
  },
};
