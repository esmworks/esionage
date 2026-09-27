ALTER TABLE "page_invitation" DROP CONSTRAINT "page_invitation_level_check";--> statement-breakpoint
ALTER TABLE "page_permission" DROP CONSTRAINT "page_permission_level_check";--> statement-breakpoint
ALTER TABLE "page_invitation" ADD CONSTRAINT "page_invitation_level_check" CHECK ("page_invitation"."level" in ('view', 'comment', 'edit', 'full'));--> statement-breakpoint
ALTER TABLE "page_permission" ADD CONSTRAINT "page_permission_level_check" CHECK ("page_permission"."level" in ('none', 'view', 'comment', 'edit', 'full'));--> statement-breakpoint
-- The page access rule with the "comment" level. Returns 0 none, 1 view, 2 comment, 3 edit, 4 full
-- (see 0003_page_permission.sql for how the levels combine).
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
    RETURN CASE WHEN v_role IN ('owner', 'member') THEN 4 ELSE 0 END;
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
  RETURN GREATEST(
    CASE WHEN v_role IN ('owner', 'member') THEN COALESCE(v_everyone, 4) ELSE 0 END,
    COALESCE(v_own, 0)
  );
END
$$;
