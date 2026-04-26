import { RateLimiterRedis } from "rate-limiter-flexible";
import { ensureRedis, getRedis } from "./redis";

type RateLimitName = "addonIngest" | "battlenetSync" | "publicRead" | "publicHeavyRead";
type RejectedRateLimit = {
  remainingPoints?: number;
  msBeforeNext?: number;
};

const limiters = {
  addonIngest: new RateLimiterRedis({
    storeClient: getRedis(),
    keyPrefix: "rate-limit:addon-ingest",
    points: 30,
    duration: 60,
  }),
  battlenetSync: new RateLimiterRedis({
    storeClient: getRedis(),
    keyPrefix: "rate-limit:battlenet-sync",
    points: 5,
    duration: 60,
  }),
  publicRead: new RateLimiterRedis({
    storeClient: getRedis(),
    keyPrefix: "rate-limit:public-read",
    points: 180,
    duration: 60,
  }),
  publicHeavyRead: new RateLimiterRedis({
    storeClient: getRedis(),
    keyPrefix: "rate-limit:public-heavy-read",
    points: 60,
    duration: 60,
  }),
} satisfies Record<RateLimitName, RateLimiterRedis>;

async function consumeRateLimit(name: RateLimitName, key: string) {
  await ensureRedis();

  try {
    const result = await limiters[name].consume(key);
    return {
      ok: true as const,
      remainingPoints: result.remainingPoints,
      retryAfterMs: 0,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    const rejected = error as RejectedRateLimit;

    return {
      ok: false as const,
      remainingPoints: rejected.remainingPoints ?? 0,
      retryAfterMs: rejected.msBeforeNext ?? 60_000,
    };
  }
}

export function limitAddonIngest(userId: string) {
  return consumeRateLimit("addonIngest", userId);
}

export function limitBattleNetSync(userId: string) {
  return consumeRateLimit("battlenetSync", userId);
}

export function limitPublicRead(key: string) {
  return consumeRateLimit("publicRead", key);
}

export function limitPublicHeavyRead(key: string) {
  return consumeRateLimit("publicHeavyRead", key);
}
