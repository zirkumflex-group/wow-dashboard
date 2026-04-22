import { eq } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import type { GenericEndpointContext } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { players, schema } from "@wow-dashboard/db";
import { env } from "@wow-dashboard/env/server";
import { db } from "./db";
import { insertAuditEvent } from "./lib/audit";
import { enqueueSyncCharactersJob } from "./lib/queue";

type BattleNetProfile = Record<string, string | undefined>;
type BattleNetAccountHook = {
  accountId: string;
  providerId: string;
  userId: string;
  accessToken?: string | null;
  idToken?: string | null;
};

function buildBattleNetEmail(profile: BattleNetProfile): string {
  const battleTag = (profile.battletag ?? profile.battle_tag ?? "").replaceAll("#", "-");
  return `${profile.sub}.${battleTag}@battlenet.local`;
}

function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;

  const segments = token.split(".");
  if (segments.length < 2) return null;

  try {
    return JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function readBattleTagFromIdToken(idToken: string | null | undefined): string | null {
  const payload = decodeJwtPayload(idToken);
  const battleTag = payload?.battle_tag ?? payload?.battletag ?? payload?.battleTag;
  return typeof battleTag === "string" && battleTag.trim() !== "" ? battleTag : null;
}

async function upsertPlayerBinding(account: BattleNetAccountHook): Promise<void> {
  const battleTag = readBattleTagFromIdToken(account.idToken) ?? account.accountId;

  await db
    .insert(players)
    .values({
      battlenetAccountId: account.accountId,
      userId: account.userId,
      battleTag,
    })
    .onConflictDoUpdate({
      target: players.battlenetAccountId,
      set: {
        userId: account.userId,
        battleTag,
      },
    });
}

async function readPlayerBinding(userId: string) {
  return db.query.players.findFirst({
    where: eq(players.userId, userId),
  });
}

function isBattleNetAccount(account: { providerId?: string | null }): account is BattleNetAccountHook {
  return account.providerId === "battlenet";
}

async function queueCharacterSync(account: BattleNetAccountHook) {
  if (!account.accessToken) {
    return { queued: false as const, error: undefined };
  }

  try {
    await enqueueSyncCharactersJob({
      userId: account.userId,
      accessToken: account.accessToken,
    });

    return { queued: true as const, error: undefined };
  } catch (error) {
    return {
      queued: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const auth = betterAuth({
  appName: "WoW Dashboard",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.SITE_URL, env.BETTER_AUTH_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: false,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          if (!user.email?.endsWith("@battlenet.local")) return;

          const existingPlayer = await readPlayerBinding(user.id);
          await insertAuditEvent("auth.user.created", {
            userId: user.id,
            metadata: {
              battleTag: user.name ?? null,
              playerAlreadyBound: Boolean(existingPlayer),
            },
          });
        },
      },
    },
    account: {
      create: {
        after: async (account) => {
          if (!isBattleNetAccount(account)) return;

          await upsertPlayerBinding(account);
          const sync = await queueCharacterSync(account);
          await insertAuditEvent("auth.account.created", {
            userId: account.userId,
            metadata: {
              providerId: account.providerId,
              battlenetAccountId: account.accountId,
              syncPrepared: Boolean(account.accessToken),
              syncQueued: sync.queued,
            },
            error: sync.error,
          });
        },
      },
      update: {
        after: async (account) => {
          if (!isBattleNetAccount(account) || !account.accountId || !account.userId) return;

          await upsertPlayerBinding({
            accountId: account.accountId,
            providerId: account.providerId,
            userId: account.userId,
            accessToken: account.accessToken,
            idToken: account.idToken,
          });
          const sync = await queueCharacterSync({
            accountId: account.accountId,
            providerId: account.providerId,
            userId: account.userId,
            accessToken: account.accessToken,
            idToken: account.idToken,
          });
          await insertAuditEvent("auth.account.updated", {
            userId: account.userId,
            metadata: {
              providerId: account.providerId,
              battlenetAccountId: account.accountId,
              syncPrepared: Boolean(account.accessToken),
              syncQueued: sync.queued,
            },
            error: sync.error,
          });
        },
      },
    },
  },
  plugins: [
    bearer(),
    genericOAuth({
      config: [
        {
          providerId: "battlenet",
          discoveryUrl: "https://oauth.battle.net/.well-known/openid-configuration",
          clientId: env.BATTLENET_CLIENT_ID,
          clientSecret: env.BATTLENET_CLIENT_SECRET,
          scopes: ["openid", "wow.profile"],
          mapProfileToUser: (profile: BattleNetProfile) => ({
            id: String(profile.sub),
            name: profile.battletag ?? profile.battle_tag ?? String(profile.sub),
            email: buildBattleNetEmail(profile),
            emailVerified: true,
          }),
        },
      ],
    }),
  ],
});

export type ApiAuthSession = typeof auth.$Infer.Session.session;
export type ApiAuthUser = typeof auth.$Infer.Session.user;
export type ApiAuthContext = GenericEndpointContext | null;
