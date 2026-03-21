import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  version: process.versions.electron,
  auth: {
    login: () => ipcRenderer.invoke("auth:login"),
    getToken: () => ipcRenderer.invoke("auth:getToken"),
    getSession: () => ipcRenderer.invoke("auth:getSession"),
    logout: () => ipcRenderer.invoke("auth:logout"),
  },
  wow: {
    getRetailPath: () => ipcRenderer.invoke("wow:getRetailPath"),
    selectRetailFolder: () => ipcRenderer.invoke("wow:selectRetailFolder"),
    readAddonData: () => ipcRenderer.invoke("wow:readAddonData"),
    checkAddonInstalled: () => ipcRenderer.invoke("wow:checkAddonInstalled"),
    getInstalledAddonVersion: () =>
      ipcRenderer.invoke("wow:getInstalledAddonVersion") as Promise<string | null>,
    installAddon: (downloadUrl: string, checksumUrl: string | null) =>
      ipcRenderer.invoke("wow:installAddon", downloadUrl, checksumUrl),
    getLatestAddonRelease: () =>
      ipcRenderer.invoke("wow:getLatestAddonRelease") as Promise<{ url: string; checksumUrl: string | null; version: string }>,
    watchAddonFile: () => ipcRenderer.invoke("wow:watchAddonFile"),
    unwatchAddonFile: () => ipcRenderer.invoke("wow:unwatchAddonFile"),
    onAddonFileChanged: (cb: () => void) => {
      ipcRenderer.on("wow:addonFileChanged", () => cb());
    },
  },
  settings: {
    getAppSettings: () => ipcRenderer.invoke("settings:getAppSettings"),
    setCloseBehavior: (value: "tray" | "exit") =>
      ipcRenderer.invoke("settings:setCloseBehavior", value),
    setAutostart: (value: boolean) => ipcRenderer.invoke("settings:setAutostart", value),
    setLaunchMinimized: (value: boolean) =>
      ipcRenderer.invoke("settings:setLaunchMinimized", value),
    setLastSyncedAt: (value: number) =>
      ipcRenderer.invoke("settings:setLastSyncedAt", value),
  },
  openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>,
  installUpdate: () => ipcRenderer.invoke("app:installUpdate"),
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
  updates: {
    onUpdateAvailable: (cb: (version: string) => void) => {
      ipcRenderer.on("app:updateAvailable", (_, version: string) => cb(version));
    },
    onUpdateDownloaded: (cb: (version: string) => void) => {
      ipcRenderer.on("app:updateDownloaded", (_, version: string) => cb(version));
    },
    onUpdateNotAvailable: (cb: () => void) => {
      ipcRenderer.on("app:updateNotAvailable", () => cb());
    },
  },
});
