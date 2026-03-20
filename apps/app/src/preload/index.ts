import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  version: process.versions.electron,
  auth: {
    login: (siteUrl: string) => ipcRenderer.invoke("auth:login", siteUrl),
    getToken: (siteUrl: string) => ipcRenderer.invoke("auth:getToken", siteUrl),
    getSession: (siteUrl: string) => ipcRenderer.invoke("auth:getSession", siteUrl),
    logout: (siteUrl: string) => ipcRenderer.invoke("auth:logout", siteUrl),
  },
  wow: {
    getRetailPath: () => ipcRenderer.invoke("wow:getRetailPath"),
    selectRetailFolder: () => ipcRenderer.invoke("wow:selectRetailFolder"),
    readAddonData: (retailPath: string) => ipcRenderer.invoke("wow:readAddonData", retailPath),
    checkAddonInstalled: (retailPath: string) =>
      ipcRenderer.invoke("wow:checkAddonInstalled", retailPath),
    getInstalledAddonVersion: (retailPath: string) =>
      ipcRenderer.invoke("wow:getInstalledAddonVersion", retailPath) as Promise<string | null>,
    installAddon: (retailPath: string, downloadUrl: string) =>
      ipcRenderer.invoke("wow:installAddon", retailPath, downloadUrl),
    getLatestAddonRelease: () =>
      ipcRenderer.invoke("wow:getLatestAddonRelease") as Promise<{ url: string; version: string }>,
    watchAddonFile: (retailPath: string) => ipcRenderer.invoke("wow:watchAddonFile", retailPath),
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
