CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_convex_id" text,
	"user_id" text,
	"event" text NOT NULL,
	"metadata" jsonb,
	"error" text,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "character_daily_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_convex_id" text,
	"character_id" uuid NOT NULL,
	"day_start_at" timestamp with time zone NOT NULL,
	"last_taken_at" timestamp with time zone NOT NULL,
	"item_level" double precision NOT NULL,
	"gold" double precision NOT NULL,
	"playtime_seconds" integer NOT NULL,
	"mythic_plus_score" double precision NOT NULL,
	"currencies" jsonb,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_convex_id" text,
	"player_id" uuid NOT NULL,
	"name" text NOT NULL,
	"realm" text NOT NULL,
	"region" text NOT NULL,
	"class" text NOT NULL,
	"race" text NOT NULL,
	"faction" text NOT NULL,
	"is_booster" boolean,
	"non_tradeable_slots" text[],
	"latest_snapshot" jsonb,
	"latest_snapshot_details" jsonb,
	"mythic_plus_summary" jsonb,
	"mythic_plus_recent_runs_preview" jsonb,
	"mythic_plus_run_count" integer,
	"first_snapshot_at" timestamp with time zone,
	"snapshot_count" integer,
	CONSTRAINT "characters_region_check" CHECK ("characters"."region" in ('us', 'eu', 'kr', 'tw')),
	CONSTRAINT "characters_faction_check" CHECK ("characters"."faction" in ('alliance', 'horde')),
	CONSTRAINT "characters_non_tradeable_slots_check" CHECK ("characters"."non_tradeable_slots" is null or "characters"."non_tradeable_slots" <@ ARRAY['head', 'shoulders', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'neck', 'back', 'finger1', 'finger2', 'trinket1', 'trinket2', 'mainHand', 'offHand']::text[])
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mythic_plus_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_convex_id" text,
	"character_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"attempt_id" text,
	"canonical_key" text,
	"observed_at" timestamp with time zone NOT NULL,
	"season_id" integer,
	"map_challenge_mode_id" integer,
	"map_name" text,
	"level" integer,
	"status" text,
	"completed" boolean,
	"completed_in_time" boolean,
	"duration_ms" integer,
	"run_score" double precision,
	"start_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"abandon_reason" text,
	"this_week" boolean,
	"members" jsonb,
	CONSTRAINT "mythic_plus_runs_status_check" CHECK ("mythic_plus_runs"."status" is null or "mythic_plus_runs"."status" in ('active', 'completed', 'abandoned')),
	CONSTRAINT "mythic_plus_runs_abandon_reason_check" CHECK ("mythic_plus_runs"."abandon_reason" is null or "mythic_plus_runs"."abandon_reason" in ('challenge_mode_reset', 'left_instance', 'leaver_timer', 'history_incomplete', 'stale_recovery', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_convex_id" text,
	"battlenet_account_id" text NOT NULL,
	"user_id" text,
	"battle_tag" text NOT NULL,
	"discord_user_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_convex_id" text,
	"character_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"level" integer NOT NULL,
	"spec" text NOT NULL,
	"role" text NOT NULL,
	"item_level" double precision NOT NULL,
	"gold" double precision NOT NULL,
	"playtime_seconds" integer NOT NULL,
	"playtime_this_level_seconds" integer,
	"mythic_plus_score" double precision NOT NULL,
	"owned_keystone" jsonb,
	"currencies" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	CONSTRAINT "snapshots_spec_check" CHECK ("snapshots"."spec" in ('Blood', 'Frost', 'Unholy', 'Havoc', 'Vengeance', 'Devourer', 'Balance', 'Feral', 'Guardian', 'Restoration', 'Augmentation', 'Devastation', 'Preservation', 'Beast Mastery', 'Marksmanship', 'Survival', 'Arcane', 'Fire', 'Brewmaster', 'Mistweaver', 'Windwalker', 'Holy', 'Protection', 'Retribution', 'Discipline', 'Shadow', 'Assassination', 'Outlaw', 'Subtlety', 'Elemental', 'Enhancement', 'Affliction', 'Demonology', 'Destruction', 'Arms', 'Fury')),
	CONSTRAINT "snapshots_role_check" CHECK ("snapshots"."role" in ('tank', 'healer', 'dps'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "character_daily_snapshots" ADD CONSTRAINT "character_daily_snapshots_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "characters" ADD CONSTRAINT "characters_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mythic_plus_runs" ADD CONSTRAINT "mythic_plus_runs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_log_legacy_convex_id_uidx" ON "audit_log" USING btree ("legacy_convex_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_user_id_timestamp_idx" ON "audit_log" USING btree ("user_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_timestamp_idx" ON "audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "character_daily_snapshots_legacy_convex_id_uidx" ON "character_daily_snapshots" USING btree ("legacy_convex_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_daily_snapshots_character_id_idx" ON "character_daily_snapshots" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "character_daily_snapshots_character_id_day_start_at_idx" ON "character_daily_snapshots" USING btree ("character_id","day_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "characters_legacy_convex_id_uidx" ON "characters" USING btree ("legacy_convex_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_player_id_idx" ON "characters" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_player_id_realm_idx" ON "characters" USING btree ("player_id","realm");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_is_booster_idx" ON "characters" USING btree ("is_booster");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mythic_plus_runs_legacy_convex_id_uidx" ON "mythic_plus_runs" USING btree ("legacy_convex_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mythic_plus_runs_character_id_idx" ON "mythic_plus_runs" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mythic_plus_runs_character_id_observed_at_idx" ON "mythic_plus_runs" USING btree ("character_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mythic_plus_runs_character_id_attempt_id_uidx" ON "mythic_plus_runs" USING btree ("character_id","attempt_id") WHERE "mythic_plus_runs"."attempt_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mythic_plus_runs_character_id_canonical_key_uidx" ON "mythic_plus_runs" USING btree ("character_id","canonical_key") WHERE "mythic_plus_runs"."canonical_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mythic_plus_runs_character_id_fingerprint_uidx" ON "mythic_plus_runs" USING btree ("character_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "players_legacy_convex_id_uidx" ON "players" USING btree ("legacy_convex_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "players_battlenet_account_id_uidx" ON "players" USING btree ("battlenet_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "players_user_id_uidx" ON "players" USING btree ("user_id") WHERE "players"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "snapshots_legacy_convex_id_uidx" ON "snapshots" USING btree ("legacy_convex_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_character_id_idx" ON "snapshots" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshots_character_id_taken_at_idx" ON "snapshots" USING btree ("character_id","taken_at");
