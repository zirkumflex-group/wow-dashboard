import { randomBytes } from "node:crypto";
import { loginCodeTtlSeconds } from "@wow-dashboard/api-schema";
import { auth } from "../auth";
import { insertAuditEvent } from "./audit";
import { ensureRedis } from "./redis";

const loginCodePrefix = "auth:login-code";
const desktopLoginAttemptPrefix = "auth:desktop-login-attempt";
const codeBytes = 32;

type StoredLoginCode = {
  token: string;
  userId: string;
  createdAt: string;
};

function buildLoginCodeKey(code: string): string {
  return `${loginCodePrefix}:${code}`;
}

function buildDesktopLoginAttemptKey(attemptId: string): string {
  return `${desktopLoginAttemptPrefix}:${attemptId}`;
}

function createRandomCode(): string {
  return randomBytes(codeBytes).toString("hex");
}

async function createDesktopSessionToken(userId: string): Promise<string> {
  const authContext = await auth.$context;
  const session = await authContext.internalAdapter.createSession(userId, false, {
    userAgent: "wow-dashboard-desktop",
  });

  if (!session) {
    throw new Error("Failed to create desktop session");
  }

  return session.token;
}

export async function createLoginCode(input: {
  userId: string;
}): Promise<string> {
  const redis = await ensureRedis();
  const token = await createDesktopSessionToken(input.userId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createRandomCode();
    const payload: StoredLoginCode = {
      token,
      userId: input.userId,
      createdAt: new Date().toISOString(),
    };

    const result = await redis.set(
      buildLoginCodeKey(code),
      JSON.stringify(payload),
      "EX",
      loginCodeTtlSeconds,
      "NX",
    );

    if (result !== "OK") continue;

    await insertAuditEvent("auth.code.generated", {
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

  let payload: StoredLoginCode;
  try {
    payload = JSON.parse(rawValue) as StoredLoginCode;
  } catch {
    return null;
  }

  await insertAuditEvent("auth.code.redeemed", {
    userId: payload.userId,
    metadata: {
      expiresInSeconds: loginCodeTtlSeconds,
    },
  });

  return payload.token;
}

export async function completeDesktopLoginAttempt(input: {
  attemptId: string;
  userId: string;
}): Promise<void> {
  const attemptId = input.attemptId.trim();
  if (!attemptId) {
    throw new Error("attemptId is required");
  }

  const redis = await ensureRedis();
  const token = await createDesktopSessionToken(input.userId);
  const payload: StoredLoginCode = {
    token,
    userId: input.userId,
    createdAt: new Date().toISOString(),
  };

  await redis.set(
    buildDesktopLoginAttemptKey(attemptId),
    JSON.stringify(payload),
    "EX",
    loginCodeTtlSeconds,
  );

  await insertAuditEvent("auth.desktop.completed", {
    userId: input.userId,
    metadata: {
      attemptId,
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

  let payload: StoredLoginCode;
  try {
    payload = JSON.parse(rawValue) as StoredLoginCode;
  } catch {
    return null;
  }

  await insertAuditEvent("auth.desktop.consumed", {
    userId: payload.userId,
    metadata: {
      attemptId: normalizedAttemptId,
      expiresInSeconds: loginCodeTtlSeconds,
    },
  });

  return payload.token;
}
