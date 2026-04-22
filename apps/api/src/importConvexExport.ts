import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  account as authAccount,
  auditLog,
  characterDailySnapshots,
  characters,
  closeDatabaseConnection,
  createDatabaseConnection,
  mythicPlusRuns,
  players,
  session as authSession,
  snapshots,
  user as authUser,
  type CharacterFaction,
  type CharacterRegion,
  type LatestSnapshotDetails,
  type LatestSnapshotSummary,
  type MythicPlusRecentRunPreview,
  type MythicPlusSummary,
  type NonTradeableSlot,
  type OwnedKeystone,
} from "@wow-dashboard/db";
import { eq } from "drizzle-orm";

type ConvexBetterAuthUser = {
  _id: string;
  createdAt: number;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  name: string;
  updatedAt: number;
};

type ConvexBetterAuthAccount = {
  _id: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  accountId: string;
  createdAt: number;
  idToken?: string;
  providerId: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: number;
  scope?: string;
  updatedAt: number;
  userId: string;
};

type ConvexBetterAuthSession = {
  _id: string;
  createdAt: number;
  expiresAt: number;
  ipAddress?: string;
  token: string;
  updatedAt: number;
  userAgent?: string;
  userId: string;
};

type ConvexPlayer = {
  _id: string;
  battleTag: string;
  discordUserId?: string;
  userId: string;
};

type ConvexCharacter = {
  _id: string;
  class: string;
  faction: CharacterFaction;
  firstSnapshotAt?: number;
  isBooster?: boolean;
  latestSnapshot?: LatestSnapshotSummary;
  latestSnapshotDetails?: LatestSnapshotDetails;
  mythicPlusRecentRunsPreview?: MythicPlusRecentRunPreview[];
  mythicPlusRunCount?: number;
  mythicPlusSummary?: MythicPlusSummary;
  name: string;
  nonTradeableSlots?: NonTradeableSlot[];
  playerId: string;
  race: string;
  realm: string;
  region: CharacterRegion;
  snapshotCount?: number;
};

type ConvexSnapshot = {
  _id: string;
  characterId: string;
  currencies: LatestSnapshotDetails["currencies"];
  gold: number;
  itemLevel: number;
  level: number;
  mythicPlusScore: number;
  ownedKeystone?: OwnedKeystone;
  playtimeSeconds: number;
  playtimeThisLevelSeconds?: number;
  role: LatestSnapshotSummary["role"];
  spec: LatestSnapshotSummary["spec"];
  stats: LatestSnapshotDetails["stats"];
  takenAt: number;
};

type ConvexCharacterDailySnapshot = {
  _id: string;
  characterId: string;
  currencies?: LatestSnapshotDetails["currencies"];
  dayStartAt: number;
  gold: number;
  itemLevel: number;
  lastTakenAt: number;
  mythicPlusScore: number;
  playtimeSeconds: number;
  stats?: LatestSnapshotDetails["stats"];
};

type ConvexMythicPlusRun = {
  _id: string;
  abandonedAt?: number;
  abandonReason?:
    | "challenge_mode_reset"
    | "left_instance"
    | "leaver_timer"
    | "history_incomplete"
    | "stale_recovery"
    | "unknown";
  attemptId?: string;
  canonicalKey?: string;
  characterId: string;
  completed?: boolean;
  completedAt?: number;
  completedInTime?: boolean;
  durationMs?: number;
  endedAt?: number;
  fingerprint: string;
  level?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  members?: MythicPlusRecentRunPreview["members"];
  observedAt: number;
  runScore?: number;
  seasonID?: number;
  startDate?: number;
  status?: "active" | "completed" | "abandoned";
  thisWeek?: boolean;
};

type ConvexAuditLog = {
  _id: string;
  error?: string;
  event: string;
  metadata?: unknown;
  timestamp: number;
  userId?: string;
};

type ImportCounters = {
  inserted: number;
  updated: number;
  skipped: number;
};

type ImportSummary = {
  users: ImportCounters;
  accounts: ImportCounters;
  sessions: ImportCounters;
  players: ImportCounters;
  characters: ImportCounters;
  snapshots: ImportCounters;
  characterDailySnapshots: ImportCounters;
  mythicPlusRuns: ImportCounters;
  auditLog: ImportCounters;
  warnings: string[];
};

const defaultSummary = (): ImportSummary => ({
  users: { inserted: 0, updated: 0, skipped: 0 },
  accounts: { inserted: 0, updated: 0, skipped: 0 },
  sessions: { inserted: 0, updated: 0, skipped: 0 },
  players: { inserted: 0, updated: 0, skipped: 0 },
  characters: { inserted: 0, updated: 0, skipped: 0 },
  snapshots: { inserted: 0, updated: 0, skipped: 0 },
  characterDailySnapshots: { inserted: 0, updated: 0, skipped: 0 },
  mythicPlusRuns: { inserted: 0, updated: 0, skipped: 0 },
  auditLog: { inserted: 0, updated: 0, skipped: 0 },
  warnings: [],
});

function commandExists(command: string) {
  try {
    execFileSync(command, ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readJsonLinesFromZip<T>(zipPath: string, entryPath: string): T[] {
  try {
    const output = execFileSync("unzip", ["-p", zipPath, entryPath], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("filename not matched")) {
      return [];
    }

    throw error;
  }
}

function expectRow<T>(rows: T[], label: string) {
  const row = rows[0];
  if (!row) {
    throw new Error(`Expected ${label} to return one row.`);
  }

  return row;
}

function dateFromMilliseconds(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return new Date(Math.trunc(value));
}

function dateFromSeconds(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return new Date(Math.trunc(value * 1000));
}

function integerValue(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return Math.trunc(value);
}

function normalizeDiscordUserId(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    return mentionMatch[1]!;
  }

  return trimmed;
}

function maxNullable(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}

function minDate(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

function maxDate(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function latestTakenAt(
  snapshot: LatestSnapshotSummary | null | undefined,
  details: LatestSnapshotDetails | null | undefined,
) {
  return details?.takenAt ?? snapshot?.takenAt ?? null;
}

function mergeSlots(
  existing: readonly NonTradeableSlot[] | null | undefined,
  incoming: readonly NonTradeableSlot[] | null | undefined,
) {
  const merged = new Set<NonTradeableSlot>();

  for (const slot of existing ?? []) merged.add(slot);
  for (const slot of incoming ?? []) merged.add(slot);

  return merged.size > 0 ? Array.from(merged) : null;
}

function characterNaturalKey(playerId: string, character: Pick<ConvexCharacter, "region" | "realm" | "name">) {
  return [playerId, character.region, character.realm.toLowerCase(), character.name.toLowerCase()].join(
    "|",
  );
}

function snapshotNaturalKey(characterId: string, takenAt: Date) {
  return `${characterId}|${takenAt.toISOString()}`;
}

function dailyNaturalKey(characterId: string, dayStartAt: Date) {
  return `${characterId}|${dayStartAt.toISOString()}`;
}

function mythicRunNaturalKey(characterId: string, fingerprint: string) {
  return `${characterId}|${fingerprint}`;
}

function auditNaturalKey(log: Pick<ConvexAuditLog, "event" | "timestamp" | "userId">) {
  return `${log.userId ?? ""}|${log.event}|${Math.trunc(log.timestamp)}`;
}

function normalizePreviewRuns(
  value: MythicPlusRecentRunPreview[] | null | undefined,
  characterId: string,
) {
  if (!value || value.length === 0) {
    return null;
  }

  return value.map((run) => ({
    ...run,
    characterId,
  }));
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      apply: { type: "boolean", default: false },
      "include-sessions": { type: "boolean", default: false },
    },
  });

  const zipPathArg = positionals[0];
  if (!zipPathArg) {
    throw new Error(
      "Usage: pnpm -F @wow-dashboard/api import-convex-export <path-to-export.zip> [--apply] [--include-sessions]",
    );
  }

  if (!commandExists("unzip")) {
    throw new Error("The importer requires the `unzip` binary to be installed.");
  }

  const zipPath = resolve(process.env.INIT_CWD ?? process.cwd(), zipPathArg);
  const apply = values.apply;
  const includeSessions = values["include-sessions"];

  const exportedUsers = readJsonLinesFromZip<ConvexBetterAuthUser>(
    zipPath,
    "_components/betterAuth/user/documents.jsonl",
  );
  const exportedAccounts = readJsonLinesFromZip<ConvexBetterAuthAccount>(
    zipPath,
    "_components/betterAuth/account/documents.jsonl",
  );
  const exportedSessions = includeSessions
    ? readJsonLinesFromZip<ConvexBetterAuthSession>(
        zipPath,
        "_components/betterAuth/session/documents.jsonl",
      )
    : [];
  const exportedPlayers = readJsonLinesFromZip<ConvexPlayer>(zipPath, "players/documents.jsonl");
  const exportedCharacters = readJsonLinesFromZip<ConvexCharacter>(
    zipPath,
    "characters/documents.jsonl",
  );
  const exportedSnapshots = readJsonLinesFromZip<ConvexSnapshot>(
    zipPath,
    "snapshots/documents.jsonl",
  );
  const exportedDailySnapshots = readJsonLinesFromZip<ConvexCharacterDailySnapshot>(
    zipPath,
    "characterDailySnapshots/documents.jsonl",
  );
  const exportedMythicPlusRuns = readJsonLinesFromZip<ConvexMythicPlusRun>(
    zipPath,
    "mythicPlusRuns/documents.jsonl",
  );
  const exportedAuditLog = readJsonLinesFromZip<ConvexAuditLog>(zipPath, "auditLog/documents.jsonl");

  console.log("[import-convex-export] loaded export", {
    users: exportedUsers.length,
    accounts: exportedAccounts.length,
    sessions: exportedSessions.length,
    players: exportedPlayers.length,
    characters: exportedCharacters.length,
    snapshots: exportedSnapshots.length,
    characterDailySnapshots: exportedDailySnapshots.length,
    mythicPlusRuns: exportedMythicPlusRuns.length,
    auditLog: exportedAuditLog.length,
    apply,
    includeSessions,
  });

  if (!apply) {
    console.log("[import-convex-export] dry run only. Re-run with --apply to write to Postgres.");
    return;
  }

  const summary = defaultSummary();
  const connection = createDatabaseConnection();
  const { db } = connection;

  try {
    const [
      existingUsers,
      existingAccounts,
      existingSessions,
      existingPlayers,
      existingCharacters,
      existingSnapshots,
      existingDailySnapshots,
      existingMythicPlusRuns,
      existingAuditLog,
    ] = await Promise.all([
      db.select().from(authUser),
      db.select().from(authAccount),
      includeSessions ? db.select().from(authSession) : Promise.resolve([]),
      db.select().from(players),
      db.select().from(characters),
      db
        .select({
          id: snapshots.id,
          legacyConvexId: snapshots.legacyConvexId,
          characterId: snapshots.characterId,
          takenAt: snapshots.takenAt,
        })
        .from(snapshots),
      db.select().from(characterDailySnapshots),
      db.select().from(mythicPlusRuns),
      db
        .select({
          id: auditLog.id,
          legacyConvexId: auditLog.legacyConvexId,
          userId: auditLog.userId,
          event: auditLog.event,
          timestamp: auditLog.timestamp,
        })
        .from(auditLog),
    ]);

    const usersById = new Map(existingUsers.map((row) => [row.id, row]));
    const usersByEmail = new Map(existingUsers.map((row) => [row.email, row]));
    const accountsByProviderAccount = new Map(
      existingAccounts.map((row) => [`${row.providerId}|${row.accountId}`, row]),
    );
    const accountsByUserId = new Map<string, (typeof existingAccounts)[number]>();
    for (const row of existingAccounts) {
      if (!accountsByUserId.has(row.userId) && row.providerId === "battlenet") {
        accountsByUserId.set(row.userId, row);
      }
    }

    const sessionsByToken = new Map(existingSessions.map((row) => [row.token, row]));
    const playersByLegacy = new Map(
      existingPlayers.filter((row) => row.legacyConvexId).map((row) => [row.legacyConvexId!, row]),
    );
    const playersByBattlenetAccountId = new Map(
      existingPlayers.map((row) => [row.battlenetAccountId, row]),
    );
    const playersByUserId = new Map(
      existingPlayers
        .filter((row) => row.userId)
        .map((row) => [row.userId!, row]),
    );
    const charactersByLegacy = new Map(
      existingCharacters.filter((row) => row.legacyConvexId).map((row) => [row.legacyConvexId!, row]),
    );
    const charactersByNatural = new Map(
      existingCharacters.map((row) => [
        characterNaturalKey(row.playerId, row),
        row,
      ]),
    );
    const snapshotsByLegacy = new Map(
      existingSnapshots
        .filter((row) => row.legacyConvexId)
        .map((row) => [row.legacyConvexId!, row]),
    );
    const snapshotsByNatural = new Map(
      existingSnapshots.map((row) => [snapshotNaturalKey(row.characterId, row.takenAt), row]),
    );
    const dailyByLegacy = new Map(
      existingDailySnapshots
        .filter((row) => row.legacyConvexId)
        .map((row) => [row.legacyConvexId!, row]),
    );
    const dailyByNatural = new Map(
      existingDailySnapshots.map((row) => [dailyNaturalKey(row.characterId, row.dayStartAt), row]),
    );
    const mythicRunsByLegacy = new Map(
      existingMythicPlusRuns
        .filter((row) => row.legacyConvexId)
        .map((row) => [row.legacyConvexId!, row]),
    );
    const mythicRunsByNatural = new Map(
      existingMythicPlusRuns.map((row) => [mythicRunNaturalKey(row.characterId, row.fingerprint), row]),
    );
    const auditByLegacy = new Map(
      existingAuditLog
        .filter((row) => row.legacyConvexId)
        .map((row) => [row.legacyConvexId!, row]),
    );
    const auditByNatural = new Map(
      existingAuditLog.map((row) => [
        auditNaturalKey({
          event: row.event,
          timestamp: row.timestamp.getTime(),
          userId: row.userId ?? undefined,
        }),
        row,
      ]),
    );
    const targetUserIdByLegacyConvexUserId = new Map<string, string>();
    const resolveTargetUserId = (legacyUserId: string | null | undefined) => {
      if (!legacyUserId) {
        return null;
      }

      return (
        targetUserIdByLegacyConvexUserId.get(legacyUserId) ??
        usersById.get(legacyUserId)?.id ??
        null
      );
    };

    for (const exported of exportedUsers) {
      const byId = usersById.get(exported._id);
      const byEmail = usersByEmail.get(exported.email);
      const existing = byId ?? byEmail ?? null;
      const createdAt = dateFromMilliseconds(exported.createdAt)!;
      const updatedAt = dateFromMilliseconds(exported.updatedAt)!;
      if (!existing) {
        const inserted = expectRow(
          await db
          .insert(authUser)
          .values({
            id: exported._id,
            name: exported.name,
            email: exported.email,
            emailVerified: exported.emailVerified,
            image: exported.image ?? null,
            createdAt,
            updatedAt,
          })
          .returning(),
          `insert user ${exported._id}`,
        );

        usersById.set(inserted.id, inserted);
        usersByEmail.set(inserted.email, inserted);
        targetUserIdByLegacyConvexUserId.set(exported._id, inserted.id);
        summary.users.inserted += 1;
        continue;
      }

      const exportIsNewer = updatedAt.getTime() >= existing.updatedAt.getTime();
      const updated = expectRow(
        await db
        .update(authUser)
        .set({
          name: exportIsNewer ? exported.name : existing.name,
          email: existing.email,
          emailVerified: exportIsNewer ? exported.emailVerified : existing.emailVerified,
          image: exportIsNewer ? exported.image ?? null : existing.image,
          createdAt: minDate(existing.createdAt, createdAt)!,
          updatedAt: maxDate(existing.updatedAt, updatedAt)!,
        })
        .where(eq(authUser.id, existing.id))
        .returning(),
        `update user ${existing.id}`,
      );

      usersById.set(updated.id, updated);
      usersByEmail.set(updated.email, updated);
      targetUserIdByLegacyConvexUserId.set(exported._id, updated.id);
      summary.users.updated += 1;
    }

    for (const exported of exportedAccounts) {
      const key = `${exported.providerId}|${exported.accountId}`;
      const existing = accountsByProviderAccount.get(key) ?? null;
      const createdAt = dateFromMilliseconds(exported.createdAt)!;
      const updatedAt = dateFromMilliseconds(exported.updatedAt)!;
      const targetUserId = resolveTargetUserId(exported.userId);

      if (!targetUserId) {
        summary.accounts.skipped += 1;
        summary.warnings.push(
          `Skipped account ${key}: user ${exported.userId} was not imported into target DB.`,
        );
        continue;
      }

      if (!existing) {
        const inserted = expectRow(
          await db
          .insert(authAccount)
          .values({
            id: exported._id,
            accountId: exported.accountId,
            providerId: exported.providerId,
            userId: targetUserId,
            accessToken: exported.accessToken ?? null,
            refreshToken: exported.refreshToken ?? null,
            idToken: exported.idToken ?? null,
            accessTokenExpiresAt: dateFromMilliseconds(exported.accessTokenExpiresAt),
            refreshTokenExpiresAt: dateFromMilliseconds(exported.refreshTokenExpiresAt),
            scope: exported.scope ?? null,
            password: null,
            createdAt,
            updatedAt,
          })
          .returning(),
          `insert account ${key}`,
        );

        accountsByProviderAccount.set(key, inserted);
        if (inserted.providerId === "battlenet") {
          accountsByUserId.set(inserted.userId, inserted);
        }
        summary.accounts.inserted += 1;
        continue;
      }

      const exportIsNewer = updatedAt.getTime() >= existing.updatedAt.getTime();
      const updated = expectRow(
        await db
        .update(authAccount)
        .set({
          userId: targetUserId,
          accessToken: exportIsNewer ? exported.accessToken ?? null : existing.accessToken,
          refreshToken: exportIsNewer ? exported.refreshToken ?? null : existing.refreshToken,
          idToken: exportIsNewer ? exported.idToken ?? null : existing.idToken,
          accessTokenExpiresAt: exportIsNewer
            ? dateFromMilliseconds(exported.accessTokenExpiresAt)
            : existing.accessTokenExpiresAt,
          refreshTokenExpiresAt: exportIsNewer
            ? dateFromMilliseconds(exported.refreshTokenExpiresAt)
            : existing.refreshTokenExpiresAt,
          scope: exportIsNewer ? exported.scope ?? null : existing.scope,
          createdAt: minDate(existing.createdAt, createdAt)!,
          updatedAt: maxDate(existing.updatedAt, updatedAt)!,
        })
        .where(eq(authAccount.id, existing.id))
        .returning(),
        `update account ${existing.id}`,
      );

      accountsByProviderAccount.set(key, updated);
      if (updated.providerId === "battlenet") {
        accountsByUserId.delete(existing.userId);
        accountsByUserId.set(updated.userId, updated);
      }
      summary.accounts.updated += 1;
    }

    if (includeSessions) {
      for (const exported of exportedSessions) {
        const existing = sessionsByToken.get(exported.token) ?? null;
        const createdAt = dateFromMilliseconds(exported.createdAt)!;
        const updatedAt = dateFromMilliseconds(exported.updatedAt)!;
        const targetUserId = resolveTargetUserId(exported.userId);

        if (!targetUserId) {
          summary.sessions.skipped += 1;
          summary.warnings.push(
            `Skipped session ${exported._id}: user ${exported.userId} was not imported into target DB.`,
          );
          continue;
        }

        if (!existing) {
          const inserted = expectRow(
            await db
            .insert(authSession)
            .values({
              id: exported._id,
              expiresAt: dateFromMilliseconds(exported.expiresAt)!,
              token: exported.token,
              createdAt,
              updatedAt,
              ipAddress: exported.ipAddress ?? null,
              userAgent: exported.userAgent ?? null,
              userId: targetUserId,
            })
            .returning(),
            `insert session ${exported._id}`,
          );

          sessionsByToken.set(inserted.token, inserted);
          summary.sessions.inserted += 1;
          continue;
        }

        const exportIsNewer = updatedAt.getTime() >= existing.updatedAt.getTime();
        const updated = expectRow(
          await db
          .update(authSession)
          .set({
            expiresAt: exportIsNewer ? dateFromMilliseconds(exported.expiresAt)! : existing.expiresAt,
            createdAt: minDate(existing.createdAt, createdAt)!,
            updatedAt: maxDate(existing.updatedAt, updatedAt)!,
            ipAddress: exportIsNewer ? exported.ipAddress ?? null : existing.ipAddress,
            userAgent: exportIsNewer ? exported.userAgent ?? null : existing.userAgent,
            userId: targetUserId,
          })
          .where(eq(authSession.id, existing.id))
          .returning(),
          `update session ${existing.id}`,
        );

        sessionsByToken.set(updated.token, updated);
        summary.sessions.updated += 1;
      }
    }

    const targetPlayerIdByLegacyConvexPlayerId = new Map<string, string>();
    for (const exported of exportedPlayers) {
      const targetUserId = resolveTargetUserId(exported.userId);
      const battlenetAccount = targetUserId ? accountsByUserId.get(targetUserId) : null;
      if (!battlenetAccount) {
        summary.players.skipped += 1;
        summary.warnings.push(
          `Skipped player ${exported.battleTag}: no battlenet account found for user ${exported.userId}.`,
        );
        continue;
      }

      const existing =
        playersByLegacy.get(exported._id) ??
        playersByBattlenetAccountId.get(battlenetAccount.accountId) ??
        (targetUserId ? playersByUserId.get(targetUserId) : null) ??
        null;

      const values = {
        legacyConvexId: exported._id,
        battlenetAccountId: battlenetAccount.accountId,
        userId: targetUserId,
        battleTag: exported.battleTag,
        discordUserId: normalizeDiscordUserId(exported.discordUserId),
      };

      if (!existing) {
        const inserted = expectRow(
          await db.insert(players).values(values).returning(),
          `insert player ${exported._id}`,
        );
        playersByLegacy.set(exported._id, inserted);
        playersByBattlenetAccountId.set(inserted.battlenetAccountId, inserted);
        if (inserted.userId) {
          playersByUserId.set(inserted.userId, inserted);
        }
        targetPlayerIdByLegacyConvexPlayerId.set(exported._id, inserted.id);
        summary.players.inserted += 1;
        continue;
      }

      const updated = expectRow(
        await db
        .update(players)
        .set({
          legacyConvexId: existing.legacyConvexId ?? values.legacyConvexId,
          battlenetAccountId: values.battlenetAccountId,
          userId: values.userId,
          battleTag: values.battleTag || existing.battleTag,
          discordUserId: values.discordUserId ?? existing.discordUserId,
        })
        .where(eq(players.id, existing.id))
        .returning(),
        `update player ${existing.id}`,
      );

      playersByLegacy.set(updated.legacyConvexId ?? exported._id, updated);
      playersByBattlenetAccountId.set(updated.battlenetAccountId, updated);
      if (updated.userId) {
        if (existing.userId && existing.userId !== updated.userId) {
          playersByUserId.delete(existing.userId);
        }
        playersByUserId.set(updated.userId, updated);
      }
      targetPlayerIdByLegacyConvexPlayerId.set(exported._id, updated.id);
      summary.players.updated += 1;
    }

    const targetCharacterIdByLegacyConvexCharacterId = new Map<string, string>();
    for (const exported of exportedCharacters) {
      const targetPlayerId = targetPlayerIdByLegacyConvexPlayerId.get(exported.playerId);
      if (!targetPlayerId) {
        summary.characters.skipped += 1;
        summary.warnings.push(
          `Skipped character ${exported.region}/${exported.realm}/${exported.name}: player ${exported.playerId} was not imported.`,
        );
        continue;
      }

      const naturalKey = characterNaturalKey(targetPlayerId, exported);
      const existing =
        charactersByLegacy.get(exported._id) ?? charactersByNatural.get(naturalKey) ?? null;

      const exportLatestTakenAt = latestTakenAt(
        exported.latestSnapshot ?? null,
        exported.latestSnapshotDetails ?? null,
      );
      const existingLatestTakenAt = existing
        ? latestTakenAt(existing.latestSnapshot ?? null, existing.latestSnapshotDetails ?? null)
        : null;
      const exportIsNewer =
        exportLatestTakenAt !== null &&
        (existingLatestTakenAt === null || exportLatestTakenAt >= existingLatestTakenAt);

      const normalizedPreview = normalizePreviewRuns(
        exported.mythicPlusRecentRunsPreview ?? null,
        existing?.id ?? "",
      );

      const values = {
        legacyConvexId: exported._id,
        playerId: targetPlayerId,
        name: exported.name,
        realm: exported.realm,
        region: exported.region,
        class: exported.class,
        race: exported.race,
        faction: exported.faction,
        isBooster: exported.isBooster ?? null,
        nonTradeableSlots: mergeSlots(null, exported.nonTradeableSlots ?? null),
        latestSnapshot: exported.latestSnapshot ?? null,
        latestSnapshotDetails: exported.latestSnapshotDetails ?? null,
        mythicPlusSummary: exported.mythicPlusSummary ?? null,
        mythicPlusRecentRunsPreview: normalizedPreview,
        mythicPlusRunCount: integerValue(exported.mythicPlusRunCount),
        firstSnapshotAt: dateFromSeconds(exported.firstSnapshotAt),
        snapshotCount: integerValue(exported.snapshotCount),
      };

      if (!existing) {
        const inserted = expectRow(
          await db.insert(characters).values(values).returning(),
          `insert character ${exported._id}`,
        );
        charactersByLegacy.set(exported._id, inserted);
        charactersByNatural.set(characterNaturalKey(inserted.playerId, inserted), inserted);
        targetCharacterIdByLegacyConvexCharacterId.set(exported._id, inserted.id);
        summary.characters.inserted += 1;
        continue;
      }

      const mergedPreview =
        (exportIsNewer ? normalizedPreview : null) ??
        existing.mythicPlusRecentRunsPreview ??
        (normalizedPreview
          ? normalizePreviewRuns(normalizedPreview, existing.id)
          : null);

      const updated = expectRow(
        await db
        .update(characters)
        .set({
          legacyConvexId: existing.legacyConvexId ?? values.legacyConvexId,
          playerId: values.playerId,
          name: values.name,
          realm: values.realm,
          region: values.region,
          class: values.class,
          race: values.race,
          faction: values.faction,
          isBooster: values.isBooster ?? existing.isBooster,
          nonTradeableSlots: mergeSlots(existing.nonTradeableSlots, values.nonTradeableSlots),
          latestSnapshot: exportIsNewer
            ? values.latestSnapshot
            : existing.latestSnapshot ?? values.latestSnapshot,
          latestSnapshotDetails: exportIsNewer
            ? values.latestSnapshotDetails
            : existing.latestSnapshotDetails ?? values.latestSnapshotDetails,
          mythicPlusSummary: exportIsNewer
            ? values.mythicPlusSummary ?? existing.mythicPlusSummary
            : existing.mythicPlusSummary ?? values.mythicPlusSummary,
          mythicPlusRecentRunsPreview: mergedPreview,
          mythicPlusRunCount: maxNullable(existing.mythicPlusRunCount, values.mythicPlusRunCount),
          firstSnapshotAt: minDate(existing.firstSnapshotAt, values.firstSnapshotAt),
          snapshotCount: maxNullable(existing.snapshotCount, values.snapshotCount),
        })
        .where(eq(characters.id, existing.id))
        .returning(),
        `update character ${existing.id}`,
      );

      charactersByLegacy.set(updated.legacyConvexId ?? exported._id, updated);
      charactersByNatural.set(characterNaturalKey(updated.playerId, updated), updated);
      targetCharacterIdByLegacyConvexCharacterId.set(exported._id, updated.id);
      summary.characters.updated += 1;
    }

    for (const exported of exportedSnapshots) {
      const targetCharacterId = targetCharacterIdByLegacyConvexCharacterId.get(exported.characterId);
      if (!targetCharacterId) {
        summary.snapshots.skipped += 1;
        summary.warnings.push(
          `Skipped snapshot ${exported._id}: character ${exported.characterId} was not imported.`,
        );
        continue;
      }

      const takenAt = dateFromSeconds(exported.takenAt)!;
      const naturalKey = snapshotNaturalKey(targetCharacterId, takenAt);
      const existing =
        snapshotsByLegacy.get(exported._id) ?? snapshotsByNatural.get(naturalKey) ?? null;

      const values = {
        legacyConvexId: exported._id,
        characterId: targetCharacterId,
        takenAt,
        level: integerValue(exported.level)!,
        spec: exported.spec,
        role: exported.role,
        itemLevel: exported.itemLevel,
        gold: exported.gold,
        playtimeSeconds: integerValue(exported.playtimeSeconds)!,
        playtimeThisLevelSeconds: integerValue(exported.playtimeThisLevelSeconds),
        mythicPlusScore: exported.mythicPlusScore,
        ownedKeystone: exported.ownedKeystone ?? null,
        currencies: exported.currencies,
        stats: exported.stats,
      };

      if (!existing) {
        const inserted = expectRow(
          await db.insert(snapshots).values(values).returning(),
          `insert snapshot ${exported._id}`,
        );
        snapshotsByLegacy.set(exported._id, inserted);
        snapshotsByNatural.set(snapshotNaturalKey(inserted.characterId, inserted.takenAt), inserted);
        summary.snapshots.inserted += 1;
        continue;
      }

      const updated = expectRow(
        await db
        .update(snapshots)
        .set({
          ...values,
          legacyConvexId: existing.legacyConvexId ?? values.legacyConvexId,
        })
        .where(eq(snapshots.id, existing.id))
        .returning({
          id: snapshots.id,
          legacyConvexId: snapshots.legacyConvexId,
          characterId: snapshots.characterId,
          takenAt: snapshots.takenAt,
        }),
        `update snapshot ${existing.id}`,
      );

      snapshotsByLegacy.set(updated.legacyConvexId ?? exported._id, updated);
      snapshotsByNatural.set(snapshotNaturalKey(updated.characterId, updated.takenAt), updated);
      summary.snapshots.updated += 1;
    }

    for (const exported of exportedDailySnapshots) {
      const targetCharacterId = targetCharacterIdByLegacyConvexCharacterId.get(exported.characterId);
      if (!targetCharacterId) {
        summary.characterDailySnapshots.skipped += 1;
        summary.warnings.push(
          `Skipped daily snapshot ${exported._id}: character ${exported.characterId} was not imported.`,
        );
        continue;
      }

      const dayStartAt = dateFromSeconds(exported.dayStartAt)!;
      const lastTakenAt = dateFromSeconds(exported.lastTakenAt)!;
      const naturalKey = dailyNaturalKey(targetCharacterId, dayStartAt);
      const existing =
        dailyByLegacy.get(exported._id) ?? dailyByNatural.get(naturalKey) ?? null;

      const values = {
        legacyConvexId: exported._id,
        characterId: targetCharacterId,
        dayStartAt,
        lastTakenAt,
        itemLevel: exported.itemLevel,
        gold: exported.gold,
        playtimeSeconds: integerValue(exported.playtimeSeconds)!,
        mythicPlusScore: exported.mythicPlusScore,
        currencies: exported.currencies ?? null,
        stats: exported.stats ?? null,
      };

      if (!existing) {
        const inserted = expectRow(
          await db.insert(characterDailySnapshots).values(values).returning(),
          `insert daily snapshot ${exported._id}`,
        );
        dailyByLegacy.set(exported._id, inserted);
        dailyByNatural.set(dailyNaturalKey(inserted.characterId, inserted.dayStartAt), inserted);
        summary.characterDailySnapshots.inserted += 1;
        continue;
      }

      const exportIsNewer = lastTakenAt.getTime() >= existing.lastTakenAt.getTime();
      const updated = expectRow(
        await db
        .update(characterDailySnapshots)
        .set({
          legacyConvexId: existing.legacyConvexId ?? values.legacyConvexId,
          characterId: values.characterId,
          dayStartAt: values.dayStartAt,
          lastTakenAt: exportIsNewer ? values.lastTakenAt : existing.lastTakenAt,
          itemLevel: exportIsNewer ? values.itemLevel : existing.itemLevel,
          gold: exportIsNewer ? values.gold : existing.gold,
          playtimeSeconds: exportIsNewer ? values.playtimeSeconds : existing.playtimeSeconds,
          mythicPlusScore: exportIsNewer ? values.mythicPlusScore : existing.mythicPlusScore,
          currencies: exportIsNewer ? values.currencies : existing.currencies ?? values.currencies,
          stats: exportIsNewer ? values.stats : existing.stats ?? values.stats,
        })
        .where(eq(characterDailySnapshots.id, existing.id))
        .returning(),
        `update daily snapshot ${existing.id}`,
      );

      dailyByLegacy.set(updated.legacyConvexId ?? exported._id, updated);
      dailyByNatural.set(dailyNaturalKey(updated.characterId, updated.dayStartAt), updated);
      summary.characterDailySnapshots.updated += 1;
    }

    for (const exported of exportedMythicPlusRuns) {
      const targetCharacterId = targetCharacterIdByLegacyConvexCharacterId.get(exported.characterId);
      if (!targetCharacterId) {
        summary.mythicPlusRuns.skipped += 1;
        summary.warnings.push(
          `Skipped Mythic+ run ${exported._id}: character ${exported.characterId} was not imported.`,
        );
        continue;
      }

      const naturalKey = mythicRunNaturalKey(targetCharacterId, exported.fingerprint);
      const existing =
        mythicRunsByLegacy.get(exported._id) ?? mythicRunsByNatural.get(naturalKey) ?? null;

      const values = {
        legacyConvexId: exported._id,
        characterId: targetCharacterId,
        fingerprint: exported.fingerprint,
        attemptId: exported.attemptId ?? null,
        canonicalKey: exported.canonicalKey ?? null,
        observedAt: dateFromSeconds(exported.observedAt)!,
        seasonId: integerValue(exported.seasonID),
        mapChallengeModeId: integerValue(exported.mapChallengeModeID),
        mapName: exported.mapName ?? null,
        level: integerValue(exported.level),
        status: exported.status ?? null,
        completed: exported.completed ?? null,
        completedInTime: exported.completedInTime ?? null,
        durationMs: integerValue(exported.durationMs),
        runScore: exported.runScore ?? null,
        startDate: dateFromSeconds(exported.startDate),
        completedAt: dateFromSeconds(exported.completedAt),
        endedAt: dateFromSeconds(exported.endedAt),
        abandonedAt: dateFromSeconds(exported.abandonedAt),
        abandonReason: exported.abandonReason ?? null,
        thisWeek: exported.thisWeek ?? null,
        members: exported.members ?? null,
      };

      if (!existing) {
        const inserted = expectRow(
          await db.insert(mythicPlusRuns).values(values).returning(),
          `insert mythic+ run ${exported._id}`,
        );
        mythicRunsByLegacy.set(exported._id, inserted);
        mythicRunsByNatural.set(mythicRunNaturalKey(inserted.characterId, inserted.fingerprint), inserted);
        summary.mythicPlusRuns.inserted += 1;
        continue;
      }

      const exportIsNewer = values.observedAt.getTime() >= existing.observedAt.getTime();
      const updated = expectRow(
        await db
        .update(mythicPlusRuns)
        .set({
          legacyConvexId: existing.legacyConvexId ?? values.legacyConvexId,
          characterId: values.characterId,
          fingerprint: values.fingerprint,
          attemptId: values.attemptId ?? existing.attemptId,
          canonicalKey: values.canonicalKey ?? existing.canonicalKey,
          observedAt: exportIsNewer ? values.observedAt : existing.observedAt,
          seasonId: exportIsNewer ? values.seasonId : existing.seasonId ?? values.seasonId,
          mapChallengeModeId: exportIsNewer
            ? values.mapChallengeModeId
            : existing.mapChallengeModeId ?? values.mapChallengeModeId,
          mapName: exportIsNewer ? values.mapName : existing.mapName ?? values.mapName,
          level: exportIsNewer ? values.level : existing.level ?? values.level,
          status: exportIsNewer ? values.status : existing.status ?? values.status,
          completed: exportIsNewer ? values.completed : existing.completed ?? values.completed,
          completedInTime: exportIsNewer
            ? values.completedInTime
            : existing.completedInTime ?? values.completedInTime,
          durationMs: exportIsNewer ? values.durationMs : existing.durationMs ?? values.durationMs,
          runScore: exportIsNewer ? values.runScore : existing.runScore ?? values.runScore,
          startDate: exportIsNewer ? values.startDate : existing.startDate ?? values.startDate,
          completedAt: exportIsNewer
            ? values.completedAt
            : existing.completedAt ?? values.completedAt,
          endedAt: exportIsNewer ? values.endedAt : existing.endedAt ?? values.endedAt,
          abandonedAt: exportIsNewer
            ? values.abandonedAt
            : existing.abandonedAt ?? values.abandonedAt,
          abandonReason: exportIsNewer
            ? values.abandonReason
            : existing.abandonReason ?? values.abandonReason,
          thisWeek: exportIsNewer ? values.thisWeek : existing.thisWeek ?? values.thisWeek,
          members: exportIsNewer ? values.members : existing.members ?? values.members,
        })
        .where(eq(mythicPlusRuns.id, existing.id))
        .returning(),
        `update mythic+ run ${existing.id}`,
      );

      mythicRunsByLegacy.set(updated.legacyConvexId ?? exported._id, updated);
      mythicRunsByNatural.set(mythicRunNaturalKey(updated.characterId, updated.fingerprint), updated);
      summary.mythicPlusRuns.updated += 1;
    }

    for (const exported of exportedAuditLog) {
      const targetUserId = resolveTargetUserId(exported.userId) ?? exported.userId ?? undefined;
      const naturalKey = auditNaturalKey({
        ...exported,
        userId: targetUserId,
      });
      const existing = auditByLegacy.get(exported._id) ?? auditByNatural.get(naturalKey) ?? null;
      const values = {
        legacyConvexId: exported._id,
        userId: targetUserId ?? null,
        event: exported.event,
        metadata: exported.metadata ?? null,
        error: exported.error ?? null,
        timestamp: dateFromMilliseconds(exported.timestamp)!,
      };

      if (!existing) {
        const inserted = expectRow(
          await db.insert(auditLog).values(values).returning({
          id: auditLog.id,
          legacyConvexId: auditLog.legacyConvexId,
          userId: auditLog.userId,
          event: auditLog.event,
          timestamp: auditLog.timestamp,
          }),
          `insert audit log ${exported._id}`,
        );

        auditByLegacy.set(exported._id, inserted);
        auditByNatural.set(naturalKey, inserted);
        summary.auditLog.inserted += 1;
        continue;
      }

      const updated = expectRow(
        await db
        .update(auditLog)
        .set({
          legacyConvexId: existing.legacyConvexId ?? values.legacyConvexId,
          userId: existing.userId ?? values.userId,
          event: values.event,
          metadata: values.metadata,
          error: values.error,
          timestamp: existing.timestamp.getTime() >= values.timestamp.getTime()
            ? existing.timestamp
            : values.timestamp,
        })
        .where(eq(auditLog.id, existing.id))
        .returning({
          id: auditLog.id,
          legacyConvexId: auditLog.legacyConvexId,
          userId: auditLog.userId,
          event: auditLog.event,
          timestamp: auditLog.timestamp,
        }),
        `update audit log ${existing.id}`,
      );

      auditByLegacy.set(updated.legacyConvexId ?? exported._id, updated);
      auditByNatural.set(naturalKey, updated);
      summary.auditLog.updated += 1;
    }

    console.log("[import-convex-export] completed", summary);
  } finally {
    await closeDatabaseConnection(connection);
  }
}

void main().catch((error) => {
  console.error("[import-convex-export] failed", error);
  process.exit(1);
});
