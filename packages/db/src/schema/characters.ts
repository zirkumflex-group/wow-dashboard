import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { players } from "./players";
import { sqlTextArray, sqlTextEnum } from "./sql";
import {
  characterFactions,
  characterRegions,
  nonTradeableSlots,
  type CharacterFaction,
  type CharacterRegion,
  type LatestSnapshotDetails,
  type LatestSnapshotSummary,
  type MythicPlusRecentRunPreview,
  type MythicPlusSummary,
  type NonTradeableSlot,
} from "./types";

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyConvexId: text("legacy_convex_id"),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    realm: text("realm").notNull(),
    region: text("region").$type<CharacterRegion>().notNull(),
    class: text("class").notNull(),
    race: text("race").notNull(),
    faction: text("faction").$type<CharacterFaction>().notNull(),
    isBooster: boolean("is_booster"),
    nonTradeableSlots: text("non_tradeable_slots").array().$type<NonTradeableSlot[]>(),
    latestSnapshot: jsonb("latest_snapshot").$type<LatestSnapshotSummary>(),
    latestSnapshotDetails: jsonb("latest_snapshot_details").$type<LatestSnapshotDetails>(),
    mythicPlusSummary: jsonb("mythic_plus_summary").$type<MythicPlusSummary>(),
    mythicPlusRecentRunsPreview: jsonb("mythic_plus_recent_runs_preview").$type<
      MythicPlusRecentRunPreview[]
    >(),
    mythicPlusRunCount: integer("mythic_plus_run_count"),
    firstSnapshotAt: timestamp("first_snapshot_at", { mode: "date", withTimezone: true }),
    snapshotCount: integer("snapshot_count"),
  },
  (table) => ({
    legacyConvexIdIdx: uniqueIndex("characters_legacy_convex_id_uidx").on(table.legacyConvexId),
    naturalKeyIdx: uniqueIndex("characters_player_id_region_realm_name_uidx").on(
      table.playerId,
      table.region,
      table.realm,
      table.name,
    ),
    byPlayerIdx: index("characters_player_id_idx").on(table.playerId),
    byPlayerAndRealmIdx: index("characters_player_id_realm_idx").on(table.playerId, table.realm),
    byBoosterIdx: index("characters_is_booster_idx").on(table.isBooster),
    regionCheck: check(
      "characters_region_check",
      sql`${table.region} in (${sqlTextEnum(characterRegions)})`,
    ),
    factionCheck: check(
      "characters_faction_check",
      sql`${table.faction} in (${sqlTextEnum(characterFactions)})`,
    ),
    nonTradeableSlotsCheck: check(
      "characters_non_tradeable_slots_check",
      sql`${table.nonTradeableSlots} is null or ${table.nonTradeableSlots} <@ ${sqlTextArray(nonTradeableSlots)}`,
    ),
  }),
);
