ALTER TABLE "notification" ADD COLUMN "email_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "email_locale" text;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "assignment_inbox" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "share_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "share_inbox" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_email_due_idx" ON "notification" USING btree ("email_due_at");--> statement-breakpoint
-- Apps registered before notifications:read existed may ask for it too; users still approve it on the consent screen.
UPDATE "oauth_client" SET "scopes" = array_append("scopes", 'notifications:read') WHERE 'pages:read' = ANY("scopes") AND NOT ('notifications:read' = ANY("scopes"));
