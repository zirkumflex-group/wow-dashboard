import Redis from "ioredis";
import { env } from "@wow-dashboard/env/server";

let redisClient: Redis | null = null;

function createRedisClient(): Redis {
  return new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
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
