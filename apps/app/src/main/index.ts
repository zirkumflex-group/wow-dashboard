import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  safeStorage,
  session,
  shell,
  Tray,
  Menu,
  nativeImage,
} from "electron";
import { autoUpdater } from "electron-updater";
import * as fs from "fs";
import * as path from "path";
import { join, resolve, sep } from "path";
import * as crypto from "crypto";
import * as os from "os";
import * as unzipper from "unzipper";

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
let cachedElectronToken: string | null = null;
let storedSessionToken: string | null = null;
let pendingLoginResolve: ((token: string) => void) | null = null;
let pendingLoginReject: ((err: Error) => void) | null = null;

// ─── Token persistence via OS keychain (safeStorage) ──────────────────────────

function getTokenPath(): string {
  return join(app.getPath("userData"), "auth-token.bin");
}

function loadStoredAuth(): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const buf = fs.readFileSync(getTokenPath());
    const raw = safeStorage.decryptString(buf);
    try {
      const parsed = JSON.parse(raw) as { sessionToken?: string };
      if (typeof parsed.sessionToken === "string") {
        storedSessionToken = parsed.sessionToken;
        return;
      }
    } catch {
      cachedElectronToken = raw;
    }
  } catch {
    return;
  }
}

function saveSessionToken(token: string | null): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  storedSessionToken = token;
  const tokenPath = getTokenPath();
  if (!token) {
    try {
      fs.unlinkSync(tokenPath);
    } catch {
      // file may not exist
    }
    return;
  }
  try {
    fs.writeFileSync(tokenPath, safeStorage.encryptString(JSON.stringify({ sessionToken: token })));
  } catch (err) {
    console.warn("[wow-dashboard] Failed to persist token:", err);
  }
}

function getJwtExpirationMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payloadPart = parts[1];
  if (!payloadPart) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isJwtExpired(token: string, nowMs = Date.now(), skewMs = 60_000): boolean {
  const exp = getJwtExpirationMs(token);
  if (!exp) return true;
  return nowMs >= exp - skewMs;
}

async function fetchFreshConvexToken(): Promise<string | null> {
  if (!storedSessionToken) return null;
  try {
    const resp = await net.fetch(`${SITE_URL}/api/auth/convex/token`, {
      headers: {
        Origin: SITE_URL,
        Authorization: `Bearer ${storedSessionToken}`,
      },
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        storedSessionToken = null;
        saveSessionToken(null);
      }
      return null;
    }
    const data = (await resp.json()) as { token?: string };
    cachedElectronToken = data?.token ?? null;
    return cachedElectronToken;
  } catch {
    return null;
  }
}

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
      const current = this.src[this.pos] ?? "";
      if (/\s/.test(current)) {
        this.pos++;
      } else if (current === "-" && this.src[this.pos + 1] === "-") {
        while (this.pos < this.src.length && this.src[this.pos] !== "\n") this.pos++;
      } else {
        break;
      }
    }
  }

  private parseValue(): unknown {
    this.skip();
    const ch = this.src[this.pos] ?? "";
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
type LuaTable = Record<string, unknown>;
const CLASS_TAG_BY_ID: Record<number, string> = {
  1: "WARRIOR",
  2: "PALADIN",
  3: "HUNTER",
  4: "ROGUE",
  5: "PRIEST",
  6: "DEATHKNIGHT",
  7: "SHAMAN",
  8: "MAGE",
  9: "WARLOCK",
  10: "MONK",
  11: "DRUID",
  12: "DEMONHUNTER",
  13: "EVOKER",
};

interface MythicPlusRunMemberData {
  name: string;
  realm?: string;
  classTag?: string;
  role?: Role;
}

interface MythicPlusRunData {
  fingerprint: string;
  observedAt: number;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  completed?: boolean;
  completedInTime?: boolean;
  durationMs?: number;
  runScore?: number;
  startDate?: number;
  completedAt?: number;
  thisWeek?: boolean;
  members?: MythicPlusRunMemberData[];
}

interface SnapshotData {
  takenAt: number;
  level: number;
  spec: string;
  role: Role;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  playtimeThisLevelSeconds?: number;
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
    speedPercent?: number;
    leechPercent?: number;
    avoidancePercent?: number;
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
  mythicPlusRuns: MythicPlusRunData[];
}

interface AddonFileStats {
  totalBytes: number;
  createdAt: number;
  modifiedAt: number;
  totalSnapshots: number;
  totalMythicPlusRuns: number;
}

function getSnapshotCompletenessScore(snapshot: SnapshotData): number {
  let score = 0;

  if (snapshot.playtimeSeconds > 0) score += 1;
  if (snapshot.playtimeThisLevelSeconds !== undefined) score += 1;
  if (snapshot.stats.speedPercent !== undefined) score += 2;
  if (snapshot.stats.leechPercent !== undefined) score += 2;
  if (snapshot.stats.avoidancePercent !== undefined) score += 2;

  return score;
}

function mergeSnapshotData(current: SnapshotData, candidate: SnapshotData): SnapshotData {
  const currentScore = getSnapshotCompletenessScore(current);
  const candidateScore = getSnapshotCompletenessScore(candidate);
  const preferred = candidateScore >= currentScore ? candidate : current;
  const fallback = preferred === candidate ? current : candidate;

  return {
    ...preferred,
    playtimeSeconds: preferred.playtimeSeconds > 0 ? preferred.playtimeSeconds : fallback.playtimeSeconds,
    playtimeThisLevelSeconds:
      preferred.playtimeThisLevelSeconds ?? fallback.playtimeThisLevelSeconds,
    stats: {
      ...preferred.stats,
      speedPercent: preferred.stats.speedPercent ?? fallback.stats.speedPercent,
      leechPercent: preferred.stats.leechPercent ?? fallback.stats.leechPercent,
      avoidancePercent: preferred.stats.avoidancePercent ?? fallback.stats.avoidancePercent,
    },
  };
}

function isRecord(value: unknown): value is LuaTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeRunMemberRole(value: unknown): Role | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "TANK") return "tank";
  if (normalized === "HEALER") return "healer";
  if (normalized === "DAMAGER" || normalized === "DAMAGE" || normalized === "DPS") return "dps";
  return undefined;
}

function normalizeClassTag(value: unknown, classId?: number): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized !== "") {
      return normalized.toUpperCase().replace(/[\s_-]/g, "");
    }
  }

  if (typeof classId === "number" && Number.isFinite(classId)) {
    return CLASS_TAG_BY_ID[classId];
  }

  return undefined;
}

function normalizeMemberIdentity(
  nameValue: unknown,
  realmValue?: unknown,
): { name: string; realm?: string } | null {
  if (typeof nameValue !== "string") {
    return null;
  }

  let name = nameValue.trim();
  if (name === "") {
    return null;
  }

  let realm = typeof realmValue === "string" ? realmValue.trim() : undefined;
  if (realm === "") {
    realm = undefined;
  }

  if (!realm) {
    const separatorIndex = name.indexOf("-");
    if (separatorIndex > 0 && separatorIndex < name.length - 1) {
      realm = name.slice(separatorIndex + 1).trim() || undefined;
      name = name.slice(0, separatorIndex).trim();
    }
  }

  return name === "" ? null : { name, realm };
}

function normalizeMythicPlusRunMember(value: unknown): MythicPlusRunMemberData | null {
  if (!isRecord(value)) {
    return null;
  }

  const identity = normalizeMemberIdentity(
    value.name ?? value.playerName ?? value.fullName ?? value.unitName,
    value.realm ?? value.realmName ?? value.server ?? value.realmSlug,
  );
  if (!identity) {
    return null;
  }

  const classId = toOptionalNumber(value.classID ?? value.classId);
  const classTag = normalizeClassTag(
    value.classTag ?? value.classFile ?? value.classFilename ?? value.class ?? value.englishClass,
    classId,
  );
  const role =
    normalizeRunMemberRole(value.role ?? value.assignedRole ?? value.combatRole) ??
    normalizeRunMemberRole(value.specRole);

  return {
    name: identity.name,
    realm: identity.realm,
    classTag,
    role,
  };
}

function normalizeMythicPlusRunMembers(value: unknown): MythicPlusRunMemberData[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const members: MythicPlusRunMemberData[] = [];
  const seenMembers = new Set<string>();

  for (const rawMember of value) {
    const member = normalizeMythicPlusRunMember(rawMember);
    if (!member) {
      continue;
    }

    const memberKey = `${member.name.toLowerCase()}|${member.realm?.toLowerCase() ?? ""}`;
    if (seenMembers.has(memberKey)) {
      continue;
    }

    seenMembers.add(memberKey);
    members.push(member);
  }

  return members.length > 0 ? members : undefined;
}

function getNormalizedRunMemberName(member: MythicPlusRunMemberData) {
  return member.name.trim().toLowerCase();
}

function getNormalizedRunMemberRealm(member: MythicPlusRunMemberData) {
  return member.realm?.trim().toLowerCase() ?? "";
}

function findMergeableRunMemberIndex(
  members: MythicPlusRunMemberData[],
  candidateMember: MythicPlusRunMemberData,
) {
  const candidateName = getNormalizedRunMemberName(candidateMember);
  const candidateRealm = getNormalizedRunMemberRealm(candidateMember);
  let exactIndex: number | undefined;
  let unresolvedIndex: number | undefined;
  let unresolvedCount = 0;
  let sameNameIndex: number | undefined;
  let sameNameCount = 0;

  for (let index = 0; index < members.length; index += 1) {
    const currentMember = members[index]!;
    if (getNormalizedRunMemberName(currentMember) !== candidateName) {
      continue;
    }

    sameNameCount += 1;
    sameNameIndex ??= index;
    const currentRealm = getNormalizedRunMemberRealm(currentMember);
    if (currentRealm === candidateRealm) {
      exactIndex = index;
      break;
    }
    if (currentRealm === "") {
      unresolvedIndex = index;
      unresolvedCount += 1;
    }
  }

  if (exactIndex !== undefined) {
    return exactIndex;
  }
  if (candidateRealm === "") {
    return sameNameCount === 1 ? unresolvedIndex ?? sameNameIndex : undefined;
  }

  return unresolvedCount === 1 ? unresolvedIndex : undefined;
}

function mergeMythicPlusRunMember(
  currentMember: MythicPlusRunMemberData | undefined,
  candidateMember: MythicPlusRunMemberData,
): MythicPlusRunMemberData {
  return {
    name: candidateMember.name,
    realm: candidateMember.realm ?? currentMember?.realm,
    classTag: candidateMember.classTag ?? currentMember?.classTag,
    role: candidateMember.role ?? currentMember?.role,
  };
}

function mergeMythicPlusRunMembers(
  currentMembers: MythicPlusRunMemberData[] | undefined,
  candidateMembers: MythicPlusRunMemberData[] | undefined,
) {
  if ((!currentMembers || currentMembers.length === 0) && (!candidateMembers || candidateMembers.length === 0)) {
    return undefined;
  }

  const mergedMembers: MythicPlusRunMemberData[] = [];

  for (const members of [candidateMembers, currentMembers]) {
    for (const member of members ?? []) {
      const mergedIndex = findMergeableRunMemberIndex(mergedMembers, member);
      if (mergedIndex === undefined) {
        mergedMembers.push(member);
        continue;
      }

      mergedMembers[mergedIndex] = mergeMythicPlusRunMember(mergedMembers[mergedIndex], member);
    }
  }

  return mergedMembers.length > 0 ? mergedMembers : undefined;
}

function getMythicPlusRunMemberCompletenessScore(
  members: MythicPlusRunMemberData[] | undefined,
): number {
  if (!members || members.length === 0) {
    return 0;
  }

  let score = 0;
  for (const member of members) {
    if (member.name) score += 1;
    if (member.realm) score += 1;
    if (member.classTag) score += 2;
    if (member.role) score += 2;
  }

  return score;
}

function getImprovedMythicPlusRunMembers(
  currentMembers: MythicPlusRunMemberData[] | undefined,
  candidateMembers: MythicPlusRunMemberData[] | undefined,
) {
  const mergedMembers = mergeMythicPlusRunMembers(currentMembers, candidateMembers);
  if (!mergedMembers || mergedMembers.length === 0) {
    return undefined;
  }

  const currentCount = currentMembers?.length ?? 0;
  if (mergedMembers.length > currentCount) {
    return mergedMembers;
  }

  return getMythicPlusRunMemberCompletenessScore(mergedMembers) >
    getMythicPlusRunMemberCompletenessScore(currentMembers)
    ? mergedMembers
    : undefined;
}

function normalizeSnapshotSpec(value: unknown): string {
  if (typeof value !== "string") {
    return "Unknown";
  }

  const normalized = value.trim();
  return normalized === "" ? "Unknown" : normalized;
}

function toOptionalMythicPlusTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const year = toOptionalNumber(value.year);
  const month = toOptionalNumber(value.month);
  const day = toOptionalNumber(value.day);
  if (year === undefined || month === undefined || day === undefined) {
    return undefined;
  }

  const fullYear = year < 100 ? 2000 + year : year;
  const hour = toOptionalNumber(value.hour) ?? 0;
  const minute = toOptionalNumber(value.minute) ?? toOptionalNumber(value.min) ?? 0;
  const second = toOptionalNumber(value.second) ?? toOptionalNumber(value.sec) ?? 0;
  const timestampMs = new Date(fullYear, month, day + 1, hour, minute, second).getTime();

  return Number.isFinite(timestampMs) ? Math.floor(timestampMs / 1000) : undefined;
}

function toFingerprintToken(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

function getRunMapFingerprintToken(run: Partial<MythicPlusRunData>): string {
  if (run.mapChallengeModeID !== undefined) {
    return toFingerprintToken(run.mapChallengeModeID);
  }

  if (typeof run.mapName === "string") {
    const normalizedName = run.mapName.trim().toLowerCase();
    if (normalizedName !== "") return normalizedName;
  }

  return "";
}

function getRunIdentityTimestamp(run: Partial<MythicPlusRunData>): number | null {
  return run.startDate ?? run.completedAt ?? null;
}

function buildCanonicalMythicPlusRunFingerprint(run: Partial<MythicPlusRunData>): string | undefined {
  const mapToken = getRunMapFingerprintToken(run);
  const identityTimestamp = getRunIdentityTimestamp(run);

  if (mapToken === "" || run.level === undefined) {
    return undefined;
  }

  if (identityTimestamp !== null) {
    return [
      toFingerprintToken(run.seasonID),
      mapToken,
      toFingerprintToken(run.level),
      toFingerprintToken(identityTimestamp),
    ].join("|");
  }

  if (run.durationMs !== undefined || run.runScore !== undefined) {
    return [
      toFingerprintToken(run.seasonID),
      mapToken,
      toFingerprintToken(run.level),
      toFingerprintToken(run.durationMs),
      toFingerprintToken(run.runScore),
    ].join("|");
  }

  return undefined;
}

function buildRunFingerprint(run: Partial<MythicPlusRunData>): string {
  return [
    toFingerprintToken(run.seasonID),
    toFingerprintToken(run.mapChallengeModeID),
    toFingerprintToken(run.level),
    toFingerprintToken(run.completed),
    toFingerprintToken(run.completedInTime),
    toFingerprintToken(run.durationMs),
    toFingerprintToken(run.runScore),
    toFingerprintToken(run.completedAt),
    toFingerprintToken(run.startDate),
  ].join("|");
}

function getMythicPlusRunDedupKey(run: Partial<MythicPlusRunData>): string {
  return buildCanonicalMythicPlusRunFingerprint(run) ?? run.fingerprint ?? buildRunFingerprint(run);
}

function getMythicPlusRunCompletionEstimate(run: Partial<MythicPlusRunData>): number | undefined {
  return run.completedAt ??
    (run.startDate !== undefined && run.durationMs !== undefined
      ? run.startDate + Math.floor(run.durationMs / 1000 + 0.5)
      : undefined);
}

function getMythicPlusRunSortValue(run: Partial<MythicPlusRunData>): number {
  return run.completedAt ?? run.startDate ?? run.observedAt ?? 0;
}

function getMythicPlusRunCompletenessScore(run: Partial<MythicPlusRunData>): number {
  let score = 0;

  if (run.seasonID !== undefined) score += 1;
  if (run.mapChallengeModeID !== undefined) score += 3;
  if (typeof run.mapName === "string" && run.mapName.trim() !== "") score += 1;
  if (run.level !== undefined) score += 2;
  if (run.startDate !== undefined) score += 4;
  if (run.completedAt !== undefined) score += 4;
  if (run.durationMs !== undefined) score += 3;
  if (run.runScore !== undefined) score += 3;
  if (run.completedInTime !== undefined) score += 2;
  if (run.completed !== undefined) score += 1;
  if (run.thisWeek !== undefined) score += 1;
  if ((run.members?.length ?? 0) > 0) score += 3;

  return score;
}

function shouldReplaceMythicPlusRun(
  currentRun: MythicPlusRunData | undefined,
  candidateRun: MythicPlusRunData,
): boolean {
  if (!currentRun) {
    return true;
  }

  const currentScore = getMythicPlusRunCompletenessScore(currentRun);
  const candidateScore = getMythicPlusRunCompletenessScore(candidateRun);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  const currentSortValue = getMythicPlusRunSortValue(currentRun);
  const candidateSortValue = getMythicPlusRunSortValue(candidateRun);
  if (candidateSortValue !== currentSortValue) {
    return candidateSortValue > currentSortValue;
  }

  return (candidateRun.observedAt ?? 0) > (currentRun.observedAt ?? 0);
}

function mergeMythicPlusRunData(
  currentRun: MythicPlusRunData | undefined,
  candidateRun: MythicPlusRunData,
): MythicPlusRunData {
  if (!currentRun) {
    return candidateRun;
  }

  const candidatePreferred = shouldReplaceMythicPlusRun(currentRun, candidateRun);
  const preferredRun = candidatePreferred ? candidateRun : currentRun;
  const fallbackRun = candidatePreferred ? currentRun : candidateRun;

  const preferredObservedAt = preferredRun.observedAt ?? 0;
  const fallbackObservedAt = fallbackRun.observedAt ?? 0;
  const mergedObservedAt =
    preferredObservedAt > 0 && fallbackObservedAt > 0
      ? Math.min(preferredObservedAt, fallbackObservedAt)
      : preferredObservedAt > 0
        ? preferredObservedAt
        : fallbackObservedAt;

  const mergedRun: MythicPlusRunData = {
    fingerprint: preferredRun.fingerprint || fallbackRun.fingerprint,
    observedAt: mergedObservedAt,
    seasonID: preferredRun.seasonID ?? fallbackRun.seasonID,
    mapChallengeModeID: preferredRun.mapChallengeModeID ?? fallbackRun.mapChallengeModeID,
    mapName: preferredRun.mapName ?? fallbackRun.mapName,
    level: preferredRun.level ?? fallbackRun.level,
    completed: preferredRun.completed ?? fallbackRun.completed,
    completedInTime: preferredRun.completedInTime ?? fallbackRun.completedInTime,
    durationMs: preferredRun.durationMs ?? fallbackRun.durationMs,
    runScore: preferredRun.runScore ?? fallbackRun.runScore,
    startDate: preferredRun.startDate ?? fallbackRun.startDate,
    completedAt: preferredRun.completedAt ?? fallbackRun.completedAt,
    thisWeek: preferredRun.thisWeek ?? fallbackRun.thisWeek,
    members: mergeMythicPlusRunMembers(currentRun.members, candidateRun.members),
  };

  mergedRun.fingerprint = getMythicPlusRunDedupKey(mergedRun);
  return mergedRun;
}

function normalizeStoredMythicPlusRun(runRaw: LuaTable): MythicPlusRunData {
  const legacyRaw = isRecord(runRaw.raw) ? runRaw.raw : null;
  const durationMs =
    toOptionalNumber(runRaw.durationMs) ??
    (toOptionalNumber(runRaw.durationSec) !== undefined
      ? Math.round((runRaw.durationSec as number) * 1000)
      : undefined) ??
    (toOptionalNumber(runRaw.durationSeconds) !== undefined
      ? Math.round((runRaw.durationSeconds as number) * 1000)
      : undefined) ??
    toOptionalNumber(runRaw.time) ??
    toOptionalNumber(runRaw.runDuration);

  const run: MythicPlusRunData = {
    fingerprint: "",
    observedAt:
      toOptionalNumber(runRaw.observedAt) ??
      toOptionalMythicPlusTimestamp(runRaw.completedAt) ??
      toOptionalMythicPlusTimestamp(runRaw.startDate) ??
      0,
    seasonID: toOptionalNumber(runRaw.seasonID),
    mapChallengeModeID:
      toOptionalNumber(runRaw.mapChallengeModeID) ??
      toOptionalNumber(runRaw.challengeModeID) ??
      toOptionalNumber(runRaw.mapID) ??
      (legacyRaw ? toOptionalNumber(legacyRaw.mapChallengeModeID ?? legacyRaw.challengeModeID ?? legacyRaw.mapID) : undefined),
    mapName:
      toOptionalString(runRaw.mapName) ??
      toOptionalString(runRaw.name) ??
      toOptionalString(runRaw.zoneName) ??
      toOptionalString(runRaw.shortName) ??
      (legacyRaw
        ? toOptionalString(
            legacyRaw.mapName ?? legacyRaw.name ?? legacyRaw.zoneName ?? legacyRaw.shortName,
          )
        : undefined),
    level: toOptionalNumber(runRaw.level) ?? toOptionalNumber(runRaw.keystoneLevel),
    completed:
      toOptionalBoolean(runRaw.completed) ??
      toOptionalBoolean(runRaw.finishedSuccess) ??
      toOptionalBoolean(runRaw.isCompleted),
    completedInTime:
      toOptionalBoolean(runRaw.completedInTime) ??
      toOptionalBoolean(runRaw.intime) ??
      toOptionalBoolean(runRaw.onTime),
    durationMs,
    runScore:
      toOptionalNumber(runRaw.runScore) ??
      toOptionalNumber(runRaw.score) ??
      toOptionalNumber(runRaw.mythicRating),
    startDate:
      toOptionalMythicPlusTimestamp(runRaw.startDate) ??
      toOptionalMythicPlusTimestamp(runRaw.startedAt),
    completedAt:
      toOptionalMythicPlusTimestamp(runRaw.completedAt) ??
      toOptionalMythicPlusTimestamp(runRaw.completionDate) ??
      toOptionalMythicPlusTimestamp(runRaw.completedDate) ??
      toOptionalMythicPlusTimestamp(runRaw.endTime) ??
      toOptionalMythicPlusTimestamp(runRaw.startDate),
    thisWeek: toOptionalBoolean(runRaw.thisWeek) ?? toOptionalBoolean(runRaw.isThisWeek),
    members:
      normalizeMythicPlusRunMembers(
        runRaw.members ?? runRaw.partyMembers ?? runRaw.groupMembers ?? runRaw.roster,
      ) ??
      (legacyRaw
        ? normalizeMythicPlusRunMembers(
            legacyRaw.members ??
              legacyRaw.partyMembers ??
              legacyRaw.groupMembers ??
              legacyRaw.roster,
          )
        : undefined),
  };

  if (
    run.completed !== true &&
    (run.durationMs !== undefined || run.runScore !== undefined || run.completedAt !== undefined)
  ) {
    run.completed = true;
  }

  run.fingerprint =
    buildCanonicalMythicPlusRunFingerprint(run) ??
    toOptionalString(runRaw.fingerprint) ??
    buildRunFingerprint(run);
  return run;
}

function reconcilePendingMembers(
  runs: MythicPlusRunData[],
  pending: Record<string, unknown>,
): boolean {
  const capturedAt = toOptionalNumber(pending.capturedAt);
  if (capturedAt === undefined) return false;
  const pendingMembersRaw = pending.members;
  if (!Array.isArray(pendingMembersRaw) || pendingMembersRaw.length === 0) return false;
  const pendingMembers = normalizeMythicPlusRunMembers(pendingMembersRaw);
  if (!pendingMembers || pendingMembers.length === 0) return false;

  const pendingMap = toOptionalNumber(pending.mapChallengeModeID);
  const pendingLevel = toOptionalNumber(pending.level);
  const pendingDurationMs = toOptionalNumber(pending.durationMs);
  const pendingCompletedInTime = toOptionalBoolean(pending.completedInTime);
  const pendingLatestRunFingerprint = toOptionalString(pending.latestKnownRunFingerprint);
  const pendingLatestRunSortValue = toOptionalNumber(pending.latestKnownRunSortValue);

  let bestIdx = -1;
  let bestDiff = Infinity;
  let bestMembers: MythicPlusRunMemberData[] | undefined;
  const MATCH_WINDOW = 5 * 60; // 5 minutes

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (pendingMap !== undefined && run.mapChallengeModeID !== pendingMap) {
      continue;
    }
    if (pendingLevel !== undefined && run.level !== pendingLevel) {
      continue;
    }

    const improvedMembers = getImprovedMythicPlusRunMembers(run.members, pendingMembers);
    if (!improvedMembers) {
      continue;
    }

    const runCompletedAt = getMythicPlusRunCompletionEstimate(run);
    if (runCompletedAt !== undefined) {
      const diff = Math.abs(runCompletedAt - capturedAt);
      if (diff <= MATCH_WINDOW && diff < bestDiff) {
        bestIdx = i;
        bestDiff = diff;
        bestMembers = improvedMembers;
      }
    }
  }

  if (bestIdx >= 0) {
    runs[bestIdx]!.members = bestMembers;
    return true;
  }

  const fallbackCandidates: Array<{
    index: number;
    durationDiff: number | undefined;
    completionDiff: number | undefined;
    outcomeMatches: boolean;
    mergedMembers: MythicPlusRunMemberData[];
    thisWeek: boolean;
  }> = [];

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (pendingMap !== undefined && run.mapChallengeModeID !== pendingMap) {
      continue;
    }
    if (pendingLevel !== undefined && run.level !== pendingLevel) {
      continue;
    }

    const improvedMembers = getImprovedMythicPlusRunMembers(run.members, pendingMembers);
    if (!improvedMembers) {
      continue;
    }

    let isAfterCapture = true;
    if (pendingLatestRunSortValue !== undefined || pendingLatestRunFingerprint) {
      isAfterCapture = false;
      const runSortValue = getMythicPlusRunSortValue(run);
      if (pendingLatestRunSortValue !== undefined && runSortValue > pendingLatestRunSortValue) {
        isAfterCapture = true;
      } else if (
        pendingLatestRunSortValue === undefined &&
        pendingLatestRunFingerprint &&
        run.fingerprint !== pendingLatestRunFingerprint
      ) {
        isAfterCapture = true;
      }
    }

    if (!isAfterCapture) {
      continue;
    }

    const durationDiff =
      pendingDurationMs !== undefined && run.durationMs !== undefined
        ? Math.abs(run.durationMs - pendingDurationMs)
        : undefined;
    const runCompletedAt = getMythicPlusRunCompletionEstimate(run);
    const completionDiff =
      runCompletedAt !== undefined ? Math.abs(runCompletedAt - capturedAt) : undefined;

    fallbackCandidates.push({
      index: i,
      durationDiff,
      completionDiff,
      outcomeMatches:
        pendingCompletedInTime === undefined ||
        run.completedInTime === undefined ||
        run.completedInTime === pendingCompletedInTime,
      mergedMembers: improvedMembers,
      thisWeek: run.thisWeek === true,
    });
  }

  const filteredFallbackCandidates =
    pendingDurationMs === undefined
      ? fallbackCandidates
      : fallbackCandidates.filter(
          (candidate) =>
            candidate.durationDiff === undefined || candidate.durationDiff <= 2 * 60 * 1000,
        );
  const rankedFallbackCandidates =
    filteredFallbackCandidates.length > 0 ? filteredFallbackCandidates : fallbackCandidates;

  rankedFallbackCandidates.sort((left, right) => {
    if (
      left.completionDiff !== undefined &&
      right.completionDiff !== undefined &&
      left.completionDiff !== right.completionDiff
    ) {
      return left.completionDiff - right.completionDiff;
    }
    if (left.completionDiff !== undefined && right.completionDiff === undefined) {
      return -1;
    }
    if (left.completionDiff === undefined && right.completionDiff !== undefined) {
      return 1;
    }

    if (
      left.durationDiff !== undefined &&
      right.durationDiff !== undefined &&
      left.durationDiff !== right.durationDiff
    ) {
      return left.durationDiff - right.durationDiff;
    }
    if (left.durationDiff !== undefined && right.durationDiff === undefined) {
      return -1;
    }
    if (left.durationDiff === undefined && right.durationDiff !== undefined) {
      return 1;
    }

    if (left.outcomeMatches !== right.outcomeMatches) {
      return left.outcomeMatches ? -1 : 1;
    }
    if (left.thisWeek !== right.thisWeek) {
      return left.thisWeek ? -1 : 1;
    }

    return left.index - right.index;
  });

  const bestCandidate = rankedFallbackCandidates[0];
  const secondCandidate = rankedFallbackCandidates[1];
  let fallbackUnique = rankedFallbackCandidates.length === 1;

  if (!fallbackUnique && bestCandidate) {
    const uniqueByCompletion =
      bestCandidate.completionDiff !== undefined &&
      bestCandidate.completionDiff <= 3 * 60 * 60 &&
      (secondCandidate?.completionDiff === undefined ||
        secondCandidate.completionDiff - bestCandidate.completionDiff > 15 * 60);
    const uniqueByDuration =
      bestCandidate.durationDiff !== undefined &&
      bestCandidate.durationDiff <= 2 * 60 * 1000 &&
      (secondCandidate?.durationDiff === undefined ||
        secondCandidate.durationDiff - bestCandidate.durationDiff > 60 * 1000);
    const uniqueByWeek =
      bestCandidate.thisWeek &&
      (secondCandidate === undefined || secondCandidate.thisWeek !== true);

    fallbackUnique = uniqueByCompletion || uniqueByDuration || uniqueByWeek;
  }

  if (fallbackUnique && bestCandidate) {
    runs[bestCandidate.index]!.members = bestCandidate.mergedMembers;
    return true;
  }

  return false;
}

function extractCharacters(db: Record<string, unknown>): CharacterData[] {
  const characters = (db.characters ?? {}) as Record<string, unknown>;
  const pendingMembersStore = isRecord(db.pendingMythicPlusMembers) ? db.pendingMythicPlusMembers : {};
  const result: CharacterData[] = [];
  const validRegions: Region[] = ["us", "eu", "kr", "tw"];

  for (const [charKey, charRaw] of Object.entries(characters)) {
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
        spec: normalizeSnapshotSpec(snap.spec),
        role,
        itemLevel: Number(snap.itemLevel),
        gold: Number(snap.gold),
        playtimeSeconds: Number(snap.playtimeSeconds),
        playtimeThisLevelSeconds: toOptionalNumber(snap.playtimeThisLevelSeconds),
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
          speedPercent: toOptionalNumber(stats.speedPercent),
          leechPercent: toOptionalNumber(stats.leechPercent),
          avoidancePercent: toOptionalNumber(stats.avoidancePercent),
        },
      });
    }

    const mythicPlusRunsByFingerprint = new Map<string, MythicPlusRunData>();
    for (const runRaw of (char.mythicPlusRuns as unknown[]) ?? []) {
      if (!isRecord(runRaw)) continue;
      const run = normalizeStoredMythicPlusRun(runRaw);
      const dedupKey = getMythicPlusRunDedupKey(run);
      if (!dedupKey) continue;
      const currentRun = mythicPlusRunsByFingerprint.get(dedupKey);
      mythicPlusRunsByFingerprint.set(dedupKey, mergeMythicPlusRunData(currentRun, run));
    }
    const mythicPlusRuns = Array.from(mythicPlusRunsByFingerprint.values());
    mythicPlusRuns.sort(
      (a, b) => (b.completedAt ?? b.startDate ?? b.observedAt ?? 0) - (a.completedAt ?? a.startDate ?? a.observedAt ?? 0),
    );

    // Reconcile pending members from durable SavedVariables store
    const pendingPayload = pendingMembersStore[charKey];
    if (isRecord(pendingPayload)) {
      reconcilePendingMembers(mythicPlusRuns, pendingPayload);
    }

    result.push({
      name: String(char.name),
      realm: String(char.realm),
      region,
      class: String(char.class),
      race: String(char.race),
      faction,
      snapshots,
      mythicPlusRuns,
    });
  }

  return result;
}

async function findAndParseAddonData(
  retailPath: string,
): Promise<{
  characters: CharacterData[];
  accountsFound: string[];
  fileStats: AddonFileStats | null;
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
        const snapshotsByTime = new Map(existing.snapshots.map((snapshot) => [snapshot.takenAt, snapshot]));
        for (const snap of char.snapshots) {
          const current = snapshotsByTime.get(snap.takenAt);
          if (!current) {
            existing.snapshots.push(snap);
            snapshotsByTime.set(snap.takenAt, snap);
            continue;
          }

          const mergedSnapshot = mergeSnapshotData(current, snap);
          Object.assign(current, mergedSnapshot);
        }

        const existingRunsByFingerprint = new Map(
          existing.mythicPlusRuns.map((run) => [getMythicPlusRunDedupKey(run), run] as const),
        );
        for (const run of char.mythicPlusRuns) {
          const dedupKey = getMythicPlusRunDedupKey(run);
          const currentRun = existingRunsByFingerprint.get(dedupKey);
          if (!currentRun) {
            existing.mythicPlusRuns.push(run);
            existingRunsByFingerprint.set(dedupKey, run);
            continue;
          }

          Object.assign(currentRun, mergeMythicPlusRunData(currentRun, run));
        }
        existing.mythicPlusRuns.sort(
          (a, b) =>
            (b.completedAt ?? b.startDate ?? b.observedAt ?? 0) -
            (a.completedAt ?? a.startDate ?? a.observedAt ?? 0),
        );
      }
    }
  }

  const characters = Array.from(allChars.values());
  const totalSnapshots = characters.reduce((sum, c) => sum + c.snapshots.length, 0);
  const totalMythicPlusRuns = characters.reduce((sum, c) => sum + c.mythicPlusRuns.length, 0);
  const fileStats =
    accountsFound.length > 0
      ? { totalBytes, createdAt, modifiedAt, totalSnapshots, totalMythicPlusRuns }
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
      sandbox: true,
      nodeIntegration: false,
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

// Build-time constants from .env — never read from renderer input.
const CONVEX_SITE_URL: string = (import.meta as unknown as { env: Record<string, string> }).env
  .VITE_CONVEX_SITE_URL ?? "";

function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "auth") {
      const code = parsed.searchParams.get("code");
      if (code && pendingLoginResolve) {
        const resolve = pendingLoginResolve;
        const reject = pendingLoginReject;
        pendingLoginResolve = null;
        pendingLoginReject = null;

        // Exchange the one-time code for the actual token via the Convex HTTP action.
        net
          .fetch(`${CONVEX_SITE_URL}/api/auth/redeem-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          })
          .then(async (resp) => {
            if (!resp.ok) throw new Error(`Code exchange failed: ${resp.status}`);
            const data = (await resp.json()) as { token?: string; error?: string };
            if (!data.token) throw new Error(data.error ?? "No token in response");
            storedSessionToken = data.token;
            cachedElectronToken = null;
            saveSessionToken(data.token);
            resolve(data.token);
          })
          .catch((err: Error) => {
            reject?.(err);
          });
      }
    }
  } catch {
    // ignore malformed deep-links
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

// Trusted site URL — read from build-time env, never from renderer input.
const SITE_URL: string = (import.meta as unknown as { env: Record<string, string> }).env
  .VITE_SITE_URL ?? "";

// Auth
ipcMain.handle("auth:login", () => {
  return new Promise<boolean>((resolve, reject) => {
    // Set up pending deep-link resolution with a 10-minute timeout.
    const timeout = setTimeout(() => {
      pendingLoginReject?.(new Error("Login timed out"));
      pendingLoginResolve = null;
      pendingLoginReject = null;
    }, 10 * 60 * 1000);

    pendingLoginResolve = (_token: string) => {
      clearTimeout(timeout);
      resolve(true);
    };
    pendingLoginReject = (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    };

    // Open the login page in the browser. The browser initiates the OAuth flow so the
    // state cookie lands in the browser session (not Electron's), which means better-auth
    // can validate the callback and honour the callbackURL → /auth/electron-callback.
    void shell.openExternal(`${SITE_URL}/auth/electron-login`);
  });
});

ipcMain.handle("auth:getToken", async () => {
  if (cachedElectronToken && !isJwtExpired(cachedElectronToken)) return cachedElectronToken;

  const refreshed = await fetchFreshConvexToken();
  if (refreshed) return refreshed;

  // Fallback: fetch from session cookies (legacy / future in-app flows).
  try {
    const resp = await session.defaultSession.fetch(`${SITE_URL}/api/auth/convex/token`, {
      headers: { Origin: SITE_URL },
    });
    if (!resp.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await resp.json();
    cachedElectronToken = data?.token ?? null;
    return cachedElectronToken;
  } catch {
    return null;
  }
});

ipcMain.handle("auth:getSession", async () => {
  try {
    const resp = await session.defaultSession.fetch(`${SITE_URL}/api/auth/get-session`, {
      headers: {
        Origin: SITE_URL,
        ...(storedSessionToken ? { Authorization: `Bearer ${storedSessionToken}` } : {}),
      },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
});

ipcMain.handle("auth:logout", async () => {
  const sessionToken = storedSessionToken;
  cachedElectronToken = null;
  storedSessionToken = null;
  saveSessionToken(null);
  try {
    await session.defaultSession.fetch(`${SITE_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: SITE_URL,
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({}),
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

ipcMain.handle("wow:readAddonData", async () => {
  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) return null;
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

ipcMain.handle("wow:watchAddonFile", async () => {
  stopAddonWatcher();
  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) return;
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

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const resolvedDest = resolve(destDir);
  const directory = await unzipper.Open.file(zipPath);
  for (const file of directory.files) {
    const outPath = resolve(resolvedDest, file.path);
    // Reject any entry whose resolved path escapes destDir.
    const rel = path.relative(resolvedDest, outPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Path traversal detected in zip entry: ${file.path}`);
    }
    if (file.type === "Directory") {
      await fs.promises.mkdir(outPath, { recursive: true });
    } else {
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      await new Promise<void>((res, rej) =>
        file.stream().pipe(fs.createWriteStream(outPath)).on("finish", res).on("error", rej),
      );
    }
  }
}

ipcMain.handle("wow:checkAddonInstalled", async () => {
  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) return false;
  const addonPath = join(retailPath, "Interface", "AddOns", "wow-dashboard");
  try {
    await fs.promises.access(addonPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("wow:getInstalledAddonVersion", async () => {
  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) return null;
  const tocPath = join(retailPath, "Interface", "AddOns", "wow-dashboard", "wow-dashboard.toc");
  try {
    const content = await fs.promises.readFile(tocPath, "utf-8");
    const match = content.match(/^##\s*Version:\s*(.+)$/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
});

function validateGitHubUrl(url: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (
    parsedUrl.hostname !== "objects.githubusercontent.com" &&
    parsedUrl.hostname !== "github.com"
  ) {
    throw new Error(`Untrusted download host: ${parsedUrl.hostname}`);
  }
}

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

ipcMain.handle("wow:installAddon", async (_, downloadUrl: string, checksumUrl: string) => {
  // Validate both URLs come from GitHub only.
  validateGitHubUrl(downloadUrl);
  if (checksumUrl) validateGitHubUrl(checksumUrl);

  const settings = await getSettings();
  const retailPath = settings.retailPath as string | undefined;
  if (!retailPath) throw new Error("WoW retail path is not configured");

  const tmpDir = os.tmpdir();
  const zipPath = join(tmpDir, "wow-dashboard-addon.zip");
  const checksumPath = join(tmpDir, "wow-dashboard-addon.zip.sha256");
  const extractDir = join(tmpDir, "wow-dashboard-addon-extract");
  const addonsDir = join(retailPath, "Interface", "AddOns");
  const addonDest = join(addonsDir, "wow-dashboard");

  try {
    await downloadFile(downloadUrl, zipPath);

    // Verify SHA256 checksum if a checksum URL was provided.
    if (checksumUrl) {
      await downloadFile(checksumUrl, checksumPath);
      const checksumContent = await fs.promises.readFile(checksumPath, "utf-8");
      const expectedHash = checksumContent.trim().split(/\s+/)[0];
      const actualHash = await computeFileSha256(zipPath);
      if (actualHash !== expectedHash) {
        throw new Error(
          `Checksum mismatch — addon package may be corrupted or tampered with.\nExpected: ${expectedHash}\nGot: ${actualHash}`,
        );
      }
    }

    await fs.promises.rm(extractDir, { recursive: true, force: true });
    await fs.promises.mkdir(extractDir, { recursive: true });

    await extractZip(zipPath, extractDir);

    const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const addonSrc =
      dirs.length === 1
        ? (() => {
            const dir = dirs[0];
            if (!dir) return extractDir;
            const candidate = resolve(extractDir, dir.name);
            if (!candidate.startsWith(resolve(extractDir) + sep)) {
              throw new Error("Path traversal detected in zip archive");
            }
            return candidate;
          })()
        : extractDir;

    await fs.promises.mkdir(addonsDir, { recursive: true });
    await fs.promises.rm(addonDest, { recursive: true, force: true });
    await fs.promises.cp(addonSrc, addonDest, { recursive: true });
  } finally {
    await fs.promises.rm(zipPath, { force: true }).catch(() => {});
    await fs.promises.rm(checksumPath, { force: true }).catch(() => {});
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checksumAsset = addonRelease.assets.find((a: any) => a.name === "wow-dashboard.zip.sha256");
  return {
    url: asset.browser_download_url as string,
    checksumUrl: checksumAsset ? (checksumAsset.browser_download_url as string) : null,
    version: (addonRelease.tag_name as string).replace("addon-v", ""),
  };
});

// Shell
ipcMain.handle("app:openExternal", (_, url: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol === "https:" || parsed.protocol === "http:") {
    shell.openExternal(url);
  }
});
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

// macOS: deep-links arrive via open-url before the app is fully ready.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Windows/Linux: a second instance is launched with the deep-link URL in argv.
// Grab the lock so only one instance runs; the second instance forwards its URL and quits.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_, argv) => {
    const url = argv.find((a) => a.startsWith("wow-dashboard://"));
    if (url) handleDeepLink(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  // In dev mode on Windows the app isn't packaged, so we must supply the Electron
  // executable path and the app path explicitly for the registry entry to work.
  if (!app.isPackaged) {
    app.setAsDefaultProtocolClient("wow-dashboard", process.execPath, [
      path.resolve(process.argv[1] ?? "."),
    ]);
  } else {
    app.setAsDefaultProtocolClient("wow-dashboard");
  }
  // Restore persisted desktop auth state from OS keychain (safeStorage).
  loadStoredAuth();

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
