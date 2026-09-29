CREATE TABLE "property_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"database_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"group_id" text,
	"person_property_id" text,
	"level" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_permission_principal_key" UNIQUE NULLS NOT DISTINCT("property_id","user_id","group_id","person_property_id"),
	CONSTRAINT "property_permission_principal_check" CHECK (num_nonnulls("property_permission"."user_id", "property_permission"."group_id", "property_permission"."person_property_id") <= 1),
	CONSTRAINT "property_permission_level_check" CHECK ("property_permission"."level" in ('none', 'view_property', 'view', 'edit_values', 'edit'))
);
--> statement-breakpoint
ALTER TABLE "property_permission" ADD CONSTRAINT "property_permission_property_id_database_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."database_property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_permission" ADD CONSTRAINT "property_permission_database_id_page_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_permission" ADD CONSTRAINT "property_permission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_permission" ADD CONSTRAINT "property_permission_person_property_id_database_property_id_fk" FOREIGN KEY ("person_property_id") REFERENCES "public"."database_property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_permission" ADD CONSTRAINT "property_permission_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_permission" ADD CONSTRAINT "property_permission_group_fk" FOREIGN KEY ("group_id","workspace_id") REFERENCES "public"."member_group"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_permission_database_idx" ON "property_permission" USING btree ("database_id");--> statement-breakpoint
CREATE INDEX "property_permission_user_idx" ON "property_permission" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "property_permission_group_idx" ON "property_permission" USING btree ("group_id");