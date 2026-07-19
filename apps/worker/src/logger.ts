import { createLogger } from "@wow-dashboard/observability";
import { env } from "@wow-dashboard/env/worker";

export const logger = createLogger("worker", env.LOG_LEVEL);
