CREATE TABLE "assignment_email" (
	"row_id" text NOT NULL,
	"property_id" text NOT NULL,
	"user_id" text NOT NULL,
	"actor_id" text,
	"locale" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assignment_email_row_id_property_id_user_id_pk" PRIMARY KEY("row_id","property_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"assignment_emails" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_email" ADD CONSTRAINT "assignment_email_row_id_page_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_email" ADD CONSTRAINT "assignment_email_property_id_database_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."database_property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_email" ADD CONSTRAINT "assignment_email_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_email" ADD CONSTRAINT "assignment_email_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_email_due_idx" ON "assignment_email" USING btree ("due_at");