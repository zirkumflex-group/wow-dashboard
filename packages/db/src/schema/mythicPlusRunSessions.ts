import {
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
  text,
} from "drizzle-orm/pg-core";
import { characters } from "./characters";
import { mythicPlusRuns } from "./mythicPlusRuns";

export const mythicPlusRunSessions = pgTable(
  "mythic_plus_run_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    isPaid: boolean("is_paid").notNull().default(false),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byCharacterIdx: index("mythic_plus_run_sessions_character_id_idx").on(table.characterId),
  }),
);

export const mythicPlusRunSessionRuns = pgTable(
  "mythic_plus_run_session_runs",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => mythicPlusRunSessions.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => mythicPlusRuns.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "mythic_plus_run_session_runs_pk",
      columns: [table.sessionId, table.runId],
    }),
    byRunIdx: uniqueIndex("mythic_plus_run_session_runs_run_id_uidx").on(table.runId),
    bySessionPositionIdx: uniqueIndex("mythic_plus_run_session_runs_session_position_uidx").on(
      table.sessionId,
      table.position,
    ),
  }),
);
