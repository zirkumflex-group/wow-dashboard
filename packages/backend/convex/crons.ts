import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "deduplicate snapshots",
  { hourUTC: 5, minuteUTC: 0 },
  internal.snapshots.deduplicateSnapshots,
);

// Clean up expired one-time login codes every hour.
crons.cron(
  "cleanup expired login codes",
  "0 * * * *",
  internal.loginCodes.cleanupExpiredCodes,
  {},
);

export default crons;
