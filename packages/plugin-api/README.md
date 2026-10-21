# Specular plugin API 0.2.0

API 0.2 (increment 76) replaces the single workspace snapshot of 0.1 with **named, versioned development models** that each plugin declares in its manifest (DD-050). Specular builds each model once per project revision and shares it among the plugins that declare it. See [Models and evidence semantics](#models-and-evidence-semantics) and [Migrating from 0.1](#migrating-from-01).

### Appearance

Specular supplies optional `RenderRequest.appearance` with `mode: 'dark' | 'light'` and a fixed semantic `colors` palette. It was added under SDK 0.1.0 and remains part of 0.2. Missing appearance means legacy dark defaults. Host-rendered list, graph, and timeline models inherit the selected mode automatically; they need no palette code or rerender on a theme change.

For custom views, the host sets `data-theme` and `color-scheme` on the isolated document's `html` element before activation/update. It exposes `--specular-background`, `--specular-surface`, `--specular-text`, `--specular-muted`, `--specular-border`, `--specular-accent`, `--specular-selection`, `--specular-warning`, and `--specular-error`. Use these CSS variables with dark fallbacks, for example `color: var(--specular-text, #d7e0e6)`. No core DOM or settings access is granted. Palette inputs are validated and projected to host-owned values.

Live mode changes arrive through the existing `update(request)` lifecycle, even when the model revision is unchanged. Retain filters, selection, scroll, and camera state; a theme-only update should not rebuild the view. Follow the custom-definition-browser and bundled Relationships examples. Older custom interfaces that hardcode colors remain loadable but must adopt these variables or `appearance.mode` to follow the selected theme. Authored image pixels and explicit diagram styles are not recolored automatically. Build and inspect your package in both modes, including initial activation, live switching, source navigation, and reopening.

This is a local, experimental SDK artifact for read-only abstraction views (increment 30). It has no runtime dependencies and is not published to a registry. Increment 31 delivers isolated execution and graph/list rendering, increment 32 adds isolated custom interfaces, and increment 33 adds persistent local installation and management. Validation or compilation does not establish that a plugin is safe to execute.

## Build a plugin without Specular source

Use Node.js 22.12+ and TypeScript 7.0.2. Obtain `specular-plugin-api-0.2.0.tgz` and the standalone specification-index example. Copy the example into your own project directory, then run (use `npm.cmd` in PowerShell if needed):

```sh
npm install --save-dev /absolute/path/specular-plugin-api-0.2.0.tgz
npm run build
npm run validate
```

The SDK is a development dependency: the examples use only type imports, so compiled entries need no SDK or Specular source at runtime. Authors of list, graph, and timeline views implement `PluginModule` by exporting `render(request)` and optionally `dispose()`. Authors of custom views implement `CustomPluginModule` by exporting `activate(context)`. Do not import application internals. Bundle any other runtime dependencies into the entry. For reproducible author builds, retain the generated lockfile in your project. The SDK artifact includes declarations, JavaScript manifest validation, and the static validation CLI.

Use `examples/plugins/plugin-template` as the starting point for a list view. `examples/plugins/document-headings` is a second public-API-only example, alongside the specification index and the project timeline. `examples/plugins/document-timeline` is a single-file custom view whose extraction and filtering stay pure and separately testable; `examples/plugins/custom-definition-browser` is the minimal custom-view starting point. Copy a template before changing its identity; never install two packages with the same plugin ID.

## Local package format

A package is a directory containing `specular-plugin.json`, `package.json` with `"type": "module"`, and the compiled ESM entry. Build tools, source, SDK, and node_modules are unnecessary in a delivered package. The entry must be self-contained JavaScript; imports requiring Node, remote modules, or Specular internals are outside the contract. Specular installs either this directory or a `.zip` with these files at its root. Local packaged assets beyond the entry remain outside the 0.2.0 contract.

```json
{
  "manifestVersion": 1,
  "id": "example.specification-index",
  "version": "0.2.0",
  "api": ">=0.2.0 <0.3.0",
  "entry": "dist/index.js",
  "capabilities": ["workspace.read", "source.navigate"],
  "models": ["project@1"],
  "views": [{ "id": "definitions", "title": "Specification index", "kind": "list" }]
}
```

All eight fields are required; unknown fields are rejected. `models` lists 1-2 distinct models from `project@1` and `physical@1` (name and major version); requests contain exactly those models. IDs use `publisher.name` (lowercase letters, digits, hyphens; each component starts with a letter; maximum 128 characters). This is a namespace convention, not verified publisher identity. Package versions are stable `major.minor.patch` numbers without leading zeros, prereleases, or build metadata. API ranges deliberately support only an exact stable version or `>=x.y.z <x.y.z`, with one space. Other semver expressions are rejected. API 0.2.x is experimental. A compatible 0.2.x host accepts an exact `0.2.0` range or the documented bounded range `>=0.2.0 <0.3.0`; packages declaring a 0.1 range are reported as incompatible and never run. Future additive or breaking public changes require a new minor API version and updated examples; the host rejects an incompatible range before installation. Authors should set a range no wider than the API versions they have tested. Manifest schema version and API version are separate.

Entry paths are relative POSIX paths (maximum 240 characters); segments start with an ASCII letter, digit, or underscore and otherwise contain letters, digits, `_`, `-`, or `.`. Empty, parent, absolute, URL, Windows reserved-name, and trailing-dot segments are rejected. Entry filenames end in `.js`. The CLI requires ordinary files/directories without symlinks along the manifest, package metadata, or entry path; it bounds both JSON files to 64 KiB. It checks presence and metadata without executing the entry or examining JavaScript imports/assets. Future installation must revalidate copied files and runtime messages rather than trusting a previous validation result.

There must be 1-32 views with unique local IDs (lowercase letters, digits, hyphens; initial letter; maximum 64 characters), nonblank titles (maximum 120 characters), and `list`, `graph`, `timeline`, or `custom` kind. Their global identity is the pair `(plugin id, view id)`. Unknown contribution fields and capabilities are rejected. `workspace.read` is required; `source.navigate` is optional. Capabilities are requests, not permission grants. Neither capability permits writes, network, processes, raw filesystem access, credentials, or access to the application DOM.

## Models and evidence semantics

A request carries `context` and `models`. `context` holds the opaque host-issued project token (`projectId`), the nonnegative integer `revision`, and the optional `currentFile` (the active Markdown document). `models` contains exactly the models the manifest declares. Every content or index-readiness change gets a new revision, and every model in a request was computed from that revision. File selection changes trigger a new request too. Requests are immutable by contract; the host transfers isolated copies, and no mutable application objects or callbacks cross the boundary.

Every model shares one envelope: `name`, `version` (1), the `revision` it was computed from, `ready`, `provenance` (`extractor`, `extractorVersion`, and for the project model an optional opaque `configurationRevision`), and `warnings`. A model that is not ready has empty content. The envelope deliberately matches what a future extractor plugin would produce; API 0.2 has no extractor plugins.

**`physical@1`** describes the project structure: `folders` and `files` (`path`, `markdown`) found by the project scan, and `documents`, the current text of every Markdown file in scope, including unsaved editor contents. Paths are project-relative POSIX paths; no absolute workspace root is exposed. File-reading problems are summarized in `warnings`, so incomplete coverage stays visible. The physical model is ready as soon as the project is scanned.

**`project@1`** describes what the specifications state. It is ready only when the ID index is; while indexing, `occurrences` and `ids` are empty, and plugins must not treat a pending index as evidence of missing relationships. It contains:

- `occurrences`: ID definitions and references with their owners, folder scopes, categories, and module assignments.
- `ids` (increment 77): one `IdElement` per distinct ID. Its `key` equals `occurrence.key ?? occurrence.id` for every occurrence of that ID. It carries `id`, optional `scope` and `category`, the `definitions` (none means the ID is only referenced; several mean duplicates), `modules` and `features` memberships with evidence, and an optional `status`.
- `status`: `state` is `authored`, or `conflict` when the written values map to different names, plus one `StatusOccurrence` per place the status is written: the raw `value`, the configured status `name` it maps to (the value itself when no status rule matches), the `site` kind (`paragraphs`, `tables`, `headings`, or `checkboxes` for a task list marker such as `[x]`, increment 88), and the exact `source`. Statuses are authored text, not verified facts.
- `relationships` (increment 78): one `ProjectRelationship` per distinct pair, where `to` is mentioned inside the section that defines `from` (both are `IdElement` keys), with every mention recorded as `evidence` source ranges in index order. Folder-scoped IDs link only within their scope. `unownedMentions` counts mentions outside any ID's section; no link is inferred for them. A nested definition (85a), such as a scenario within its requirement, also links its parent to it, with the definition as evidence. A link recorded by an OpenSpec change (85b) has an optional `deltas` list naming the kinds of change it records (`added`, `modified`, `removed`, `renamed`, `new`); such references are owned by the change, whose definition is in another file of the change folder, so `occurrence.owner.source.file` may differ from the occurrence's file. A link is authored evidence, not proof of implementation; typed or inferred relationships are not part of the model.
- `events` (increments 79-80): free-standing dates found by the date rules, each with a `date`, a `text` (a list entry with continuations, the heading text, or the document title for a labelled field), its `source`, `mentionedIds` (keys of IDs referenced inside it), and an optional `owner` (the ID whose section contains it, or that a dated heading defines). Since increment 80, events also carry `site` (`list-entry`, `heading`, `field`), `kind` (`entry`, `milestone`, `snapshot`), and an optional `label` (`Created`, or a heading's text without its date). Treat them as optional: events without a `kind` are recorded entries. Dated statuses are not repeated here.
- Status occurrences may carry a `date` (increment 79), found by the status-date rule inside the value (first real calendar day). Every date is a `DateRecord`: an ISO day `value`, the matched `text`, its exact `source`, and the `rule` that found it (`status-date` or `event`). Dates have day precision and no planned/completed meaning of their own; that comes from the status `name`. The rules are configured in `.specular/project.json` (see the project-ID guide).
- `configuration` (increment 77): the configured `categories` (with roles and light/dark colours), `statuses` (in configured order, with light/dark colours), `modules`, and `features`, including entries no ID uses. It reflects the current configuration even while the index is not ready. Matching rules, recognition patterns, and site settings are not exported.

`provenance.extractorVersion` is `6` from increment 85b (`2` added `ids` and `configuration` in 77, `3` added `relationships` in 78, `4` added dates in 79, `5` typed date rules in 80, `6` change records in 85b); it changes whenever the project model's content grows under the same `project@1` contract. With dates in 79, the `project@1` contract is stable: later additions follow the API's versioning rules rather than growing it silently.

Occurrences carry an optional `category`:

```json
{ "key": "needs", "name": "Business needs", "role": "requirement" }
```

Category `key` is stable, `name` is a display label, and optional `role` is requirement, design, or task. An explicitly supplied category without a role has no special semantic behavior, even when its ID starts with REQ/DD/TASK. Several recognition rules can share a category. Use this metadata instead of inferring roles from prefixes. Configuration-only changes advance the ordinary revision too; source navigation still requires that integer revision and project token, never the configuration revision. Regex rules and configuration file paths are not exported.

Folder-scoped ID projects additionally supply optional `occurrence.key` and `occurrence.scope`, and the same metadata on `occurrence.owner`. `id` remains the exact authored token and source ranges are unchanged. For named elements (increment 85a), such as OpenSpec's `### Requirement: User login`, `id` is the name (`User login`), and a nested element is identified within its parent (`User login / Valid credentials`). Use `key ?? id` for identity, grouping, lookup and relationship endpoints; treat the key as opaque. `scope` is usually the canonical project-relative specification folder, suitable for a disambiguating label such as `FR-001 · specs/002-swift-version-compat`. Since increment 85a it can also be a file path, when each file is its own scope, or a captured scope such as `capability:identity` that spans folders; treat it as an opaque label. Missing scope means project scope. Unqualified references only target definitions with the same identity. `RenderRequest.targetId` uses that identity too. Never fall back from a missing scoped key to an equal raw ID in another scope. Plugins can still render raw IDs and source locations, but must use keys to group repeated scoped IDs correctly. Exact module-override evidence belongs to the containing occurrence's scope.

Scope patterns belong to individual categories. An occurrence and its owner may have different scopes, including one being project-wide; use each object's own identity metadata for relationship endpoints.

Physical-model document text uses normalized LF line endings, matching the editor and index, including unopened Windows CRLF files. Source ranges use zero-based UTF-16 offsets with an exclusive end into that supplied text; they are not byte offsets into the original disk file. Occurrence ownership points to the defining occurrence's range. `SourceReference` adds the exact project token and revision; view items, nodes, and edges can expose multiple references for the host's evidence/navigation UI. Rendered titles/descriptions are plain text, never HTML. Models contain JSON values only, with unique item/node/edge IDs, and edges must refer to existing nodes. The broker validates these constraints, payload limits, declared view kind, source bounds, and capabilities before rendering or navigation. Source evidence is always checked against the physical model's text, even for a plugin that declares only `project@1`; the host keeps both models and strips undeclared ones only from the copy the plugin receives. It rejects stale or foreign evidence and recomputes views after changes. Authored links remain authored evidence, not proof of implementation.

## Timeline views

A `timeline` model returns source-backed `{ id, date, text, ids?, sources }` items. `date` is a real ISO calendar day (`YYYY-MM-DD`) and carries no time-of-day or same-day ordering claim. The host groups items by day in ascending date order while retaining each same-day order supplied by the plugin. `text` is plain text and `ids` are recorded mentions, not inferred relationships. Each event requires at least one current `SourceReference`, so the host can open its evidence.

The standalone document-timeline example recognizes only Markdown list entries whose content begins with a valid ISO date, such as `- 2026-09-15: Recorded event`. It preserves indented continuation lines and ignores quoted/fenced examples, invalid dates, undated entries, document-level dates, and status formats. Those formats are deliberately outside the initial contract and will be considered by later timeline increments.

Since increment 74 that example collects the same format from every Markdown file in the physical model and renders it as a `custom` view titled Project timeline, keeping its `example.document-timeline` identity and `timeline` view ID for explicit package replacement. Host-rendered `timeline` models remain fully supported and unchanged; the example moved because filters, counts, and paging are view-owned interaction state rather than model shape. A project-wide collector should sort by day and then by project-relative path and source position, keep duplicate and conflicting accounts separate, report matching and total counts rather than presenting a filtered page as the whole project, and page or state a visible ceiling rather than dropping events silently. Since increment 25 the example reads events and dated statuses from `project@1` instead of parsing Markdown itself; it waits for the first ready index and disables source links on stale cards while a newer index is computed.

## Entry lifecycle

The host loads an entry in an isolated environment, invokes its named `render` export on view activation or model/target changes, and calls optional `dispose` at teardown. A render receives `apiVersion`, opaque `requestId`, local `viewId`, `context`, the declared `models`, and optional target ID; it returns a `RenderResult` echoing request/view/API/project/revision plus a list, graph, or timeline model. These inputs and outputs are the serializable public contract, not a chosen IPC transport. A plugin may return a promise. It should tolerate fresh activation and recompute from the supplied models; it cannot assume requests finish in order. The broker discards obsolete responses, handles errors/timeouts, terminates failed plugins, and revokes project data at project switches. Source return and view closure stop execution; reopening starts a fresh sandbox. A source reference is valid only for the exact project and revision supplied to that render; stale evidence is rejected. The SDK types alone enforce none of these runtime boundaries.

## Installation and runtime

### Bundled packages and custom API version 1

Manifests may declare an optional `title` for their grouped tab and `customApi: 1` for session-state support. Hosts predating these fields reject the manifest rather than silently omit required behavior; unknown custom API versions are rejected. Existing manifests and the base 0.1.0 wire contract remain supported.

With `customApi: 1`, custom activation additionally receives `saveState(text)`. A plugin may save at most 65,536 UTF-16 code units of opaque state and receives that text as `request.customState` on fresh activation. State is scoped to the registered view and project in application memory; source return, mode switching, and tab closure retain it, while project reset, plugin removal/replacement, and application exit discard it. State is inert plugin data, never a host command or source-navigation authority. Save after interactions and before requesting navigation; disposal is not a guaranteed persistence hook. Oversized or undeclared state messages fail the sandbox. Plugins must validate restored state and derive fresh evidence from the new snapshot.

Specular ships `specular.relationships` through the ordinary custom runtime. Bundled packages are enabled on first registration. The registry records bundled versus installed origin, and management displays the current and bundled versions. A preexisting or explicitly installed same-identity package takes precedence over the bundled copy, including after app upgrades. Upgrades select the shipped version only when the registry selects bundled origin, and preserve the explicit enabled/disabled preference. Failed or corrupt replacements stay unavailable until the user restores the bundled version; there is no silent code fallback. Restore preserves enabled state and retains the previous installed files for recovery. Bundled packages can be disabled or restored, but not uninstalled.

Use Project Lens > Install plugin folder... to select a built directory, or Manage plugins > Install .zip... for an archive. Specular validates compatibility, paths, metadata, entry, identity, and declared capabilities before copying the minimal runtime package into its user-data storage. Installed plugins survive restart. Manage plugins shows identity, version, capabilities, and view count, and provides open, enable/disable, and uninstall actions. Selecting an installed identity again requires explicit replacement; the previous package is retained if validation or the atomic replacement fails. No application rebuild is needed. The named `render` export is required; a default export alone is insufficient. Entries must be self-contained ESM; external imports are blocked.

Each active package uses a worker in a separate sandboxed Electron renderer with a dedicated local origin, isolated nonpersistent session, no Node integration, and no application preload in the worker. Its trusted supervisor has only a narrow message bridge. CSP and session request filtering block external script/file/network access; permission checks, permission requests, device access, downloads, popups, and navigation are denied. Chromium origin-private scratch storage can exist inside that isolated session; it does not grant raw filesystem access and is cleared at teardown. This is read-only access to project documents, not a promise of no browser-internal scratch allocation.

## Custom interfaces in increment 32

A `custom` view exports `activate({ root, request, openSource })`. It owns the supplied document root and may return an instance with `update(request)` and optional `dispose()`. The root belongs to a separate sandboxed `WebContentsView`, not Specular's renderer or DOM. Updates receive the same immutable, validated context and declared models as data-driven views. `openSource` accepts only a current `SourceReference`; both the sandbox broker and application renderer validate its project token, revision, file, and offsets before navigating.

The custom surface has a separate nonpersistent session, plugin origin, renderer, and minimal supervisor preload. Node integration, Specular's preload bridge, webviews, developer tools, permissions, devices, downloads, popups, navigation, file/remote requests, and connections are blocked. Inline styles and code-created `data:`/`blob:` images are allowed inside the plugin-owned surface. Browser origin-private scratch storage remains isolated and is cleared at teardown. Closing or leaving the view removes the surface; project switches revoke its models and terminate it. Activation, update, disposal, message, and crash failures remove the surface and leave documents usable.

Activation has a 10-second deadline, rendering five seconds, and optional disposal a 200 ms grace period before forced teardown. Request JSON (with both models, before undeclared ones are stripped) is capped at 8,388,608 UTF-16 code units, result JSON at 1,048,576, and entry files at 1 MiB. Views allow at most 2,000 list items or 500 graph nodes/1,000 edges, with 32 source references per item and text fields up to 4,096 characters. The UI debounces updates and coalesces changes while a request is pending. Pending results never regain authority after a newer revision, project switch, or closure. Thrown errors, crashes, malformed messages, stale evidence, and timeouts fail the view; close/reopen to retry. These are bounded transport/execution checks, not hard per-process memory quotas or a proof against Chromium vulnerabilities.

`validateManifest(value, hostVersion?)` returns a discriminated success/error result. `isApiCompatible(range, hostVersion?)` uses the bounded range grammar above. Both default to `API_VERSION`; neither loads plugins. Run `specular-plugin-validate <directory>` for static package checks (exit 0 on success, 1 on failure).

### Optional module metadata (increment 45)

`IdOccurrence.moduleAssignment` is optional. Older plugins can ignore it. It contains `state` (`assigned`, `unassigned`, or `conflict`), `modules` (key/name pairs), and `evidence`. Conflict and unassigned states have an empty module list. Evidence records use `kind: file-rule | id-override | unassigned` with their own module lists; file rules include `rule`, project-relative `path`, `scope`, and definition `source`. Overrides include the exact `id`. Source evidence uses the public `SourceRange` (`file`, `start`, `end`) and existing revision-checked navigation. Evidence may refer to another document in the snapshot. Configuration rule identifiers describe `.specular/project.json`; module metadata grants no additional capabilities. Categories and roles remain independent.

## Migrating from 0.1

API 0.2 is a one-step breaking change; Specular no longer supplies the 0.1 snapshot. To migrate a package:

1. Set `"api": ">=0.2.0 <0.3.0"`, add `"models"`, and rebuild against `specular-plugin-api-0.2.0.tgz`.
2. Replace `request.snapshot.projectId`, `.revision`, and `.currentFile` with `request.context.*`.
3. Replace `snapshot.occurrences` and `snapshot.ready` with `request.models.project.occurrences` and `.ready` (declare `project@1`).
4. Replace `snapshot.documents` and `snapshot.warnings` with `request.models.physical.documents` and `.warnings` (declare `physical@1`).
5. Replace `snapshot.configurationRevision` with `request.models.project.provenance.configurationRevision`.

Declare only the models you read: a plugin working from document text alone (such as document headings) declares `physical@1` and never waits for the ID index, while the project timeline declares `project@1` for its events and `physical@1` for line numbers. Every example in this repository and the bundled Relationships plugin follow this pattern.
