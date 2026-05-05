ALTER TABLE "characters" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
CREATE INDEX "characters_visibility_idx" ON "characters" USING btree ("visibility");--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_visibility_check" CHECK ("characters"."visibility" in ('public', 'unlisted', 'private'));