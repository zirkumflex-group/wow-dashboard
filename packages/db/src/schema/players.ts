import { sql } from "drizzle-orm";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const players = pgTable(
  "players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyConvexId: text("legacy_convex_id"),
    battlenetAccountId: text("battlenet_account_id").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    battleTag: text("battle_tag").notNull(),
    discordUserId: text("discord_user_id"),
  },
  (table) => ({
    legacyConvexIdIdx: uniqueIndex("players_legacy_convex_id_uidx").on(table.legacyConvexId),
    battlenetAccountIdIdx: uniqueIndex("players_battlenet_account_id_uidx").on(
      table.battlenetAccountId,
    ),
    userIdIdx: uniqueIndex("players_user_id_uidx")
      .on(table.userId)
      .where(sql`${table.userId} is not null`),
  }),
);
