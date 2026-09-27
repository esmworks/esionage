CREATE TABLE "page_link" (
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_link_source_id_target_id_pk" PRIMARY KEY("source_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "page_mention" (
	"page_id" text NOT NULL,
	"mention_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_mention_page_id_mention_id_pk" PRIMARY KEY("page_id","mention_id")
);
--> statement-breakpoint
CREATE TABLE "page_reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"mention_id" text NOT NULL,
	"user_id" text NOT NULL,
	"date" text NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "mention_id" text;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "mention_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "mention_inbox" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "reminder_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "reminder_inbox" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "page_link" ADD CONSTRAINT "page_link_source_id_page_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_link" ADD CONSTRAINT "page_link_target_id_page_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_mention" ADD CONSTRAINT "page_mention_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_mention" ADD CONSTRAINT "page_mention_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_reminder" ADD CONSTRAINT "page_reminder_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_reminder" ADD CONSTRAINT "page_reminder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_link_target_idx" ON "page_link" USING btree ("target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_reminder_mention_idx" ON "page_reminder" USING btree ("page_id","mention_id");--> statement-breakpoint
CREATE INDEX "page_reminder_due_idx" ON "page_reminder" USING btree ("remind_at") WHERE "page_reminder"."notified_at" is null;