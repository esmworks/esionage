CREATE TABLE "scim_group" (
	"group_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scim_group" ADD CONSTRAINT "scim_group_group_fk" FOREIGN KEY ("group_id","workspace_id") REFERENCES "public"."member_group"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scim_group_workspace_idx" ON "scim_group" USING btree ("workspace_id");