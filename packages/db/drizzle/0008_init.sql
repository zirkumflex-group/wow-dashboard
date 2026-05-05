ALTER TABLE "characters" ADD COLUMN "battle_net_verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "battle_net_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "battle_net_last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "battle_net_realm_slug" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "battle_net_level" integer;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "battle_net_verification_error" text;--> statement-breakpoint
CREATE INDEX "characters_battlenet_verification_status_idx" ON "characters" USING btree ("battle_net_verification_status");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_battlenet_verification_status_check" CHECK ("characters"."battle_net_verification_status" in ('unverified', 'verified', 'not_found', 'error'));--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_battlenet_level_check" CHECK ("characters"."battle_net_level" is null or ("characters"."battle_net_level" >= 1 and "characters"."battle_net_level" <= 100));