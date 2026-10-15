CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instance_id" uuid,
	"jid" text NOT NULL,
	"number" text,
	"name" text,
	"source" text DEFAULT 'synced' NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"public_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"to" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text,
	"media_url" text,
	"state" text DEFAULT 'sent' NOT NULL,
	"error_message" text,
	"provider_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"caption" text,
	"media_url" text,
	"file_name" text,
	"mime_type" text,
	"audience_mode" text DEFAULT 'all' NOT NULL,
	"status_jid_list" jsonb,
	"caption_valid" boolean DEFAULT true NOT NULL,
	"state" text DEFAULT 'published' NOT NULL,
	"provider_message_id" text,
	"provider_response" jsonb,
	"error_message" text,
	"expires_in_seconds" integer,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"name" text,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text DEFAULT 'Minha instância' NOT NULL,
	"server_url" text DEFAULT 'https://server.wame.api.br' NOT NULL,
	"api_key" text NOT NULL,
	"phone_number" text,
	"profile_name" text,
	"webhook_url" text,
	"webhook_format" text DEFAULT 'native' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"last_status" text DEFAULT 'unknown' NOT NULL,
	"last_status_detail" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_instance_id_whatsapp_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."whatsapp_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_instance_id_whatsapp_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."whatsapp_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_posts" ADD CONSTRAINT "status_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_posts" ADD CONSTRAINT "status_posts_instance_id_whatsapp_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."whatsapp_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_user_idx" ON "contacts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_jid_idx" ON "contacts" USING btree ("user_id","jid");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "files_created_idx" ON "files" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "media_assets_user_idx" ON "media_assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "media_assets_user_created_idx" ON "media_assets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "message_logs_user_idx" ON "message_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_logs_user_created_idx" ON "message_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "status_posts_user_idx" ON "status_posts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "status_posts_user_created_idx" ON "status_posts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_instances_user_idx" ON "whatsapp_instances" USING btree ("user_id");