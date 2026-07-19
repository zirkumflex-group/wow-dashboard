import "./load";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import {
  envStringWithDevelopmentDefault,
  requiredEnvStringInProduction,
  serverRuntimeSchema,
} from "./server-shared";

const placeholderBattleNetClientId = "replace-with-battlenet-client-id";
const placeholderBattleNetClientSecret = "replace-with-battlenet-client-secret";

export const env = createEnv({
  server: {
    DATABASE_URL: envStringWithDevelopmentDefault(
      "postgres://wowdash:wowdash@localhost:5432/wowdash",
    ),
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
    BATTLENET_CLIENT_ID: requiredEnvStringInProduction(placeholderBattleNetClientId),
    BATTLENET_CLIENT_SECRET: requiredEnvStringInProduction(placeholderBattleNetClientSecret),
    ...serverRuntimeSchema,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
