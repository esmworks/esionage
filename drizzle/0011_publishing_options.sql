ALTER TABLE "database_view" ADD COLUMN "published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "page_publication" ADD COLUMN "indexable" boolean DEFAULT false NOT NULL;