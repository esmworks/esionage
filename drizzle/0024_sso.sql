CREATE TABLE "sso_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidc_config" text,
	"saml_config" text,
	"user_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"organization_id" text,
	"domain" text NOT NULL,
	"domain_verified" boolean,
	CONSTRAINT "sso_provider_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "scim_identity" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"external_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scim_identity_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "scim_token" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "scim_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_sso" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"protocol" text NOT NULL,
	"verification_token" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_sso_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "sso_provider_id" text;--> statement-breakpoint
ALTER TABLE "sso_provider" ADD CONSTRAINT "sso_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_identity" ADD CONSTRAINT "scim_identity_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_identity" ADD CONSTRAINT "scim_identity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_token" ADD CONSTRAINT "scim_token_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_token" ADD CONSTRAINT "scim_token_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_sso" ADD CONSTRAINT "workspace_sso_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_sso" ADD CONSTRAINT "workspace_sso_provider_id_sso_provider_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sso_provider"("provider_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_sso" ADD CONSTRAINT "workspace_sso_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scim_identity_user_idx" ON "scim_identity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scim_token_workspace_idx" ON "scim_token" USING btree ("workspace_id");--> statement-breakpoint
-- A workspace's SSO provider lives only as long as its connection: removing the connection, or the
-- workspace with it, removes the provider row (and so stops sign-ins through it).
CREATE OR REPLACE FUNCTION workspace_sso_drop_provider() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "sso_provider" WHERE "provider_id" = OLD."provider_id";
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER workspace_sso_drop_provider AFTER DELETE ON "workspace_sso"
  FOR EACH ROW EXECUTE FUNCTION workspace_sso_drop_provider();
