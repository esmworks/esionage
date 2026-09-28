CREATE TABLE "member_group" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_group_id_workspace_key" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "member_group_member" (
	"group_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_group_member_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "page_group_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"group_id" text NOT NULL,
	"level" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_group_permission_key" UNIQUE("page_id","group_id"),
	CONSTRAINT "page_group_permission_level_check" CHECK ("page_group_permission"."level" in ('none', 'view', 'comment', 'edit', 'full'))
);
--> statement-breakpoint
CREATE TABLE "teamspace_group" (
	"teamspace_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"group_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teamspace_group_teamspace_id_group_id_pk" PRIMARY KEY("teamspace_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "member_group" ADD CONSTRAINT "member_group_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_group" ADD CONSTRAINT "member_group_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_group_member" ADD CONSTRAINT "member_group_member_group_fk" FOREIGN KEY ("group_id","workspace_id") REFERENCES "public"."member_group"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_group_member" ADD CONSTRAINT "member_group_member_member_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_member"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_group_permission" ADD CONSTRAINT "page_group_permission_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_group_permission" ADD CONSTRAINT "page_group_permission_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_group_permission" ADD CONSTRAINT "page_group_permission_group_fk" FOREIGN KEY ("group_id","workspace_id") REFERENCES "public"."member_group"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamspace_group" ADD CONSTRAINT "teamspace_group_teamspace_fk" FOREIGN KEY ("teamspace_id","workspace_id") REFERENCES "public"."teamspace"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamspace_group" ADD CONSTRAINT "teamspace_group_group_fk" FOREIGN KEY ("group_id","workspace_id") REFERENCES "public"."member_group"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_group_name_idx" ON "member_group" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "member_group_member_user_idx" ON "member_group_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "page_group_permission_workspace_idx" ON "page_group_permission" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "page_group_permission_group_idx" ON "page_group_permission" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "teamspace_group_group_idx" ON "teamspace_group" USING btree ("group_id");--> statement-breakpoint
-- The page access rule with groups (on top of 0021_teamspaces). Returns 0 none, 1 view, 2 comment, 3 edit, 4 full.
-- Groups hold owners and members of the workspace only; for guests they count for nothing.
--   - A group that joined a teamspace puts everyone in it into that teamspace, as a row in
--     teamspace_member would.
--   - A group's entry on a page applies like a person's own entry: the one on the page or its
--     nearest ancestor, for each group. The user gets the highest of the "everyone" level (capped
--     by where the page lives, as before), their own entry and the entries of every group they are in.
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
  v_group smallint;
  v_named boolean;
  v_grouped boolean := false;
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
        OR EXISTS (SELECT 1 FROM teamspace_member WHERE teamspace_id = v_teamspace AND user_id = p_user)
        OR EXISTS (
          SELECT 1 FROM teamspace_group tg
          JOIN member_group_member gm ON gm.group_id = tg.group_id AND gm.user_id = p_user
          WHERE tg.teamspace_id = v_teamspace
        ) THEN
        v_default := 4;
        v_cap := 4;
      ELSIF v_access = 'open' THEN
        v_default := 2;
        v_cap := 2;
      END IF;
    END IF;
    v_grouped := EXISTS (SELECT 1 FROM page_group_permission WHERE workspace_id = v_workspace);
  END IF;
  v_named := EXISTS (SELECT 1 FROM page_permission WHERE workspace_id = v_workspace);
  -- Workspaces that never restrict or share a page: skip the ancestor walk.
  IF NOT v_named AND NOT v_grouped THEN
    RETURN v_default;
  END IF;
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, 0 AS depth FROM page WHERE id = p_page
    UNION ALL
    SELECT p.id, p.parent_id, c.depth + 1 FROM page p JOIN chain c ON p.id = c.parent_id WHERE c.depth < 64
  )
  SELECT
    CASE WHEN v_named THEN
      (SELECT array_position(ARRAY['none', 'view', 'comment', 'edit', 'full'], pp.level) - 1
         FROM chain c JOIN page_permission pp ON pp.page_id = c.id AND pp.user_id IS NULL
         ORDER BY c.depth LIMIT 1)
    END,
    CASE WHEN v_named THEN
      (SELECT array_position(ARRAY['none', 'view', 'comment', 'edit', 'full'], pp.level) - 1
         FROM chain c JOIN page_permission pp ON pp.page_id = c.id AND pp.user_id = p_user
         ORDER BY c.depth LIMIT 1)
    END,
    CASE WHEN v_grouped THEN
      (SELECT max(nearest.rank) FROM (
         SELECT DISTINCT ON (gp.group_id) array_position(ARRAY['none', 'view', 'comment', 'edit', 'full'], gp.level) - 1 AS rank
         FROM chain c
         JOIN page_group_permission gp ON gp.page_id = c.id
         JOIN member_group_member gm ON gm.group_id = gp.group_id AND gm.user_id = p_user
         ORDER BY gp.group_id, c.depth
       ) nearest)
    END
  INTO v_everyone, v_own, v_group;
  RETURN GREATEST(LEAST(COALESCE(v_everyone, v_default), v_cap), COALESCE(v_own, 0), COALESCE(v_group, 0));
END
$$;
