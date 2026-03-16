CREATE TABLE "monthly_sheets" (
	"user_id" text NOT NULL,
	"month_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "monthly_sheets_user_id_month_key_pk" PRIMARY KEY("user_id","month_key")
);
--> statement-breakpoint
CREATE TABLE "sheet_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"month_key" text NOT NULL,
	"entry_date" text NOT NULL,
	"project" text NOT NULL,
	"description" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"generation_key" text NOT NULL,
	"sync_key" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_configs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"repos_json" text NOT NULL,
	"include_saturday" boolean DEFAULT false NOT NULL,
	"include_sunday" boolean DEFAULT false NOT NULL,
	"telegram_reminder_enabled" boolean DEFAULT false NOT NULL,
	"first_block_start" text DEFAULT '09:00' NOT NULL,
	"first_block_end" text DEFAULT '13:00' NOT NULL,
	"second_block_start" text DEFAULT '14:00' NOT NULL,
	"second_block_end" text DEFAULT '18:00' NOT NULL,
	"initial_month" text NOT NULL,
	"bootstrap_start_date" text,
	"bootstrap_end_date" text,
	"last_successful_sync_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"github_pat" text,
	"github_access_token" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"run_date" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"message" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_sheet_entries_user_month" ON "sheet_entries" USING btree ("user_id","month_key","entry_date");--> statement-breakpoint
CREATE INDEX "idx_sheet_entries_user_date" ON "sheet_entries" USING btree ("user_id","entry_date");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_user_created" ON "sync_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_user_date" ON "sync_runs" USING btree ("user_id","run_date");