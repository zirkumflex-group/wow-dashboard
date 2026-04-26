WITH ranked_snapshots AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "character_id", "taken_at"
      ORDER BY
        (
          CASE WHEN "playtime_this_level_seconds" IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN "owned_keystone" IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN "stats" ? 'speedPercent' THEN 2 ELSE 0 END +
          CASE WHEN "stats" ? 'leechPercent' THEN 2 ELSE 0 END +
          CASE WHEN "stats" ? 'avoidancePercent' THEN 2 ELSE 0 END
        ) DESC,
        "playtime_seconds" DESC,
        "mythic_plus_score" DESC,
        "item_level" DESC,
        "id" ASC
    ) AS "row_num"
  FROM "snapshots"
)
DELETE FROM "snapshots"
WHERE "id" IN (
  SELECT "id"
  FROM ranked_snapshots
  WHERE "row_num" > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_character_id_taken_at_uidx" ON "snapshots" USING btree ("character_id","taken_at");
