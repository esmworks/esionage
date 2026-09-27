CREATE TABLE "page_permission" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"level" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_permission_principal_key" UNIQUE NULLS NOT DISTINCT("page_id","user_id"),
	CONSTRAINT "page_permission_level_check" CHECK ("page_permission"."level" in ('none', 'view', 'edit', 'full'))
);
--> statement-breakpoint
ALTER TABLE "page_permission" ADD CONSTRAINT "page_permission_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_permission" ADD CONSTRAINT "page_permission_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_permission" ADD CONSTRAINT "page_permission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_permission" ADD CONSTRAINT "page_permission_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_permission_workspace_idx" ON "page_permission" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "page_permission_user_idx" ON "page_permission" USING btree ("user_id");--> statement-breakpoint
-- The page access rule, in one place. Returns 0 none, 1 view, 2 edit, 3 full.
-- For each principal (the user; everyone with a member role) the permission on the page itself or
-- on its nearest ancestor that has one applies, so a subpage can widen or narrow what it inherits.
-- Without any permission on the chain, owners and members get full access and nobody else any.
-- The user's level is the higher of the two. People who are not in the workspace get nothing.
CREATE OR REPLACE FUNCTION page_access_level(p_user text, p_page text) RETURNS smallint
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE
  v_workspace text;
  v_role text;
  v_everyone smallint;
  v_own smallint;
BEGIN
  SELECT workspace_id INTO v_workspace FROM page WHERE id = p_page;
  IF v_workspace IS NULL THEN RETURN 0; END IF;
  SELECT role INTO v_role FROM workspace_member WHERE workspace_id = v_workspace AND user_id = p_user;
  IF v_role IS NULL THEN RETURN 0; END IF;
  -- Most workspaces never restrict anything: skip the ancestor walk.
  IF NOT EXISTS (SELECT 1 FROM page_permission WHERE workspace_id = v_workspace) THEN
    RETURN CASE WHEN v_role IN ('owner', 'member') THEN 3 ELSE 0 END;
  END IF;
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, 0 AS depth FROM page WHERE id = p_page
    UNION ALL
    SELECT p.id, p.parent_id, c.depth + 1 FROM page p JOIN chain c ON p.id = c.parent_id WHERE c.depth < 64
  )
  SELECT
    (SELECT array_position(ARRAY['none', 'view', 'edit', 'full'], pp.level) - 1
       FROM chain c JOIN page_permission pp ON pp.page_id = c.id AND pp.user_id IS NULL
       ORDER BY c.depth LIMIT 1),
    (SELECT array_position(ARRAY['none', 'view', 'edit', 'full'], pp.level) - 1
       FROM chain c JOIN page_permission pp ON pp.page_id = c.id AND pp.user_id = p_user
       ORDER BY c.depth LIMIT 1)
  INTO v_everyone, v_own;
  RETURN GREATEST(
    CASE WHEN v_role IN ('owner', 'member') THEN COALESCE(v_everyone, 3) ELSE 0 END,
    COALESCE(v_own, 0)
  );
END
$$;
