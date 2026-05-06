CREATE TABLE "mythic_plus_run_session_runs" (
	"session_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "mythic_plus_run_session_runs_pk" PRIMARY KEY("session_id","run_id")
);
--> statement-breakpoint
CREATE TABLE "mythic_plus_run_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"is_paid" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mythic_plus_run_session_runs" ADD CONSTRAINT "mythic_plus_run_session_runs_session_id_mythic_plus_run_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."mythic_plus_run_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mythic_plus_run_session_runs" ADD CONSTRAINT "mythic_plus_run_session_runs_run_id_mythic_plus_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."mythic_plus_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mythic_plus_run_sessions" ADD CONSTRAINT "mythic_plus_run_sessions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mythic_plus_run_session_runs_run_id_uidx" ON "mythic_plus_run_session_runs" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mythic_plus_run_session_runs_session_position_uidx" ON "mythic_plus_run_session_runs" USING btree ("session_id","position");--> statement-breakpoint
CREATE INDEX "mythic_plus_run_sessions_character_id_idx" ON "mythic_plus_run_sessions" USING btree ("character_id");