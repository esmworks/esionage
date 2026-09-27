ALTER TABLE "page" ADD COLUMN "is_template" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "in_template" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "default_template_id" text;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_default_template_id_page_id_fk" FOREIGN KEY ("default_template_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_template_idx" ON "page" USING btree ("workspace_id","parent_id") WHERE "page"."is_template";