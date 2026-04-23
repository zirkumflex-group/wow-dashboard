CREATE TEMP TABLE "_character_merge_map" AS
WITH "ranked_characters" AS (
  SELECT
    "id" AS "source_id",
    first_value("id") OVER (
      PARTITION BY "player_id", "region", "realm", "name"
      ORDER BY
        COALESCE("snapshot_count", 0) DESC,
        COALESCE("mythic_plus_run_count", 0) DESC,
        COALESCE(
          NULLIF("latest_snapshot_details"->>'takenAt', '')::double precision,
          NULLIF("latest_snapshot"->>'takenAt', '')::double precision,
          0
        ) DESC,
        "id" ASC
    ) AS "survivor_id",
    count(*) OVER (PARTITION BY "player_id", "region", "realm", "name") AS "group_size"
  FROM "characters"
)
SELECT "source_id", "survivor_id"
FROM "ranked_characters"
WHERE "group_size" > 1 AND "source_id" <> "survivor_id";
--> statement-breakpoint
INSERT INTO "audit_log" ("event", "metadata", "timestamp")
SELECT
  'db.migration.merge_duplicate_character',
  jsonb_build_object(
    'sourceCharacter', to_jsonb("source_character"),
    'survivorCharacterId', "survivor_character"."id"
  ),
  now()
FROM "_character_merge_map" "merge_map"
INNER JOIN "characters" "source_character" ON "source_character"."id" = "merge_map"."source_id"
INNER JOIN "characters" "survivor_character" ON "survivor_character"."id" = "merge_map"."survivor_id";
--> statement-breakpoint
CREATE TEMP TABLE "_snapshot_rekey_duplicates" AS
WITH "rekeyed_snapshots" AS (
  SELECT
    "snapshots"."id",
    COALESCE("merge_map"."survivor_id", "snapshots"."character_id") AS "target_character_id",
    "snapshots"."taken_at",
    "snapshots"."playtime_seconds",
    "snapshots"."mythic_plus_score",
    "snapshots"."item_level",
    (
      CASE WHEN "snapshots"."playtime_this_level_seconds" IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN "snapshots"."owned_keystone" IS NOT NULL THEN 1 ELSE 0 END +
      CASE WHEN "snapshots"."stats" ? 'speedPercent' THEN 2 ELSE 0 END +
      CASE WHEN "snapshots"."stats" ? 'leechPercent' THEN 2 ELSE 0 END +
      CASE WHEN "snapshots"."stats" ? 'avoidancePercent' THEN 2 ELSE 0 END
    ) AS "completeness_score"
  FROM "snapshots"
  LEFT JOIN "_character_merge_map" "merge_map" ON "merge_map"."source_id" = "snapshots"."character_id"
  WHERE
    "snapshots"."character_id" IN (SELECT "source_id" FROM "_character_merge_map")
    OR "snapshots"."character_id" IN (SELECT "survivor_id" FROM "_character_merge_map")
),
"ranked_snapshots" AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "target_character_id", "taken_at"
      ORDER BY
        "completeness_score" DESC,
        "playtime_seconds" DESC,
        "mythic_plus_score" DESC,
        "item_level" DESC,
        "id" ASC
    ) AS "winner_id"
  FROM "rekeyed_snapshots"
)
SELECT "id" AS "loser_id", "winner_id"
FROM "ranked_snapshots"
WHERE "id" <> "winner_id";
--> statement-breakpoint
INSERT INTO "audit_log" ("event", "metadata", "timestamp")
SELECT
  'db.migration.merge_duplicate_snapshot',
  jsonb_build_object(
    'sourceSnapshot', to_jsonb("source_snapshot"),
    'survivorSnapshotId', "duplicates"."winner_id"
  ),
  now()
FROM "_snapshot_rekey_duplicates" "duplicates"
INNER JOIN "snapshots" "source_snapshot" ON "source_snapshot"."id" = "duplicates"."loser_id";
--> statement-breakpoint
DELETE FROM "snapshots"
WHERE "id" IN (SELECT "loser_id" FROM "_snapshot_rekey_duplicates");
--> statement-breakpoint
UPDATE "snapshots" "snapshot"
SET "character_id" = "merge_map"."survivor_id"
FROM "_character_merge_map" "merge_map"
WHERE "snapshot"."character_id" = "merge_map"."source_id";
--> statement-breakpoint
CREATE TEMP TABLE "_daily_snapshot_rekey_duplicates" AS
WITH "rekeyed_daily_snapshots" AS (
  SELECT
    "daily_snapshots"."id",
    COALESCE("merge_map"."survivor_id", "daily_snapshots"."character_id") AS "target_character_id",
    "daily_snapshots"."day_start_at",
    "daily_snapshots"."last_taken_at"
  FROM "character_daily_snapshots" "daily_snapshots"
  LEFT JOIN "_character_merge_map" "merge_map" ON "merge_map"."source_id" = "daily_snapshots"."character_id"
  WHERE
    "daily_snapshots"."character_id" IN (SELECT "source_id" FROM "_character_merge_map")
    OR "daily_snapshots"."character_id" IN (SELECT "survivor_id" FROM "_character_merge_map")
),
"ranked_daily_snapshots" AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "target_character_id", "day_start_at"
      ORDER BY "last_taken_at" DESC, "id" ASC
    ) AS "winner_id"
  FROM "rekeyed_daily_snapshots"
)
SELECT "id" AS "loser_id", "winner_id"
FROM "ranked_daily_snapshots"
WHERE "id" <> "winner_id";
--> statement-breakpoint
INSERT INTO "audit_log" ("event", "metadata", "timestamp")
SELECT
  'db.migration.merge_duplicate_daily_snapshot',
  jsonb_build_object(
    'sourceDailySnapshot', to_jsonb("source_daily_snapshot"),
    'survivorDailySnapshotId', "duplicates"."winner_id"
  ),
  now()
FROM "_daily_snapshot_rekey_duplicates" "duplicates"
INNER JOIN "character_daily_snapshots" "source_daily_snapshot" ON "source_daily_snapshot"."id" = "duplicates"."loser_id";
--> statement-breakpoint
DELETE FROM "character_daily_snapshots"
WHERE "id" IN (SELECT "loser_id" FROM "_daily_snapshot_rekey_duplicates");
--> statement-breakpoint
UPDATE "character_daily_snapshots" "daily_snapshot"
SET "character_id" = "merge_map"."survivor_id"
FROM "_character_merge_map" "merge_map"
WHERE "daily_snapshot"."character_id" = "merge_map"."source_id";
--> statement-breakpoint
CREATE TEMP TABLE "_mythic_plus_run_rekey_duplicate_candidates" AS
WITH "rekeyed_runs" AS (
  SELECT
    "runs"."id",
    COALESCE("merge_map"."survivor_id", "runs"."character_id") AS "target_character_id",
    "runs"."fingerprint",
    "runs"."attempt_id",
    "runs"."canonical_key",
    "runs"."observed_at"
  FROM "mythic_plus_runs" "runs"
  LEFT JOIN "_character_merge_map" "merge_map" ON "merge_map"."source_id" = "runs"."character_id"
  WHERE
    "runs"."character_id" IN (SELECT "source_id" FROM "_character_merge_map")
    OR "runs"."character_id" IN (SELECT "survivor_id" FROM "_character_merge_map")
),
"fingerprint_duplicates" AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "target_character_id", "fingerprint"
      ORDER BY "observed_at" DESC, "id" ASC
    ) AS "winner_id",
    1 AS "priority",
    'fingerprint' AS "identity_type"
  FROM "rekeyed_runs"
),
"attempt_duplicates" AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "target_character_id", "attempt_id"
      ORDER BY "observed_at" DESC, "id" ASC
    ) AS "winner_id",
    2 AS "priority",
    'attempt_id' AS "identity_type"
  FROM "rekeyed_runs"
  WHERE "attempt_id" IS NOT NULL
),
"canonical_duplicates" AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "target_character_id", "canonical_key"
      ORDER BY "observed_at" DESC, "id" ASC
    ) AS "winner_id",
    3 AS "priority",
    'canonical_key' AS "identity_type"
  FROM "rekeyed_runs"
  WHERE "canonical_key" IS NOT NULL
)
SELECT "id" AS "loser_id", "winner_id", "priority", "identity_type"
FROM "fingerprint_duplicates"
WHERE "id" <> "winner_id"
UNION ALL
SELECT "id" AS "loser_id", "winner_id", "priority", "identity_type"
FROM "attempt_duplicates"
WHERE "id" <> "winner_id"
UNION ALL
SELECT "id" AS "loser_id", "winner_id", "priority", "identity_type"
FROM "canonical_duplicates"
WHERE "id" <> "winner_id";
--> statement-breakpoint
CREATE TEMP TABLE "_mythic_plus_run_rekey_duplicates" AS
SELECT DISTINCT ON ("loser_id")
  "loser_id",
  "winner_id",
  "identity_type"
FROM "_mythic_plus_run_rekey_duplicate_candidates"
ORDER BY "loser_id", "priority", "winner_id";
--> statement-breakpoint
INSERT INTO "audit_log" ("event", "metadata", "timestamp")
SELECT
  'db.migration.merge_duplicate_mythic_plus_run',
  jsonb_build_object(
    'sourceMythicPlusRun', to_jsonb("source_run"),
    'survivorMythicPlusRunId', "duplicates"."winner_id",
    'matchedBy', "duplicates"."identity_type"
  ),
  now()
FROM "_mythic_plus_run_rekey_duplicates" "duplicates"
INNER JOIN "mythic_plus_runs" "source_run" ON "source_run"."id" = "duplicates"."loser_id";
--> statement-breakpoint
DELETE FROM "mythic_plus_runs"
WHERE "id" IN (SELECT "loser_id" FROM "_mythic_plus_run_rekey_duplicates");
--> statement-breakpoint
UPDATE "mythic_plus_runs" "run"
SET "character_id" = "merge_map"."survivor_id"
FROM "_character_merge_map" "merge_map"
WHERE "run"."character_id" = "merge_map"."source_id";
--> statement-breakpoint
WITH "affected_survivors" AS (
  SELECT DISTINCT "survivor_id" AS "character_id" FROM "_character_merge_map"
),
"snapshot_stats" AS (
  SELECT
    "affected_survivors"."character_id",
    min("snapshots"."taken_at") AS "first_snapshot_at",
    count("snapshots"."id")::integer AS "snapshot_count"
  FROM "affected_survivors"
  LEFT JOIN "snapshots" ON "snapshots"."character_id" = "affected_survivors"."character_id"
  GROUP BY "affected_survivors"."character_id"
)
UPDATE "characters" "character"
SET
  "latest_snapshot" = NULL,
  "latest_snapshot_details" = NULL,
  "mythic_plus_summary" = NULL,
  "mythic_plus_recent_runs_preview" = NULL,
  "mythic_plus_run_count" = NULL,
  "first_snapshot_at" = "snapshot_stats"."first_snapshot_at",
  "snapshot_count" = "snapshot_stats"."snapshot_count"
FROM "snapshot_stats"
WHERE "character"."id" = "snapshot_stats"."character_id";
--> statement-breakpoint
DELETE FROM "characters"
WHERE "id" IN (SELECT "source_id" FROM "_character_merge_map");
--> statement-breakpoint
INSERT INTO "audit_log" ("event", "metadata", "timestamp")
SELECT
  'db.migration.clear_orphan_player_user_id',
  jsonb_build_object('player', to_jsonb("players")),
  now()
FROM "players"
WHERE "user_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE "user"."id" = "players"."user_id");
--> statement-breakpoint
UPDATE "players"
SET "user_id" = NULL
WHERE "user_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE "user"."id" = "players"."user_id");
--> statement-breakpoint
DROP INDEX "character_daily_snapshots_character_id_day_start_at_idx";
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "character_daily_snapshots_character_id_day_start_at_uidx" ON "character_daily_snapshots" USING btree ("character_id","day_start_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "characters_player_id_region_realm_name_uidx" ON "characters" USING btree ("player_id","region","realm","name");

