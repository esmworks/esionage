# Changelog

## Unreleased

### Added

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
