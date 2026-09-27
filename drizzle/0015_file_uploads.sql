CREATE TABLE "file" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"page_id" text,
	"storage_key" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"uploaded_by" text,
	"referenced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_reference" (
	"file_id" text NOT NULL,
	"page_id" text NOT NULL,
	CONSTRAINT "file_reference_file_id_page_id_pk" PRIMARY KEY("file_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_reference" ADD CONSTRAINT "file_reference_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_reference" ADD CONSTRAINT "file_reference_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_workspace_idx" ON "file" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "file_page_idx" ON "file" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "file_reference_page_idx" ON "file_reference" USING btree ("page_id");--> statement-breakpoint
-- Which pages show which files: the file URLs (/api/files/<id>) in a page's derived Markdown, for
-- files of the page's own workspace. Every way a body is written ends up in content_markdown
-- (editor saves, MCP writes, duplicates and templates copy it, history restores), so a trigger keeps
-- this current for all of them. Also stamps the first time a file is used (see file.referenced_at).
-- Keep the pattern in sync with fileIdsIn in src/lib/files.ts.
CREATE FUNCTION sync_file_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids text[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.content_markdown IS NOT DISTINCT FROM OLD.content_markdown THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(DISTINCT m[1]), '{}') INTO ids
  FROM regexp_matches(NEW.content_markdown, '/api/files/([A-Za-z0-9_-]{24})(?![A-Za-z0-9_-])', 'g') AS m;
  DELETE FROM file_reference WHERE page_id = NEW.id AND NOT (file_id = ANY (ids));
  IF cardinality(ids) > 0 THEN
    INSERT INTO file_reference (file_id, page_id)
    SELECT f.id, NEW.id FROM file f WHERE f.id = ANY (ids) AND f.workspace_id = NEW.workspace_id
    ON CONFLICT DO NOTHING;
    UPDATE file SET referenced_at = now()
    WHERE id = ANY (ids) AND workspace_id = NEW.workspace_id AND referenced_at IS NULL;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER page_file_references AFTER INSERT OR UPDATE OF content_markdown ON page
FOR EACH ROW EXECUTE FUNCTION sync_file_references();
--> statement-breakpoint
-- Apps registered before files:write existed may ask for it too; users still approve it on the consent screen.
UPDATE "oauth_client" SET "scopes" = array_append("scopes", 'files:write') WHERE 'pages:write' = ANY("scopes") AND NOT ('files:write' = ANY("scopes"));
