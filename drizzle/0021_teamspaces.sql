CREATE TABLE "teamspace" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"description" text DEFAULT '' NOT NULL,
	"access" text DEFAULT 'open' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teamspace_id_workspace_key" UNIQUE("id","workspace_id"),
	CONSTRAINT "teamspace_access_check" CHECK ("teamspace"."access" in ('default', 'open', 'closed', 'private'))
);
--> statement-breakpoint
CREATE TABLE "teamspace_member" (
	"teamspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teamspace_member_teamspace_id_user_id_pk" PRIMARY KEY("teamspace_id","user_id"),
	CONSTRAINT "teamspace_member_role_check" CHECK ("teamspace_member"."role" in ('owner', 'member'))
);
--> statement-breakpoint
ALTER TABLE "page" ADD COLUMN "teamspace_id" text;--> statement-breakpoint
ALTER TABLE "teamspace" ADD CONSTRAINT "teamspace_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamspace" ADD CONSTRAINT "teamspace_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamspace_member" ADD CONSTRAINT "teamspace_member_teamspace_id_teamspace_id_fk" FOREIGN KEY ("teamspace_id") REFERENCES "public"."teamspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamspace_member" ADD CONSTRAINT "teamspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teamspace_workspace_idx" ON "teamspace" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "teamspace_member_user_idx" ON "teamspace_member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_teamspace_fk" FOREIGN KEY ("teamspace_id","workspace_id") REFERENCES "public"."teamspace"("id","workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_teamspace_idx" ON "page" USING btree ("teamspace_id");--> statement-breakpoint
-- Every workspace gets a "General" teamspace everyone is in, owned by its owners.
INSERT INTO "teamspace" ("id", "workspace_id", "name", "access", "created_at")
SELECT gen_random_uuid()::text, w."id", 'General', 'default', w."created_at" FROM "workspace" w;--> statement-breakpoint
INSERT INTO "teamspace_member" ("teamspace_id", "user_id", "role")
SELECT t."id", wm."user_id", 'owner'
FROM "teamspace" t JOIN "workspace_member" wm ON wm."workspace_id" = t."workspace_id" AND wm."role" = 'owner';--> statement-breakpoint
-- Existing pages were open to every member, as pages of General are. A guest's private page (its
-- own "everyone: none" entry) stays outside any teamspace: private to them, as it was.
UPDATE "page" p SET "teamspace_id" = t."id"
FROM "teamspace" t
WHERE t."workspace_id" = p."workspace_id"
  AND p."parent_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "workspace_member" wm
    JOIN "page_permission" pp ON pp."page_id" = p."id" AND pp."user_id" IS NULL AND pp."level" = 'none'
    WHERE wm."workspace_id" = p."workspace_id" AND wm."user_id" = p."created_by" AND wm."role" = 'guest'
  );--> statement-breakpoint
WITH RECURSIVE tree AS (
  SELECT "id", "teamspace_id", 0 AS depth FROM "page" WHERE "parent_id" IS NULL
  UNION ALL
  SELECT c."id", tree."teamspace_id", tree.depth + 1 FROM "page" c JOIN tree ON c."parent_id" = tree."id" WHERE tree.depth < 1000
)
UPDATE "page" p SET "teamspace_id" = tree."teamspace_id"
FROM tree
WHERE p."id" = tree."id" AND p."parent_id" IS NOT NULL AND tree."teamspace_id" IS NOT NULL;--> statement-breakpoint
-- A page belongs to its parent's teamspace. Only a top-level page's teamspace is set by the app;
-- a subpage takes its parent's, whatever was written (unless the parent comes in the same statement,
-- as when a tree is copied at once: then the app writes the root's teamspace on every page).
CREATE OR REPLACE FUNCTION page_inherit_teamspace() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_teamspace text;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT teamspace_id INTO v_teamspace FROM page WHERE id = NEW.parent_id;
    IF FOUND THEN NEW.teamspace_id := v_teamspace; END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER page_inherit_teamspace BEFORE INSERT OR UPDATE OF parent_id, teamspace_id ON "page"
FOR EACH ROW EXECUTE FUNCTION page_inherit_teamspace();--> statement-breakpoint
-- When a page changes teamspace (it moved), so does everything under it, one level at a time.
CREATE OR REPLACE FUNCTION page_propagate_teamspace() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE page SET teamspace_id = NEW.teamspace_id
  WHERE parent_id = NEW.id AND teamspace_id IS DISTINCT FROM NEW.teamspace_id;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER page_propagate_teamspace AFTER UPDATE ON "page"
FOR EACH ROW WHEN (OLD.teamspace_id IS DISTINCT FROM NEW.teamspace_id)
EXECUTE FUNCTION page_propagate_teamspace();--> statement-breakpoint
-- New workspaces start with their General teamspace too (the app names it in the creator's language).
CREATE OR REPLACE FUNCTION workspace_general_teamspace() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO teamspace (id, workspace_id, name, access) VALUES (gen_random_uuid()::text, NEW.id, 'General', 'default');
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER workspace_general_teamspace AFTER INSERT ON "workspace"
FOR EACH ROW EXECUTE FUNCTION workspace_general_teamspace();--> statement-breakpoint
-- The page access rule with teamspaces. Returns 0 none, 1 view, 2 comment, 3 edit, 4 full.
-- What an owner or member gets from where the page lives, before page entries narrow or widen it:
--   - a teamspace they are in (every default teamspace, or a row in teamspace_member): full;
--   - an open teamspace they haven't joined: comment, at most;
--   - a closed or private teamspace they aren't in: nothing, and "everyone" entries don't apply;
--   - no teamspace (a private page): nothing, unless an "everyone" entry shares it with the workspace.
-- Then, as before (0003, 0013): for each principal the entry on the page or its nearest ancestor
-- applies; the user's level is the higher of the "everyone" one (capped as above) and their own.
-- Guests only get their own entries; people outside the workspace get nothing.
CREATE OR REPLACE FUNCTION page_access_level(p_user text, p_page text) RETURNS smallint
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE
  v_workspace text;
  v_teamspace text;
  v_role text;
  v_access text;
  v_default smallint := 0;
  v_cap smallint := 0;
  v_everyone smallint;
  v_own smallint;
BEGIN
  SELECT workspace_id, teamspace_id INTO v_workspace, v_teamspace FROM page WHERE id = p_page;
  IF v_workspace IS NULL THEN RETURN 0; END IF;
  SELECT role INTO v_role FROM workspace_member WHERE workspace_id = v_workspace AND user_id = p_user;
  IF v_role IS NULL THEN RETURN 0; END IF;
  IF v_role IN ('owner', 'member') THEN
    IF v_teamspace IS NULL THEN
      v_cap := 4;
    ELSE
      SELECT access INTO v_access FROM teamspace WHERE id = v_teamspace;
      IF v_access = 'default'
        OR EXISTS (SELECT 1 FROM teamspace_member WHERE teamspace_id = v_teamspace AND user_id = p_user) THEN
        v_default := 4;
        v_cap := 4;
      ELSIF v_access = 'open' THEN
        v_default := 2;
        v_cap := 2;
      END IF;
    END IF;
  END IF;
  -- Workspaces that never restrict or share a page: skip the ancestor walk.
  IF NOT EXISTS (SELECT 1 FROM page_permission WHERE workspace_id = v_workspace) THEN
    RETURN v_default;
  END IF;
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, 0 AS depth FROM page WHERE id = p_page
    UNION ALL
    SELECT p.id, p.parent_id, c.depth + 1 FROM page p JOIN chain c ON p.id = c.parent_id WHERE c.depth < 64
  )
  SELECT
    (SELECT array_position(ARRAY['none', 'view', 'comment', 'edit', 'full'], pp.level) - 1
       FROM chain c JOIN page_permission pp ON pp.page_id = c.id AND pp.user_id IS NULL
       ORDER BY c.depth LIMIT 1),
    (SELECT array_position(ARRAY['none', 'view', 'comment', 'edit', 'full'], pp.level) - 1
       FROM chain c JOIN page_permission pp ON pp.page_id = c.id AND pp.user_id = p_user
       ORDER BY c.depth LIMIT 1)
  INTO v_everyone, v_own;
  RETURN GREATEST(LEAST(COALESCE(v_everyone, v_default), v_cap), COALESCE(v_own, 0));
END
$$;
--> statement-breakpoint
-- A top-level page outside any teamspace is private: the app always gives one an "everyone" entry
-- (usually "no access") beside the people it is for. A top-level page that ends its transaction
-- without teamspace and without an "everyone" entry was made by code that doesn't place pages
-- (older code, scripts, a copy carrying only its source's named entries), so it goes to the
-- workspace's first default teamspace, where top-level pages always went before teamspaces and
-- where it gets the access it would have had then. (With an "everyone" entry, a page gives owners
-- and members the same access in a default teamspace as outside any, so nothing changes there.)
CREATE OR REPLACE FUNCTION page_home_teamspace() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE page p SET teamspace_id = (
    SELECT t.id FROM teamspace t
    WHERE t.workspace_id = p.workspace_id AND t.access = 'default' AND t.archived_at IS NULL
    ORDER BY t.created_at, t.id LIMIT 1
  )
  WHERE p.id = NEW.id AND p.parent_id IS NULL AND p.teamspace_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM page_permission pp WHERE pp.page_id = p.id AND pp.user_id IS NULL);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER page_home_teamspace AFTER INSERT ON "page"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.parent_id IS NULL AND NEW.teamspace_id IS NULL)
EXECUTE FUNCTION page_home_teamspace();
