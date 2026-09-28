CREATE TABLE "access_request" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"message" text,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_request_requester_key" UNIQUE("page_id","requester_id")
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "access_request_id" text;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "access_request_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "access_request_inbox" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_request_workspace_idx" ON "access_request" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "access_request_requester_idx" ON "access_request" USING btree ("requester_id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_access_request_id_access_request_id_fk" FOREIGN KEY ("access_request_id") REFERENCES "public"."access_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_access_request_idx" ON "notification" USING btree ("access_request_id");