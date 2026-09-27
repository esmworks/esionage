CREATE TABLE "page_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"level" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_invitation_email_key" UNIQUE("page_id","email"),
	CONSTRAINT "page_invitation_level_check" CHECK ("page_invitation"."level" in ('view', 'edit', 'full'))
);
--> statement-breakpoint
ALTER TABLE "page_invitation" ADD CONSTRAINT "page_invitation_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_invitation" ADD CONSTRAINT "page_invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_invitation" ADD CONSTRAINT "page_invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_invitation_workspace_email_idx" ON "page_invitation" USING btree ("workspace_id","email");