import { and, eq } from "drizzle-orm";
import { account } from "@wow-dashboard/db";
import { env } from "@wow-dashboard/env/server";
import { db } from "../db";
import { insertAuditEvent } from "../lib/audit";

type BattleNetAccountRecord = typeof account.$inferSelect;

type BattleNetTokenRefreshResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
};

type BattleNetAccessTokenResult =
  | {
      ok: true;
      accessToken: string;
      refreshed: boolean;
    }
  | {
      ok: false;
      reason:
        | "missing_account"
        | "missing_access_token"
        | "missing_refresh_token"
        | "refresh_failed";
      error?: string;
    };

const battleNetTokenEndpoint = "https://oauth.battle.net/token";
const accessTokenRefreshSkewMs = 5 * 60 * 1000;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readExpiresInSeconds(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function expiresAtFromNow(expiresInSeconds: number | null): Date | null {
  return expiresInSeconds === null ? null : new Date(Date.now() + expiresInSeconds * 1000);
}

function hasFreshAccessToken(
  accountRow: BattleNetAccountRecord,
): accountRow is BattleNetAccountRecord & {
  accessToken: string;
} {
  if (!accountRow.accessToken) {
    return false;
  }

  const expiresAt = accountRow.accessTokenExpiresAt;
  return !expiresAt || expiresAt.getTime() > Date.now() + accessTokenRefreshSkewMs;
}

async function requestRefreshedBattleNetToken(
  refreshToken: string,
): Promise<BattleNetTokenRefreshResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(battleNetTokenEndpoint, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(
        `${env.BATTLENET_CLIENT_ID}:${env.BATTLENET_CLIENT_SECRET}`,
      ).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`Battle.net token refresh failed with HTTP ${response.status}`);
  }

  try {
    return JSON.parse(rawBody) as BattleNetTokenRefreshResponse;
  } catch {
    throw new Error("Battle.net token refresh returned invalid JSON");
  }
}

async function refreshBattleNetAccessToken(
  accountRow: BattleNetAccountRecord & { refreshToken: string },
): Promise<BattleNetAccessTokenResult> {
  try {
    const refreshedToken = await requestRefreshedBattleNetToken(accountRow.refreshToken);
    const accessToken = readString(refreshedToken.access_token);
    if (!accessToken) {
      throw new Error("Battle.net token refresh response did not include an access token");
    }

    const refreshToken = readString(refreshedToken.refresh_token) ?? accountRow.refreshToken;
    const accessTokenExpiresAt =
      expiresAtFromNow(readExpiresInSeconds(refreshedToken.expires_in)) ??
      accountRow.accessTokenExpiresAt;
    const refreshTokenExpiresIn = readExpiresInSeconds(refreshedToken.refresh_token_expires_in);
    const refreshTokenExpiresAt =
      refreshTokenExpiresIn === null
        ? accountRow.refreshTokenExpiresAt
        : expiresAtFromNow(refreshTokenExpiresIn);

    await db
      .update(account)
      .set({
        accessToken,
        refreshToken,
        idToken: readString(refreshedToken.id_token) ?? accountRow.idToken,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        scope: readString(refreshedToken.scope) ?? accountRow.scope,
        updatedAt: new Date(),
      })
      .where(eq(account.id, accountRow.id));

    await insertAuditEvent("battlenet.token.refreshed", {
      userId: accountRow.userId,
      metadata: {
        battlenetAccountId: accountRow.accountId,
        accessTokenExpiresAt: accessTokenExpiresAt?.toISOString() ?? null,
      },
    });

    return {
      ok: true,
      accessToken,
      refreshed: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await insertAuditEvent("battlenet.token.refresh_failed", {
      userId: accountRow.userId,
      metadata: {
        battlenetAccountId: accountRow.accountId,
      },
      error: message,
    });

    return {
      ok: false,
      reason: "refresh_failed",
      error: message,
    };
  }
}

export async function resolveBattleNetAccessTokenForUser(
  userId: string,
): Promise<BattleNetAccessTokenResult> {
  const accountRow = await db.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, "battlenet")),
  });

  if (!accountRow) {
    return {
      ok: false,
      reason: "missing_account",
    };
  }

  if (hasFreshAccessToken(accountRow)) {
    return {
      ok: true,
      accessToken: accountRow.accessToken,
      refreshed: false,
    };
  }

  if (!accountRow.accessToken && !accountRow.refreshToken) {
    return {
      ok: false,
      reason: "missing_access_token",
    };
  }

  if (!accountRow.refreshToken) {
    await insertAuditEvent("battlenet.token.refresh_missing", {
      userId,
      metadata: {
        battlenetAccountId: accountRow.accountId,
        accessTokenExpiresAt: accountRow.accessTokenExpiresAt?.toISOString() ?? null,
      },
    });

    return {
      ok: false,
      reason: "missing_refresh_token",
    };
  }

  return refreshBattleNetAccessToken({
    ...accountRow,
    refreshToken: accountRow.refreshToken,
  });
}
