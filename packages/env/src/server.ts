import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    PORT: z.string().default("3000"),
    DATABASE_URL: z.string().min(1).default("postgres://wowdash:wowdash@localhost:5432/wowdash"),
    REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
    SITE_URL: z.url().default("http://localhost:3001"),
    API_URL: z.url().default("http://localhost:3000/api"),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32)
      .default("development-only-better-auth-secret-change-me"),
    BATTLENET_CLIENT_ID: z.string().min(1).default("replace-with-battlenet-client-id"),
    BATTLENET_CLIENT_SECRET: z.string().min(1).default("replace-with-battlenet-client-secret"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("debug"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
