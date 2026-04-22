import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAuthSessionState } from "../shared/auth";
import type {
  AddonUpdateCheckResult,
  AddonUpdateState,
  AppInstallUpdateResult,
  AppUpdateState,
} from "../shared/update";

function subscribeToChannel<TArgs extends unknown[]>(
  channel: string,
  callback: (...args: TArgs) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
    callback(...(args as TArgs));
  };

  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("electron", {
  version: process.versions.electron,
  auth: {
    login: () => ipcRenderer.invoke("auth:login"),
    getToken: () => ipcRenderer.invoke("auth:getToken"),
    getSession: () =>
      ipcRenderer.invoke("auth:getSession") as Promise<DesktopAuthSessionState>,
    logout: () => ipcRenderer.invoke("auth:logout"),
  },
  wow: {
    getRetailPath: () => ipcRenderer.invoke("wow:getRetailPath") as Promise<string | null>,
    selectRetailFolder: () => ipcRenderer.invoke("wow:selectRetailFolder") as Promise<string | null>,
    readAddonData: () => ipcRenderer.invoke("wow:readAddonData"),
    checkAddonInstalled: () => ipcRenderer.invoke("wow:checkAddonInstalled") as Promise<boolean>,
    getInstalledAddonVersion: () =>
      ipcRenderer.invoke("wow:getInstalledAddonVersion") as Promise<string | null>,
    installAddon: (downloadUrl: string, checksumUrl: string | null) =>
      ipcRenderer.invoke("wow:installAddon", downloadUrl, checksumUrl),
    getLatestAddonRelease: () =>
      ipcRenderer.invoke("wow:getLatestAddonRelease") as Promise<{
        url: string;
        checksumUrl: string | null;
        version: string;
      }>,
    getAddonUpdateStatus: () =>
      ipcRenderer.invoke("wow:getAddonUpdateStatus") as Promise<AddonUpdateState>,
    triggerAddonUpdateCheck: () =>
      ipcRenderer.invoke("wow:triggerAddonUpdateCheck") as Promise<AddonUpdateCheckResult>,
    watchAddonFile: () => ipcRenderer.invoke("wow:watchAddonFile") as Promise<boolean>,
    unwatchAddonFile: () => ipcRenderer.invoke("wow:unwatchAddonFile") as Promise<void>,
    onAddonFileChanged: (cb: () => void) => subscribeToChannel("wow:addonFileChanged", cb),
    onAddonUpdateStaged: (cb: (version: string) => void) =>
      subscribeToChannel("wow:addonUpdateStaged", cb),
    onAddonUpdateApplied: (cb: (version: string) => void) =>
      subscribeToChannel("wow:addonUpdateApplied", cb),
    onAddonUpdateState: (cb: (state: AddonUpdateState) => void) =>
      subscribeToChannel("wow:addonUpdateState", cb),
  },
  settings: {
    getAppSettings: () => ipcRenderer.invoke("settings:getAppSettings"),
    setCloseBehavior: (value: "tray" | "exit") =>
      ipcRenderer.invoke("settings:setCloseBehavior", value),
    setAutostart: (value: boolean) => ipcRenderer.invoke("settings:setAutostart", value),
    setLaunchMinimized: (value: boolean) =>
      ipcRenderer.invoke("settings:setLaunchMinimized", value),
    setLastSyncedAt: (value: number) => ipcRenderer.invoke("settings:setLastSyncedAt", value),
  },
  openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>,
  getUpdateStatus: () => ipcRenderer.invoke("app:getUpdateStatus") as Promise<AppUpdateState>,
  installUpdate: () => ipcRenderer.invoke("app:installUpdate") as Promise<AppInstallUpdateResult>,
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates") as Promise<void>,
  updates: {
    getStatus: () => ipcRenderer.invoke("app:getUpdateStatus") as Promise<AppUpdateState>,
    onUpdateState: (cb: (state: AppUpdateState) => void) =>
      subscribeToChannel("app:updateState", cb),
    onUpdateAvailable: (cb: (version: string) => void) =>
      subscribeToChannel("app:updateAvailable", cb),
    onUpdateDownloaded: (cb: (version: string) => void) =>
      subscribeToChannel("app:updateDownloaded", cb),
    onUpdateNotAvailable: (cb: () => void) => subscribeToChannel("app:updateNotAvailable", cb),
  },
});
