# Project timeline example

This independently built plugin shows dated entries and dated statuses from **every** Markdown file in the open project, whichever document is selected. Increment 24 delivered its single-document predecessor; increment 74 extended it to the whole project and renders it through a custom interface so the view can own its filters, counts, and paging. Since increment 25 (0.5.0) it extracts nothing itself: it reads the project model (`project@1`) that Specular builds once and shares, and uses `physical@1` only for line numbers, file counts, and reading warnings.

It shows two kinds of event:

- **Recorded entries:** list items whose content begins with a real ISO calendar date, for example:

```markdown
- 2026-09-15: Added the first timeline view.
  The continuation remains part of the same event.
```

- **Statuses:** authored statuses of IDs whose value contains a date, such as `Status: Implemented on 2026-10-13` under `# REQ-001 ...`. The card shows the ID and its label, the configured status name in its configured colour, and opens the matched `on 2026-10-13`. Undated statuses are not events.

- **Milestones and last-updated dates (increment 80, 0.6.0):** headings containing a date, such as `## [0.23.2] - 2026-05-22` (shown with a Heading badge and the heading text without its date), and labelled fields such as `**Created**: 2025-12-12` (shown with the label as a badge and the document title). `Last Updated`-style snapshot rules are disabled by default; when enabled their cards say "last touched".

All date rules, and folders excluded from them, are configured in `.specular/project.json` (`dates`); see the project-ID guide.

## Scope

Events come from the project model, so they cover nested files and files that have never been opened, include unsaved editor buffers, and follow Specular's own folder exclusions and file-reading limits. Reading warnings from the physical model are shown, so incomplete coverage stays visible. The project model needs a ready ID index: before the first index the view says it is waiting, and after an edit it keeps the previous events with their source links disabled and an "Updating" note until indexing catches up, so a link never opens a stale position.

It ignores quoted and fenced examples, invalid calendar dates, undated entries and statuses, document-level `Last updated` dates, dated headings and tables, and statuses outside an ID's section. Their absence is not evidence that no event occurred.

Events are grouped by ascending calendar day. Within a day, order follows the project-relative file path and then the source position; this is deterministic display order and claims no time-of-day ordering. Identical text and conflicting dates in different files stay separate source accounts; nothing is merged or reconciled. Mentioned IDs follow the project's configured ID categories and are displayed as recorded mentions only; a status records what the specification states, not verified delivery.

## Controls

Source-file, mentioned-ID, inclusive date-range, event-type (recorded entries, statuses, milestones, or last updated), and status filters combine; the status filter lists every configured status, including unused ones, followed by any unconfigured names that dated statuses use, and **Show all events** resets them. The summary always reports matching and total events plus contributing and total files, so a filtered page never reads as the whole project. A range that ends before it starts, no supported entries at all, and no matches for the current filters are reported as three distinct outcomes. Results are paged at 50 events; collection stops at 20,000 events and says so rather than trimming totals silently. Filtering by one file is how you inspect a single document — the view deliberately does not follow the active editor.

Each event opens its exact current source range through the host's validated navigation, in whichever file it came from. The view recomputes after edits, file additions, removals, renames, and project changes. Valid filters are retained across a refresh and across source return within a project, and reset on a project switch. Theme changes reuse the existing view instead of rebuilding it.

## Entries over time

Increment 75 adds a collapsible histogram above the filters. Bars count every collected entry across the whole project's date range, by day for spans up to 92 days, by Monday-start week up to 104 weeks, and by calendar month beyond that; empty days, weeks, or months are drawn as zero. Each bar is stacked by source file: the five files with the most entries get their own colour and the rest share an Other files segment, listed in a legend with per-file counts.

The chart drives the same filters as the cards. Click a bar to show that day, week, or month; drag across bars to select a range; click a legend file to show only that file, and again to clear it. Entries outside the file and ID filters stay visible but faint, and the selected date range is highlighted rather than zoomed. A dashed line marks today when it falls inside the range, separating recorded from future-dated entries. Bars are keyboard-reachable (Left/Right/Home/End, then Enter or Space), each announces its range and per-file counts, and a table lists every non-empty bucket. Counts are recorded dated entries, not measured activity.

## Build

Build the local SDK with `npm.cmd run sdk:pack`, install the generated tarball in this directory, then run `npm.cmd run build` and `npm.cmd run validate`. In Specular, select **Project Lens > Install plugin folder...** and choose this built directory. The package keeps its `example.document-timeline` identity, so installing it over an earlier version is an explicit replacement.

The entry additionally exports its pure `collectEvents`, `documentEvents`, `filtered`, `counts`, `days`, `readState`, `histogram`, `bucketUnit`, `bucketStart`, and `bucketEnd` helpers, which `scripts/test-plugin-sdk.mjs` exercises without a DOM. Verify dates, counts, filters, source navigation, keyboard focus, and live dark/light switching in both modes after an independent SDK build.
