import { and, eq } from "drizzle-orm";
import { account, type DatabaseClient } from "@wow-dashboard/db";

type BattleNetAccountRecord = typeof account.$inferSelect;

type BattleNetTokenRefreshResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
};

export type BattleNetAuditWriter = (
  event: string,
  values: {
    userId?: string | null;
    metadata?: unknown;
    error?: string;
  },
) => Promise<void>;

export type BattleNetAccessTokenResult =
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

export type BattleNetTokenServiceOptions = {
  db: DatabaseClient;
  clientId: string;
  clientSecret: string;
  audit?: BattleNetAuditWriter;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  onAuditError?: (error: unknown) => void;
};

const battleNetTokenEndpoint = "https://oauth.battle.net/token";
const accessTokenRefreshSkewMs = 5 * 60 * 1000;
const legacyAccessTokenTtlMs = 24 * 60 * 60 * 1000;
const defaultRequestTimeoutMs = 10_000;

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

function getLegacyAccessTokenIssuedAt(accountRow: BattleNetAccountRecord): Date | null {
  return accountRow.updatedAt ?? accountRow.createdAt ?? null;
}

function getEffectiveAccessTokenExpiresAt(accountRow: BattleNetAccountRecord): Date | null {
  if (accountRow.accessTokenExpiresAt) {
    return accountRow.accessTokenExpiresAt;
  }

  const issuedAt = getLegacyAccessTokenIssuedAt(accountRow);
  return issuedAt ? new Date(issuedAt.getTime() + legacyAccessTokenTtlMs) : null;
}

function getAccessTokenExpiryMetadata(accountRow: BattleNetAccountRecord) {
  const inferredAccessTokenExpiresAt = accountRow.accessTokenExpiresAt
    ? null
    : getEffectiveAccessTokenExpiresAt(accountRow);

  return {
    accessTokenExpiresAt: accountRow.accessTokenExpiresAt?.toISOString() ?? null,
    inferredAccessTokenExpiresAt: inferredAccessTokenExpiresAt?.toISOString() ?? null,
    accessTokenExpirySource: accountRow.accessTokenExpiresAt ? "provider" : "legacy_inferred",
  };
}

function hasFreshAccessToken(
  accountRow: BattleNetAccountRecord,
): accountRow is BattleNetAccountRecord & { accessToken: string } {
  if (!accountRow.accessToken) {
    return false;
  }

  if (!accountRow.accessTokenExpiresAt && accountRow.refreshToken) {
    return false;
  }

  const expiresAt = getEffectiveAccessTokenExpiresAt(accountRow);
  return Boolean(expiresAt && expiresAt.getTime() > Date.now() + accessTokenRefreshSkewMs);
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function writeAuditSafely(
  audit: BattleNetAuditWriter | undefined,
  onAuditError: ((error: unknown) => void) | undefined,
  event: string,
  values: Parameters<BattleNetAuditWriter>[1],
): Promise<void> {
  if (!audit) return;

  try {
    await audit(event, values);
  } catch (error) {
    onAuditError?.(error);
  }
}

export function createBattleNetTokenService(options: BattleNetTokenServiceOptions) {
  const timeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs;

  async function requestRefreshedBattleNetToken(
    refreshToken: string,
    signal?: AbortSignal,
  ): Promise<BattleNetTokenRefreshResponse> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const response = await (options.fetch ?? globalThis.fetch)(battleNetTokenEndpoint, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString(
          "base64",
        )}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: requestSignal(signal, timeoutMs),
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
    signal?: AbortSignal,
  ): Promise<BattleNetAccessTokenResult> {
    try {
      const refreshedToken = await requestRefreshedBattleNetToken(accountRow.refreshToken, signal);
      const accessToken = readString(refreshedToken.access_token);
      if (!accessToken) {
        throw new Error("Battle.net token refresh response did not include an access token");
      }

      const refreshToken = readString(refreshedToken.refresh_token) ?? accountRow.refreshToken;
      const refreshedAt = new Date();
      const accessTokenExpiresAt =
        expiresAtFromNow(readExpiresInSeconds(refreshedToken.expires_in)) ??
        new Date(refreshedAt.getTime() + legacyAccessTokenTtlMs);
      const refreshTokenExpiresIn = readExpiresInSeconds(refreshedToken.refresh_token_expires_in);
      const refreshTokenExpiresAt =
        refreshTokenExpiresIn === null
          ? accountRow.refreshTokenExpiresAt
          : expiresAtFromNow(refreshTokenExpiresIn);

      await options.db
        .update(account)
        .set({
          accessToken,
          refreshToken,
          idToken: readString(refreshedToken.id_token) ?? accountRow.idToken,
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          scope: readString(refreshedToken.scope) ?? accountRow.scope,
          updatedAt: refreshedAt,
        })
        .where(eq(account.id, accountRow.id));

      await writeAuditSafely(options.audit, options.onAuditError, "battlenet.token.refreshed", {
        userId: accountRow.userId,
        metadata: {
          battlenetAccountId: accountRow.accountId,
          ...getAccessTokenExpiryMetadata({
            ...accountRow,
            accessTokenExpiresAt,
            updatedAt: refreshedAt,
          }),
        },
      });

      return {
        ok: true,
        accessToken,
        refreshed: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeAuditSafely(
        options.audit,
        options.onAuditError,
        "battlenet.token.refresh_failed",
        {
          userId: accountRow.userId,
          metadata: {
            battlenetAccountId: accountRow.accountId,
          },
          error: message,
        },
      );

      return {
        ok: false,
        reason: "refresh_failed",
        error: message,
      };
    }
  }

  async function resolveForUser(
    userId: string,
    signal?: AbortSignal,
  ): Promise<BattleNetAccessTokenResult> {
    const accountRow = await options.db.query.account.findFirst({
      where: and(eq(account.userId, userId), eq(account.providerId, "battlenet")),
    });

    if (!accountRow) {
      return { ok: false, reason: "missing_account" };
    }

    if (hasFreshAccessToken(accountRow)) {
      return {
        ok: true,
        accessToken: accountRow.accessToken,
        refreshed: false,
      };
    }

    if (!accountRow.accessToken && !accountRow.refreshToken) {
      return { ok: false, reason: "missing_access_token" };
    }

    if (!accountRow.refreshToken) {
      await writeAuditSafely(
        options.audit,
        options.onAuditError,
        "battlenet.token.refresh_missing",
        {
          userId,
          metadata: {
            battlenetAccountId: accountRow.accountId,
            ...getAccessTokenExpiryMetadata(accountRow),
          },
        },
      );

      return { ok: false, reason: "missing_refresh_token" };
    }

    return refreshBattleNetAccessToken(
      { ...accountRow, refreshToken: accountRow.refreshToken },
      signal,
    );
  }

  return { resolveForUser };
}

export const battleNetRegions = ["us", "eu", "kr", "tw"] as const;
export type BattleNetRegion = (typeof battleNetRegions)[number];

export interface BattleNetCharacter {
  name: string;
  realm: { name: string; slug: string };
  playable_class: { name: string };
  playable_race: { name: string };
  faction: { type: string };
  level: number;
}

interface BattleNetWowAccount {
  characters?: BattleNetCharacter[];
}

interface BattleNetWowProfileResponse {
  wow_accounts?: BattleNetWowAccount[];
}

export class BattleNetRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BattleNetRequestError";
  }
}

export async function fetchBattleNetCharactersForRegion(
  accessToken: string,
  region: BattleNetRegion,
  options: {
    fetch?: typeof globalThis.fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<BattleNetCharacter[]> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs;
  const url = `https://${region}.api.blizzard.com/profile/user/wow?namespace=profile-${region}&locale=en_US`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: requestSignal(options.signal, timeoutMs),
    });
  } catch (error) {
    throw new BattleNetRequestError(
      `Battle.net profile request failed for region ${region}`,
      true,
      null,
      { cause: error },
    );
  }

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    const retryable =
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500;
    throw new BattleNetRequestError(
      `Battle.net profile request returned HTTP ${response.status} for region ${region}`,
      retryable,
      response.status,
    );
  }

  let data: BattleNetWowProfileResponse;
  try {
    data = (await response.json()) as BattleNetWowProfileResponse;
  } catch (error) {
    throw new BattleNetRequestError(
      `Battle.net profile response was invalid JSON for region ${region}`,
      true,
      response.status,
      { cause: error },
    );
  }

  return (data.wow_accounts ?? []).flatMap((wowAccount) => wowAccount.characters ?? []);
}
