import { ensureRedis } from "./redis";

const authStoragePrefix = "better-auth:";
const incrementScript = `
local value = redis.call("INCR", KEYS[1])
if value == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return value
`;

function storageKey(key: string): string {
  return `${authStoragePrefix}${key}`;
}

export const authSecondaryStorage = {
  async get(key: string) {
    return (await ensureRedis()).get(storageKey(key));
  },
  async getAndDelete(key: string) {
    return (await ensureRedis()).call("GETDEL", storageKey(key));
  },
  async increment(key: string, ttl: number) {
    const result = await (
      await ensureRedis()
    ).eval(incrementScript, 1, storageKey(key), Math.max(1, Math.ceil(ttl)));
    return Number(result);
  },
  async set(key: string, value: string, ttl?: number) {
    const redis = await ensureRedis();
    if (ttl !== undefined) {
      await redis.set(storageKey(key), value, "EX", Math.max(1, Math.ceil(ttl)));
      return;
    }
    await redis.set(storageKey(key), value);
  },
  async delete(key: string) {
    await (await ensureRedis()).del(storageKey(key));
  },
};
