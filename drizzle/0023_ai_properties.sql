CREATE TABLE "ai_property_state" (
	"row_id" text NOT NULL,
	"property_id" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"source_hash" text,
	"requested_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_property_state_row_id_property_id_pk" PRIMARY KEY("row_id","property_id")
);
--> statement-breakpoint
ALTER TABLE "ai_property_state" ADD CONSTRAINT "ai_property_state_row_id_page_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_state" ADD CONSTRAINT "ai_property_state_property_id_database_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."database_property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_state" ADD CONSTRAINT "ai_property_state_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_property_state_property_idx" ON "ai_property_state" USING btree ("property_id");