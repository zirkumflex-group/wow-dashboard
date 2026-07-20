import "./load";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import {
  envStringWithDevelopmentDefault,
  requiredEnvStringInProduction,
  serverRuntimeSchema,
} from "./server-shared";

const placeholderBetterAuthSecret = "development-only-better-auth-secret-change-me";
const documentedPlaceholderBetterAuthSecret = "replace-with-32-character-secret";
const placeholderBattleNetClientId = "replace-with-battlenet-client-id";
const placeholderBattleNetClientSecret = "replace-with-battlenet-client-secret";

const adminUserIdsSchema = z
  .string()
  .default("")
  .transform((value) =>
    Array.from(
      new Set(
        value
          .split(",")
          .map((userId) => userId.trim())
          .filter((userId) => userId !== ""),
      ),
    ),
  )
  .pipe(z.array(z.string().min(1).max(255)).max(20));

export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: envStringWithDevelopmentDefault(
      "postgres://wowdash:wowdash@localhost:5432/wowdash",
    ),
    REDIS_URL: envStringWithDevelopmentDefault("redis://localhost:6379"),
    APP_REVISION: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    SITE_URL: z.url().default("http://localhost:3001"),
    API_URL: z.url().default("http://localhost:3000/api"),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: requiredEnvStringInProduction(placeholderBetterAuthSecret, 32, [
      documentedPlaceholderBetterAuthSecret,
    ]),
    ADMIN_USER_IDS: adminUserIdsSchema,
    BATTLENET_CLIENT_ID: requiredEnvStringInProduction(placeholderBattleNetClientId),
    BATTLENET_CLIENT_SECRET: requiredEnvStringInProduction(placeholderBattleNetClientSecret),
    ...serverRuntimeSchema,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
