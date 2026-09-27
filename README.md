# Esionage

An open-source, self-hostable Notion alternative with realtime collaboration and a built-in
MCP server, so AI assistants such as Claude can search, read and edit your workspace after you
approve them over OAuth.

## Features

- **Pages**: nested pages, a block editor (BlockNote) with slash menu and markdown shortcuts,
  icons, favorites, duplicate, move, trash with restore, export as Markdown, and full-text search
  over titles and content.
- **Rich blocks**: callouts, LaTeX equations (block and inline, KaTeX), Mermaid diagrams with a
  live preview, a table of contents and a breadcrumb, also on published pages and in Markdown.
- **Realtime collaboration**: several people can edit the same page at once (Yjs over WebSocket
  via Hocuspocus), with live cursors.
- **Databases**: every row is also a page.
  - Properties: text, number, select, multi-select, status, date, checkbox, checklist, URL,
    email, phone, person, one- or two-way relations to other databases, formulas, rollups over
    relations, and the read-only "created by", "created time", "last edited time" and
    "last edited by".
  - Views: table, board, calendar, gallery, list, timeline and chart, each with its own filters,
    sorting and grouping. Filters combine with "and"/"or" in groups and take relative dates such as
    "this week". A "Me" filter shows each viewer their own rows.
  - Table views calculate column totals, averages, counts and more over the filtered rows.
  - Select rows to edit a property, duplicate, export or trash them at once.
  - Form views collect answers as new rows, in the app or through a public link, signed in or
    anonymous.
  - Put a database inside any page, or show a view of an existing one there.
  - Lock a database to freeze its properties and views, and export its rows as CSV.
- **Comments**: select text and comment on it; reply, react, resolve and reopen threads, live for
  everyone on the page. People who can comment on a page (or edit it) write comments and viewers
  read along; full access also deletes other people's comments.
- **Inbox**: a notification when someone assigns you to a row, shares a page with you or replies in
  a comment thread you're in, with an email a little later. Choose per kind whether it shows in the inbox and whether it comes by email.
- **Page history**: versions are saved automatically while you edit and before every AI edit.
  You can preview and restore any version, and see what changed since it or since the version
  before, and who (or which AI app) changed it.
- **Sharing and permissions**: give members or everyone full, edit, comment, view or no access to a page.
  Subpages inherit it unless you change them. Share a page with someone outside the workspace by
  email and they join as a guest who sees only the pages shared with them.
- **Publish to the web**: a read-only public link for a page and its subpages, kept out of search
  engines unless you allow them. Published databases show the views you pick (tables, boards,
  lists, galleries) and visitors switch between them. Owners decide whether members may publish
  and can take any published page offline.
- **Workspaces and members**: add people by email (several at once) as owners or members, send
  an invitation link to people who don't have an account yet, or turn on a join link anyone can
  use. Owners can export the member list as CSV, hand ownership to someone else, and decide who
  may invite guests.
- **Email**: invitations, password reset, assignment and share notifications over SMTP (see [Email](#email)).
- **Sign in with GitHub or Google**, optional (see [Social login](#social-login)).
- **English and Turkish** interface.
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

- **Pin a version:** set `ESIONAGE_VERSION=0.2.0` in `.env`. The default is `latest`.
- **Upgrade:** run `docker compose pull && docker compose up -d`. Coming from 0.1.0, first add
  `COMPOSE_PROFILES=bundled-db` to `.env` (see [CHANGELOG.md](CHANGELOG.md)).
- **Build from source:** clone the repository and run `docker compose up -d --build`.

To stop new sign-ups after creating your own account, set `DISABLE_SIGNUP=true` and restart.
You can still bring people in: in Settings → Members, add their email. If they have no account
yet, you get an invitation link to send them. The link works for 7 days and lets only that email
sign up, even while sign-up is closed. The workspace join link (Settings → Members → Add members
with a link) is different: anyone holding it can join as a member, so it never opens closed
sign-up. People without an account can use it only while sign-up is open.

If the app is reachable under another URL (a domain behind a reverse proxy, another port), set
`APP_URL` to that public origin. It is the OAuth issuer and the MCP resource identifier, so it
must match what clients see.

`TRUSTED_PROXIES` says how many reverse proxies stand in front of the app (default `1`). Public
forms limit answers per visitor address, and the app reads that address from `X-Forwarded-For`
only as far as these proxies wrote it. Set `0` when clients reach the app directly, otherwise a
visitor could send the header and pose as a new address with every answer. Behind a CDN plus a
proxy, set `2`.

### Use an external PostgreSQL

The compose file runs PostgreSQL 18 only while `COMPOSE_PROFILES=bundled-db` is set in `.env`.
To use a database you already run, remove that line and set `EXTERNAL_DATABASE_URL` to its
connection URL. The `db` service is then not created.

## Email

Email is needed for invitations and password reset. Set these in `.env`:

| Variable | Meaning |
| --- | --- |
| `SMTP_URL` | Connection URL, e.g. `smtp://user:password@smtp.example.com:587`. Use `smtps://` for implicit TLS on port 465. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | Alternative to `SMTP_URL`. The port defaults to 587 (STARTTLS), or 465 with `SMTP_SECURE=true`. |
| `MAIL_FROM` | Sender, e.g. `Esionage <no-reply@example.com>`. Required when SMTP is set. |

Check the settings with `pnpm mail:test you@example.com`. In Docker, run
`docker compose exec app tsx scripts/send-test-email.ts you@example.com`. The server also logs
its mail setup at startup.

Without SMTP, development prints emails to the server log. In production, features that need
email say that it is not configured.

## Social login

People can also sign in with GitHub or Google. Each provider is off until you set both of its
variables in `.env` and restart:

| Provider | Variables | Callback URL to register |
| --- | --- | --- |
| GitHub ([new OAuth app](https://github.com/settings/applications/new)) | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `${APP_URL}/api/auth/callback/github` |
| Google ([OAuth client](https://console.cloud.google.com/apis/credentials), type "Web application") | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `${APP_URL}/api/auth/callback/google` |

For example, with `APP_URL=https://notes.example.com` the GitHub callback URL is
`https://notes.example.com/api/auth/callback/github`. The sign-in and sign-up pages show a
"Continue with …" button for each configured provider.

- **Existing accounts:** signing in with a provider opens the account that has the same email,
  as long as the provider says the address is verified. Otherwise the person is asked to sign in
  with their password. If that account's email was never verified, signing in this way also
  removes its password and signs out its other sessions and connected apps: anyone could have
  registered the address before its owner did. The owner can get a password back with "Forgot
  password", which proves the address by email.
- **Closed sign-up:** with `DISABLE_SIGNUP=true`, a provider signs in only people who already
  have an account, or who were invited with that email. It never creates other accounts.

## Deploy on Dokploy

Run the database as a Dokploy database service and the app as an Application, so Dokploy
handles database backups on its own. No compose file is involved.

1. Create a **Database → PostgreSQL** service with Docker image `postgres:18` and deploy it.
   Copy its **Internal Connection URL**.
2. Create an **Application** with this repository as its GitHub source and build type
   **Dockerfile**.
3. Under **Environment**, set `APP_URL` (the public origin, e.g. `https://notes.example.com`),
   `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `DATABASE_URL` (the Internal Connection
   URL from step 1).
4. Under **Domains**, add your domain with container port `3000` and HTTPS.
5. Deploy. Migrations run when the container starts. Turn on auto deploy to redeploy on every
   push.

## Connect an AI assistant

The server URL is `<APP_URL>/mcp`. Settings → *Connect an AI assistant* shows ready-to-copy
instructions. For example, with Claude Code:

```bash
claude mcp add --transport http esionage http://localhost:3000/mcp
```

The client opens a browser window where you sign in and approve access. The tools cover:

- **Finding things:** `list_workspaces`, `search`, `list_pages`, `list_recent_pages`, `list_users`.
- **Pages:** `get_page`, `create_page`, `update_page`, `move_page`, `archive_page`, `list_trash`,
  `restore_page`.
- **Page history:** `list_page_history`, `get_page_version`, `diff_page_version`, `restore_page_version`.
- **Comments:** `list_comments`, `add_comment` (start a thread on quoted text, or reply).
- **Inbox:** `list_notifications`, when the user also grants the `notifications:read` permission.
- **Databases:** `get_database`, `query_database`, `create_database`, `create_database_row`,
  `create_database_rows`, `update_database_row`, `update_database_rows`, `add_database_property`
  (including one- or two-way relations), `update_database_property`, `delete_database_property`,
  `create_database_view` and `update_database_view` (table, board, calendar, gallery, list,
  timeline, chart or form, including a form's public link).

An app only ever sees the pages its user can see. Read-only apps can't call the tools that
change anything.

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
| `pnpm mail:test you@example.com` | Send a test email with the SMTP settings from `.env` |
| `pnpm db:generate` | New migration from schema changes in `src/db/schema` |
| `pnpm tsx scripts/access-e2e.ts` | End-to-end checks against the database for page permissions, guests and publishing. The other `scripts/*-e2e.ts` files do the same for their areas (databases, filters, bulk actions, property types, people, trash, views, formulas, charts, forms, inline databases, publishing options); `mcp-e2e.ts` and `auth-e2e.ts` below need a running server. |
| `pnpm tsx scripts/mcp-e2e.ts` | End-to-end OAuth + MCP check against a running server (see the header of the file) |
| `pnpm tsx scripts/auth-e2e.ts` | End-to-end password reset check against a running server with SMTP pointed at [Mailpit](https://mailpit.axllent.org) |

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
