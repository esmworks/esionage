# Changelog

## Unreleased

### Added

- **Semantic search** (#43; optional, on with `AI_EMBEDDINGS_MODEL`): search also finds pages by
  meaning, merged with full-text results by reciprocal rank fusion, in the search dialog (marked
  *Similar meaning*), MCP `search` and REST `GET /search` (each result has `match: "text"` or
  `"semantic"`). Pages are cut into chunks (title, a row's values, the body's blocks) whose
  embeddings are stored in `page_chunk` as `real[]` with their model, dimensions and a content hash
  (only changed chunks are embedded again), ranked by cosine similarity in SQL (`embedding_cosine`,
  no extension needed; the README describes moving to pgvector for large workspaces). Indexing runs
  in the background a few seconds after pages are edited, created, renamed or restored or a row's
  values change, within `AI_CONCURRENCY` and `AI_WORKSPACE_RATE_LIMIT`; a workspace's first search
  sweeps up pages the index missed, and `pnpm search:index` backfills everything. Access is
  checked when the query runs, before ranking, never stored in the index. Trashed pages drop out
  at once; turning AI off for a workspace deletes its index. New setting
  `AI_EMBEDDINGS_MIN_SIMILARITY` (default 0.3). Without an embeddings model search is exactly the
  full-text search it was. Migration `0026_semantic_search`. New checks:
  `scripts/semantic-search-e2e.ts` (64, against a stand-in OpenAI-compatible server),
  `src/server/semantic-text.test.ts`.
- **AI chat** (#41): *Ask AI* in the sidebar opens a panel that answers questions from the pages
  the person can read, citing them as links to the page and block. Each question is searched for
  (hybrid search) and the model may call `search_pages` and `read_page` (up to five turns), which
  run through `operations.ts` as the person with their access checked on every call; answers
  stream (`POST /api/ai/chat`, NDJSON) and can be stopped. Questions can be kept to the current
  page and its subpages. Conversations are private, kept per person and workspace
  (`ai_conversation`, migration `0027_ai_chat`; 50 per workspace, 40 questions each, 4000
  characters a question), listed and deletable in the panel, and deleted when the person leaves
  the workspace or deletes their account; cited pages they can no longer open lose their title.
  Off while offline and when AI is off, with the reason shown. Links to `#block-<id>` scroll to
  and highlight the block. New checks: `scripts/ai-chat-e2e.ts` (62), `src/server/ai/chat.test.ts`.
- **Single sign-on and SCIM** (#38), with Better Auth's SSO plugin (`@better-auth/sso` 1.7.6):
  an instance-wide OpenID Connect provider from `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
  `OIDC_CLIENT_SECRET` (`OIDC_NAME`, `OIDC_DOMAINS`), and one OpenID Connect or SAML 2.0
  connection per workspace, set up by owners in Settings → Security. A workspace connection signs
  people in only for its email domains, once each is verified with a DNS TXT record
  (`_leafdesk-sso.<domain>`); public mail domains can't be claimed and a domain belongs to one
  connection. "Continue with SSO" on the sign-in page routes an email to its provider. The first
  sign-in creates the account (only in those domains) and joins the workspace as a member;
  two-step verification still asks for its code afterwards. New workspace setting *How members
  sign in*: *Any method* or *Single sign-on only*, enforced like "require two-step verification"
  (pages, exports, actions, API routes, live collaboration; a new `/sso-required/<id>` page), with
  owners and guests exempt. SCIM 2.0 at `/scim/v2` with workspace SCIM tokens (hashed, revocable):
  `Users` list/filter/get/create/replace/patch/delete, where `active: false` removes someone from
  the workspace and owners can't be deactivated; `Groups` in the next entry.
  The SSO box lists the workspace ID, OIDC redirect URI, SAML entity ID, ACS and metadata URLs to
  copy. The plugin's own provider management, its shared callback and SAML single logout are off.
  Migration `0024_sso`. New checks: `scripts/sso-e2e.ts` (69, against a mock OIDC provider it
  runs itself), `scripts/scim-e2e.ts`, `src/lib/sso-config.test.ts`, `src/lib/scim.test.ts`,
  `src/server/sso.test.ts`. Not tried against real identity providers; SAML only in unit tests.
- **SCIM groups** (#38, on member groups #37): `/scim/v2/Groups` lists (filter `displayName`,
  `externalId` or `id` with `eq`, paging, `excludedAttributes=members`), gets, creates, replaces,
  patches and deletes the workspace's member groups, including ones made in the app. `PATCH`
  takes Okta's and Microsoft Entra ID's forms (`add`/`remove`/`replace` on `members`, `remove` on
  `members[value eq "…"]`, `displayName`, `externalId`, path-less objects, ops in any case); `PUT`
  keeps members it leaves out. Members must be the workspace's owners or members: guests, unknown
  or outside ids and nested groups are a 400 `invalidValue` and nothing of that request is
  applied; a taken name is a 409. Changes run through `server/groups.ts` (a new `changeGroup`
  that renames and adds and removes people in one transaction, which the settings' rename, add
  and remove now use too), so access, open editors and stranded pages are handled as in the app;
  the workspace's oldest owner acts for the token and receives pages only a removed member or
  deleted group could manage. `scim_group` keeps the provider's `externalId`, and Settings →
  Groups marks provisioned groups ("From your identity provider", with a note in the members
  dialog that the provider may undo edits; en/tr/de/es/fr). `/Schemas` now describes the User and
  Group attributes. Migration `0025_scim_groups` (renumber at merge if needed). Checks:
  `scripts/scim-e2e.ts` (118, including a live editor closing and cross-workspace isolation),
  `src/lib/scim.test.ts` (22). Not tried against real Okta or Entra ID.
- **Member groups** (#37): workspace owners create groups in Settings → Groups (rename, add and
  remove members, delete); everyone sees the list and who is in each group. A page can be shared
  with a group from the share panel like a person (`page_group_permission`, inherited by subpages
  and overridable, "no access" included), and a group can be added to a non-default teamspace,
  whose pages its members then reach as members (they can't leave or be removed one by one while
  in the group). `page_access_level` counts group entries and teamspace groups, and the highest
  level from the person, the page's teamspace and their groups wins; guests get nothing from
  groups. Only members and owners can be in a group: leaving the workspace removes people from
  their groups (a composite foreign key) and so does becoming a guest. Removing someone from a
  group, removing a group's entry or teamspace, or deleting the group closes their live editing
  sessions on pages they no longer reach, and hands pages nobody could manage any more to the
  person who made the change. Duplicating a page copies its group entries. The member list has a
  Groups column (also in the CSV export). MCP `list_groups` and REST
  `GET /workspaces/{id}/groups` list groups with their members and teamspaces. New checks:
  `scripts/groups-e2e.ts` (79), `src/lib/groups.test.ts`, `src/lib/search-fold.test.ts`.
- **AI foundation** (optional; off unless `AI_PROVIDER` and `AI_MODEL` are set): one server-side
  interface in `src/server/ai` for streaming chat with tool calls, embeddings (an OpenAI-compatible
  `/embeddings` call over `fetch`), per-person and per-workspace rate limits, a maximum input
  size, timeouts, cancellation and a usage log line per request (feature, model, tokens, cost; no
  content). Providers: Anthropic, OpenAI, Google, any OpenAI-compatible server, Ollama and LM
  Studio, through `@earendil-works/pi-ai` 0.87.1 (MIT) with only those APIs registered; tests use
  its faux provider. Owners can turn AI off per workspace (Settings → General → AI), which also
  shows the server's provider and model. See the README's AI section for the environment
  variables, limits and what is sent where.
- **AI writing assistant** (#40): *Ask AI* in the formatting toolbar and the slash menu (plus
  *Continue writing* and *Summarize page*): improve writing, fix spelling and grammar, make
  shorter, translate into a chosen language, or follow your own instruction. The answer streams
  into a panel (`POST /api/ai/write`, newline-delimited JSON) with *Replace selection*, *Insert
  below*, *Try again* and *Discard*; *Stop* and closing cancel the request. Applying saves a page
  history version first ("Before AI assistant edit") and edits through the shared document, so
  others see it live and Undo reverts it. Only people who can edit the page can use it; offline
  it is hidden.
- **AI autofill properties** (#42): a text property can be filled in by AI with a summary of the
  row's page, a translation (of the name, the page content or another property) or a custom
  prompt with `{Property}` placeholders and optionally the page content. Values are plain text
  (filters, sorts, CSV, REST and MCP work as before; `get_database` shows `ai_autofill`), worked
  out in the background with a concurrency limit and each workspace's rate limit, per row
  (*Update with AI* on a cell or the row page), for a view (*Update all rows in this view*), and
  optionally a few seconds after a row changes when its inputs did. Cells show pending and failed
  values with the reason. Migration `0023_ai_properties` adds the `ai_property_state` table
  (additive).
- **German, Spanish and French** (#51): the whole interface, emails and built-in templates in
  Deutsch, Español and Français, next to English and Turkish; the editor's menus use BlockNote's own
  dictionaries for them. The language picker lists each language by its own name. Adding a
  language is now a folder of JSON files (`src/i18n/messages/<locale>/`, found by name, no index
  file) plus a line in `src/i18n/config.ts` and one in `src/i18n/blocknote/index.ts`; a language
  that lacks a text shows the English one. Built-in templates moved to
  `messages/<locale>/templates.json`. `Accept-Language` matching now also takes regional codes
  (`pt-br`) when a language has them. `pnpm i18n:check` (also in `pnpm test` and a CI step)
  compares every language with English: missing or extra files and keys, empty texts, invalid
  ICU (parsed with @formatjs/icu-messageformat-parser 3.5.20, MIT, dev only), placeholders, tags
  and select branches that differ (plural vs. plain `{count}` is allowed).
  CSV import recognises German, Spanish and French title columns and yes/no words. The
  translation workflow is in `CONTRIBUTING.md`. The new translations were not reviewed by native
  speakers yet.
- **Import from Notion** (#46): Notion's *Markdown & CSV* export ZIP, including a split export
  (`Export-<id>.zip` holding `Export-<id>-Part-N.zip`, each possibly wrapped in its own
  `Export-…-Part-N/` folder), goes in through the existing Import dialog and `/api/import`, under
  the page or into the teamspace it was started from. On top of what the Markdown import already
  did for Notion (ids out of titles, `_all.csv` over the partial CSV, folders as subpages):
  callouts (`<aside>`) become callouts, `$`…`$` inline equations become equations (toggles as
  `<details>`, to-dos, tables and `$$` blocks were already read), a line linking to one of the
  page's own subpages becomes a link-to-page block, notion.so links to pages of the export point
  at the imported pages, a database's own `.md` next to its CSV is left out as a duplicate, and
  the `Name: value` property list at the top of each row page is taken off its body (lines linking
  to files stay, so the files are uploaded). Relation cells (`Title (../DB%20<id>/Title%20<id>.md)`,
  `Title (https://www.notion.so/…-<id>)`, or `[Title](…)` in the row page's list) make a one-way
  relation property to the database their links lead to, linked by link, else by a unique title;
  entries that find no row are counted in a warning, and columns whose links all lead outside the
  export stay text without the links. New import warnings: files no page shows or links to
  (`unused`) and ZIP entries whose path climbs out of the archive (`unsafePath`, previously
  dropped silently). The dialog says how to export from Notion (en/tr). New code in
  `src/lib/import/notion.ts`; checks in `src/lib/import/notion.test.ts`,
  `src/server/import/archive.test.ts`, `src/server/import/notion-blocks.test.ts` and
  `scripts/notion-import-e2e.ts` (33). The fixtures follow Notion's documented export format; no
  real Notion export was tried. No migration.
- **Offline editing** (#10): each page opened in the browser is kept in IndexedDB (its Yjs
  document, via y-indexeddb 9.0.12, MIT), loaded before the page connects. Without a connection the
  page stays editable, and the edits merge with the server's state when it returns (the sync
  handshake sends only what the server lacks, which also keeps the comment-thread guard happy).
  Pages edited offline and closed before reconnecting are sent in the background the next time
  the app is open. The page header shows Offline / "Offline · edits kept here" / Syncing… /
  Synced. The sidebar tree and the last 30 databases and rows opened are kept for reading offline
  (read-only, with a note saying from when); actions that need the server (share, comments,
  favorites, page menu, search, inbox, new pages, templates, import, trash, sign-out, the icon
  picker) are turned off offline with a tooltip saying so. Copies are stored per user and wiped
  on sign-out (with a warning when edits haven't synced), when another user signs in on the
  browser, and per page when the collab server refuses it: its refusals now carry a reason
  (`forbidden`, `two-step`, `unauthorized`) and only `forbidden` drops the copy. Collab tokens
  stay in memory only. New checks: `scripts/offline-e2e.ts` (17), `scripts/sw-e2e.ts` (12, headless
  Chrome), `src/lib/offline.test.ts`.
- **Installable app** (#44): web app manifest (`/manifest.webmanifest`, standalone, start URL
  `/`), icons (192, 512, maskable 512, SVG, favicon, Apple touch icon, from the "e" mark), light
  and dark theme colours, iOS home-screen meta tags, and a hand-written service worker
  (`public/sw.js`, production only; `pnpm dev` unregisters a leftover one). It caches the app's
  hashed scripts, the icons and an offline page, and keeps the HTML of the last 50 signed-in pages
  per user (read from `<meta name="leafdesk-user">`) for use only when the network fails; a
  different user's page drops the previous user's copies, a 404 drops that page, and API
  responses, uploads, server actions and the websocket are never touched. Offline, pages never
  opened go to `/offline`, which lists the pages kept on the device, and the start URL goes to the
  last page opened. The browser's install prompt is kept for an "Install app" item in the
  workspace menu instead of a banner. README: install and offline use, and a short Tauri /
  Electron / installed web app comparison for a desktop shell (not built). The Docker image now
  copies `public/`. No migration.
- **Phones:** the editor's formatting toolbar scrolls sideways within the screen instead of
  widening the page (which zoomed the whole page out), and the slash and link menus stay inside
  the screen.
- **Teamspaces** (#36): pages and people are grouped into teamspaces. Every workspace gets a
  *General* teamspace (default: everyone is in it and stays in it, new members included); all
  existing top-level pages move into it with their subpages, so nobody's access changes, except
  a guest's private pages, which stay private. Access types: **default**, **open** (visible to
  every member, who can join; until then they read and comment), **closed** (visible, but its
  pages open only to its members, whom its owners add; no join requests) and **private** (only its
  members see it, workspace owners included). Pages outside any teamspace are **private** to their
  creator unless shared. Owners and members only: guests are never in teamspaces and keep getting
  single pages. The rule lives in SQL (`page_access_level`), so the sidebar, search, @-mentions,
  exports, sharing, MCP, the REST API and live collaboration all follow it.
  - **Sidebar:** a *Teamspaces* heading with a section per teamspace you're in (new page, new
    database, from a template, import, edit, leave), *Shared* for pages shared with you from
    elsewhere and *Private* for your own. Dragging a page onto another teamspace or onto Private
    moves it there after a confirmation; the Move dialog lists teamspaces and Private too.
  - **Settings → Teamspaces:** active and archived teamspaces with search and owner/access
    filters, members and owners, a row menu (edit, members, join, leave, archive), the default
    teamspaces (always in effect, no "update" step) and "Only workspace owners can create
    teamspaces". The members table gets a Teamspaces column.
  - **Who may do what:** creating needs a member when the workspace allows it, else an owner;
    managing a teamspace needs one of its owners (or a workspace owner, except for a private one
    they aren't in); making a teamspace default, or not default any more, needs a workspace owner
    (everyone stays in a former default teamspace until they leave). Every teamspace keeps an
    owner: the last one can't leave, and someone leaving the workspace hands theirs to the
    teamspace's oldest member, else to the owner who removed them. Archiving hides a teamspace and
    stops new pages in it; its pages keep their access.
  - **Moving:** a page moved to another teamspace, or to Private, takes the access of its new place
    with all its subpages; its own "everyone" entry is dropped and people shared by name keep
    theirs. Restoring a page whose parent is still in the trash keeps the access it inherited.
  - **Where new pages go:** the teamspace you add them in; from Home, the first default teamspace;
    from MCP or the REST API without `teamspace_id`, Private. Duplicates stay in their teamspace;
    copies of published pages are private.
  - **MCP and REST:** `list_teamspaces` / `GET /workspaces/{id}/teamspaces`; `teamspace_id` on
    `create_page`, `create_database`, `move_page` and `list_pages` (and their REST endpoints);
    pages report their teamspace.
  - Migration `0021_teamspaces`. Top-level pages that older code creates without a teamspace and
    without an "everyone" entry are sent to the first default teamspace when their transaction
    ends, so they keep the access they had.

- **Export as PDF** (#47): "Export as PDF" in the page menu opens the page's print view
  (`/print/<page id>`) in a new tab and the browser's print dialog once its images, fonts and
  Mermaid diagrams have loaded ("Save as PDF"). The view draws the page like its published version
  (shared with it: `components/published/published-body.tsx`), always in the light theme, with
  print rules: `@page` margins, code blocks and tables wrapped to the page width, headings kept
  with what follows, figures, callouts and table rows not split, backgrounds kept. Links to other
  pages print as their titles ("No access" for pages hidden from the reader), PDFs and embedded
  sites as a card naming them, toggles open. "Include subpages" adds the pages under it in sidebar
  order (at most 100), each on a new sheet. Same access as opening the page (404 otherwise) and
  the workspace's two-step policy; the body is read from the live document, so recent edits are
  in. No new dependencies, no migration.
- **REST API with personal access tokens:** `/api/v1` offers workspaces, pages (read with the
  whole Markdown body, create, update title, icon and body, move, trash, restore, sub-pages),
  search, databases (schema, queries with filters, sorts, saved views and cursor pagination),
  rows (add, add up to 100 at once, update one or many, read) and comments (list, start a thread,
  reply). It shares its service layer with the MCP server (`src/server/operations.ts`), so both
  check input and access alike and save page history before every body change. Tokens are
  created in Settings → Connected apps: read only or read and write, optionally limited to one
  workspace, expiring after 7, 30, 90 or 365 days or never; the secret (`esi_` plus 40 letters
  and digits, easy for secret scanners to match) is shown once and stored as a SHA-256 hash; the
  list shows when each token was last used, and revoking takes effect at once. Pages the user
  can't see, or outside a token's workspace, answer 404; errors are JSON with a code; each token
  may make 180 requests a minute (`API_RATE_LIMIT`), bodies are limited to 5 MB, only tokens
  authenticate (never the session cookie) and CORS stays off unless `API_CORS_ORIGINS` is set.
  Like MCP's OAuth tokens, API tokens are outside the workspace two-step verification policy.
  An OpenAPI 3.1 document is served at `/api/v1/openapi.json` and rendered at `/docs/api`.
  Claiming an account through an email-verified sign-in also revokes its tokens (migration
  `0020_api_tokens`).
- **My account** (#54): a page of its own at `/account`, opened from "My account" (or the name
  and picture) in the workspace menu, with Profile, Security, Preferences and Connected apps tabs.
  Language, notifications, two-step verification, passkeys and connected apps moved here from the
  workspace settings; the old settings addresses redirect. New:
  - Name and an uploaded picture (PNG, JPEG, WebP or GIF up to 2 MB, cropped to 256×256 in the
    browser, checked by content, served only to signed-in people from `/api/avatars/…`). Pictures
    now show in the sidebar, member lists, the share dialog, presence, person properties,
    mentions and comments.
  - Changing the password (optionally signing out every other device) or, for GitHub/Google-only
    accounts, setting one; a notice goes by email.
  - Changing the email address through a 24-hour link sent to the new address, confirmed on a page
    that signs nobody in; the old address is told. Off, with an explanation, without SMTP in
    production.
  - Signed-in devices with browser, system, IP and last activity; sign out one or all others
    (which also closes their live collaboration connections).
  - Deleting the account after typing its email. Refused while the person is the only owner of a
    workspace others are in; otherwise workspaces nobody else is in are deleted with their files,
    the others are left the way leaving works (an owner takes over pages only this person could
    manage), and sessions, passkeys, connected apps and the picture go with it.
  - Email, password and deletion ask for the password again, or a two-step or recovery code for
    accounts without one, or else a sign-in from the last 10 minutes; all of it is rate-limited.
  No migration: email-change links use the existing `verification` table and pictures the upload
  storage.

- **Workspace site and Duplicate for published pages:** owners set up a site in Settings → Site: a
  slug (lowercase letters, digits and hyphens, 3–40 characters, unique, a few reserved), a title
  and a home page picked among published pages. `/s/<slug>` opens the home page with a navigation
  (sidebar, a menu on phones) of the publications listed in the site, each with its subpages;
  pages live at `/s/<slug>/<title>-<id>` (old titles redirect), and mentions of other listed pages
  link within the site. A publication is listed only when its publisher (Publish tab) or an owner
  (Settings → Site) turns it on, so link-only pages never show up; the home page is listed when it
  is picked, and the site falls back to its first listed page while the home page is offline.
  Existing `/s/<token>` links keep working, and each page keeps its publication's search-engine
  setting. New per-publication option **Allow duplicate** (off by default): a Duplicate button on
  the published page lets a signed-in visitor (others sign in first and come back) copy the page
  and its published subpages to the top of one of their workspaces, optionally as a template. Only
  what the publication shows is copied (pages the publisher can see, public properties, web
  views); bodies are rebuilt without comments, history, reminders or people's ids, pages that
  weren't copied read as the published page showed them, and uploaded files are copied into the
  new workspace within its quota. Five duplicates a minute and thirty an hour per person
  (migration `0018_site_and_duplicate`).
- **Export with subpages and whole-workspace export:** "Export with subpages" in the page menu
  ("Export with row pages" for databases) downloads a ZIP of the page and everything under it, and
  owners can download the whole workspace from Settings → General → Export. Pages are Markdown,
  databases CSV with their row pages in a folder beside them (each row page lists its
  properties), and uploaded files the pages and rows show are copied into `files/`. The layout
  mirrors the sidebar, with names made safe and unique per folder; links between exported pages
  and to their files become relative paths, links to anything left out point at the app. Only
  pages the person can view go in (hidden ones are left out and links to them say "No access");
  the trash is left out; templates are kept in `Templates/` folders. The archive is streamed as it
  is built (fflate), one export at a time per person, and exports over `EXPORT_MAX_PAGES` (10,000)
  pages or `EXPORT_MAX_FILES_MB` (2,048) of files are refused up front with a message. No
  migration.
- **Import Markdown and CSV** (#45): "Import" in the sidebar (and in the "+" menu) opens a dialog
  that sends files to the new `POST /api/import` route.
  - Markdown files, a picked folder or ZIP files become pages under a chosen page or at the top
    level, keeping the folders as the page tree: a folder next to `Name.md` holds that page's
    subpages, other folders become pages whose body is their `index.md`/`README.md`. Titles come
    from front matter or a first `# Heading`, else the file name (Notion's ids left out). Links
    between the imported files become page links (mentions); images and files a page shows by
    relative path are uploaded to it and the links pointed at the uploads; images inside a line of
    text get lines of their own. CSV files in the upload become databases, and pages in their
    folder become the bodies of the rows with the same title (or new rows). Notion's layout is
    understood (`Export-…` folder, split exports with ZIPs inside, `_all.csv`), and so is Leafdesk's
    own export: its `Templates/` folders become the database's row templates and, when importing
    at the top level, workspace templates again (under a page they're pages of a "Templates"
    page), and the property list at the top of a row's page is left out of the row's body when it
    says what the CSV does. Exporting such an import gives the same archive back
    (`scripts/roundtrip-e2e.ts`).
  - A CSV file becomes a new database, each column typed as guessed from its values (number,
    checkbox, date in ISO, day-first or month-first form, URL, email, select or multi-select for
    few repeating values, else text) and changeable in the dialog, or its rows are added to an
    existing database with a column → property mapping (options a select, multi-select or status
    column names are added; people and related rows are found by name or email). Comma, semicolon
    and tab separators, UTF-8 or Windows-1254 text, and Leafdesk's own CSV export read back.
  - All or nothing: limits (100 MB upload, 300 MB unpacked, 2,000 files, 500 pages, 5,000 rows,
    100 columns) are checked first, and a failure midway deletes what the import made. What it
    left out is reported in the dialog: cells that didn't fit their property (left empty),
    missing or too large images, skipped files. Needs edit access to the destination page or
    database (top-level imports follow the usual rules for guests).
- **Two-step verification and passkeys** (Settings → Account security): an authenticator app
  (TOTP, QR code or typed key) with ten one-time recovery codes shown once to copy or download,
  new codes on demand, and "don't ask again on this device" for 30 days. Signing in with a
  password or with GitHub/Google then asks for a code or a recovery code; signing in to connect
  an MCP app continues to its consent page after the code, either way. Turning it off asks for
  the password, or a code on accounts without one. Passkeys can be added, renamed and removed,
  and "Sign in with a passkey" is on the sign-in page. Built on Better Auth's `twoFactor` plugin
  and `@better-auth/passkey`; migration `0018_two_factor_passkeys` adds the `two_factor` and
  `passkey` tables, `user.two_factor_enabled` and `session.auth_method` (how a session signed
  in). `pnpm auth:reset-2fa <email>` resets an account that lost both its app and its codes.
- **Require two-step verification** (workspace Settings → Security, owners): people whose session
  has neither the authenticator app nor a passkey sign-in are sent to a page where they set one
  up before they can open the workspace. The access checks enforce it for server actions and API
  routes too, and the live collaboration connection checks it when it connects (turning the
  policy on closes the ones that don't pass). An owner can turn it on only from a session that
  passes, and the settings show how many people haven't set anything up yet. Apps connected over
  MCP are not affected.

- **Files & media property:** a database property that holds uploaded files. Images show as small
  thumbnails in tables, boards, lists, galleries and row pages, other files by name; the cell
  editor uploads (pick or drop, several at once) and removes them. Galleries can take their cover
  from the first image of a files property. Files in a value open for anyone who can see a row
  holding them, and for visitors of a published database: the `file_reference` trigger now also
  tracks `/api/files/<id>` URLs in row property values (migration
  `0016_files_property_references`). A value can only hold files of the same workspace that the
  person setting it can open. Removing a file from a value never deletes it; it stays with the row
  it was uploaded to and follows the usual cleanup. Filters: is empty / is not empty; sorting by
  the number of files; formulas read the file names as a list, rollups count them. CSV export
  writes one "name (URL)" line per file. Forms can ask for files, on public links too: uploads wait
  with the database (rate limited per address and per form on public links) until the answer
  arrives, and the new row takes them over. MCP returns values as `[{name, url}]`, sets them from
  URLs of files already uploaded to the workspace (no outside URLs), `attach_file` takes
  `property` to add an upload to a row's files property, and gallery views take a files property
  as `cover`.
- **PDF preview:** a file block holding an uploaded PDF shows it in place with the browser's PDF
  viewer (and a link to open it), in the editor and on published pages. It loads
  `/api/files/<id>?view=pdf`, which serves only files stored as PDF; PDFs are framable by the app
  itself only (`frame-ancestors 'self'`). Markdown export keeps the block as a link.
- **Web bookmarks and embeds:** "Web bookmark" and "Embed" in the slash menu, and pasting a lone
  link into an empty line offers Bookmark, Embed (for supported sites) or Keep as link. A bookmark
  is a card with the page's title, description, icon and preview image; the server fetches them
  once (Open Graph and meta tags) and stores them in the block, and "Refresh preview" fetches them
  again. The fetch needs edit access to the page, is rate limited per user and guarded against
  server-side request forgery: http(s) on web ports only, every resolved address must be public
  (no private, loopback, link-local, CGNAT, multicast or IPv6 ULA/link-local), each of at most
  three redirects is checked again, 5 s and 1 MB at most, head only. Preview images are hotlinked
  with `referrerPolicy="no-referrer"` rather than proxied. Embeds show YouTube (via
  youtube-nocookie), Vimeo, Loom, Figma, published Google Docs/Sheets/Slides, CodePen, Spotify and
  Google Maps in a sandboxed, lazy iframe whose address is always rebuilt from the pasted URL;
  other links become bookmarks. Both show on published pages. In Markdown (export, MCP) a bookmark
  is a `[Title](url)` line, which a rewrite of the page turns back into that bookmark (other link
  lines stay links; `<!-- leafdesk:bookmark -->` after a link makes a new one), and an embed is
  `[url](url) <!-- leafdesk:embed -->`. Uploaded PDFs show in place (see PDF preview).
- **File uploads:** image, video, audio and file blocks now take files: drop, paste or pick one
  and it is uploaded instead of asking for a URL. Files are stored on a local volume by default or
  in S3-compatible storage (AWS S3, Cloudflare R2, MinIO) with `S3_BUCKET` and its credentials.
  `UPLOAD_MAX_FILE_MB` (default 50) and `UPLOAD_WORKSPACE_QUOTA_MB` (default 10240) limit a file
  and a workspace, checked while the upload arrives. A file opens for people who can see a page
  showing it, so duplicates and pages made from templates share it, and for visitors of published
  pages. Only raster images, video, audio and PDF open in the browser; SVG and everything else
  download. Deleting a page for good removes files no other page shows, and uploads nothing used
  are removed after a day. Docker Compose keeps files in a new `uploads` volume.
- **MCP:** `attach_file` uploads a file to a page from a URL or base64 data and adds it to the
  body. It needs the new `files:write` scope; apps registered earlier may request it too. URLs
  that resolve to private, loopback or link-local addresses, or redirect to them, are refused.
- **Mentions and page links:** type `@` in a page to mention a person, a page or a date. A page
  mention shows the page's current icon and title and follows renames; a page you can't open shows
  as "No access" without its title, and one that was deleted as "Deleted page". "Link to page" in
  the slash menu adds a page link on a line of its own. Mentioned people get an inbox notification
  (and an email a minute later) once per mention, only if they can open the page, and not again when
  the page is saved; taking the mention out before they read it takes the notification back. Click
  a date to set a reminder (on the day, a day or a week before, at 9:00): it reaches the inbox and
  email of whoever set it. Pages list the pages linking to them under "Linked from", as far as the
  reader can see them. Mentions and reminders have their own notification preferences. The server
  finds new mentions, links and reminders when it saves a page, whoever made the change.
- **Mentions in Markdown and MCP:** a page mention is a link to the page
  (`[Title](/w/<workspace>/p/<page>)`, any link to a page of the app becomes one), a Link to page
  block is that link alone on its line followed by `<!-- leafdesk:page-link -->`, a person is
  `@Name` and a date `@2026-10-01`. Exports and MCP's `get_page` show each linked page's current
  title, or "No access"; writing the Markdown back keeps mentions (nobody is notified twice) and
  reminders. `get_page` lists the pages linking to a page under `linked_from`, and
  `list_notifications` includes mentions and reminders. Published pages link mentions of pages that
  are published too and show others as plain text.
- **Presence:** the page header shows who else has the page open, as avatars in their cursor
  colors with "+N" for more than four; click them for everyone's names. People who can only view
  the page count too, each person shows once however many tabs they have open, and you don't see
  yourself. The collab server names each viewer after the account they signed in with.
- **Find and replace in a page:** Cmd/Ctrl+F inside a page opens a find bar over the editor. It
  highlights every match, shows "3/12", steps with Enter and Shift+Enter, and can match case. People
  who can edit also replace the current match or all of them in one undo step, synced to everyone
  on the page. Matches stay within a block, and the selected text fills the search box.
- **Templates:** save a page or database, with its subpages, as a workspace template from the page
  menu, and create new pages from it via "From a template" in the sidebar or on the home page. The
  copy leaves out the template's comments and gets the access of where it's created. Using a
  template needs view access to it and edit access where the new page goes. A built-in gallery
  (meeting notes, weekly plan, project tracker) creates its pages only when you pick one. Templates
  are kept out of the sidebar, search, trash, favorites and published sites, and deleting one
  removes it for good.
- **Database row templates:** the arrow next to "New" lists a database's row templates with preset
  properties and content, adds a row from one, and sets which one "New" uses by default. MCP
  `create_database_row` uses that default too when no values are given.
- **MCP:** `list_templates` lists workspace, built-in and row templates, and `create_page` and
  `create_database_row` take a `template_id`.
- **Editor blocks:** callouts with an icon and a background color, equations in LaTeX (a block of
  their own or inline in text, rendered with KaTeX), Mermaid diagrams with a live preview, a table of
  contents that follows the page's headings and scrolls to them, and a breadcrumb of the pages above.
  All are in the slash menu and show on published pages. In Markdown (export, MCP) a callout is a
  GitHub alert (`> [!NOTE]`), equations are `$…$` and `$$…$$`, a diagram is a ```` ```mermaid ````
  fence, and the table of contents and breadcrumb are `<!-- leafdesk:toc -->` and
  `<!-- leafdesk:breadcrumb -->` lines; all of them are read back into blocks.
- **Columns** (#16): "2 columns" and "3 columns" in the slash menu place blocks side by side;
  inside a column the menu offers "Add column" instead (up to five). Blocks move into, out of and
  between columns with the side menu's drag handle; a column whose last block is dragged away or
  deleted goes, and a column list left with one column turns back into plain blocks.
  Columns are equal by default and resized by dragging the line between them (stored as each
  column's share, so it syncs, undoes and keeps its proportion at any width). On screens narrower
  than 640px they stack, in the editor and on published pages, where tables of contents, diagrams,
  embeds and databases inside columns show in place. In Markdown (export, MCP) columns are marker
  lines around their blocks (`<!-- leafdesk:columns -->`, `<!-- leafdesk:column -->` before each
  column, optionally `width=2`, and `<!-- leafdesk:/columns -->`), so plain Markdown readers see
  the blocks in order and writing a body back keeps its columns. Built on BlockNote's own column
  support in its core; its multi-column package (GPL-3.0 or commercial) is not used. No migration.
- **"Can comment" access:** share a page so people can read and comment on it without editing it.
  Their comments mark the selected text on the server, so the page itself stays read-only for them.
- **Comments on pages:** select text and choose Comment to start a thread; reply, react with emoji,
  edit or delete your own comments, and resolve or reopen threads. Threads update live for everyone
  on the page and are listed in a Comments panel from the page header. People who can edit a page
  comment on it, people who can view it read the comments, and full access also deletes other
  people's comments and threads. Replies notify everyone in the thread (a new thread notifies the
  page's author) in the inbox and, a couple of minutes later, by email; Settings > Preferences turns
  either off.
- **MCP:** `list_comments` reads a page's comment threads and `add_comment` starts a thread on quoted
  text or replies to one.
- **Social login:** sign in with GitHub or Google, each turned on by setting its
  `*_CLIENT_ID` and `*_CLIENT_SECRET`. A provider account opens the existing account with the same
  verified email, and closed sign-up admits only existing or invited people (see README). If that
  account's email was unverified, its password, other sessions and connected apps are removed, so
  someone who registered another person's email can't keep access.
- **Inbox:** pages shared with you now show in the inbox next to assignments, and you get an email
  about them a little later. A share undone right away sends nothing.
- **Notification preferences:** Settings > Preferences chooses, for assignments and shared pages
  separately, whether they show in the inbox and whether they come by email.
- **MCP:** `list_notifications` lists the user's inbox. It needs the new `notifications:read`
  permission. Apps connected earlier can ask for it too; the user approves it once on the consent
  screen.
- **Database filters** can be combined with "or" and grouped two levels deep. Date filters can be
  relative: today, this week, this month, or the past or next N days. MCP `query_database` and the
  view tools accept the new shape, and flat filter lists keep working.
- **Column calculations** in table views: count, sum, average, median, min, max, range, earliest,
  latest, percent checked and more. They are calculated over the filtered rows and saved with the
  view.
- **Bulk row actions:** select rows in a table (shift-click for a range, or select all) to set a
  property, duplicate, export as CSV or move them to the trash at once. Rows you can't change are
  skipped and reported. MCP `update_database_rows` sets the same values on up to 100 rows.
- **New property types:** Status (options grouped as to do, in progress and done), Checklist
  (sub-items with progress), Email and Phone (click to write or call).
- **System properties:** when a row was created, when it was last edited, and who edited it last.
  They are read-only and can be filtered (including relative dates) and sorted. They are included
  in CSV export and MCP. Editing a row's body counts as an edit.
- **Formula properties:** compute a value per row from other properties with arithmetic, text,
  date and logic functions. The editor shows mistakes as you type, and results filter, sort,
  export and show over MCP like values of their type.
- **Rollup properties:** count, sum, average, min or max, percent checked, or list the values of
  related rows (only the rows you can see), shown as a number, bar or ring.
- **More grouping:** boards and tables group by multi-select, checkbox, date (day, week, month or
  year), created or edited time and relation, and statuses by their to do / in progress / done
  group. Tables show groups as collapsible sections with counts, their own calculations and a
  New row that fills in the group's value.
- **Gallery view:** cards with the first image of each row's page as cover, in three sizes.
- **List view:** one compact line per row, with the properties you choose on the right.
- **Timeline view:** bars from a start date to an optional end date, day, week or month zoom,
  drag to move or resize, swimlanes by any groupable property, and a "No date" section you can
  drag rows from. MCP `create_database_view` and `update_database_view` handle the new views.
- **Chart view:** vertical or horizontal bars, a line or a donut over a grouping property, counting
  rows or using any column calculation (sum, average, median…). Counts and sums can be stacked by
  a second property that holds one value per row (select, status, checkbox, date, created or
  edited time and by), so every row is counted once. A donut's center shows the number of rows,
  even when a row sits in several slices. Hover a bar for its value, click it to list its rows.
- **Form view:** ask for chosen properties in order, with labels, help text, required answers,
  default values and a thank-you message. Each answer adds a row. A form can get a public link
  (`/f/…`) for signed-in or anonymous answers, guarded by rate limits and a hidden field that
  password managers leave alone. A link stops taking answers when whoever opened it can no longer
  add rows; the form and Settings say so, and anyone who can edit it can take it over. Owners see
  and close every public form under Settings > Security. MCP can create and change forms and
  their links. Behind reverse proxies, set `TRUSTED_PROXIES` (default 1) so limits count real
  visitor addresses.
- **Inline databases and linked views:** the slash menu adds a database inside a page, or a view
  of an existing database whose layout, filters and sorts are kept in the page. What a block shows
  follows the reader's access to the database. Published pages show them as tables.
- **Changes in page history:** compare a version with the current page or with the version before
  it. Changed blocks are shown with added words in green and removed words struck through in red;
  unchanged stretches are folded. Each comparison names who made the changes, and changes an AI
  app made through MCP name the app. MCP `diff_page_version` returns the same comparison as text.

- **Publishing options:** pick which views of a database published pages show; visitors switch
  between them, and boards, lists and galleries look like they do in the app (calendars,
  timelines and charts show as tables). Boards by people or linked rows show as tables, and only
  the values a view shows reach the visitor. A publication can let search engines index the page
  and its subpages; it is off by default, and Settings > Security shows which ones allow it.
- **Trash and history retention** (#55): owners choose in Settings > Security > Data retention
  how long pages stay in the trash (7 to 365 days, or never; 30 by default, stored in
  `workspace.settings.trashRetentionDays`, no migration). The trash shows how many days each page
  has left, MCP `list_trash` returns `deletes_at`. Once a day the server deletes the pages whose
  time is up the way *Delete permanently* does (subpages and files included) and prunes page
  history: versions older than 90 days or past the newest 200 of a page go, saved versions and
  versions from before a restore stay a year, and the newest version of a page always stays. With
  several replicas a Postgres advisory lock lets one run at a time; each run logs what it removed.
  The cleanup runs on production servers; `RETENTION_JOB=on|off` overrides that (a dev server
  leaves the data alone unless it is `on`).
  New checks: `scripts/retention-e2e.ts` (35), `src/lib/retention.test.ts`.

### Changed

- **Renamed from Esionage to Leafdesk.** The repository is now `esmworks/leafdesk` and the image
  `ghcr.io/esmworks/leafdesk`. Stored names changed too, with no fallback for the old ones:
  `ESIONAGE_VERSION` is now `LEAFDESK_VERSION`; the bundled database user, password and name
  default to `leafdesk`; markdown markers are `<!-- leafdesk:… -->`; SSO domains are verified
  with a `_leafdesk-sso.<domain>` TXT record; offline edits, service worker caches and browser
  settings use `leafdesk` keys. An existing installation needs a new database (or
  `EXTERNAL_DATABASE_URL` pointing at the old one) and its SSO domains verified again.
- ESLint 9 with Next.js's rules (`eslint-config-next`): `pnpm lint`, also a CI step, fails on
  warnings too. The React Compiler checks are off (the app doesn't use it), and so are the rules
  for `<img>` (images come from any origin) and for full page loads after signing in or out (on
  purpose).
- Better Auth's `/update-user` endpoint now only accepts a name or removing the picture, so a
  picture can't point at an arbitrary URL. A password change that signs out other devices keeps the
  current session's sign-in method (a passkey session keeps satisfying a workspace's two-step
  policy).
- **Published databases** show the columns their first view shows. A board no longer publishes
  the text and number properties it hides on its cards.
- **New databases** start with a Status property of the status type (to do, in progress, done)
  instead of a select.
- **Teamspaces, laid out like Notion's.** Settings > Teamspaces starts with the default teamspaces
  (picked in one field, applied with *Update* after a confirmation) and who may create teamspaces,
  then lists the teamspaces with status, owner and access menus, a search button, "N members ·
  Joined" under each name, the owners' pictures, an access menu in each row (changes to and from
  *Default* ask first) and sorting by last update. In the sidebar a teamspace stays closed until
  opened (the open ones are remembered per browser), opening a page unfolds the way to it and
  scrolls it into view, the Teamspaces section ends with *Add new* (or *Browse teamspaces* for
  those who can't create one), and Private and Shared show their first ten pages with a row for
  the rest.

### Fixed

- Searching in the share panel, the groups, members and teamspace lists, the @-mention menu, the
  person, relation and select pickers and the move and link-to-page dialogs no longer misses
  names with "I" in a Turkish-locale browser (typed "I" could fold to "ı" while the names folded
  to "i").
- Empty lines on published pages no longer show as a box.
- Typing right after pressing New in a database keeps the first letters, including accented
  letters, other keyboards and pasted text, and Enter no longer adds a second empty row.
- A formula dividing by an empty property is empty instead of a "division by zero" error.

## 0.2.0 — 2026-09-27

### Upgrading from 0.1.0

- **Docker Compose:** the bundled PostgreSQL now starts only when `COMPOSE_PROFILES=bundled-db`
  is set in `.env`. Add that line before `docker compose up -d`, or the database container won't
  start. Your data stays in the same volume.
- **Database port:** `docker-compose.yml` no longer publishes PostgreSQL on the host. In a clone of
  the repository, `docker-compose.override.yml` still publishes it on `127.0.0.1` for `pnpm dev`.
- **Migrations** (0001–0008) run automatically when the container starts. Existing pages,
  databases, members and connected AI apps keep working, and every member keeps full access to
  existing pages.
- **Docker image:** releases are published to `ghcr.io/esmworks/leafdesk`. `docker-compose.yml`
  runs that image. Set `LEAFDESK_VERSION` to pin a version.

### Added

- **Email (SMTP)** for invitations, password reset and assignment notifications. Configure it
  with `SMTP_URL` or `SMTP_HOST`/`SMTP_PORT`/…, plus `MAIL_FROM`.
- **Invitations:** invite people who don't have an account yet by email. Invitations expire after
  7 days and can be revoked. The Members page adds bulk invites, a workspace join link and a CSV
  export.
- **Password reset** by email.
- **`DISABLE_SIGNUP`** closes public sign-up. Invited people can still sign up through their link.
- **Page sharing:** share a page with members or by email, restrict it, and let subpages inherit
  its access.
- **Guest role:** guests see only the pages shared with them. Owners decide whether members may
  invite guests and whether guests may create private pages.
- **Publish to the web:** a read-only public link for a page and its subpages. It is hidden from
  search engines and can be revoked. Owners decide whether members may publish, and Settings →
  Security lists every published page so owners can take any of them offline.
- **Databases:** relation and person properties, a "created by" property, calendar views, a
  viewer-dependent "Me" filter, sorting and board grouping by person. On boards you can reorder
  columns, add groups and hide long card fields.
- **Assignments:** people assigned to a row get an email and an in-app inbox notification.
- **MCP tools** for moving pages, views, property edits, trash, history and adding many rows at
  once (`create_database_rows`).
- **English and Turkish** interface.

### Changed

- When someone leaves a workspace, pages only they could manage are handed to an owner.
- Sessions are checked against the database on every request, so signing out or removing a member
  takes effect immediately. Removing a member also closes their open editors.
- Reworked sidebar, settings and wide database layouts.

### Fixed

- Restricted pages no longer show up in any read path: lists, search, MCP tools, rows, moves,
  publications and live collaboration.
- Concurrent edits to a page title merge instead of dropping keystrokes. Titles of pages created
  in 0.1.0 are converted on their first edit.
- Controls that did nothing are now wired up or hidden.
- Settings → Members no longer scrolls the whole page sideways on narrower screens.

## 0.1.0 — 2026-09-26

First release: workspaces, nested pages with a collaborative editor, databases with table and
board views, search, page history, and an MCP server with OAuth for AI apps.
