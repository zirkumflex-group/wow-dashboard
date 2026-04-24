ALTER TABLE "character_daily_snapshots" ADD COLUMN "season_id" integer;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "season_id" integer;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "currency_details" jsonb;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "equipment" jsonb;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "weekly_rewards" jsonb;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "major_factions" jsonb;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "client_info" jsonb;--> statement-breakpoint
UPDATE "snapshots"
SET "season_id" = 17
WHERE "season_id" IS NULL
  AND "taken_at" >= '2026-03-18T00:00:00Z'::timestamptz;--> statement-breakpoint
UPDATE "character_daily_snapshots"
SET "season_id" = 17
WHERE "season_id" IS NULL
  AND "day_start_at" >= '2026-03-18T00:00:00Z'::timestamptz;--> statement-breakpoint
CREATE INDEX "character_daily_snapshots_character_id_season_id_day_start_at_idx" ON "character_daily_snapshots" USING btree ("character_id","season_id","day_start_at");--> statement-breakpoint
CREATE INDEX "snapshots_character_id_season_id_taken_at_idx" ON "snapshots" USING btree ("character_id","season_id","taken_at");
