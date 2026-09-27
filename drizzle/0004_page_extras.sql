CREATE TABLE "page_favorite" (
	"user_id" text NOT NULL,
	"page_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_favorite_user_id_page_id_pk" PRIMARY KEY("user_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "page_publication" (
	"page_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_publication_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "page_favorite" ADD CONSTRAINT "page_favorite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_favorite" ADD CONSTRAINT "page_favorite_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_publication" ADD CONSTRAINT "page_publication_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_publication" ADD CONSTRAINT "page_publication_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_favorite_page_idx" ON "page_favorite" USING btree ("page_id");