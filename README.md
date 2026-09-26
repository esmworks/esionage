# Esionage

An open-source, self-hostable Notion alternative with realtime collaboration and a built-in
MCP server, so AI assistants such as Claude can search, read and edit your workspace after you
approve them over OAuth.

## Features

- **Pages**: nested pages, a block editor (BlockNote) with slash menu and markdown shortcuts,
  icons, trash with restore, and full-text search over titles and content.
- **Realtime collaboration**: several people can edit the same page at once (Yjs over WebSocket
  via Hocuspocus), with live cursors.
- **Databases**: typed properties (text, number, select, multi-select, date, checkbox, URL),
  table and board views, filters, sorting and grouping. Every row is also a page.
- **Page history**: versions are saved automatically while you edit and before every AI edit.
  You can preview and restore any version.
- **Workspaces and members**: add people by email as owners or members.
- **MCP server with OAuth 2.1**: remote MCP endpoint at `/mcp`.
  - Supports Client ID Metadata Documents and Dynamic Client Registration, with PKCE and a
    consent screen.
  - Tokens are audience-bound. Apps can be read-only or read-write, and you can revoke them in
    Settings.

## Quick start (Docker)

Prebuilt images for amd64 and arm64 are published to
[GitHub Container Registry](https://github.com/esmworks/esionage/pkgs/container/esionage) for every release.
You only need two files:

```bash
mkdir esionage && cd esionage
curl -fsSLO https://raw.githubusercontent.com/esmworks/esionage/main/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/esmworks/esionage/main/.env.example -o .env
# set BETTER_AUTH_SECRET in .env to the output of: openssl rand -base64 32
docker compose up -d
```

Open http://localhost:3000 and create an account. Migrations run automatically when the app
container starts.

- **Pin a version:** set `ESIONAGE_VERSION=0.1.0` in `.env`. The default is `latest`.
- **Upgrade:** run `docker compose pull && docker compose up -d`.
- **Build from source:** clone the repository and run `docker compose up -d --build`.

If the app is reachable under another URL (a domain behind a reverse proxy, another port), set
`APP_URL` to that public origin. It is the OAuth issuer and the MCP resource identifier, so it
must match what clients see.

## Deploy on Dokploy

Use `docker-compose.dokploy.yml`. It builds from source and publishes no host ports, since
Dokploy itself uses port 3000.

1. Create a **Compose** service with this repository as its Git source and set the compose path
   to `./docker-compose.dokploy.yml`.
2. Under **Environment**, set `APP_URL` (the public origin, e.g. `https://notes.example.com`),
   `POSTGRES_PASSWORD` (`openssl rand -hex 24`) and `BETTER_AUTH_SECRET`
   (`openssl rand -base64 32`).
3. Under **Advanced**, turn on **Isolated Deployments** so `app` and `db` share a private network.
4. Under **Domains**, add your domain for service `app`, port `3000`, with HTTPS.
5. Deploy. Turn on auto deploy to redeploy on every push.

## Connect an AI assistant

The server URL is `<APP_URL>/mcp`. Settings → *Connect an AI assistant* shows ready-to-copy
instructions. For example, with Claude Code:

```bash
claude mcp add --transport http esionage http://localhost:3000/mcp
```

The client opens a browser window where you sign in and approve access. Tools include `list_workspaces`,
`search`, `get_page`, `list_pages`, `create_page`, `update_page`, `archive_page`,
`get_database`, `query_database`, `create_database_row`, `update_database_row`,
`create_database` and `add_database_property`.

## Development

Requirements: Node.js 24 and pnpm 11 (via `corepack enable`), plus Docker for PostgreSQL.

```bash
pnpm install
cp .env.example .env      # set BETTER_AUTH_SECRET
docker compose up -d db
pnpm db:migrate
pnpm dev                  # http://localhost:3000
```

Useful scripts:

| Script | What it does |
| --- | --- |
| `pnpm typecheck` | TypeScript check |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm build` | Production build |
| `pnpm db:generate` | New migration from schema changes in `src/db/schema` |
| `pnpm tsx scripts/mcp-e2e.ts` | End-to-end OAuth + MCP check against a running server (see the header of the file) |

## Architecture

- A single Node process (`server.ts`) serves Next.js (App Router) and the Hocuspocus
  collaboration server on the `/collab` WebSocket path.
  - Route handlers, server actions and MCP tools write into open documents through the same
    Hocuspocus instance, so AI edits appear live in open editors.
  - The `/collab` connection is authenticated with a short-lived HMAC token.
- The Yjs document is the source of truth for page content. On every save, the app also stores
  derived markdown and plain text in PostgreSQL for search and MCP reads.
- Auth is Better Auth: email/password for people, and the OAuth provider, JWT, MCP and CIMD
  plugins for apps. Data access uses Drizzle ORM on PostgreSQL 18.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).
