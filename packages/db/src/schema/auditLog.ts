import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyConvexId: text("legacy_convex_id"),
    userId: text("user_id"),
    event: text("event").notNull(),
    metadata: jsonb("metadata").$type<unknown>(),
    error: text("error"),
    timestamp: timestamp("timestamp", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => ({
    legacyConvexIdIdx: uniqueIndex("audit_log_legacy_convex_id_uidx").on(table.legacyConvexId),
    byUserAndTimeIdx: index("audit_log_user_id_timestamp_idx").on(table.userId, table.timestamp),
    byTimeIdx: index("audit_log_timestamp_idx").on(table.timestamp),
  }),
);
