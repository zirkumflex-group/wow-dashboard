import Redis from "ioredis";
import { env } from "@wow-dashboard/env/api";
import { logger } from "./logger";

let redisClient: Redis | null = null;

function createRedisClient(): Redis {
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 10_000,
    commandTimeout: 5_000,
    maxRetriesPerRequest: 2,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
  });
  redis.on("error", (error) => logger.error("redis.error", { error }));
  return redis;
}

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = createRedisClient();
  }

  return redisClient;
}

export async function ensureRedis(): Promise<Redis> {
  const redis = getRedis();

  if (redis.status === "wait") {
    await redis.connect();
  }

  return redis;
}

export async function closeRedis(): Promise<void> {
  if (!redisClient) return;

  const client = redisClient;
  redisClient = null;

  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
