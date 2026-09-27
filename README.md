# Esionage

An open-source, self-hostable Notion alternative with realtime collaboration and a built-in
MCP server, so AI assistants such as Claude can search, read and edit your workspace after you
approve them over OAuth.

## Features

- **Pages**: nested pages, a block editor (BlockNote) with slash menu and markdown shortcuts,
  icons, favorites, duplicate, move, trash with restore, export as Markdown (or, with subpages, as
  a ZIP; owners can export the whole workspace, see [Export](#export)), and full-text search over
  titles and content.
- **Rich blocks**: callouts, LaTeX equations (block and inline, KaTeX), Mermaid diagrams with a
  live preview, a table of contents and a breadcrumb, also on published pages and in Markdown.
- **Web bookmarks and embeds**: link cards with the page's title, description and image (fetched
  once on the server behind an SSRF guard), and YouTube, Vimeo, Loom, Figma, Google Docs, CodePen,
  Spotify and Google Maps embeds in sandboxed iframes.
- **Realtime collaboration**: several people can edit the same page at once (Yjs over WebSocket
  via Hocuspocus), with live cursors. The page header shows who else has the page open, including
  people who can only view it.
- **Find and replace** in a page (Cmd/Ctrl+F): highlights every match, steps through them, and
  replaces one or all in a single undo step. Anyone who can open the page can search it.
- **Databases**: every row is also a page.
  - Properties: text, number, select, multi-select, status, date, checkbox, checklist, URL,
    email, phone, files & media (uploads with image thumbnails), person, one- or two-way relations to other databases, formulas, rollups over
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
  - Row templates with preset properties and content; pick one as the default for "New".
- **Templates**: save a page or database (with its subpages) as a template and create new pages
  from it, or start from built-in templates for meeting notes, a weekly plan or a project tracker.
  Templates stay out of the sidebar, search, trash and published sites.
- **Comments**: select text and comment on it; reply, react, resolve and reopen threads, live for
  everyone on the page. People who can comment on a page (or edit it) write comments and viewers
  read along; full access also deletes other people's comments.
- **Mentions and page links**: `@` mentions people, pages (with their live title, or "No access")
  and dates with optional reminders; "Link to page" blocks; a "Linked from" list of backlinks on
  every page.
- **Inbox**: a notification when someone assigns you to a row, shares a page with you, replies in
  a comment thread you're in or mentions you, and when a reminder you set is due, with an email a
  little later. Choose per kind whether it shows in the inbox and whether it comes by email.
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
- **File uploads**: drop, paste or pick images, video, audio and other files into a page. They are
  stored on disk or in S3-compatible storage, only people who can see a page showing them can open
  them, and published pages show theirs (see [File uploads](#file-uploads)). Uploaded PDFs show
  in place.
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

## File uploads

Images, video, audio and other files added to pages are stored on disk in `UPLOAD_DIR`
(`./data/uploads` by default). With Docker Compose that directory is the `uploads` volume, so
back it up together with the database. To use S3-compatible storage (AWS S3, Cloudflare R2, MinIO)
instead, set `S3_BUCKET` and its credentials; files already stored are not moved when you switch.

| Variable | Meaning |
| --- | --- |
| `UPLOAD_DIR` | Where files go with local storage. Default `./data/uploads`. |
| `UPLOAD_MAX_FILE_MB` | Largest file, in MB. Default `50`. |
| `UPLOAD_WORKSPACE_QUOTA_MB` | Most one workspace may store, in MB. Default `10240`; `0` means no limit. |
| `S3_BUCKET` | Store files in this bucket instead of on disk. |
| `S3_ENDPOINT` | The service's URL for R2, MinIO and others, e.g. `https://<account-id>.r2.cloudflarestorage.com`. Leave out for AWS S3. |
| `S3_REGION` | Default `us-east-1` (R2 accepts it too). |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credentials allowed to put, get and delete objects in the bucket. |
| `S3_FORCE_PATH_STYLE` | Address the bucket by path (`<endpoint>/<bucket>/…`). Default `true` with `S3_ENDPOINT`, `false` for AWS. |
| `S3_PREFIX` | Optional folder inside the bucket. |

Limits are enforced while a file arrives. A file can be opened by anyone who can see the page it
was uploaded to or a page of the same workspace showing it (so duplicates and pages made from
templates share it), or a row whose files & media property holds it, and by visitors of a
published page showing it. Only raster images, video,
audio and PDF open in the browser; everything else, SVG included, is downloaded. When a page is
deleted for good, its files go once no other page shows them, and uploads no page ever used are
removed after a day.

## Export

The page menu exports a page as Markdown or a database as CSV. "Export with subpages" (for a
database, "Export with row pages") downloads a ZIP of the page and everything under it; owners
can download the whole workspace from Settings → General → Export. The archive mirrors the
sidebar:

```
Project.md              a page, and a folder of the same name for its subpages
Project/
  Tasks.csv             a database as CSV, its row pages in a folder beside it
  Tasks/
    Write docs.md       a row page lists its properties under its title
    Templates/          the database's row templates
Templates/              workspace templates (whole-workspace exports only)
files/                  uploaded files the exported pages and rows show
```

Names come from titles, made safe for every file system and unique within their folder. Links
between exported pages and to uploaded files point into the archive (relative paths), so the
Markdown can be opened in an editor such as Obsidian; links to pages that aren't in it point at
the app. An export holds only what the person exporting can see: pages they can't open are left
out and links to them say "No access". Pages in the trash are left out; exporting a page from the
trash brings the subpages trashed with it.

The ZIP is streamed while it is built, one download at a time per person. Larger exports are
refused up front with a message:

| Variable | Meaning |
| --- | --- |
| `EXPORT_MAX_PAGES` | Most pages (rows and templates included) one export may hold. Default `10000`. |
| `EXPORT_MAX_FILES_MB` | Most MB of uploaded files one export may hold. Default `2048` (at most about 3.5 GB). |

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
- **Templates:** `list_templates`; `create_page` and `create_database_row` take a `template_id`.
- **Comments:** `list_comments`, `add_comment` (start a thread on quoted text, or reply).
- **Mentions:** page bodies read and write mentions as Markdown: `[Title](/w/<workspace>/p/<page>)`
  for a page, `@Name` for a person, `@YYYY-MM-DD` for a date (see `src/lib/mentions.ts`).
- **Inbox:** `list_notifications`, when the user also grants the `notifications:read` permission.
- **Files:** `attach_file` uploads an image, video, audio or other file to a page (or, with
  `property`, to a row's files & media property) from a public URL or base64 data, when the user
  also grants the `files:write` permission. Files properties can only be set to files already
  uploaded to the workspace. URLs that lead to
  private or loopback addresses are refused.
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
| `pnpm tsx scripts/access-e2e.ts` | End-to-end checks against the database for page permissions, guests and publishing. The other `scripts/*-e2e.ts` files do the same for their areas (databases, filters, bulk actions, property types, people, trash, views, formulas, charts, forms, inline databases, publishing options, presence, uploads); `mcp-e2e.ts` and `auth-e2e.ts` below need a running server. |
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
