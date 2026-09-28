ALTER TABLE "workspace_member" ADD COLUMN "invited_by" text;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Who brought existing members in, as far as the data tells. An invitation is deleted once it is
-- redeemed, so workspace_invitation no longer knows who sent the ones that were accepted; the audit
-- log (0031) does, for what happened since it exists. The latest event that let each member in,
-- no later than the membership itself (both are written in one transaction):
--   - member.added by someone else: an owner or member added them, a page was shared with them,
--     or an owner approved their request;
--   - invitation.accepted: whoever last sent an invitation to that address before it was redeemed;
--   - member.joined, or member.added by their identity provider over SCIM: they came in on their
--     own, and nobody invited them.
UPDATE "workspace_member" wm SET "invited_by" = came_in.inviter
FROM (
  SELECT m.workspace_id, m.user_id,
    CASE
      WHEN e.action = 'member.added' AND e.actor_user_id <> m.user_id THEN e.actor_user_id
      WHEN e.action = 'invitation.accepted' THEN (
        SELECT sent.actor_user_id FROM "audit_event" sent
        WHERE sent.workspace_id = e.workspace_id AND sent.action = 'invitation.sent'
          AND sent.target_id = e.target_id AND sent.created_at <= e.created_at
        ORDER BY sent.created_at DESC
        LIMIT 1
      )
    END AS inviter
  FROM "workspace_member" m
  CROSS JOIN LATERAL (
    SELECT ae.workspace_id, ae.action, ae.actor_user_id, ae.target_id, ae.created_at
    FROM "audit_event" ae
    WHERE ae.workspace_id = m.workspace_id AND ae.created_at <= m.created_at
      AND (
        (ae.action IN ('member.added', 'member.joined') AND ae.target_type = 'user' AND ae.target_id = m.user_id)
        OR (ae.action = 'invitation.accepted' AND ae.actor_user_id = m.user_id)
      )
    ORDER BY ae.created_at DESC
    LIMIT 1
  ) e
) came_in
WHERE wm.workspace_id = came_in.workspace_id AND wm.user_id = came_in.user_id
  AND came_in.inviter IS NOT NULL AND came_in.inviter <> wm.user_id;--> statement-breakpoint
-- Guests the audit log can't place: the author of their oldest page entry by someone else, which
-- is how Settings > Guests guessed until now (a guest arrives by a page being shared with them).
UPDATE "workspace_member" wm SET "invited_by" = (
  SELECT pp.created_by FROM "page_permission" pp
  WHERE pp.workspace_id = wm.workspace_id AND pp.user_id = wm.user_id
    AND pp.created_by IS NOT NULL AND pp.created_by <> wm.user_id
  ORDER BY pp.created_at
  LIMIT 1
)
WHERE wm.role = 'guest' AND wm.invited_by IS NULL;
