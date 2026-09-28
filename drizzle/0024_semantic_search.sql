CREATE TABLE "page_chunk" (
	"page_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"position" integer NOT NULL,
	"block_id" text,
	"text" text NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"embedding" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_chunk_page_id_content_hash_pk" PRIMARY KEY("page_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "page_index_state" (
	"page_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"model" text NOT NULL,
	"source_hash" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_chunk" ADD CONSTRAINT "page_chunk_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_chunk" ADD CONSTRAINT "page_chunk_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_index_state" ADD CONSTRAINT "page_index_state_page_id_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_index_state" ADD CONSTRAINT "page_index_state_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_chunk_workspace_model_idx" ON "page_chunk" USING btree ("workspace_id","model");--> statement-breakpoint
CREATE INDEX "page_index_state_workspace_idx" ON "page_index_state" USING btree ("workspace_id");--> statement-breakpoint
-- Cosine similarity of two embeddings stored as real[] (semantic search without pgvector). With
-- pgvector, a vector column and an HNSW index would replace this; see the README.
CREATE OR REPLACE FUNCTION embedding_cosine(a real[], b real[]) RETURNS double precision
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE
    WHEN sum(x::float8 * x) = 0 OR sum(y::float8 * y) = 0 THEN 0
    ELSE sum(x::float8 * y) / sqrt(sum(x::float8 * x) * sum(y::float8 * y))
  END
  FROM unnest(a, b) AS t(x, y)
$$;
