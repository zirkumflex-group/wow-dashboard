import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Addon data ingest: max 10 uploads per user per minute
  addonIngest: { kind: "fixed window", rate: 10, period: MINUTE },
  // Battle.net resync: max 5 resyncs per user per minute
  battlenetSync: { kind: "fixed window", rate: 5, period: MINUTE },
});
