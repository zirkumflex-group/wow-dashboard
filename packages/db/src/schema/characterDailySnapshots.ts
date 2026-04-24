import {
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
import { type Currencies, type Stats } from "./types";

export const characterDailySnapshots = pgTable(
  "character_daily_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyConvexId: text("legacy_convex_id"),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    dayStartAt: timestamp("day_start_at", { mode: "date", withTimezone: true }).notNull(),
    lastTakenAt: timestamp("last_taken_at", { mode: "date", withTimezone: true }).notNull(),
    itemLevel: doublePrecision("item_level").notNull(),
    gold: doublePrecision("gold").notNull(),
    playtimeSeconds: integer("playtime_seconds").notNull(),
    mythicPlusScore: doublePrecision("mythic_plus_score").notNull(),
    seasonId: integer("season_id"),
    currencies: jsonb("currencies").$type<Currencies>(),
    stats: jsonb("stats").$type<Stats>(),
  },
  (table) => ({
    legacyConvexIdIdx: uniqueIndex("character_daily_snapshots_legacy_convex_id_uidx").on(
      table.legacyConvexId,
    ),
    byCharacterIdx: index("character_daily_snapshots_character_id_idx").on(table.characterId),
    byCharacterAndDayIdx: uniqueIndex(
      "character_daily_snapshots_character_id_day_start_at_uidx",
    ).on(table.characterId, table.dayStartAt),
    byCharacterSeasonAndDayIdx: index(
      "character_daily_snapshots_character_id_season_id_day_start_at_idx",
    ).on(table.characterId, table.seasonId, table.dayStartAt),
  }),
);
