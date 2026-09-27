CREATE TABLE "form_publication" (
	"view_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"anonymous" boolean DEFAULT false NOT NULL,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_publication_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "form_publication" ADD CONSTRAINT "form_publication_view_id_database_view_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."database_view"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_publication" ADD CONSTRAINT "form_publication_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;