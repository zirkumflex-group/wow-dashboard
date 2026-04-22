import { randomBytes } from "node:crypto";
import { loginCodeTtlSeconds } from "@wow-dashboard/api-schema";
import { insertAuditEvent } from "./audit";
import { ensureRedis } from "./redis";

const loginCodePrefix = "auth:login-code";
const codeBytes = 32;

type StoredLoginCode = {
  token: string;
  userId: string;
  createdAt: string;
};

function buildLoginCodeKey(code: string): string {
  return `${loginCodePrefix}:${code}`;
}

function createRandomCode(): string {
  return randomBytes(codeBytes).toString("hex");
}

export async function createLoginCode(input: {
  token: string;
  userId: string;
}): Promise<string> {
  const redis = await ensureRedis();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createRandomCode();
    const payload: StoredLoginCode = {
      token: input.token,
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
