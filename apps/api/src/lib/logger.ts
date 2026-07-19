import { createLogger } from "@wow-dashboard/observability";
import { env } from "@wow-dashboard/env/api";

export const logger = createLogger("api", env.LOG_LEVEL);
