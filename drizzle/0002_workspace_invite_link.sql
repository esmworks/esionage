ALTER TABLE "workspace" ADD COLUMN "invite_link_token" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_invite_link_token_unique" UNIQUE("invite_link_token");