# Changelog

## Unreleased

### Added

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
    understood (`Export-…` folder, split exports with ZIPs inside, `_all.csv`), and so is Esionage's
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
    and tab separators, UTF-8 or Windows-1254 text, and Esionage's own CSV export read back.
  - All or nothing: limits (100 MB upload, 300 MB unpacked, 2,000 files, 500 pages, 5,000 rows,
    100 columns) are checked first, and a failure midway deletes what the import made. What it
    left out is reported in the dialog: cells that didn't fit their property (left empty),
    missing or too large images, skipped files. Needs edit access to the destination page or
    database (top-level imports follow the usual rules for guests).
- **Two-step verification and passkeys** (Settings → Account security): an authenticator app
  (TOTP, QR code or typed key) with ten one-time recovery codes shown once to copy or download,
  new codes on demand, and "don't ask again on this device" for 30 days. Signing in with a
  password or with GitHub/Google then asks for a code or a recovery code. Turning it off asks for
  the password, or a code on accounts without one. Passkeys can be added, renamed and removed,
  and "Sign in with a passkey" is on the sign-in page. Built on Better Auth's `twoFactor` plugin
  and `@better-auth/passkey`; migration `0018_two_factor_passkeys` adds the `two_factor` and
  `passkey` tables, `user.two_factor_enabled` and `session.auth_method` (how a session signed
  in). `pnpm auth:reset-2fa <email>` resets an account that lost both its app and its codes.
- **Require two-step verification** (workspace Settings → Security, owners): people whose session
  has neither the authenticator app nor a passkey sign-in are sent to a page where they set one
  up before they can open the workspace. An owner can turn it on only from a session that
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
  lines stay links; `<!-- esionage:bookmark -->` after a link makes a new one), and an embed is
  `[url](url) <!-- esionage:embed -->`. Uploaded PDFs show in place (see PDF preview).
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
  block is that link alone on its line followed by `<!-- esionage:page-link -->`, a person is
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
  fence, and the table of contents and breadcrumb are `<!-- esionage:toc -->` and
  `<!-- esionage:breadcrumb -->` lines; all of them are read back into blocks. Columns are left out:
  BlockNote's multi-column package is GPL-3.0.
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

### Changed

- **Published databases** show the columns their first view shows. A board no longer publishes
  the text and number properties it hides on its cards.
- **New databases** start with a Status property of the status type (to do, in progress, done)
  instead of a select.

### Fixed

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
- **Docker image:** releases are published to `ghcr.io/esmworks/esionage`. `docker-compose.yml`
  runs that image. Set `ESIONAGE_VERSION` to pin a version.

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
