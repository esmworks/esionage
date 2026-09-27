ALTER TABLE "notification" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "comment_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "comment_inbox" boolean DEFAULT true NOT NULL;