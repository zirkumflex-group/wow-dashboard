import { account, session, user, verification } from "./auth";
import { auditLog } from "./auditLog";
import { characterDailySnapshots } from "./characterDailySnapshots";
import { characters } from "./characters";
import { mythicPlusRuns } from "./mythicPlusRuns";
import { players } from "./players";
import { snapshots } from "./snapshots";

export * from "./auth";
export * from "./auditLog";
export * from "./characterDailySnapshots";
export * from "./characters";
export * from "./mythicPlusRuns";
export * from "./players";
export * from "./snapshots";
export * from "./types";

export const schema = {
  user,
  session,
  account,
  verification,
  players,
  characters,
  snapshots,
  characterDailySnapshots,
  mythicPlusRuns,
  auditLog,
};
