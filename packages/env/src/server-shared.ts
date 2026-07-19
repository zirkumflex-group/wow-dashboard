import { z } from "zod";

const runtimeNodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = runtimeNodeEnv === "production";

export function requiredEnvStringInProduction(
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

export function envStringWithDevelopmentDefault(defaultValue: string) {
  const schema = z.string().min(1);
  if (!isProduction) {
    return schema.default(defaultValue);
  }

  return schema.refine((value) => value !== defaultValue, {
    message: "Must be set to a non-default value in production.",
  });
}

export const serverRuntimeSchema = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
};
