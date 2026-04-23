import "./load";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const placeholderBetterAuthSecret = "development-only-better-auth-secret-change-me";
const documentedPlaceholderBetterAuthSecret = "replace-with-32-character-secret";
const placeholderBattleNetClientId = "replace-with-battlenet-client-id";
const placeholderBattleNetClientSecret = "replace-with-battlenet-client-secret";
const runtimeNodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = runtimeNodeEnv === "production";

function requiredEnvStringInProduction(
  placeholder: string,
  minimumLength = 1,
  additionalPlaceholders: readonly string[] = [],
) {
  const schema = z.string().min(minimumLength);

  if (!isProduction) {
    return schema.default(placeholder);
  }

  const placeholders = new Set([placeholder, ...additionalPlaceholders]);
  return schema.refine((value) => !placeholders.has(value), {
    message: "Must be set to a non-placeholder value in production.",
  });
}

function envStringWithDevelopmentDefault(defaultValue: string) {
  const schema = z.string().min(1);
  if (!isProduction) {
    return schema.default(defaultValue);
  }

  return schema.refine((value) => value !== defaultValue, {
    message: "Must be set to a non-default value in production.",
  });
}

export const env = createEnv({
  server: {
    PORT: z.string().default("3000"),
    DATABASE_URL: envStringWithDevelopmentDefault(
      "postgres://wowdash:wowdash@localhost:5432/wowdash",
    ),
    REDIS_URL: envStringWithDevelopmentDefault("redis://localhost:6379"),
    SITE_URL: z.url().default("http://localhost:3001"),
    API_URL: z.url().default("http://localhost:3000/api"),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: requiredEnvStringInProduction(placeholderBetterAuthSecret, 32, [
      documentedPlaceholderBetterAuthSecret,
    ]),
    BATTLENET_CLIENT_ID: requiredEnvStringInProduction(placeholderBattleNetClientId),
    BATTLENET_CLIENT_SECRET: requiredEnvStringInProduction(placeholderBattleNetClientSecret),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("debug"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
