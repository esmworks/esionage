ALTER TABLE "teamspace" ADD COLUMN "member_level" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "teamspace" ADD CONSTRAINT "teamspace_member_level_check" CHECK ("teamspace"."member_level" in ('full', 'edit', 'comment', 'view'));
--> statement-breakpoint
-- The page access rule with a teamspace's member level (on top of 0022_groups). Returns 0 none, 1 view,
-- 2 comment, 3 edit, 4 full. Unchanged but for the default of those the teamspace reaches:
--   - its members get the teamspace's member_level (full unless lowered), its owners and the
--     workspace's owners full, when the page (or its nearest ancestor with one) has no entry for
--     everyone; such an entry still decides for all of them, as before;
--   - members of the workspace who haven't joined an open teamspace get up to comment, and never
--     more than its members.
CREATE OR REPLACE FUNCTION page_access_level(p_user text, p_page text) RETURNS smallint
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE
  v_workspace text;
  v_teamspace text;
  v_role text;
  v_access text;
  v_members smallint;
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
      SELECT access, array_position(ARRAY['none', 'view', 'comment', 'edit', 'full'], member_level) - 1
        INTO v_access, v_members FROM teamspace WHERE id = v_teamspace;
      IF v_access = 'default'
        OR EXISTS (SELECT 1 FROM teamspace_member WHERE teamspace_id = v_teamspace AND user_id = p_user)
        OR EXISTS (
          SELECT 1 FROM teamspace_group tg
          JOIN member_group_member gm ON gm.group_id = tg.group_id AND gm.user_id = p_user
          WHERE tg.teamspace_id = v_teamspace
        ) THEN
        -- The teamspace's owners and the workspace's owners run it: full access by default.
        IF v_role = 'owner'
          OR EXISTS (SELECT 1 FROM teamspace_member WHERE teamspace_id = v_teamspace AND user_id = p_user AND role = 'owner') THEN
          v_default := 4;
        ELSE
          v_default := v_members;
        END IF;
        v_cap := 4;
      ELSIF v_access = 'open' THEN
        -- Those who haven't joined read and comment, never more than its members get.
        v_default := LEAST(2, v_members);
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
