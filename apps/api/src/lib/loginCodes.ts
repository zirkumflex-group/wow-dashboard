import { randomBytes } from "node:crypto";
import { loginCodeTtlSeconds } from "@wow-dashboard/api-schema";
import { auth } from "../auth";
import { insertAuditEvent } from "./audit";
import { logger } from "./logger";
import { ensureRedis } from "./redis";

const loginCodePrefix = "auth:login-code";
const desktopLoginAttemptPrefix = "auth:desktop-login";
const codeBytes = 32;
const desktopSessionUserAgent = "wow-dashboard-desktop";
const desktopSessionTtlSeconds = 180 * 24 * 60 * 60;
const desktopSessionRefreshThresholdSeconds = 30 * 24 * 60 * 60;
const desktopSessionMaximumClockSkewSeconds = 5 * 60;

type StoredAuthHandoff = {
  userId: string;
  createdAt: string;
  legacySessionToken?: string;
};

type StoredLoginCode = StoredAuthHandoff;
type StoredDesktopLoginAttempt = StoredAuthHandoff;

function buildLoginCodeKey(code: string): string {
  return `${loginCodePrefix}:${code}`;
}

function buildDesktopLoginAttemptKey(attemptId: string): string {
  return `${desktopLoginAttemptPrefix}:${attemptId}`;
}

function createRandomCode(): string {
  return randomBytes(codeBytes).toString("hex");
}

function getDesktopSessionExpiresAt(): Date {
  return new Date(Date.now() + desktopSessionTtlSeconds * 1000);
}

type MaybeDesktopSession = {
  token?: string | null;
  userAgent?: string | null;
  expiresAt?: Date | string | null;
};

export async function ensureDesktopSessionLifetime(session: MaybeDesktopSession): Promise<void> {
  await ensureDesktopSessionLifetimeWithOptions(session);
}

export async function ensureElectronSessionLifetime(session: MaybeDesktopSession): Promise<void> {
  await ensureDesktopSessionLifetimeWithOptions(session, { promoteLegacySession: true });
}

async function ensureDesktopSessionLifetimeWithOptions(
  session: MaybeDesktopSession,
  options: { promoteLegacySession?: boolean } = {},
): Promise<void> {
  if (!session.token) return;
  if (session.userAgent !== desktopSessionUserAgent && !options.promoteLegacySession) return;

  const expiresAt =
    session.expiresAt instanceof Date
      ? session.expiresAt
      : session.expiresAt
        ? new Date(session.expiresAt)
        : null;
  const shouldRefreshExpiry =
    !expiresAt ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now() + desktopSessionRefreshThresholdSeconds * 1000 ||
    expiresAt.getTime() >
      Date.now() + (desktopSessionTtlSeconds + desktopSessionMaximumClockSkewSeconds) * 1000;
  const shouldUpdateUserAgent = session.userAgent !== desktopSessionUserAgent;

  if (!shouldRefreshExpiry && !shouldUpdateUserAgent) {
    return;
  }

  const authContext = await auth.$context;
  await authContext.internalAdapter.updateSession(session.token, {
    ...(shouldRefreshExpiry ? { expiresAt: getDesktopSessionExpiresAt() } : {}),
    updatedAt: new Date(),
    ...(shouldUpdateUserAgent ? { userAgent: desktopSessionUserAgent } : {}),
  });
}

async function createDesktopSessionToken(userId: string): Promise<string> {
  const authContext = await auth.$context;
  const session = await authContext.internalAdapter.createSession(
    userId,
    false,
    {
      userAgent: desktopSessionUserAgent,
      expiresAt: getDesktopSessionExpiresAt(),
    },
    true,
  );

  if (!session) {
    throw new Error("Failed to create desktop session");
  }

  return session.token;
}

async function writeAuditSafely(
  event: string,
  values: Parameters<typeof insertAuditEvent>[1],
): Promise<void> {
  await insertAuditEvent(event, values).catch((error) => {
    logger.warn("audit.persist_failed", { auditEvent: event, error });
  });
}

function parseStoredAuthHandoff(rawValue: string): StoredAuthHandoff | null {
  try {
    const value: unknown = JSON.parse(rawValue);
    if (!value || typeof value !== "object") return null;

    const candidate = value as Partial<StoredAuthHandoff>;
    if (
      typeof candidate.userId !== "string" ||
      !candidate.userId.trim() ||
      typeof candidate.createdAt !== "string" ||
      !Number.isFinite(Date.parse(candidate.createdAt))
    ) {
      return null;
    }

    const legacySessionToken = (value as { token?: unknown }).token;
    return {
      userId: candidate.userId,
      createdAt: candidate.createdAt,
      ...(typeof legacySessionToken === "string" && legacySessionToken.trim()
        ? { legacySessionToken }
        : {}),
    };
  } catch {
    return null;
  }
}

export async function createLoginCode(input: { userId: string }): Promise<string> {
  const redis = await ensureRedis();
  const payload: StoredLoginCode = {
    userId: input.userId,
    createdAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createRandomCode();

    const result = await redis.set(
      buildLoginCodeKey(code),
      JSON.stringify(payload),
      "EX",
      loginCodeTtlSeconds,
      "NX",
    );

    if (result !== "OK") continue;

    await writeAuditSafely("auth.code.generated", {
      userId: input.userId,
      metadata: {
        expiresInSeconds: loginCodeTtlSeconds,
      },
    });

    return code;
  }

  throw new Error("Failed to allocate login code");
}

export async function redeemLoginCode(code: string): Promise<string | null> {
  if (!code.trim()) return null;

  const redis = await ensureRedis();
  const rawValue = (await redis.call("GETDEL", buildLoginCodeKey(code))) as string | null;
  if (!rawValue) return null;

  const payload = parseStoredAuthHandoff(rawValue);
  if (!payload) return null;

  const token = payload.legacySessionToken ?? (await createDesktopSessionToken(payload.userId));

  await writeAuditSafely("auth.code.redeemed", {
    userId: payload.userId,
    metadata: {
      expiresInSeconds: loginCodeTtlSeconds,
    },
  });

  return token;
}

export async function completeDesktopLoginAttempt(input: {
  attemptId: string;
  userId: string;
}): Promise<void> {
  const attemptId = input.attemptId.trim();
  if (!attemptId) return;

  const redis = await ensureRedis();
  const payload: StoredDesktopLoginAttempt = {
    userId: input.userId,
    createdAt: new Date().toISOString(),
  };

  const result = await redis.set(
    buildDesktopLoginAttemptKey(attemptId),
    JSON.stringify(payload),
    "EX",
    loginCodeTtlSeconds,
    "NX",
  );

  if (result !== "OK") {
    const existingValue = await redis.get(buildDesktopLoginAttemptKey(attemptId));
    const existingPayload = existingValue ? parseStoredAuthHandoff(existingValue) : null;
    if (existingPayload?.userId === input.userId) return;
    throw new Error("Desktop login attempt is already complete");
  }

  await writeAuditSafely("auth.desktop.completed", {
    userId: input.userId,
    metadata: {
      expiresInSeconds: loginCodeTtlSeconds,
    },
  });
}

export async function consumeDesktopLoginAttempt(attemptId: string): Promise<string | null> {
  const normalizedAttemptId = attemptId.trim();
  if (!normalizedAttemptId) return null;

  const redis = await ensureRedis();
  const rawValue = (await redis.call(
    "GETDEL",
    buildDesktopLoginAttemptKey(normalizedAttemptId),
  )) as string | null;
  if (!rawValue) return null;

  const payload = parseStoredAuthHandoff(rawValue);
  if (!payload) return null;

  const token = payload.legacySessionToken ?? (await createDesktopSessionToken(payload.userId));

  await writeAuditSafely("auth.desktop.consumed", {
    userId: payload.userId,
    metadata: {
      expiresInSeconds: loginCodeTtlSeconds,
    },
  });

  return token;
}
