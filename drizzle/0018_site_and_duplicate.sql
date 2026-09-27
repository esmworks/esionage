CREATE TABLE "workspace_site" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"home_page_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_site_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "page_publication" ADD COLUMN "in_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "page_publication" ADD COLUMN "allow_duplicate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_site" ADD CONSTRAINT "workspace_site_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_site" ADD CONSTRAINT "workspace_site_home_page_id_page_id_fk" FOREIGN KEY ("home_page_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE no action;