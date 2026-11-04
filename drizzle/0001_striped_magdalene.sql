DO $$ BEGIN
  CREATE TYPE "public"."email_purpose" AS ENUM('password_reset');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ledger_entry_type" AS ENUM('topic_created', 'reply_created', 'topic_thanked', 'daily_checkin', 'admin_adjust', 'admin_deduct', 'registration_bonus');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."node_request_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."report_status" AS ENUM('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."report_target_type" AS ENUM('topic', 'reply', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "avatars" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"storage_path" varchar(256) NOT NULL,
	"original_name" varchar(255),
	"mime_type" varchar(64) NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_before" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"ref_type" varchar(32),
	"ref_id" integer,
	"idempotency_key" varchar(128),
	"actor_id" integer,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_checkins" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"checkin_date" varchar(10) NOT NULL,
	"reward" integer DEFAULT 0 NOT NULL,
	"streak" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "edit_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" integer NOT NULL,
	"editor_id" integer NOT NULL,
	"previous_title" text,
	"previous_content" text,
	"new_title" text,
	"new_content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_masked" varchar(128) NOT NULL,
	"purpose" "email_purpose" NOT NULL,
	"delivered" boolean DEFAULT false NOT NULL,
	"skip_reason" varchar(128),
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "node_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"title" varchar(128) NOT NULL,
	"description" text,
	"category_id" integer,
	"requester_id" integer NOT NULL,
	"status" "node_request_status" DEFAULT 'pending' NOT NULL,
	"handled_by" integer,
	"handled_at" timestamp with time zone,
	"approved_node_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"request_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" integer NOT NULL,
	"reporter_id" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"handled_by" integer,
	"handled_at" timestamp with time zone,
	"handle_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN IF NOT EXISTS "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN IF NOT EXISTS "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN IF NOT EXISTS "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN IF NOT EXISTS "edit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "deleted_reason" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "edit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "avatars" ADD CONSTRAINT "avatars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "daily_checkins" ADD CONSTRAINT "daily_checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "edit_history" ADD CONSTRAINT "edit_history_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "node_requests" ADD CONSTRAINT "node_requests_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "node_requests" ADD CONSTRAINT "node_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "node_requests" ADD CONSTRAINT "node_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "node_requests" ADD CONSTRAINT "node_requests_approved_node_id_nodes_id_fk" FOREIGN KEY ("approved_node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reports" ADD CONSTRAINT "reports_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avatars_user_idx" ON "avatars" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "avatars_path_uidx" ON "avatars" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_idem_uidx" ON "credit_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_checkins_user_date_uidx" ON "daily_checkins" USING btree ("user_id","checkin_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_checkins_date_idx" ON "daily_checkins" USING btree ("checkin_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edit_history_target_idx" ON "edit_history" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edit_history_editor_idx" ON "edit_history" USING btree ("editor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_logs_user_idx" ON "email_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "node_requests_status_idx" ON "node_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "node_requests_requester_idx" ON "node_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_hash_uidx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_reporter_idx" ON "reports" USING btree ("reporter_id");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "replies" ADD CONSTRAINT "replies_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "topics" ADD CONSTRAINT "topics_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "replies_topic_deleted_idx" ON "replies" USING btree ("topic_id","deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_node_deleted_idx" ON "topics" USING btree ("node_id","deleted_at","last_reply_at");