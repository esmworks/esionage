CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_user_id" text,
	"actor_kind" text NOT NULL,
	"actor_name" text DEFAULT '' NOT NULL,
	"actor_email" text,
	"actor_via" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_label" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_actor_kind_check" CHECK ("audit_event"."actor_kind" in ('user', 'api_token', 'connected_app', 'scim', 'system'))
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_workspace_time_idx" ON "audit_event" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_workspace_action_idx" ON "audit_event" USING btree ("workspace_id","action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_workspace_actor_idx" ON "audit_event" USING btree ("workspace_id","actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_created_idx" ON "audit_event" USING btree ("created_at");