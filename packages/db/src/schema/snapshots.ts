import { sql } from "drizzle-orm";
import {
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
  snapshotRoles,
  snapshotSpecs,
  type Currencies,
  type OwnedKeystone,
  type SnapshotRole,
  type SnapshotSpec,
  type Stats,
} from "./types";

export const snapshots = pgTable(
  "snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyConvexId: text("legacy_convex_id"),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    takenAt: timestamp("taken_at", { mode: "date", withTimezone: true }).notNull(),
    level: integer("level").notNull(),
    spec: text("spec").$type<SnapshotSpec>().notNull(),
    role: text("role").$type<SnapshotRole>().notNull(),
    itemLevel: doublePrecision("item_level").notNull(),
    gold: doublePrecision("gold").notNull(),
    playtimeSeconds: integer("playtime_seconds").notNull(),
    playtimeThisLevelSeconds: integer("playtime_this_level_seconds"),
    mythicPlusScore: doublePrecision("mythic_plus_score").notNull(),
    ownedKeystone: jsonb("owned_keystone").$type<OwnedKeystone>(),
    currencies: jsonb("currencies").$type<Currencies>().notNull(),
    stats: jsonb("stats").$type<Stats>().notNull(),
  },
  (table) => ({
    legacyConvexIdIdx: uniqueIndex("snapshots_legacy_convex_id_uidx").on(table.legacyConvexId),
    byCharacterIdx: index("snapshots_character_id_idx").on(table.characterId),
    byCharacterAndTimeIdx: index("snapshots_character_id_taken_at_idx").on(
      table.characterId,
      table.takenAt,
    ),
    specCheck: check(
      "snapshots_spec_check",
      sql`${table.spec} in (${sqlTextEnum(snapshotSpecs)})`,
    ),
    roleCheck: check(
      "snapshots_role_check",
      sql`${table.role} in (${sqlTextEnum(snapshotRoles)})`,
    ),
  }),
);
