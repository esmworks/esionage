-- Files properties: a database row shows the files its property values hold, like a body shows
-- the files its Markdown links to, so the same trigger keeps file_reference current for both.
-- Every way row values are written (the app, MCP, forms, CSV imports, duplicates and templates,
-- two-way relation syncs) ends up in page.properties, which is why this lives in the trigger rather
-- than in the code that writes them.
--
-- Only the `url` of entries of list values counts (`$.*[*].url`, the shape of a files value:
-- [{url, name, type}]), and only an exact file path: text that merely contains a path (a text or
-- URL property) references nothing. Keep in sync with fileIdsInProperties in src/lib/files.ts.
CREATE OR REPLACE FUNCTION sync_file_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids text[];
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.content_markdown IS NOT DISTINCT FROM OLD.content_markdown
    AND NEW.properties IS NOT DISTINCT FROM OLD.properties THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(array_agg(DISTINCT found.id), '{}') INTO ids
  FROM (
    SELECT m[1] AS id
    FROM regexp_matches(NEW.content_markdown, '/api/files/([A-Za-z0-9_-]{24})(?![A-Za-z0-9_-])', 'g') AS m
    UNION
    SELECT substring(u #>> '{}' FROM '^/api/files/([A-Za-z0-9_-]{24})$')
    FROM jsonb_path_query(NEW.properties, 'lax $.*[*].url') AS u
  ) AS found
  WHERE found.id IS NOT NULL;
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
DROP TRIGGER IF EXISTS page_file_references ON page;
--> statement-breakpoint
CREATE TRIGGER page_file_references AFTER INSERT OR UPDATE OF content_markdown, properties ON page
FOR EACH ROW EXECUTE FUNCTION sync_file_references();
