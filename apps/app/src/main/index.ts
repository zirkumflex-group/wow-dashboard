import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  session,
  shell,
  Tray,
  Menu,
  nativeImage,
} from "electron";
import { autoUpdater } from "electron-updater";
import * as fs from "fs";
import { join } from "path";
import * as os from "os";
import { execFile } from "child_process";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let mainWindowReady = false;
let pendingWindowReveal = false;
// Cache close behavior so the window close handler can be synchronous (event.preventDefault
// must be called synchronously – awaiting inside the handler is too late on Windows).
let closeBehaviorCache: "tray" | "exit" = "tray";
let launchMinimizedCache = true;
let addonWatcher: ReturnType<typeof fs.watch> | null = null;
let addonWatchDebounce: ReturnType<typeof setTimeout> | null = null;

async function loadTrayIcon(): Promise<Electron.NativeImage> {
  try {
    if (process.platform === "win32") {
      const icon = await app.getFileIcon(process.execPath, { size: "small" });
      if (!icon.isEmpty()) return icon;
    }
  } catch (error) {
    console.warn("[wow-dashboard] Failed to load tray icon from executable:", error);
  }

  return nativeImage.createEmpty();
}

async function createTray(): Promise<void> {
  if (tray) return;

  const icon = await loadTrayIcon();
  tray = new Tray(icon);

  const buildMenu = () =>
    Menu.buildFromTemplate([
      {
        label: "Show WoW Dashboard",
        click: () => {
          showWindow();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

  tray.setToolTip("WoW Dashboard");
  tray.setContextMenu(buildMenu());

  const revealWindow = () => {
    pendingWindowReveal = false;
    mainWindow?.setSkipTaskbar(false);
    mainWindow?.show();
    mainWindow?.focus();
  };

  const showWindow = () => {
    if (!mainWindow) {
      pendingWindowReveal = true;
      createWindow();
      return;
    }

    if (!mainWindowReady) {
      pendingWindowReveal = true;
      return;
    }

    revealWindow();
  };

  tray.on("click", showWindow);
  // Windows fires "double-click" on the tray icon; handle both.
  tray.on("double-click", showWindow);
}

// ─── Settings persistence ─────────────────────────────────────────────────────

function settingsPath(): string {
  return join(app.getPath("userData"), "wow-dashboard-settings.json");
}

async function getSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.promises.readFile(settingsPath(), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function saveSettings(data: Record<string, unknown>): Promise<void> {
  await fs.promises.writeFile(settingsPath(), JSON.stringify(data, null, 2), "utf-8");
}

// ─── Lua parser ───────────────────────────────────────────────────────────────
// Parses the WoW SavedVariables file format (a Lua table literal assignment).

class LuaParser {
  private src: string;
  private pos: number;

  constructor(src: string) {
    this.src = src;
    this.pos = 0;
  }

  parseFile(): Record<string, unknown> | null {
    const m = this.src.match(/WowDashboardDB\s*=\s*/);
    if (!m || m.index === undefined) return null;
    this.pos = m.index + m[0].length;
    const val = this.parseValue();
    return val as Record<string, unknown>;
  }

  private skip(): void {
    while (this.pos < this.src.length) {
      if (/\s/.test(this.src[this.pos])) {
        this.pos++;
      } else if (this.src[this.pos] === "-" && this.src[this.pos + 1] === "-") {
        while (this.pos < this.src.length && this.src[this.pos] !== "\n") this.pos++;
      } else {
        break;
      }
    }
  }

  private parseValue(): unknown {
    this.skip();
    const ch = this.src[this.pos];
    if (ch === "{") return this.parseTable();
    if (ch === '"') return this.parseString();
    if (ch === "-" || /\d/.test(ch)) return this.parseNumber();
    if (this.src.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.src.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    if (this.src.startsWith("nil", this.pos)) {
      this.pos += 3;
      return null;
    }
    throw new Error(
      `Unexpected token at ${this.pos}: "${this.src.slice(this.pos, this.pos + 30)}"`,
    );
  }

  private parseTable(): unknown[] | Record<string, unknown> {
    this.pos++; // skip '{'
    const dict: Record<string, unknown> = {};
    const arr: unknown[] = [];
    let isDict = false;

    while (true) {
      this.skip();
      if (this.src[this.pos] === "}") {
        this.pos++;
        break;
      }
      if (this.src[this.pos] === ",") {
        this.pos++;
        continue;
      }

      if (this.src[this.pos] === "[" && this.src[this.pos + 1] === '"') {
        // ["string key"] = value
        isDict = true;
        this.pos += 2; // skip ["
        const end = this.src.indexOf('"', this.pos);
        const key = this.src.slice(this.pos, end);
        this.pos = end + 1; // skip closing "
        this.skip();
        this.pos++; // skip ]
        this.skip();
        this.pos++; // skip =
        dict[key] = this.parseValue();
      } else {
        // Positional (array) value
        arr.push(this.parseValue());
      }
    }

    return isDict ? dict : arr;
  }

  private parseString(): string {
    this.pos++; // skip opening "
    let result = "";
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '"') {
        this.pos++;
        break;
      }
      if (ch === "\\") {
        this.pos++;
        const esc = this.src[this.pos++];
        if (esc === "n") result += "\n";
        else if (esc === "t") result += "\t";
        else result += esc;
      } else {
        result += ch;
        this.pos++;
      }
    }
    return result;
  }

  private parseNumber(): number {
    const m = this.src.slice(this.pos).match(/^-?\d+\.?\d*/);
    if (!m) throw new Error(`Expected number at ${this.pos}`);
    this.pos += m[0].length;
    return parseFloat(m[0]);
  }
}

// ─── Addon data extraction ────────────────────────────────────────────────────

type Role = "tank" | "healer" | "dps";
type Region = "us" | "eu" | "kr" | "tw";
type Faction = "alliance" | "horde";

interface SnapshotData {
  takenAt: number;
  level: number;
  spec: string;
  role: Role;
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
  region: Region;
  class: string;
  race: string;
  faction: Faction;
  snapshots: SnapshotData[];
}

function extractCharacters(db: Record<string, unknown>): CharacterData[] {
  const characters = (db.characters ?? {}) as Record<string, unknown>;
  const result: CharacterData[] = [];
  const validRegions: Region[] = ["us", "eu", "kr", "tw"];

  for (const charRaw of Object.values(characters)) {
    const char = charRaw as Record<string, unknown>;
    const region = String(char.region ?? "us") as Region;
    if (!validRegions.includes(region)) continue;

    const faction = String(char.faction ?? "alliance").toLowerCase() as Faction;
    if (faction !== "alliance" && faction !== "horde") continue;

    const snapshots: SnapshotData[] = [];
    for (const snapRaw of (char.snapshots as unknown[]) ?? []) {
      const snap = snapRaw as Record<string, unknown>;
      const role = String(snap.role ?? "dps") as Role;
      if (role !== "tank" && role !== "healer" && role !== "dps") continue;

      const currencies = (snap.currencies ?? {}) as Record<string, unknown>;
      const stats = (snap.stats ?? {}) as Record<string, unknown>;

      snapshots.push({
        takenAt: Number(snap.takenAt),
        level: Number(snap.level),
        spec: String(snap.spec ?? "Unknown"),
        role,
        itemLevel: Number(snap.itemLevel),
        gold: Number(snap.gold),
        playtimeSeconds: Number(snap.playtimeSeconds),
        mythicPlusScore: Number(snap.mythicPlusScore),
        currencies: {
          adventurerDawncrest: Number(currencies.adventurerDawncrest ?? 0),
          veteranDawncrest: Number(currencies.veteranDawncrest ?? 0),
          championDawncrest: Number(currencies.championDawncrest ?? 0),
          heroDawncrest: Number(currencies.heroDawncrest ?? 0),
          mythDawncrest: Number(currencies.mythDawncrest ?? 0),
          radiantSparkDust: Number(currencies.radiantSparkDust ?? 0),
        },
        stats: {
          stamina: Number(stats.stamina ?? 0),
          strength: Number(stats.strength ?? 0),
          agility: Number(stats.agility ?? 0),
          intellect: Number(stats.intellect ?? 0),
          critPercent: Number(stats.critPercent ?? 0),
          hastePercent: Number(stats.hastePercent ?? 0),
          masteryPercent: Number(stats.masteryPercent ?? 0),
          versatilityPercent: Number(stats.versatilityPercent ?? 0),
        },
      });
    }

    result.push({
      name: String(char.name),
      realm: String(char.realm),
      region,
      class: String(char.class),
      race: String(char.race),
      faction,
      snapshots,
    });
  }

  return result;
}

async function findAndParseAddonData(
  retailPath: string,
): Promise<{
  characters: CharacterData[];
  accountsFound: string[];
  fileStats: { totalBytes: number; createdAt: number; modifiedAt: number; totalSnapshots: number } | null;
}> {
  const wtfAccountPath = join(retailPath, "WTF", "Account");
  let accounts: string[];
  try {
    accounts = await fs.promises.readdir(wtfAccountPath);
  } catch {
    return { characters: [], accountsFound: [], fileStats: null };
  }

  const accountsFound: string[] = [];
  const allChars = new Map<string, CharacterData>();
  let totalBytes = 0;
  let createdAt = Infinity;
  let modifiedAt = 0;

  for (const account of accounts) {
    const luaPath = join(wtfAccountPath, account, "SavedVariables", "wow-dashboard.lua");
    let content: string;
    try {
      content = await fs.promises.readFile(luaPath, "utf-8");
    } catch {
      continue;
    }

    accountsFound.push(account);

    try {
      const stat = await fs.promises.stat(luaPath);
      totalBytes += stat.size;
      createdAt = Math.min(createdAt, stat.birthtimeMs);
      modifiedAt = Math.max(modifiedAt, stat.mtimeMs);
    } catch {
      // ignore stat errors
    }

    let db: Record<string, unknown> | null = null;
    try {
      db = new LuaParser(content).parseFile();
    } catch (e) {
      console.error(`[wow-dashboard] Lua parse error for ${luaPath}:`, e);
    }
    if (!db) continue;

    const chars = extractCharacters(db);
    for (const char of chars) {
      const key = `${char.name}-${char.realm}`;
      const existing = allChars.get(key);
      if (!existing) {
        allChars.set(key, char);
      } else {
        const knownTimes = new Set(existing.snapshots.map((s) => s.takenAt));
        for (const snap of char.snapshots) {
          if (!knownTimes.has(snap.takenAt)) {
            existing.snapshots.push(snap);
            knownTimes.add(snap.takenAt);
          }
        }
      }
    }
  }

  const characters = Array.from(allChars.values());
  const totalSnapshots = characters.reduce((sum, c) => sum + c.snapshots.length, 0);
  const fileStats =
    accountsFound.length > 0
      ? { totalBytes, createdAt, modifiedAt, totalSnapshots }
      : null;

  return { characters, accountsFound, fileStats };
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindowReady = false;
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    backgroundColor: "#030712",
    paintWhenInitiallyHidden: true,
    show: process.platform !== "win32", // on Windows start hidden in tray; show immediately on other platforms
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindowReady = true;

    if (process.platform !== "win32" || pendingWindowReveal) {
      pendingWindowReveal = false;
      mainWindow?.setSkipTaskbar(false);
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  // Use the cached close behavior so event.preventDefault() is called synchronously.
  // Awaiting inside a close handler is too late — Electron processes the event before
  // the async callback resumes, so the window would be destroyed even with preventDefault.
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    if (closeBehaviorCache === "tray") {
      event.preventDefault();
      mainWindow?.setSkipTaskbar(true);
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindowReady = false;
    pendingWindowReveal = false;
    mainWindow = null;
  });
}

async function openOAuthPopup(url: string, callbackBase: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const popup = new BrowserWindow({
      width: 800,
      height: 700,
      parent: mainWindow ?? undefined,
      webPreferences: { sandbox: true },
    });

    popup.loadURL(url);

    const onNav = (_: Electron.Event, navUrl: string) => {
      if (navUrl.startsWith(callbackBase) && !navUrl.includes("/api/auth/")) {
        popup.close();
      }
    };

    popup.webContents.on("will-redirect", onNav);
    popup.webContents.on("did-navigate", onNav);
    popup.on("closed", resolve);
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

// Auth
ipcMain.handle("auth:login", async (_, siteUrl: string) => {
  const resp = await session.defaultSession.fetch(`${siteUrl}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: siteUrl },
    body: JSON.stringify({ provider: "battlenet", callbackURL: `${siteUrl}/dashboard` }),
  });

  if (!resp.ok) throw new Error(`Auth sign-in error: ${resp.status}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await resp.json();
  const oauthUrl: string = data?.url;
  if (!oauthUrl) throw new Error("No OAuth URL returned from auth server");

  await openOAuthPopup(oauthUrl, siteUrl);
  return true;
});

ipcMain.handle("auth:getToken", async (_, siteUrl: string) => {
  try {
    const resp = await session.defaultSession.fetch(`${siteUrl}/api/auth/convex/token`, {
      headers: { Origin: siteUrl },
    });
    if (!resp.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await resp.json();
    return data?.token ?? null;
  } catch {
    return null;
  }
});

ipcMain.handle("auth:getSession", async (_, siteUrl: string) => {
  try {
    const resp = await session.defaultSession.fetch(`${siteUrl}/api/auth/get-session`, {
      headers: { Origin: siteUrl },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
});

ipcMain.handle("auth:logout", async (_, siteUrl: string) => {
  try {
    await session.defaultSession.fetch(`${siteUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: siteUrl },
    });
    return true;
  } catch {
    return false;
  }
});

// WoW addon data
ipcMain.handle("wow:getRetailPath", async () => {
  const settings = await getSettings();
  return (settings.retailPath as string) ?? null;
});

ipcMain.handle("wow:selectRetailFolder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select World of Warcraft _retail_ folder",
    buttonLabel: "Select folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folder = result.filePaths[0];
  const settings = await getSettings();
  settings.retailPath = folder;
  await saveSettings(settings);
  return folder;
});

ipcMain.handle("wow:readAddonData", async (_, retailPath: string) => {
  return findAndParseAddonData(retailPath);
});

function stopAddonWatcher() {
  if (addonWatchDebounce) {
    clearTimeout(addonWatchDebounce);
    addonWatchDebounce = null;
  }
  if (addonWatcher) {
    addonWatcher.close();
    addonWatcher = null;
  }
}

ipcMain.handle("wow:watchAddonFile", (_, retailPath: string) => {
  stopAddonWatcher();
  const watchPath = join(retailPath, "WTF", "Account");
  try {
    addonWatcher = fs.watch(watchPath, { recursive: true }, (_event, filename) => {
      if (!filename?.endsWith("wow-dashboard.lua")) return;
      if (addonWatchDebounce) clearTimeout(addonWatchDebounce);
      addonWatchDebounce = setTimeout(() => {
        mainWindow?.webContents.send("wow:addonFileChanged");
      }, 2000);
    });
  } catch (e) {
    console.warn("[wow-dashboard] Failed to watch addon file:", e);
  }
});

ipcMain.handle("wow:unwatchAddonFile", () => {
  stopAddonWatcher();
});

// Addon installation
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = net.request({ url, useSessionCookies: false });
    const writeStream = fs.createWriteStream(destPath);
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        writeStream.destroy();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }
      response.on("data", (chunk: Buffer) => writeStream.write(chunk));
      response.on("end", () => writeStream.end(() => resolve()));
      response.on("error", (err: Error) => {
        writeStream.destroy();
        reject(err);
      });
    });
    request.on("error", (err: Error) => {
      writeStream.destroy();
      reject(err);
    });
    request.end();
  });
}

function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (process.platform === "win32") {
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`,
        ],
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    } else {
      execFile("unzip", ["-o", zipPath, "-d", destDir], (error) => {
        if (error) reject(error);
        else resolve();
      });
    }
  });
}

ipcMain.handle("wow:checkAddonInstalled", async (_, retailPath: string) => {
  const addonPath = join(retailPath, "Interface", "AddOns", "wow-dashboard");
  try {
    await fs.promises.access(addonPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("wow:getInstalledAddonVersion", async (_, retailPath: string) => {
  const tocPath = join(retailPath, "Interface", "AddOns", "wow-dashboard", "wow-dashboard.toc");
  try {
    const content = await fs.promises.readFile(tocPath, "utf-8");
    const match = content.match(/^##\s*Version:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
});

ipcMain.handle("wow:installAddon", async (_, retailPath: string, downloadUrl: string) => {
  const tmpDir = os.tmpdir();
  const zipPath = join(tmpDir, "wow-dashboard-addon.zip");
  const extractDir = join(tmpDir, "wow-dashboard-addon-extract");
  const addonsDir = join(retailPath, "Interface", "AddOns");
  const addonDest = join(addonsDir, "wow-dashboard");

  try {
    await downloadFile(downloadUrl, zipPath);

    await fs.promises.rm(extractDir, { recursive: true, force: true });
    await fs.promises.mkdir(extractDir, { recursive: true });

    await extractZip(zipPath, extractDir);

    const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const addonSrc = dirs.length === 1 ? join(extractDir, dirs[0].name) : extractDir;

    await fs.promises.mkdir(addonsDir, { recursive: true });
    await fs.promises.rm(addonDest, { recursive: true, force: true });
    await fs.promises.cp(addonSrc, addonDest, { recursive: true });
  } finally {
    await fs.promises.rm(zipPath, { force: true }).catch(() => {});
    await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
});

const GITHUB_REPO = "zirkumflex-group/wow-dashboard";

ipcMain.handle("wow:getLatestAddonRelease", async () => {
  const res = await net.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const releases = (await res.json()) as any[];
  const addonRelease = releases.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.tag_name.startsWith("addon-v") && !r.draft && !r.prerelease,
  );
  if (!addonRelease) throw new Error("No addon release found on GitHub");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asset = addonRelease.assets.find((a: any) => a.name === "wow-dashboard.zip");
  if (!asset) throw new Error("No wow-dashboard.zip asset found in latest addon release");
  return {
    url: asset.browser_download_url as string,
    version: (addonRelease.tag_name as string).replace("addon-v", ""),
  };
});

// Shell
ipcMain.handle("app:openExternal", (_, url: string) => shell.openExternal(url));
ipcMain.handle("app:getVersion", () => app.getVersion());

// Trigger a silent install and relaunch — used by the "Restart Now" button in the renderer.
ipcMain.handle("app:installUpdate", () => {
  autoUpdater.quitAndInstall(true, true);
});

// Manually trigger an update check — used by the "Check for Updates" button in the renderer.
ipcMain.handle("app:checkForUpdates", () => {
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
});

// App settings
ipcMain.handle("settings:getAppSettings", async () => {
  const s = await getSettings();
  return {
    closeBehavior: (s.closeBehavior as string) ?? "tray",
    autostart: (s.autostart as boolean) ?? false,
    launchMinimized: (s.launchMinimized as boolean) ?? true,
    lastSyncedAt: (s.lastSyncedAt as number) ?? 0,
  };
});

ipcMain.handle("settings:setCloseBehavior", async (_, value: "tray" | "exit") => {
  // Update in-memory cache first so the window close handler picks it up immediately.
  closeBehaviorCache = value;
  const s = await getSettings();
  s.closeBehavior = value;
  await saveSettings(s);
});

ipcMain.handle("settings:setAutostart", async (_, value: boolean) => {
  const s = await getSettings();
  s.autostart = value;
  await saveSettings(s);
  if (process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: value });
  }
});

ipcMain.handle("settings:setLaunchMinimized", async (_, value: boolean) => {
  launchMinimizedCache = value;
  const s = await getSettings();
  s.launchMinimized = value;
  await saveSettings(s);
});

ipcMain.handle("settings:setLastSyncedAt", async (_, value: number) => {
  const s = await getSettings();
  s.lastSyncedAt = value;
  await saveSettings(s);
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Load settings before creating the window so closeBehaviorCache is populated and
  // the synchronous close handler has the correct value from the very first close event.
  const settings = await getSettings();
  closeBehaviorCache = (settings.closeBehavior as "tray" | "exit") ?? "tray";
  launchMinimizedCache = (settings.launchMinimized as boolean) ?? true;
  if (process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: (settings.autostart as boolean) ?? false });
    if (!launchMinimizedCache) {
      pendingWindowReveal = true;
    }
  }

  createWindow();
  void createTray().catch((error) => {
    console.warn("[wow-dashboard] Failed to create tray:", error);
  });

  // Check for app updates (only in packaged builds).
  // Updates download in the background and install silently on next quit (autoInstallOnAppQuit
  // is true by default in electron-updater). The renderer shows a banner so the user can also
  // trigger an immediate restart via app:installUpdate.
  if (app.isPackaged) {
    const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
    autoUpdater.on("update-available", (info) => {
      mainWindow?.webContents.send("app:updateAvailable", info.version);
    });
    autoUpdater.on("update-downloaded", (info) => {
      mainWindow?.webContents.send("app:updateDownloaded", info.version);
      // No blocking dialog — the renderer banner handles user interaction.
    });
    autoUpdater.on("update-not-available", () => {
      mainWindow?.webContents.send("app:updateNotAvailable");
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopAddonWatcher();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
