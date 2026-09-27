# Esionage

An open-source, self-hostable Notion alternative with realtime collaboration and a built-in
MCP server, so AI assistants such as Claude can search, read and edit your workspace after you
approve them over OAuth.

## Features

- **Pages**: nested pages, a block editor (BlockNote) with slash menu and markdown shortcuts,
  icons, favorites, duplicate, move, trash with restore, export as Markdown or PDF (or, with
  subpages, as a ZIP; owners can export the whole workspace, see [Export](#export)), and full-text
  search over titles and content.
- **Rich blocks**: callouts, LaTeX equations (block and inline, KaTeX), Mermaid diagrams with a
  live preview, a table of contents and a breadcrumb, and columns (2 to 5, resizable, blocks
  dragged in and out with the side menu, stacked on phones), also on published pages and in
  Markdown.
- **Web bookmarks and embeds**: link cards with the page's title, description and image (fetched
  once on the server behind an SSRF guard), and YouTube, Vimeo, Loom, Figma, Google Docs, CodePen,
  Spotify and Google Maps embeds in sandboxed iframes.
- **Realtime collaboration**: several people can edit the same page at once (Yjs over WebSocket
  via Hocuspocus), with live cursors. The page header shows who else has the page open, including
  people who can only view it.
- **Offline editing**: pages you opened before stay readable and editable without a connection;
  the edits sync when it is back, merged with what others wrote meanwhile. The sidebar and
  recently opened databases stay readable. The page header shows offline, syncing and synced (see
  [Install and offline use](#install-and-offline-use)).
- **Installable app**: install Esionage from the browser on desktop (Chrome, Edge) or add it to
  the home screen on phones; it opens in its own window.
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
- **Teamspaces**: group pages and people. Every workspace starts with a *General* teamspace
  everyone is in. A teamspace is **default** (everyone is in it, now and later, and can't leave),
  **open** (anyone sees it and can join; until they do, they read and comment on its pages),
  **closed** (anyone sees it, only its members open its pages, its owners add them) or **private**
  (only its members know it exists, workspace owners included). The sidebar has a section per
  teamspace you're in, a *Shared* section for pages shared with you from elsewhere and a *Private*
  section for pages only you see. Settings → Teamspaces lists them with filters, their members and
  owners, the default teamspaces and whether members may create teamspaces. Moving a page to
  another teamspace, or to Private, gives it the access of its new place; people it was shared
  with by name keep theirs. Guests are never in teamspaces: they get single pages.
- **Sharing and permissions**: give people, or everyone in the page's teamspace (the workspace
  for a private page), full, edit, comment, view or no access to a page. Subpages inherit it
  unless you change them. Share a page with someone outside the workspace by email and they join
  as a guest who sees only the pages shared with them.
- **Publish to the web**: a read-only public link for a page and its subpages, kept out of search
  engines unless you allow them. Published databases show the views you pick (tables, boards,
  lists, galleries) and visitors switch between them. Owners decide whether members may publish
  and can take any published page offline.
- **Workspace site**: owners give the workspace's published pages one readable address
  (`/s/<slug>`) with a home page and a navigation of the pages listed in it; pages get addresses
  like `/s/<slug>/getting-started-<id>`, and links between listed pages stay on the site. Pages
  are listed only when someone chooses to, so a page shared by link stays unlisted; each keeps its
  own link and search-engine setting. A publication can also **allow duplicate**: signed-in
  visitors copy the page, as published, into one of their workspaces (or its templates), files
  included and without comments, history, people or private properties.
- **File uploads**: drop, paste or pick images, video, audio and other files into a page. They are
  stored on disk or in S3-compatible storage, only people who can see a page showing them can open
  them, and published pages show theirs (see [File uploads](#file-uploads)). Uploaded PDFs show
  in place.
- **Import**: bring in Markdown files, a folder or a ZIP as pages that keep their folder
  structure, with links between the files turned into page links and the images they show
  uploaded, into the page or teamspace you start it from. An Esionage export comes back as it went,
  templates included. Import a CSV file as a new database with its column types guessed (and
  changeable before importing), or add its rows to an existing database by matching columns to
  properties.
- **Import from Notion**: in Notion, export a page or the workspace as *Markdown & CSV* with
  subpages, and choose the downloaded ZIP in Import (a large export split into parts, an
  `Export-….zip` holding `…-Part-1.zip` and so on, works as it is). Pages keep their tree, without
  Notion's ids in their titles; databases come from the full `_all.csv` with their column types
  guessed, and each row page's property list is taken off its body. Relation columns whose links
  lead to rows of another database in the same export become relations; others stay text.
  Callouts, toggles, to-dos, tables, equations, links between pages (notion.so links to pages of
  the export included) and subpage links come along; images and attachments are uploaded. Files no
  page uses, and entries whose path leads out of the ZIP, are listed in the result. Not carried
  over: page icons and covers, comments, database views, formulas and rollups (their values come in
  as text or numbers), and people (as select or text). Tested against archives built from
  Notion's documented format, not yet a real export.
- **Workspaces and members**: add people by email (several at once) as owners or members, send
  an invitation link to people who don't have an account yet, or turn on a join link anyone can
  use. Owners can export the member list as CSV, hand ownership to someone else, and decide who
  may invite guests.
- **Email**: invitations, password reset, assignment and share notifications over SMTP (see [Email](#email)).
- **Sign in with GitHub or Google**, optional (see [Social login](#social-login)).
- **My account**: name and picture, password, email address, signed-in devices, connected apps,
  language and notification settings in one place, and deleting the account (see
  [My account](#my-account)).
- **Two-step verification and passkeys**: an authenticator app with one-time recovery codes,
  passkeys, and a workspace policy that requires one of them (see
  [Two-step verification and passkeys](#two-step-verification-and-passkeys)).
- **Five interface languages**: English, Turkish, German, Spanish and French, chosen in My account
  or taken from the browser (see [Languages](#languages)).
- **MCP server with OAuth 2.1**: remote MCP endpoint at `/mcp`.
  - Supports Client ID Metadata Documents and Dynamic Client Registration, with PKCE and a
    consent screen.
  - Tokens are audience-bound. Apps can be read-only or read-write, and you can revoke them in
    My account → Connected apps.
- **REST API** under `/api/v1` with personal access tokens (read or read-write, optionally one
  workspace, optional expiry) and an OpenAPI 3.1 document (see [REST API](#rest-api)).

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

### PDF

"Export as PDF" in the page menu opens the page's print view (`/print/<page id>`) in a new tab
and, once its images and diagrams have loaded, the browser's print dialog: choose "Save as PDF"
as the destination. The print view draws the page the way published pages do (headings, tables,
code, images, callouts, equations, Mermaid diagrams, database blocks) and is always light, also in
dark mode. Code and tables wrap to the page width, headings stay with the text after them, and
each page starts with its title. Links to other pages print as their titles. "Include subpages"
in the view's bar adds the pages under it (up to 100), each starting on a new sheet; database
rows print in their database's table. It shows what the person printing can see, like the page
itself, and follows the workspace's two-step policy.

The browser makes the PDF, so the server needs nothing extra (no headless browser in the image).
Its own header and footer (date, address, page numbers) can be turned off under "More settings"
in the print dialog.

## Install and offline use

**Installing.** Esionage is a web app with a manifest, icons and a service worker, so browsers
offer to install it: the install icon in Chrome's or Edge's address bar, "Install app" in the
workspace menu (shown only while the browser offers it; nothing pops up on its own), or "Add to
Home Screen" in Safari's share menu on iPhone and iPad. Installed, it opens in its own window and
starts at your last workspace. Installing needs HTTPS (or `localhost`).

**Offline.** Every page you open is also kept in the browser (its Yjs document, in IndexedDB).
Without a connection — no network, or the server is down — the page stays editable; the header
says "Offline", and "Offline · edits kept here" once you have changed something. When the
connection is back the edits are sent ("Syncing…", then "Synced") and merge with what others wrote
meanwhile. Pages edited offline and closed before the connection returned are sent in the
background the next time the app is open. In an installed app or a tab opened later, the service
worker serves the pages you opened before (the last 50) from its copy; others show a short
"You're offline" page listing what is available. The sidebar and the last 30 databases and rows
you opened stay readable offline; they are read-only until the connection is back, as are
sharing, comments, favorites, search, the inbox, new pages and the other actions that need the
server (their buttons say so).

**Privacy.** Offline copies are kept per user and removed when you sign out (after a warning if
some edits haven't reached the server yet), when someone else signs in on the same browser, and,
for a page, as soon as the server says it is gone or no longer shared with you. The collaboration
token is never stored. A browser profile shared by several people without signing out still
shares its offline copies, as it shares its cookies; sign out on shared computers.

The service worker (`public/sw.js`) runs in production builds only; `pnpm dev` removes one left
behind so hot reloading keeps working. It never caches API responses, uploads, server actions or
the collaboration socket. Images and files in pages are not kept offline.

### Desktop app

Installing the web app is the desktop app for now. We looked at wrapping it:

| | Installed web app | Tauri | Electron |
| --- | --- | --- | --- |
| Size | nothing to download | ~10 MB, the system's web view | ~100 MB+, ships Chromium |
| Offline editing | yes (service worker + IndexedDB) | the same web code | the same web code |
| Updates | with the server, automatic | signed releases per platform | signed releases per platform |
| Extras | install from the browser | native menus, tray, file access; Safari's WebKit on macOS, WebView2 on Windows | native menus, tray, file access, one engine everywhere |
| Cost | none | a Rust shell, code signing, a release pipeline | code signing, a release pipeline, frequent Chromium security updates |

A shell would load the same self-hosted server, so it adds no offline ability the installed app
lacks; it would add a place to keep the server address, native menus and global shortcuts. If
that becomes worth it, Tauri is the better fit (small, uses the system web view, and the app
already works in WebKit through Safari); Electron only if one rendering engine everywhere
matters more than size.

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

## My account

"My account" in the workspace menu (or the name and picture at its top) opens `/account`. It
belongs to the person, not to a workspace, so it also works for someone who isn't in any
workspace and isn't held back by a workspace's two-step policy. The old addresses
(`/w/<id>/settings?tab=preferences`, `accountSecurity`, `apps`) redirect to it.

- **Profile:** name (up to 80 characters) and picture. The browser crops the picture to a
  256×256 WebP (PNG where WebP isn't available) before uploading it. PNG, JPEG, WebP and GIF up
  to 2 MB are accepted, checked by their content (SVG never is); pictures are stored with the
  other uploads and shown only to signed-in people. Pictures from GitHub or Google stay until
  someone uploads their own.
- **Email:** the new address gets a link, valid for 24 hours, that makes the change when opened
  and confirmed there (no sign-in needed, and it signs nobody in); the old address is told about
  it. An address another account uses gets no link, and nobody is told so. In production without SMTP
  the option is off and says why (development prints the email to the server log).
- **Password:** change it with the current one, optionally signing out every other device. People
  who only sign in with GitHub or Google can set one instead. Both send a notice by email.
- **Sessions:** every signed-in device with its browser, system, IP address and last activity
  (refreshed about once a day), with "Sign out" per device and "Sign out all other devices",
  which also closes their live collaboration connections.
- **Security, connected apps, language and notifications:** as before, moved here from the
  workspace settings.
- **Delete account:** type the account's email to confirm. It is refused while the person is the
  only owner of a workspace others are in (they hand ownership over, or remove the others,
  first). Otherwise workspaces nobody else is in are deleted with their pages and files, and the
  others are left the way leaving works: an owner takes over the pages only this person could
  manage. Sessions, passkeys, connected apps, notifications and the picture go with the account;
  pages and comments the person wrote in the remaining workspaces stay.

Changing the email or password and deleting the account ask for the password again, or for a
two-step code (or recovery code) on accounts without one. An account with neither needs a
sign-in from the last 10 minutes. These checks are rate-limited per person (10 tries per 15
minutes), as are email changes (5 an hour), picture uploads (20 an hour) and signing out devices.

## Two-step verification and passkeys

Everyone manages these in **My account → Security**:

- **Authenticator app (TOTP):** scan a QR code (or type the key) into an app such as 1Password
  or Google Authenticator and confirm with a code. Ten recovery codes are shown once, to copy or
  download; each signs in once, and "New codes" replaces them. From then on, signing in with the
  password *or* with GitHub/Google asks for a code; "Don't ask again on this device" skips it for
  30 days. Turning it off asks for the password, or, for accounts without one, a code.
- **Passkeys:** add, rename and remove them; "Sign in with a passkey" is on the sign-in page.
  Passkeys are bound to the host name of `APP_URL`, so changing that host makes existing
  passkeys stop working. Adding one needs a sign-in from the last 24 hours.

Owners can turn on **Require two-step verification** in the workspace's **Settings → Security**.
A session passes when the person has the authenticator app on, or signed in with a passkey;
anyone else who opens the workspace is sent to a page where they set one of them up first
(nobody is locked out, owners included). An owner can only turn the policy on from a session
that passes it. The policy covers everything a browser session reaches: the app's pages, exports,
server actions, API routes (files, import) and the live collaboration connection, which is
checked when it connects; turning the policy on closes the open connections of sessions that
don't pass. Apps connected over MCP and REST API tokens are not affected: they use OAuth or
personal access tokens, not sign-in sessions, and keep working until someone revokes them under
Connected apps.

Someone who lost both their authenticator app and their recovery codes can be reset by whoever
runs the server; this turns two-step verification off and signs them out (`--passkeys` also
removes their passkeys):

```bash
pnpm auth:reset-2fa person@example.com
# Docker: docker compose exec app pnpm auth:reset-2fa person@example.com
```

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

The server URL is `<APP_URL>/mcp`. My account → *Connected apps* shows ready-to-copy
instructions. For example, with Claude Code:

```bash
claude mcp add --transport http esionage http://localhost:3000/mcp
```

The client opens a browser window where you sign in and approve access. The tools cover:

- **Finding things:** `list_workspaces`, `list_teamspaces`, `search`, `list_pages`, `list_recent_pages`, `list_users`.
- **Teamspaces:** `create_page`, `create_database` and `move_page` take a `teamspace_id` for
  top-level pages (`"private"` for the user's private pages). Without one, a page an AI app
  creates at the top is private to the user, as in Notion's API; the user moves it to share it.
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

## REST API

Scripts and other programs can use the REST API under `<APP_URL>/api/v1` with a personal access
token. The reference is at `<APP_URL>/docs/api`, generated from the OpenAPI 3.1 document at
`<APP_URL>/api/v1/openapi.json` (import it into Postman, Insomnia or a client generator).

Create a token in My account → *Connected apps* → *Personal access tokens*: give it a name, choose
**Read only** (`pages:read`) or **Read and write** (`pages:write` too), optionally limit it to one
workspace, and pick when it expires (7, 30, 90 days, a year, or never). The token is shown once;
Esionage keeps only its SHA-256 hash. Tokens look like `esi_` and 40 letters and digits, so secret
scanners can match leaked ones with `esi_[A-Za-z0-9]{40}`. The list shows when each was last
used; revoking one stops it at once.

```bash
curl http://localhost:3000/api/v1/workspaces -H "Authorization: Bearer $ESIONAGE_TOKEN"

curl -X POST http://localhost:3000/api/v1/databases/<database_id>/query \
  -H "Authorization: Bearer $ESIONAGE_TOKEN" -H "Content-Type: application/json" \
  -d '{"filters": [{"property": "Status", "op": "equals", "value": "Done"}], "limit": 20}'
```

- **Account and workspaces:** `GET /me`, `GET /workspaces`, `GET /workspaces/{id}/teamspaces`,
  `GET /workspaces/{id}/pages` (`teamspace_id` narrows it to one teamspace, or `private`).
  `POST /pages` and `POST /pages/{id}/move` take a `teamspace_id` for top-level pages, as the MCP
  tools do.
- **Pages:** `GET /search`, `POST /pages`, `GET` and `PATCH /pages/{id}` (title, icon, Markdown
  body replaced or appended), `GET /pages/{id}/children`, `POST /pages/{id}/move`,
  `/archive` and `/restore`.
- **Databases and rows:** `GET /databases/{id}` (schema), `POST /databases/{id}/query` (filters,
  sorts, a saved view, cursor pagination), `POST /databases/{id}/rows`, `POST
  /databases/{id}/rows/bulk` (up to 100), `PATCH /databases/{id}/rows` (same values on many rows),
  `GET` and `PATCH /rows/{id}`.
- **Comments:** `GET` and `POST /pages/{id}/comments`.

The API and the MCP server share one service layer (`src/server/operations.ts`), so they check
input, access and history the same way: a token acts as its user, with that user's own access to
pages, and every body change is saved to page history first. Pages the user can't see (or outside
a token's workspace) answer `404`. Errors are JSON, `{"error": {"code", "message", "details"}}`;
lists page with `next_cursor`. Each token may make 180 requests a minute (`API_RATE_LIMIT`;
`X-RateLimit-*` headers, `429` with `Retry-After` beyond it), and request bodies are limited to
5 MB. Only tokens authenticate (never the browser session), and CORS is off unless
`API_CORS_ORIGINS` lists origins. Like connected MCP apps, tokens are not held back by a
workspace's "require two-step verification" policy: it guards browser sessions.

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
| `pnpm i18n:check [locale…]` | Compares every translation with English: missing or extra files and keys, and placeholders or plural/select syntax that differ (see [Languages](#languages)) |
| `pnpm build` | Production build |
| `pnpm mail:test you@example.com` | Send a test email with the SMTP settings from `.env` |
| `pnpm db:generate` | New migration from schema changes in `src/db/schema` |
| `pnpm tsx scripts/access-e2e.ts` | End-to-end checks against the database for page permissions, guests and publishing. The other `scripts/*-e2e.ts` files do the same for their areas (teamspaces, databases, filters, bulk actions, property types, people, trash, views, formulas, charts, forms, inline databases, publishing options, sites and duplicating published pages, presence, offline editing, uploads, import, Notion import, export, and `roundtrip-e2e.ts` for an export imported again); `mcp-e2e.ts` and `auth-e2e.ts` below need a running server. |
| `pnpm tsx scripts/sw-e2e.ts` | Checks the service worker (`public/sw.js`) in headless Chrome against a stand-in server: offline pages, per-user copies, the offline page (set `CHROME_PATH` outside macOS) |
| `pnpm tsx scripts/mcp-e2e.ts` | End-to-end OAuth + MCP check against a running server (see the header of the file) |
| `pnpm tsx scripts/api-e2e.ts` | End-to-end REST API check (tokens, every endpoint, access, rate limits, OpenAPI) against a running server |
| `pnpm tsx scripts/auth-e2e.ts` | End-to-end password reset check against a running server with SMTP pointed at [Mailpit](https://mailpit.axllent.org) |
| `pnpm tsx scripts/two-factor-e2e.ts` | End-to-end two-step verification check (sign-in challenge, recovery codes, workspace policy) against a running server |

## Languages

The interface is available in English, Turkish (Türkçe), German (Deutsch), Spanish (Español) and
French (Français). Each person picks a language in My account → Language, stored per browser;
without a choice the app follows the browser's `Accept-Language` and falls back to English. Dates
and numbers are formatted for the language, and emails go out in the language of whoever caused
them. The editor's own menus use [BlockNote](https://www.blocknotejs.org)'s dictionaries (Turkish is
ours, in `src/i18n/blocknote/tr.ts`).

Texts live in `src/i18n/messages/<locale>/*.json` (app, `email.json`, `templates.json` for the
built-in templates), in ICU MessageFormat. English is the source: `pnpm i18n:check` (also part of
`pnpm test` and CI) reports what each language lacks or gets wrong, and anything missing shows in
English. Adding a language is a new folder of JSON files plus one line each in
`src/i18n/config.ts` and `src/i18n/blocknote/index.ts`. Translations are welcome as pull
requests; see [CONTRIBUTING.md](CONTRIBUTING.md#translations) for the workflow.

## Architecture

- A single Node process (`server.ts`) serves Next.js (App Router) and the Hocuspocus
  collaboration server on the `/collab` WebSocket path.
  - Route handlers, server actions and MCP tools write into open documents through the same
    Hocuspocus instance, so AI edits appear live in open editors.
  - The `/collab` connection is authenticated with a short-lived HMAC token.
- Page access is worked out in SQL (`page_access_level`, migrations `0003`, `0013`, `0021`):
  every read path (sidebar, search, mentions, export, MCP, REST, collaboration) filters with it.
  A page's teamspace is stored on every page of its tree (`page.teamspace_id`, kept in step by
  triggers); null means private.
- The Yjs document is the source of truth for page content. On every save, the app also stores
  derived markdown and plain text in PostgreSQL for search and MCP reads.
- Browsers keep each page's Yjs document in IndexedDB (y-indexeddb), loaded before the page
  connects, so offline edits merge on reconnect like any other change; a hand-written service
  worker (`public/sw.js`) keeps the app's scripts and the signed-in pages' HTML per user. See
  `src/lib/offline.ts` for what is stored where and when it is wiped.
- Auth is Better Auth: email/password, GitHub/Google, two-factor and passkey plugins for people,
  and the OAuth provider, JWT, MCP and CIMD plugins for apps. Data access uses Drizzle ORM on PostgreSQL 18.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).
