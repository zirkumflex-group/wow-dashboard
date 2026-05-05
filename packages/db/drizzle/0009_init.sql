ALTER TABLE "mythic_plus_runs" ADD COLUMN "addon_signature_state" text DEFAULT 'unsigned' NOT NULL;--> statement-breakpoint
ALTER TABLE "mythic_plus_runs" ADD COLUMN "addon_signature_install_id" text;--> statement-breakpoint
ALTER TABLE "mythic_plus_runs" ADD COLUMN "addon_signature_algorithm" text;--> statement-breakpoint
ALTER TABLE "mythic_plus_runs" ADD COLUMN "addon_signature_payload_hash" text;--> statement-breakpoint
ALTER TABLE "mythic_plus_runs" ADD COLUMN "addon_signature" text;--> statement-breakpoint
ALTER TABLE "mythic_plus_runs" ADD COLUMN "addon_signature_signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "addon_signature_state" text DEFAULT 'unsigned' NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "addon_signature_install_id" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "addon_signature_algorithm" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "addon_signature_payload_hash" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "addon_signature" text;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "addon_signature_signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mythic_plus_runs" ADD CONSTRAINT "mythic_plus_runs_addon_signature_state_check" CHECK ("mythic_plus_runs"."addon_signature_state" in ('unsigned', 'valid', 'invalid'));--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_addon_signature_state_check" CHECK ("snapshots"."addon_signature_state" in ('unsigned', 'valid', 'invalid'));