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
    installAddon: (retailPath: string, downloadUrl: string) =>
      ipcRenderer.invoke("wow:installAddon", retailPath, downloadUrl),
    getLatestAddonRelease: () =>
      ipcRenderer.invoke("wow:getLatestAddonRelease") as Promise<{ url: string; version: string }>,
  },
  settings: {
    getAppSettings: () => ipcRenderer.invoke("settings:getAppSettings"),
    setCloseBehavior: (value: "tray" | "exit") =>
      ipcRenderer.invoke("settings:setCloseBehavior", value),
    setAutostart: (value: boolean) => ipcRenderer.invoke("settings:setAutostart", value),
  },
});
