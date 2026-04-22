import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { characters } from "./characters";
import { sqlTextEnum } from "./sql";
import {
  mythicPlusAbandonReasons,
  mythicPlusRunStatuses,
  type MythicPlusAbandonReason,
  type MythicPlusRunMember,
  type MythicPlusRunStatus,
} from "./types";

export const mythicPlusRuns = pgTable(
  "mythic_plus_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyConvexId: text("legacy_convex_id"),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    attemptId: text("attempt_id"),
    canonicalKey: text("canonical_key"),
    observedAt: timestamp("observed_at", { mode: "date", withTimezone: true }).notNull(),
    seasonId: integer("season_id"),
    mapChallengeModeId: integer("map_challenge_mode_id"),
    mapName: text("map_name"),
    level: integer("level"),
    status: text("status").$type<MythicPlusRunStatus>(),
    completed: boolean("completed"),
    completedInTime: boolean("completed_in_time"),
    durationMs: integer("duration_ms"),
    runScore: doublePrecision("run_score"),
    startDate: timestamp("start_date", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    endedAt: timestamp("ended_at", { mode: "date", withTimezone: true }),
    abandonedAt: timestamp("abandoned_at", { mode: "date", withTimezone: true }),
    abandonReason: text("abandon_reason").$type<MythicPlusAbandonReason>(),
    thisWeek: boolean("this_week"),
    members: jsonb("members").$type<MythicPlusRunMember[]>(),
  },
  (table) => ({
    legacyConvexIdIdx: uniqueIndex("mythic_plus_runs_legacy_convex_id_uidx").on(
      table.legacyConvexId,
    ),
    byCharacterIdx: index("mythic_plus_runs_character_id_idx").on(table.characterId),
    byCharacterAndObservedAtIdx: index("mythic_plus_runs_character_id_observed_at_idx").on(
      table.characterId,
      table.observedAt,
    ),
    byCharacterAndAttemptIdIdx: uniqueIndex("mythic_plus_runs_character_id_attempt_id_uidx")
      .on(table.characterId, table.attemptId)
      .where(sql`${table.attemptId} is not null`),
    byCharacterAndCanonicalKeyIdx: uniqueIndex(
      "mythic_plus_runs_character_id_canonical_key_uidx",
    )
      .on(table.characterId, table.canonicalKey)
      .where(sql`${table.canonicalKey} is not null`),
    byCharacterAndFingerprintIdx: uniqueIndex("mythic_plus_runs_character_id_fingerprint_uidx").on(
      table.characterId,
      table.fingerprint,
    ),
    statusCheck: check(
      "mythic_plus_runs_status_check",
      sql`${table.status} is null or ${table.status} in (${sqlTextEnum(mythicPlusRunStatuses)})`,
    ),
    abandonReasonCheck: check(
      "mythic_plus_runs_abandon_reason_check",
      sql`${table.abandonReason} is null or ${table.abandonReason} in (${sqlTextEnum(mythicPlusAbandonReasons)})`,
    ),
  }),
);
