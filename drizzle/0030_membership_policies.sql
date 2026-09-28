CREATE TABLE "workspace_join_request" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"requested_by" text,
	"source" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"locale" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_join_request_kind_check" CHECK ("workspace_join_request"."kind" in ('join', 'invite')),
	CONSTRAINT "workspace_join_request_status_check" CHECK ("workspace_join_request"."status" in ('pending', 'accepted', 'declined')),
	CONSTRAINT "workspace_join_request_user_check" CHECK ("workspace_join_request"."kind" <> 'join' or "workspace_join_request"."user_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "page_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "join_request_id" text;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "join_request_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "join_request_inbox" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_join_request" ADD CONSTRAINT "workspace_join_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_join_request" ADD CONSTRAINT "workspace_join_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_join_request" ADD CONSTRAINT "workspace_join_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_join_request" ADD CONSTRAINT "workspace_join_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_join_request_user_idx" ON "workspace_join_request" USING btree ("workspace_id","user_id") WHERE "workspace_join_request"."kind" = 'join';--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_join_request_invite_idx" ON "workspace_join_request" USING btree ("workspace_id","email") WHERE "workspace_join_request"."kind" = 'invite';--> statement-breakpoint
CREATE INDEX "workspace_join_request_status_idx" ON "workspace_join_request" USING btree ("workspace_id","status");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_join_request_id_workspace_join_request_id_fk" FOREIGN KEY ("join_request_id") REFERENCES "public"."workspace_join_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_subject_check" CHECK ("notification"."kind" = 'join_request' or "notification"."page_id" is not null);