import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "deduplicate snapshots",
  { hourUTC: 5, minuteUTC: 0 },
  internal.snapshots.deduplicateSnapshots,
);

export default crons;
