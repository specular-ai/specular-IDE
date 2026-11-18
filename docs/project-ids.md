# Project ID configuration

Create `.specular/project.json` in your project folder to recognize its existing ID conventions. Specular reads this file when opening the project and refreshes when it changes; use Explorer's Refresh button if file watching is unavailable. Alternatively, open **Project Lens > Project configuration** to edit and preview these conventions without hand-editing JSON. Agents can propose a configuration, including status and date rules, for review through **Discover with an agent** (increments 86a-87).

## Configure in Specular

In **Categories**, expand a category and its **Scope patterns** section. Add a pattern such as `specs/*` when that category's ID numbering restarts in each specification folder, then Preview and Apply. `FR-001` in `specs/002-swift-version-compat/` and `specs/003-test-architecture/` then identifies separate records, including references in each folder's descendants. Scope labels appear on cards, occurrences, relationship evidence and selectors. Authored IDs and Markdown source ranges stay unchanged. **Scope patterns** and **ID recognition rules** initially appear collapsed, with their Add buttons aligned to the right of their headings. Adding an entry opens its section and focuses the new field. Expansion state survives edits within the draft.

The terminal `*` matches one immediate child directory; new children participate automatically. Deeper folders inherit that child's scope. Files directly under `specs/`, and files outside the configured roots, retain project scope. An unqualified reference resolves only in its own scope, with no fallback to project or other feature definitions. Missing and ambiguous targets remain explicit. Folder scopes do not create application modules or features, and no cross-scope Markdown syntax is implied.

Each category can store `"idScopes": [{ "pattern": "specs/*", "enabled": true }]`. Omitted `enabled` means enabled. Categories without patterns retain project-wide IDs. Use canonical project-relative paths with forward slashes and matching folder capitalization; absolute paths, parent traversal, excluded folders, and duplicate patterns within one category (including disabled rules) are rejected. At most 64 patterns are allowed per category; different categories can use the same or overlapping roots independently. Since increment 85a, patterns can also nest, give each file its own scope, or join folders through a capture; see [Scope pattern forms](#scope-pattern-forms-increment-85a). Workspace exclusions and scan limits still apply; symlink/junction aliases cannot supply indexed documents, including through links opened in the editor.

A reference uses the patterns of the referenced ID's category, while its owning definition keeps its own category's scope. For example, a folder-scoped requirement can refer to a project-wide design ID if the design category has no scope patterns. This does not add fallback resolution for scoped categories. Earlier configurations with a top-level `idScopes` field load it as independent copies in categories that lack their own field; the next Apply saves only category settings. An explicit empty category list remains project-wide.

Disabling or removing a pattern requires a fresh Preview before Apply. The preview shows changed identities, duplicate definitions, unresolved references, module assignments and status conflicts. Existing projects without patterns retain project-wide identity. Exact module overrides optionally store `scope`, for example `{ "id": "FR-001", "scope": "specs/002-swift-version-compat", "modules": ["gui"] }`. An absent scope targets project scope only. Card edits fill this selector automatically; configuration also exposes **ID scope (empty for project)**. Overrides for disabled or absent scopes stay saved and become effective again when that scope returns. Renaming a scope folder changes its identity; update its exact overrides explicitly. No Markdown is rewritten.

1. Open **Project configuration** in Project Lens. **Discover** (named Discover IDs before increment 96) is always the first selected tab, including when resuming a retained draft. Choose **Categories**, expand a category, and edit its name and optional role. Use **Add rule** inside that category to define one or more matching formats; new rules belong to it automatically. Numbered names distinguish entries, including categories with the same name.
2. Choose **Prefix + digits** and a separator (hyphen, underscore, or none), or **Advanced regex**, then **Preview matches**. Switching to Advanced regex prefills the equivalent prefix/separator/digits pattern; a blank prefix starts with `ID`. You can edit this pattern. Switching formats preserves custom regex edits until you change the prefix or separator. The preview includes current unsaved Markdown, definition/reference counts, unresolved references, duplicate definitions, and new/removed IDs compared with the active index.
3. Filter the results and click a source location to inspect the Markdown. Reopen Project configuration to resume your draft. Results are paged in groups of 50.
4. Choose **Apply** to save `.specular/project.json` and refresh recognition. **Cancel** or Escape discards the draft. **Reset draft to legacy defaults** changes only the draft until you preview and apply it.

Tabs display one panel at a time and preserve draft edits, expanded entries, and discovery results when switching. Left/Right wraps through tabs; Home/End selects the first/last tab; Tab moves into the active panel. **Preview matches** and **Apply** stay in the footer and include changes from every tab. Navigation does not invalidate review; editing the draft or source still does.

Recognition rules appear inside their category (increment 57); there is no separate rules tab or category selector on a rule. Each category can have multiple prefix/regex rules. Renaming a category preserves its rules, and deleting one rule leaves its category and other rules intact. Rule numbers remain project-wide to match validation errors, even if numbers within one category are not consecutive. The 64-rule limit applies across all categories. Existing project files keep their rule keys and order.

Category, recognition-rule, module, and module file-rule keys are internal: Specular manages them automatically and does not display them or offer key editing in configuration or proposal review. Renaming an entry preserves its key and references, including before its first save. Existing project files retain their keys and schema; the JSON examples below document the storage format.

Removing a category also removes all its ID recognition rules and matching exact-ID module overrides from the draft. Overrides are matched against the category's current draft rules using the complete ID, including IDs absent from Markdown. Other categories' rules, unrelated overrides, module definitions, file/folder assignments, and status settings are preserved. Preview the removed IDs before **Apply**; **Cancel** restores the previous configuration. Removing the last category leaves an explicitly empty set of categories and rules after applying and reopening. Markdown text is never deleted.

Use **Delete all categories** to clear every category, its associated recognition rules, and matching exact-ID overrides in one draft action. Unrecognized overrides remain available. The normal Preview, Apply, and Cancel controls still apply. With no categories, bulk deletion and Add rule are disabled; **Add category** remains available to start defining conventions again. Modules and authored-status settings are preserved. If override matching encounters an invalid rule or exceeds its time limit, nothing is deleted; repair the rules or review the overrides and retry.

Edits to the draft or Markdown invalidate its preview. External configuration changes preserve the draft but require **Reload configuration (discard draft)** before continuing. Apply rechecks the project, configuration version, and saved Markdown before atomic replacement; a rejected or failed save preserves the draft. Markdown edits and undo history remain intact.

Invalid or overlapping rules cannot be applied. Slow regex previews are terminated. If the existing index is unavailable, you can still preview and apply repaired rules; the preview explicitly reports that before/after ID counts are unavailable. Module assignments and agent suggestions follow in later increments.

## ID definition sites (increment 54)

Open **Project configuration > Definition and status sites** to configure where recognized IDs define elements. Settings apply to all IDs in this project. ID token recognition still comes from each category's ID recognition rules in the Categories tab.

- **Headings:** Enable/disable definitions, select H1-H6 levels, and choose **Start of heading**, **Anywhere (one ID)**, or **Advanced pattern**. Start retains the existing following-character boundary (whitespace, colon, en/em dash, or end). Anywhere requires a single recognized occurrence in the heading; use a capture pattern to disambiguate multiple mentions.
- **Tables:** Enable/disable definitions, set **ID column name**, and choose **Exactly one ID** or **Advanced pattern**. Column labels are trimmed and compared without case; multiple matching ID columns are rejected as ambiguous. Whole-cell mode requires exactly one recognized ID after trimming.
- **Lists:** Disabled by default. Enable definitions independently for bulleted and numbered lists. A recognized ID must start the first paragraph after ignoring the list/task-checkbox marker and surrounding bold or emphasis. Later mentions remain references. **Only items with a checkbox** (increment 91, `"checkboxOnly": true`) limits definitions to items with a task checkbox, `[x]`, `[ ]`, or a text marker such as `[-]`; other items, such as `- T001 and T002 can run in parallel`, are references.
- **Advanced pattern:** Supply one named `(?<id>...)` capture and optionally Ignore case. For `## Login (REQ-123) [Approved]`, enter `\((?<id>REQ-\d+)\)`. This defines REQ-123; enable heading status extraction below to read Approved (increment 55).

Patterns operate on parsed heading text or trimmed cell text, not a whole file. List sites use deterministic start placement and have no advanced pattern mode. In start placement, a leading ID may be followed by whitespace, `:`, `–`, `—`, or, since increment 88, `.` or `)` before whitespace or the end, as in `- [x] 1. Write tests`, `## R1. Title`, or `- R2) Title`; `R1.2` and `R1.x` are not definitions. A list item's leading checkbox marker that Markdown does not parse, such as Kiro's `[-]` or `[~]`, is skipped before the ID. Since increment 91, start placement also accepts a full-width colon `：`, as in `### 任务 1：设计`, and a bracketed leading ID, `[ID]`, in headings, list items, and paragraphs: `**[CQ-H1] Missing input**`, `## [R1] Title`, or `- [R1]: Title`. The closing bracket is the separator, and `:`, a dash, `.`, or `)` may follow it; the definition range is the ID inside the brackets. Formatting surrounding an ID is supported, but the captured ID must occupy a contiguous literal span in a text/inline-code node. Encoded IDs, captures split across formatting, and ambiguous source mappings cannot become definitions. Captured text must fully match an active ID recognition rule, preserving case and spelling. Multiple matches, empty/missing captures, invalid regexes, and worker timeouts block Apply with source-context feedback. Patterns are limited to 512 characters, regions to 2 Mi UTF-16 code units, and execution uses the recognition worker's time limit (5 seconds plus 1 second per million characters of Markdown, at most 30 seconds).

**Preview matches** shows new/removed IDs and counts of definitions becoming references or references becoming definitions. Choose **Definition/reference changes** to navigate those occurrences. Disabling a definition site preserves ordinary ID mentions as references, so unresolved-reference findings may appear. Relationships, module assignments, navigation, and existing Status fields use the same detected definitions: changing the ID column to Key retains each row's Status association. Status field/column customization is available in the Authored-status extraction section (55).

**Apply** persists settings; **Cancel** discards the draft. **Restore ID site defaults** resets only these settings and requires Preview/Apply. Explicitly disabled sites survive restart. Existing configurations without `idDefinitionSites` keep the current default conventions. Markdown and unsaved source buffers are preserved.

The optional `idDefinitionSites` property sits beside `categories`, `rules`, and the other version-1 fields. It contains heading/table settings and may contain list settings:

```json
{
  "idDefinitionSites": {
    "headings": {
      "enabled": true,
      "levels": [1, 2, 3, 4, 5, 6],
      "mode": "regex",
      "pattern": "\\((?<id>REQ-\\d+)\\)",
      "ignoreCase": false
    },
    "tables": {
      "enabled": true,
      "column": "Key",
      "mode": "exact"
    },
    "lists": { "enabled": true, "types": ["unordered", "ordered"], "mode": "start" },
    "paragraphs": { "enabled": false, "mode": "start" }
  }
}
```

**Paragraph definitions (increment 82):** with `paragraphs` enabled, a plain paragraph defines an ID when its text starts, after optional bold or emphasis, with a recognized ID followed by a colon or a dash, as in `Property 1: Bug Condition - ...` or `**Property 2 — Preservation.** ...`, or with a bracketed ID, as in `**[CQ-H1] Missing input** (...)` (increment 91). Paragraphs in lists, quotes, and tables, and IDs later in the text, remain references. The definition owns the following blocks, including their references and status paragraphs, up to the next heading or paragraph definition. The site is off by default; enable it under **ID definitions in paragraphs**, for the project or in a category override.

Heading modes are `start`, `anywhere`, or `regex`; table modes are `exact` or `regex`. List mode is `start`; types may contain `unordered`, `ordered`, both, or neither. Only regex mode accepts `pattern` and optional `ignoreCase`. Levels must be unique integers from 1 to 6; an empty list selects no headings. Column names are nonempty single-line strings of at most 128 characters. Default settings are enabled headings at all levels in start mode and enabled tables using the ID column in exact mode.

Each category now has **ID definition sites** below its recognition rules. **Inherit project settings** follows the current project block, including unsaved draft edits. **Override for this category** copies the current effective project block and then replaces it completely for that category, including optional list settings. This keeps an absent override distinct from an override that explicitly disables both sites. **Restore inheritance** removes the category property. Renaming a category preserves its override. Preview, Apply, Cancel, save-conflict handling, source evidence, navigation, Relationships, module ownership, and status ownership use the same effective settings. Per-ID parsing remains excluded.

A category override uses the same complete shape:

```json
{
  "key": "requirements",
  "name": "Requirements",
  "idDefinitionSites": {
    "headings": { "enabled": false, "levels": [1, 2, 3, 4, 5, 6], "mode": "start" },
    "tables": { "enabled": true, "column": "Requirement", "mode": "exact" }
  }
}
```


## Authored-status extraction sites (increment 55)

In **Definition and status sites**, **Authored-status extraction** configures where values are read for all recognized IDs. The separate **Authored statuses** tab still manages display names, matching rules, and colors.

- **Paragraphs:** Enabled by default with the literal field label `Status:`. Use `State:` or another literal label, or select Advanced pattern. Only directly owned standalone paragraphs count; ownership ends at the next heading, even if it does not define an ID. **Also read list items** (increment 91, `"listItems": true`) also reads top-level list items whose first paragraph starts with the label, such as `- **Status**: DONE` under `## Milestone 3: Title`. List items that define IDs, items in nested lists, and items before any definition are not read. In Advanced pattern mode the label may be omitted and is stored as `Status:`; the `(?<status>...)` capture must match text written contiguously in the source, so it must not span `**` or a link.
- **Tables:** Enabled by default for columns named `Status` (trimmed and case-insensitive). Rename the status column to `Progress` independently of the ID column, such as `Key`. Full cell value is the default; Advanced pattern can extract part of a cell. Values belong only to their recognized ID row.
- **Headings:** Disabled by default. Enable to read values from a recognized defining heading. The default pattern `\[(?<status>[^\]]+)\]$` extracts Approved from `## Login (REQ-123) [Approved]` when the ID heading settings recognize REQ-123. Selected ID heading levels still apply.
- **Task checkboxes (increment 88):** Disabled by default. Enable **Statuses in task checkboxes** to read task progress from list items that define an ID, such as Kiro's `- [x] 1.1 Create ...` or OpenSpec's `- [ ] 2.3 ...`.
  - **Values:** the character in the checkbox becomes the status value through the marker list: by default `x` and `X` are Done, a space is Open, and `-` (Kiro's in-progress marker), `~` (Conductor's), and `/` (that of Obsidian's task plugins) are In progress; `~` and `/` were added in increment 105, so configurations saved before keep the markers they had. Edit, add, or remove markers (at most 16); a marker that is not listed gives no status. Since increment 105, Preview's summary counts the markers of ID-defining items that gave no status, as in "Checkbox markers without a status: ~ 9", so they can be added here; markers on items that define nothing, such as Spec Kit's `- [P] tasks = …` legend, are not counted. Values then go through **Authored statuses** like other values.
  - **Evidence:** the brackets, such as `[x]`.
  - **Pending work:** while the site is enabled, an unchecked item that defines an ID is an Open task rather than pending work; other unchecked items stay pending.
  - **Scope:** list items have no other status site, and status paragraphs inside a list item are not read.

Advanced patterns run on parsed heading/paragraph text or trimmed cell text, with optional Ignore case. Each match must contain a nonempty named `(?<status>...)` capture whose trimmed value has a reliable contiguous literal source span. Captures split across formatting or altered by character entities are rejected. Literal/full-cell modes preserve existing whole-paragraph/cell evidence, including supported formatting. Values are single-line and limited to 4096 characters; legacy literal/full-cell modes ignore longer prose, while invalid advanced captures reject the entire preview. Each site and each ID allows at most 256 evidence entries. The existing 2 MB region and 20 MB project limits, and the recognition worker's time limit, apply; no partial result can be applied.

**Preview matches > Show > Status assignments** displays raw values, mapped display names/colors, extraction sites, previous assignments, missing statuses, and conflicts. Expand **Authored status** for source navigation, including unsaved buffers. Repeated agreeing values retain all evidence; conflicting mapped values remain conflicts, including across sites and duplicate definitions. No site takes precedence.

**Restore status site defaults** resets only extraction settings in the draft. Apply persists them; Cancel discards edits. Disabled sites remain disabled after restart. Clearing all status palettes keeps extraction active with neutral badges; disabling every site removes authored badges while retaining palettes and Markdown. Explicit Rescan statuses uses the active draft site settings.

The optional `statusSites` object is stored in version-1 `.specular/project.json`; omission uses these defaults:

~~~json
{
  "statusSites": {
    "paragraphs": { "enabled": true, "mode": "literal", "label": "Status:" },
    "tables": { "enabled": true, "mode": "full", "column": "Status" },
    "headings": { "enabled": false, "mode": "regex", "pattern": "\\[(?<status>[^\\]]+)\\]$" },
    "checkboxes": { "enabled": false, "markers": { "x": "Done", "X": "Done", " ": "Open", "-": "In progress" } }
  }
}
~~~

`checkboxes` is optional: a configuration or category override without it has the checkbox site disabled. Each marker is a single character other than `]`, and each value has 1-128 characters. Paragraph and table Advanced modes use `"mode": "regex"` with `pattern` and optional `ignoreCase`; keep the paragraph `label` and table `column` fields. Patterns are limited to 512 characters and labels to 128.

### Category and status overrides (increments 64-65)

Expand **Authored-status extraction** inside a category to inherit the project block or store a complete paragraphs/tables/headings replacement. **Restore inheritance** removes the category block. A present block whose sites are disabled remains an explicit override.

Expand an entry in **Authored statuses**, then expand its **Authored-status extraction** section to inherit applicable category/project sites or override extraction for that status. Creating an override copies the current project settings. Its captures are retained only when the entry's matching rules uniquely map the raw value to that status. Therefore every status override can be evaluated without already knowing the status, and a capture for another status is ignored.

Category settings choose the baseline. A status override then replaces baseline candidates mapped to that status. Baseline values for statuses without overrides and unmatched values remain available. Agreeing values retain all evidence; different resolved values report a conflict. Overlapping status matching rules block Preview/Apply rather than using editor order.

Both category entries and status entries use the same optional `statusSites` object shown above. Absence inherits; **Restore inheritance** deletes it. Preview uses current buffers and shows exact evidence before Apply. Apply persists overrides without changing Markdown; Cancel, restart, save failure, and configuration conflict handling use the shared configuration workflow. Nested-section ownership, list-status extraction, checkbox mappings, and per-ID parsing remain outside increment 65.

## Category card colors

In **Project configuration**, expand a category's **Card colors** below **ID recognition rules**. Both sections use matching rounded borders. Choose separate Light mode and Dark mode accents with the color picker or a six-digit hex value such as `#ffcc00`. The two example cards update immediately. Specular preserves that accent on the card edge and derives a theme tint and contrasting text color; the filled card therefore uses a softer shade of your chosen color. The category name stays visible.

Choose **Preview matches**, then **Apply** to save. Draft colors do not change live cards until applied. Cancel/Escape discards them. **Reset light color** or **Reset dark color** removes that theme's override in the draft; preview and apply to persist the reset. Missing values use role defaults (gold requirements, green design, blue tasks) or a neutral color for role-free categories. Theme switching immediately selects the saved palette, and reopening the project restores its colors. Duplicate/unresolved diagnostics keep separate labels and styling; category color does not indicate authored status or verification.

Optional category JSON:

```json
{ "key": "needs", "name": "Requirements", "role": "requirement", "colors": { "light": "#ffcc00", "dark": "#ffe066" } }
```

Either theme may be omitted. Colors must be `#` plus six hexadecimal digits; named colors, shorthand, alpha values, and CSS expressions are rejected. Color changes do not rewrite Markdown or change recognized IDs, ownership, or Relationships. Project Lens colors are not passed to plugins as part of the category metadata; their existing appearance contract is unchanged.

## JSON example

For example:

```json
{
  "version": 1,
  "categories": [
    { "key": "requirements", "name": "Requirements", "role": "requirement" },
    { "key": "design", "name": "Design decisions", "role": "design" },
    { "key": "tasks", "name": "Tasks", "role": "task" }
  ],
  "rules": [
    { "key": "requirements", "category": "requirements", "prefix": "REF" },
    { "key": "design", "category": "design", "prefix": "DEC" },
    { "key": "tasks", "category": "tasks", "prefix": "WORK" },
    {
      "key": "features",
      "category": "requirements",
      "pattern": "(?<![\\w/])feature/[a-z]+(?![\\w/])"
    }
  ]
}
```

This configuration recognizes `REF-01`, `DEC-2`, `WORK-003`, and `feature/login`. With default definition sites, a heading such as `# REF-01 Requirement one` defines that ID. Later mentions reference it, including across documents. A table's `ID` cell can also define an ID. Quotes, raw HTML, and ordinary fenced examples stay excluded; supported Mermaid content contributes references. The exact matched text must exist in the source, so encoded lookalikes do not invent definitions.

The rules list **replaces** the built-in rules. To keep REQ IDs as well, add another rule with `"prefix": "REQ"` mapped to your requirements category. Multiple rules may share a category. An explicit empty rules list disables ID recognition. With no configuration file, Specular retains its original uppercase prefix/digit conventions: REQ, DD, TASK, Q, IP, PH, AT, US, STORY, SM, and STATE.

## Scope pattern forms (increment 85a)

Besides `folder/*`, a scope pattern is a sequence of `/`-separated segments:

| Segment | Matches |
|---|---|
| `specs`, `spec.md` | that literal folder or file name |
| `*`, `004-*` | one folder name, optionally with literal parts |
| `**` | any number of folders (not as the last segment) |
| `{capability}` | one folder name, captured; at most one per pattern |
| `*.md`, `P3_*.md` (last segment) | a Markdown file name |

- **Folder patterns** end in `*` (or a glob) or a capture. Everything below the matched folder shares its scope, and files directly in the root keep project scope, as with `specs/*`.
- **File patterns** end in a Markdown file segment. Each matching file is its own scope, so `docs/plans/*.md` restarts `Task 1` in every plan.
- **Capture patterns** name their scope by the captured segment instead of a path: `openspec/specs/{capability}/spec.md` and `openspec/changes/**/specs/{capability}/spec.md` both give `capability:identity` to their identity specs, so the files share one scope. Captured scopes are shown as `capability:identity` on cards and in the preview.
- **Nesting.** When several patterns of one category match a file, the most specific decides: the one with the most literal characters, then the most segments, then the first listed. So `openspec/changes/archive/*` takes precedence over `openspec/changes/*`, and `specs/004-*/P3_*.md` over `specs/*`.

Every pattern needs at least one literal segment, so `*` and `**/*` are rejected. Folder-derived features and modules keep the simpler `folder/*` form.

## Recognition and definitions limited to paths (increment 90)

Scope patterns decide identity, not where a category is recognized: by default its rules match in every indexed file, and files outside its patterns hold project-wide IDs. Two optional category settings narrow this:

- **Recognize only inside these scopes** (`"onlyInScopes": true`). The category's rules (prefix, pattern, labelled list, and templated) run only in files that one of its enabled scope patterns matches, including scopes loaded from an earlier top-level `idScopes`. Elsewhere its text is prose: no definitions, references, or unresolved findings. Overlaps are checked only among the rules that run in a file. The option needs at least one enabled scope pattern. A category meant for one kind of file uses a file pattern, such as `openspec/changes/**/tasks.md`, which also makes each file its own scope.
- **Define only in** (`"definitionPaths": ["specs/*/tasks.md"]`). Outside these 1-32 paths, an ID of the category at a heading, table, list, or paragraph definition site is a reference, resolved in that file's scope. So with scope `specs/*`, `- T001 Build the parser` in `specs/001/plan.md` refers to `T001` in `specs/001/tasks.md` instead of duplicating it. Keyword headings of the category define nothing outside the paths.

Definition paths use the segments above without captures. A pattern whose last segment is not a Markdown file covers that folder and everything below it, so `docs/specs` covers `docs/specs/a/b.md`. Captures, parent traversal, excluded folders, an empty list, duplicates, and more than 32 paths are rejected. Derived elements ignore both settings. Statuses, dates, and relationships follow from the definitions and references that remain.

In **Project configuration**, the category's **Scope patterns** section has **Recognize only inside these scopes**, and its **ID definition sites** section has **Define only in**, a comma-separated list of paths. Each shows how many indexed Markdown files it covers; **Preview matches** shows the effect.

```json
{ "key": "tasks", "name": "Change tasks", "role": "task",
  "idScopes": [{ "pattern": "openspec/changes/**/tasks.md" }], "onlyInScopes": true }
```

## Excluded paths (increment 99a)

Specification tools install their own Markdown beside the specifications: Spec Kit's templates in `.specify/templates/`, and copies of the tool's commands for each coding agent (`.claude/commands/`, `.github/prompts/`, `.cursor/commands/`, `.devin/workflows/`, and others). Their placeholder IDs (`T001`, `FR-006`), unchecked checkboxes, and example markers would otherwise count as definitions, references, and pending work.

The optional top-level `excludedPaths` lists 1-64 project-relative patterns, in the syntax of **Define only in**: `*` within a folder, `**` across folders, and a folder pattern covering everything below it. Markdown under them is not analyzed at all: no definitions, references, pending items, statuses, dates, or module and feature assignments, and Discover by patterns and Discover with an agent do not read it. The files stay in the Explorer, shown muted with the pattern that excludes them; they open, edit, preview (without ID links), and appear in text search. Abstractions receive them in the physical model's file list, without their text.

```json
{ "version": 1, "excludedPaths": [".specify/templates", ".claude/commands"], "categories": [], "rules": [] }
```

In **Project configuration**, the **Excluded paths** tab edits the list (comma-separated) and counts the Markdown files it excludes; **Preview matches** shows the effect. Tool memory such as `.specify/memory/constitution.md` holds real content, so leave it analyzed.

## Clarification markers (increment 99b)

Spec Kit marks open questions inline until `/speckit.clarify` resolves them, for example `- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified]`. Each such marker in prose, a heading, or a table cell is a pending item whose message is the question, shown in **Issues** as **Needs clarification** with the ID whose section contains it. A marker in an unchecked task replaces that task's generic pending entry, so the line counts once per marker. Not counted: markers in fenced or inline code, in checked checklist items, placeholder questions from the templates' instructions (`specific question`, `question`, `...`, `…`), and the bare words without brackets and a colon. The marker is pending work rather than a status: a requirement can hold several, and none of them is a lifecycle value.

## Relationship layers (increment 100b)

Focus and the Lens **Relationships** list connect IDs across ordered traceability layers. By default the layers come from the categories' roles: Requirements, Design decisions, and Implementation tasks (increment 100a), and a category without a role takes no part. The optional top-level `layers` replaces that default with 1-8 named layers, each listing category keys; a category is in at most one layer. Categories without a role, such as success criteria or tests, can then take part, and the layers can be named and ordered as the project reads them.

```json
"layers": [
  { "name": "Requirements", "categories": ["fr", "story", "sc"] },
  { "name": "Tasks", "categories": ["task"] },
  { "name": "Tests", "categories": ["zero-signature", "point-validation"] }
]
```

Focus draws one column per layer in use, headed by its name, in this order. Any link between two layered IDs is a connection; the second hop continues through a uniquely defined neighbour to layers further on. A category left out of the configured layers no longer takes part, even with a role. Roles keep their other meanings (discovery, the agent, the dossier).

In **Project configuration › Categories**, **Relationship layers** shows the layers derived from roles. **Customize layers** copies them into the draft: rename, reorder (**Move up**, **Move down**), add, and remove layers, and choose each category's layer, or none, under **Category layers**. A layer needs at least one category before Preview. **Use roles** returns to the default. Removing a category also removes it from its layer, and an emptied layer goes with it.

## Named elements (increment 85a)

Some conventions identify elements by name rather than by token. OpenSpec writes `### Requirement: User login` and `#### Scenario: Valid credentials`. A category can define such elements with a **keyword heading** site:

```json
{
  "key": "requirement",
  "name": "Requirement",
  "role": "requirement",
  "idScopes": [{ "pattern": "openspec/specs/{capability}/spec.md" }, { "pattern": "openspec/changes/*" }, { "pattern": "openspec/changes/archive/*" }],
  "idDefinitionSites": {
    "headings": { "enabled": true, "levels": [3], "mode": "keyword", "keyword": "Requirement" },
    "tables": { "enabled": false, "column": "ID", "mode": "exact" }
  }
},
{ "key": "scenario", "name": "Scenario", "parent": "requirement", "idScopes": [...], "idDefinitionSites": { "headings": { "enabled": true, "levels": [4], "mode": "keyword", "keyword": "Scenario" }, "tables": { "enabled": false, "column": "ID", "mode": "exact" } } },
{ "key": "capability", "name": "Capability", "derive": { "pattern": "openspec/specs/{capability}/spec.md" } }
```

- **Keyword headings.** In mode `keyword`, a heading whose text starts with the keyword and the separator (`:` by default; also `-`, en dash, em dash, or `.`) defines the element named by the rest of the heading. When that name is, in full, an ID another category's rule recognizes, as in Spec Kit's `## Parallel Example: User Story 1`, the heading is a section about that ID: it defines nothing, and the ID stays a reference. **Discover by patterns** does not offer a keyword category whose example headings all name another suggestion's IDs, and drops such examples from the ones it keeps. The keyword is matched ignoring case, so `Requirements:` and `Requirement 2:` are not matches. The name is the rendered heading text, so inline code loses its backticks, and whitespace is collapsed. Names are identified ignoring case: `User login` and `user Login` in one scope are the same element and are reported as duplicates, shown with the first spelling. Token IDs keep exact identity. Keyword sites are set per category and need no recognition rule; a project-wide keyword site is rejected.
- **Parent categories.** With `parent`, an element is identified within the nearest enclosing heading of the parent category: a scenario under `### Requirement: User login` is `User login / Valid credentials`. Repeated scenario names under different requirements are therefore distinct. The scenario is owned by its requirement, which links them in Relationships and the project model. A heading without an enclosing parent is identified by its own name. Parents must exist and must not form a cycle.
- **Derived elements.** With `derive`, every Markdown file matching a pattern with one `{name}` capture defines an element named by the captured segment, at the file's first heading, or at its first line when the file has no heading or its first heading already defines another element, such as a spec that starts with `### Requirement:`. `openspec/specs/{capability}/spec.md` makes each capability folder an element.
- **Source ranges.** A plain name selects exactly its text. A name with formatting such as inline code selects the heading content.

In Project configuration, a category's **ID definition sites** override offers **Keyword and name** as the heading mode, with **Heading keyword** (prefilled with the category name) and **Separator after the keyword**. Each category also has **Parent category (optional)** and **Derive elements from files (optional)**.

Without change records, keep one scope per change folder (`openspec/changes/*`, `openspec/changes/archive/*`, and, for a change touching several capabilities, `openspec/changes/archive/*/specs/*`): joining change specs into the capability scope would report every MODIFIED requirement as a duplicate of the current one. With change records (increment 85b, below), join them.

## OpenSpec changes (increment 85b)

OpenSpec describes each change in a folder, `openspec/changes/<change>/` or, once archived, `openspec/changes/archive/<change>/`. A change has a `proposal.md` and spec files whose requirement headings are grouped under `## ADDED`, `## MODIFIED`, `## REMOVED`, or `## RENAMED Requirements`. Three category settings record these changes:

```json
{ "key": "requirement", "name": "Requirement", "role": "requirement",
  "idScopes": [{ "pattern": "openspec/specs/{capability}/spec.md" }, { "pattern": "openspec/changes/**/specs/{capability}/spec.md" }],
  "idDefinitionSites": { "headings": { "enabled": true, "levels": [3], "mode": "keyword", "keyword": "Requirement" }, "tables": { "enabled": false, "column": "ID", "mode": "exact" } },
  "deltas": true, "nameReferences": true },
{ "key": "scenario", "name": "Scenario", "parent": "requirement", "idScopes": [...], "idDefinitionSites": { ... "keyword": "Scenario" ... } },
{ "key": "capability", "name": "Capability", "derive": { "pattern": "openspec/specs/{capability}/spec.md" } },
{ "key": "change", "name": "Change", "derive": { "pattern": "openspec/changes/**/{change}/proposal.md" }, "changes": { "capabilities": "capability" } }
```

- **Changes.** `changes` on a derived category makes its elements changes, named by their folder (`add-two-factor-auth`, `2026-05-12-workflow-option`). A change has the status **Active**, or **Archived** when its folder lies inside an `archive` folder (configurable with `"archive"`). Derived elements live in their own captured scope (`change:add-realms`, `capability:identity`), so a change and a capability may share a name.
- **Change records.** With `deltas`, a keyword heading under a delta section of a change folder records the change instead of defining an element. With a change category configured, only files inside change folders are read this way, because current specifications may keep the ADDED headings they were created with.
  - A **MODIFIED**, **REMOVED**, or **RENAMED** record is a reference from the change to the current requirement of that name in the capability's scope. In an active change, an unknown name is reported as an unresolved reference.
  - An **ADDED** requirement of an active change that the specifications do not define yet is a **Proposed** requirement, defined by the change and shown with the status Proposed; its scenarios are kept. Once the specifications define it, the record becomes a reference again.
  - In an **archived** change, ADDED records refer to the requirement now in the specifications. A record of a requirement that no longer exists (removed or renamed later) is history and is left out without a finding.
  - Scenarios restated inside MODIFIED requirements, and inside ADDED requirements that already exist, are part of the record and are not defined again.
  - The change links to every requirement it touches, in Relationships and the project model, and each link lists the kinds of change it records.
- **Declared capabilities.** In a change's proposal, the backticked names in the lists under **New Capabilities** and **Modified Capabilities** refer to elements of the category named by `changes.capabilities`. A New capability of an active change that the specifications do not define yet is Proposed. When a proposal declares capabilities, Specular reports **consistency** findings for:
  - a declared capability without a `specs/<capability>/` folder in the change;
  - a `specs/<capability>/` folder the proposal does not declare.
  A Modified capability that does not exist is an unresolved reference.
- **Name references.** With `nameReferences`, backticked text equal to an element name of the category, in the same scope and ignoring case, refers to it: "the `Users and workspaces` requirement". Code spans that name nothing stay plain code.

In Project configuration, each category has a **Changes and name references** section with **Record change deltas**, **Link backticked names**, and **Derived elements are changes**, plus **Archive folder name** and **Capability category of declarations** for changes. The preview summary counts consistency findings, and the Issues filter lists them.

With change records enabled, join change specs into the capability scope (`openspec/changes/**/specs/{capability}/spec.md`), so that records resolve to the current requirements. Keep change tasks in per-change scopes (`openspec/changes/*` and `openspec/changes/archive/*`).

## Rule format

- `key`: unique rule/category key, starting with a letter and containing up to 64 ASCII letters, digits, underscores, or hyphens.
- `category`: an existing category key. Category names contain 1–128 characters. The optional category role is `requirement`, `design`, or `task`; omit it for custom categories.
- `prefix`: a simple letter-led prefix of up to 64 ASCII letters, digits, or underscores. It matches that prefix, the configured separator, and one or more digits, with JavaScript word boundaries. For example, REF matches `REF-01`, but not `XREF-01`.
- `separator`: optional for prefix rules: `"-"` (default), `"_"`, or `""` (none). For example, REQ with no separator recognizes `REQ1` and `REQ01`; underscore recognizes `REQ_01`. Existing configurations retain hyphen matching.
- `pattern`: an advanced JavaScript Unicode regex, with at most 512 characters. Specify exactly one of `prefix`, `pattern`, or `list`. Supply the regex source as a JSON string, without `/.../` delimiters; double backslashes as JSON requires.
- `id`: optional for pattern rules: an ID template that makes each match a reference to another ID, described under [ID templates](#id-templates-for-aliases-increment-89).
- `ignoreCase`: optional boolean, default false. Matching uses `gu` or `giu`. Without a template, the complete match is the ID; capture groups do not select or normalize its identity. Case-insensitive matching can recognize both `REF-01` and `ref-01`, but these remain distinct IDs, as do `REF-1` and `REF-01`.

- `list`: a labelled list (increment 82), described below. It references IDs of the rule's category but never defines them.

Advanced rules control their own boundaries. Specular does not wrap them in word boundaries. Matching occurs within Markdown text/inline-code regions and supported Mermaid bodies, with additional heading/table checks for definitions. Anchors and lookarounds refer to those regions; they do not inspect across separate formatting nodes. An ID at the start of heading text must be followed by whitespace, a colon, a dash separator, or the end of the heading.

Category roles now control Relationships and Explore map. A category with role `requirement` connects through a `design` category to a `task` category, regardless of ID spelling: for example, REF-01 -> DEC-1 -> WORK-1. Several prefix/regex rules can share a category. Categories without a role stay in Overview, whose category filter uses their display names. A role-free category using REQ IDs does not receive requirement behavior. Changing roles refreshes views and invalidates old source actions. Missing and duplicate definitions remain explicit; ambiguous design definitions are not expanded into second-hop paths. Focus preserves exact ID spelling, including lowercase custom patterns. Category card colors are available in increment 44. Modules are available in increment 45 as described below; authored-status colors are available in increment 46.

### Labelled reference lists (increment 82)

Some conventions cite IDs as bare numbers after a label. Kiro tasks write `_Requirements: 1.1, 2.3_`, and designs write `**Validates: Requirements 1.1, 5.7**`, where `1.1` means acceptance criterion 1 of Requirement 1. A bare number cannot be a pattern rule, because only the label gives it meaning. A labelled-list rule is a third rule type for an existing category:

```json
{
  "key": "requirement-list",
  "category": "requirement",
  "list": {
    "label": "\\bRequirements?:|\\bValidates:? Req(?:uirements?)?",
    "item": "(?<number>\\d+)(?:\\.\\d+)?",
    "id": "Requirement {number}"
  }
}
```

- `label`: a JavaScript Unicode regex (1-512 characters) that finds where a list starts. It runs on the text of one Markdown text region, so emphasis markers such as the underscores in `_Requirements: 1.1_` are not part of it.
- `item`: optional; a regex for one item with a named `number` capture. The default, `(?<number>\d+)(?:\.\d+)?`, reads `N` or `N.M`.
- `id`: the ID template, up to 128 characters. Each `{name}` is replaced by the item's named capture, so `Requirement {number}` turns `1.1` into `Requirement 1`. Every placeholder must be a named capture of the item pattern. The `:int` and `:0N` formats of [ID templates](#id-templates-for-aliases-increment-89) apply.
- `ignoreCase` applies to the label and the item.

After each label match, Specular reads items separated by commas, `and`, `&`, or a range dash, so `1.1, 1.2 and 6.1` gives three items and `3.4-3.10` gives two. The list ends at the first other text, and an item followed directly by a letter or digit is not read. Each item becomes a reference to the templated ID of the rule's category, located at the item text, so navigation selects `1.1`. References take part in folder scopes, unresolved findings, ownership, and relationships like other references, so a cited number links to the requirement in the same spec folder. Quoted text and fenced code other than Mermaid diagrams are ignored. Lists never define IDs; definitions still come from the category's other rules, usually a pattern such as `\bRequirement \d+\b`. The criterion part (`.1`) is not part of the ID.

In Project configuration, choose **Labelled list** as a rule's **Format** and fill **List label** and **ID template** (prefilled as the category name followed by `{number}`). The item pattern is under **Advanced**, with **Restore default item pattern**. Switching formats keeps each format's last values.

### Numbered list items and acceptance criteria (increment 96d)

Kiro requirements end with `#### Acceptance Criteria` and an ordered list. Tasks and correctness properties cite the criteria as `1.1`, `1.2` (requirement 1, items 1 and 2), a number that appears nowhere in the requirement: it is the item's position. A category with **numbered list items** defines these elements:

```json
{ "key": "criterion", "name": "Acceptance criterion", "idScopes": [{ "pattern": ".kiro/specs/*" }],
  "numberedItems": { "parent": "requirement", "section": "Acceptance Criteria", "id": "Criterion {parent}.{item}" } }
```

- Each item of an ordered list inside an element of the parent category (after its heading), and, when a section is given, directly under a heading with that text inside it, defines one element. `{parent}` is the last number of the parent's ID and `{item}` the item's position, counted from 1 whatever number the list writes. The template must contain `{item}`; the default is `{parent}.{item}`.
- The element is defined at the item's first line, labelled with its text, and belongs to its parent: Relationships, the dossier, and the project model show the requirement as its owner. It takes the scopes of its category, so use the same scopes as the parent (one per specification, see increment 96b) and criteria of different specifications stay apart. Nested lists inside an item define nothing.
- Criteria get IDs such as `Criterion 1.2` rather than `1.2`, because Kiro tasks are numbered `1.2` too, and two categories cannot share an ID in one scope.
- Labelled lists cite them with a template of two captures. A second rule with the same label keeps citations of a whole requirement:

```json
{ "key": "criterion-citations", "category": "criterion",
  "list": { "label": "\\bRequirements?:|\\bValidates:?\\s+Requirements?:?", "item": "(?<number>\\d+)\\.(?<criterion>\\d+)", "id": "Criterion {number}.{criterion}" } },
{ "key": "requirement-citations", "category": "requirement",
  "list": { "label": "\\bRequirements?:|\\bValidates:?\\s+Requirements?:?", "item": "(?<number>\\d+)(?![.\\d])", "id": "Requirement {number}" } }
```

  Emphasis is not part of the text, so `_Requirements: 1.1, 2.3_` is read as `Requirements: 1.1, 2.3`. Each rule stops at the first item it cannot read, so a list mixing both forms (`Requirements: 1.1, 3`) is read only up to the change. The requirement rule must not read `Requirement 1` inside `Requirement 1.9`: end its pattern with `(?!\.\d)`, as in `\bRequirement \d+\b(?!\.\d)`; otherwise the two rules overlap and recognition stops with an error.
- In Project configuration, a category's **Numbered list items** section sets the parent category, the optional section heading, and the element ID template.
- **Discover by patterns** proposes an **Acceptance criterion** suggestion when ordered lists sit under `Acceptance Criteria` headings inside numbered keyword headings, such as `### Requirement 1`. It takes the requirement suggestion's scope, includes both citation rules when `N.M` citations occur, and makes the requirement rule end with `(?!\.\d)`. The criteria suggestion needs the requirement suggestion, or a requirement category the draft already has.
- **Bugfix specifications** (increment 96e). Kiro writes bugfix specifications from one template: `# Bugfix Requirements Document`, then `### Current Behavior (Defect)`, `### Expected Behavior (Correct)`, and `### Unchanged Behavior (Regression Prevention)`, whose criteria are paragraphs starting with their number (`1.1 WHEN … THEN …`, `2.1 The system SHALL …`). Tasks and properties cite them like acceptance criteria, so they are defined as the same `Criterion N.M` elements by a rule of the criteria category that **defines**:

  ```json
  { "key": "criterion-bugfix", "category": "criterion", "pattern": "^(?<group>\\d+)\\.(?<item>\\d+)(?=\\s)", "id": "Criterion {group}.{item}", "defines": true }
  ```

  with paragraph definitions only for that category (headings, tables, and lists off), so Kiro task items such as `- [x] 1.1 Fix …` and numbered headings define nothing. Criteria on consecutive lines, which Markdown joins into one paragraph, are each defined. A paragraph elsewhere that starts with a number, such as `4.5 MB is …`, also defines a criterion; delete such a definition's cause or narrow the category with **Define only in**. Discover by patterns adds this rule and the definition sites to the Acceptance criterion suggestion when it finds the bugfix headings, or proposes the criteria with the specification scope when a project has bugfix specifications only.
- Criteria listed without an `Acceptance Criteria` heading need a category without a section, and criteria nested under another list are not numbered.
- **Tasks** (increment 104). Kiro writes each spec's tasks as checkbox items numbered without an ID token, `- [ ] 1. Refactor the strategy` and, nested, `- [x] 1.1 Update RandomLocationStrategy`. The bundled Kiro profile proposes a **Task** category when at least 3 such items occur in `tasks.md` files of `.kiro/specs`:

  ```json
  { "key": "kiro-task", "category": "kiro-task", "pattern": "^(?<task>\\d+(?:\\.\\d+)?)(?=\\.?\\s)", "id": "Task {task}", "defines": true }
  ```

  with role task, one scope per spec (`.kiro/specs/*`, or `.kiro/specs/**/{spec}/*.md` when specs sit in area folders), definitions only in `**/.kiro/specs/**/tasks.md` at checkbox list items and headings, and checkbox statuses on (`[x]` Done, `[ ]` Open, `[-]` In progress). Tasks and subtasks form one category, `Task 1` and `Task 1.1`, numbered again in each spec. A second rule, `\bTask \d+(?:\.\d+)?\b`, makes mentions such as "after Task 7" refer to the task in that spec, and `## Task 1: …` headings in `tasks.md` define it; the profile's suggestion therefore replaces Specular's own "Task N" heading suggestion, and its explanation says how many headings that suggestion had. Citations by bare number (`_Requirements: 1.1_`) stay acceptance criteria. Since increment 106, sub-projects that keep their own `.kiro/specs`, such as `backend/.kiro/specs` next to the root one, get a scope per specification root holding tasks (`backend/.kiro/specs/*`), and `**/.kiro/specs/*` covers a nested folder with a single spec, which is no specification root. A `tasks.md` that lists its tasks and then repeats them as `### Task 1:` sections defines each twice (a duplicate).

### Section tags (increment 96f)

A category can tag its definitions by the sections they are written in. `sectionTags` lists up to 16 entries `{ "heading": <heading text>, "tag": <tag> }`: a definition of the category under an enclosing heading with that text, at any level above it, gets the tag. Headings compare without case, emphasis, or a trailing colon, so `### **Expected Behavior (Correct):**` matches `Expected Behavior (Correct)`. A definition's own heading names it and is not its section. Tags use up to 64 lowercase letters, digits, `:`, `_`, and `-`. For the three behaviour sections of Kiro bugfix specifications:

```json
"sectionTags": [
  { "heading": "Current Behavior (Defect)", "tag": "bugfix:defect" },
  { "heading": "Expected Behavior (Correct)", "tag": "bugfix:expected" },
  { "heading": "Unchanged Behavior (Regression Prevention)", "tag": "bugfix:unchanged" }
]
```

- In Project configuration, a category's **Section tags** section lists the heading texts and tags.
- Project Lens cards show tags as badges. The **Tag** filter shows the IDs with one tag, or the untagged ones, and **Group by > Tag** groups definitions by tag, with untagged definitions in **Untagged**. A definition with several tags appears in each group.
- Plugins read the tags on `project@1` IDs (`tags`).
- **Discover by patterns** adds the three bugfix tags to the Acceptance criterion suggestion when it finds bugfix specifications. Discovery never changes existing categories, so when the draft already has a criteria category, add the tags in its **Section tags** section.
- Tags come only from enclosing headings. Front matter, labels in the text, the element's own heading, and per-ID editing are not supported.

**Patterns** (increment 96g). When the headings are numbered or titled, an entry gives `pattern` instead of `heading`: a JavaScript Unicode regular expression tested against the heading text (without surrounding emphasis or a trailing colon), ignoring case. Its tag may use the pattern's named captures as `{name}`; a captured value is lowercased, and characters other than letters, digits, `:`, `_`, and `-` become hyphens. Spec Kit task lists divide tasks by phase and user story:

```json
"sectionTags": [
  { "pattern": "^Phase \\d+: (?<phase>Setup|Foundational|Polish)\\b", "tag": "phase:{phase}" },
  { "pattern": "\\(Priority: (?<priority>P\\d)\\)", "tag": "priority:{priority}" }
]
```

A task under `## Phase 1: Setup (Shared Infrastructure)` is `phase:setup`, and one under `## Phase 3: User Story 1 - Sign in (Priority: P1)` is `priority:p1`. An element gets the tags of every matching heading above it. A heading whose captures give an invalid tag, such as one longer than 64 characters, tags nothing and is listed as a consistency issue.

- In **Section tags**, each row chooses **Match**: Heading text or Pattern. Switching keeps the typed text.
- Preview lists the IDs per section tag after the definition counts.
- The Project Lens **Tag** filter lists the configured heading tags and every tag found in the index.
- **Discover by patterns** (through the bundled Spec Kit profile since increment 97b) proposes both patterns on the task suggestion (the rule matching the checkbox task IDs under those headings, such as `T001`) when at least 3 task-list headings match one of them, and defines that category in checkbox list items, so lines such as `- T001, T002 can run in parallel` keep referring.

**Tags for existing categories** (increment 96h). When the draft already has a category that recognizes a tagged suggestion's IDs, such as a Tasks category with `\bT\d{3}\b` while discovery suggests `\bT\d+\b`, the tags are offered separately, after the other suggestions, as **Add section tags to Tasks**. This happens whether the suggestion itself is omitted as existing or left in the review as ambiguous. The entry explains which headings divide the IDs and lists the entries the category lacks. **Add suggestions to draft** adds those entries to the category; its own entries stay, and it gets no new rule. When the category's list definitions are off, checkbox list items are turned on to define its IDs, as for a new task suggestion. Since increment 103, a suggestion that defines its IDs in list items, reported as an existing category whose list definitions are off, is offered the same way as **Define FR IDs in list items** (named after the category), without section tags: **Add suggestions to draft** turns on the category's unordered and ordered list items and keeps its other sites, its rules, and its scopes. Nothing changes until it is added. Delete the ambiguous suggestion when you keep the existing category, since adding both makes two rules match the same IDs. Preview then counts the IDs per tag. The Kiro bugfix tags reach an existing criteria category the same way.

### ID templates for aliases (increment 89)

Some projects write one element in several ways. Spec Kit defines `### User Story 1 - Title` and its tasks cite `[US1]` or `US1`. Without a template, `US1` and `User Story 1` are different IDs, because a match is its own ID. An `id` template on a pattern rule makes each match a reference to the templated ID instead:

```json
{ "key": "story", "category": "story", "pattern": "\\bUser Story \\d+\\b" },
{ "key": "story-alias", "category": "story", "pattern": "\\bUS(?<n>\\d+)\\b", "id": "User Story {n}" }
```

- Each `{name}` is replaced by the pattern's named capture. A template needs at least one placeholder, and every placeholder must be a named capture of the pattern. Templates are accepted only on pattern rules.
- `{name:int}` drops leading zeros. `{name:0N}`, with N from 1 to 9, drops them and pads the number to N digits. A capture that is not all digits is used unchanged.
- A templated match is only a reference, located at the matched text, so navigation selects `US1` and the card is that of User Story 1. It never defines an ID, even at the start of a heading or list item; definitions come from the category's other rules. References take part in scopes, unresolved findings, ownership, and relationships like other references.
- Templates rewrite only references, so the template must produce the spelling the definitions use. With `FR-001` definitions, `"pattern": "\\bFR-(?<n>[1-9]\\d?)\\b", "id": "FR-{n:03}"` makes `FR-1` refer to `FR-001`. With `FR-1` definitions, `"pattern": "\\bFR-(?<n>0\\d+)\\b", "id": "FR-{n:int}"` makes `FR-001` refer to `FR-1`.
- Matches of different rules must not overlap, so the pattern must not also match the definitions' own spelling, and a template replaces a labelled list that reads the same text.

In Project configuration, an **Advanced regex** rule has an optional **ID template** field. The recognition preview shows the matched text next to the ID it refers to, such as `US1 → User Story 1`, for templated and listed references.

A templated pattern rule may also set `"defines": true` (increment 96e, **Defines at definition sites** in the rule editor). Its matches then define their templated ID at the category's definition sites, with the matched text as their range, and are ignored elsewhere; a paragraph definition accepts such a match without the colon or dash other paragraph definitions need. Kiro bugfix criteria use it (see above). Since increment 104, a defining rule whose pattern starts with `^` runs only where its category can define: at the category's enabled definition sites (headings, ID-table cells, list items, or paragraphs) and inside its definition paths. Elsewhere it matches nothing, so its bare numbers are neither references nor overlaps with other rules: Kiro's bugfix-criterion rule (paragraphs only) and task rule (checkbox items in `tasks.md` only) both read `1.1` at the start of a text without "Rules … overlap on …" errors.

## Validation and recovery

The file must be UTF-8 JSON, at most 64 KB, with version 1 and at most 64 categories and 64 rules. Duplicate keys in the category/rule lists, unknown fields, nonexistent categories, invalid regex syntax, and unsafe configuration paths are rejected. `.specular` and `project.json` must be real project directory/file entries, not links. Configuration stays excluded from the normal explorer/index scan and is never treated as executable agent configuration.

Invalid file or schema edits show a warning and retain the last valid loaded configuration for the current session. If the first load is invalid, Specular visibly uses legacy defaults until the file is repaired. A project without `project.json` starts with no categories or recognition rules, so it shows no IDs until you add categories in **Categories** or accept suggestions from **Discover**; the other settings use their defaults. Removing the file returns the project to that empty state. Reopening a project reloads the disk configuration; the last valid configuration is not a separate recovery file.

Data-dependent recognition failures—overlapping matches, conflicting category assignments for the same ID, empty matches, excessive output, or a slow regex—make the index unavailable with a visible explanation. Specular does not select one overlapping rule or show a partial index as complete. Repair the rules and Refresh. The Markdown text stays editable and unchanged; stale source navigation is rejected. Regex execution runs in a worker that is terminated after five seconds, including for pathological patterns. Matching is bounded to two million UTF-16 code units per text region, 50,000 matches per region, 100,000 project occurrences, and a 20 Mi-code-unit project analysis input, alongside the existing file/index limits. Large valid inputs can hit these limits too.

Successful changes rebuild the index from the current editor buffers as well as saved Markdown. Preview links, cursor lookup, source briefs, and occurrence navigation share that result. Brief capture waits for a current index. Switching projects discards the old rules and invalidates outstanding work. The configuration save service uses an expected disk version and an atomic file replacement; a detected external change rejects the save and preserves the caller's draft.

## Application features

Open **Project configuration > Application features**, immediately to the right of **Application modules**. Use **Add feature** beside the heading to create a name, then expand a feature. Use **Add file rule** under **ID assignment rules** to assign IDs defined in a file or folder and descendants. Use **Add ID override** under **ID overrides** for exact IDs. Each rule or override belongs to the containing feature; add the same ID and scope in another feature for multiple memberships. Editing or removing an assignment inside one feature preserves other features. For folder-scoped IDs, enter the ID's scope folder (for example `specs/authentication`); leave scope blank for project-level IDs. Equal IDs in different scopes have separate assignments.

Use **Preview matches** to inspect feature names on occurrences and **Apply** to save. Features appear as rounded, dashed badges alongside module badges in Project Lens. Tab switches preserve the draft; Cancel discards edits. Names can change without losing memberships. Removing a feature removes only its own memberships; assignments left empty remain explicitly unassigned. **Remove ID override** inside a feature removes only that explicit membership. Removing the final membership retains an explicit empty assignment under **Unassigned IDs**; **Restore file/folder assignments** there clears the explicit record and restores inherited membership. Exact overrides replace all file/folder memberships; an empty override explicitly suppresses them. Ordinary mentions do not assign features. Duplicate definitions with different inherited memberships report a feature conflict until an exact override resolves it. Neither operation changes modules, categories, statuses, or Markdown. Removing a category also removes exact feature assignments recognized by its rules, matching module cleanup.

Configuration version 1 accepts optional `features` (up to 64 named entries with stable internal keys), `featureRules` (up to 128 file/folder rules), and `featureOverrides` (up to 256 distinct ID/scope selectors). Omitted fields preserve old-project behavior. For example:

```json
"features": [{ "key": "authentication", "name": "Authentication" }],
"featureOverrides": [
  { "id": "REQ-1", "scope": "specs/authentication", "features": ["authentication"] },
  { "id": "REQ-2", "features": [] }
]
```

Assignments to currently absent IDs are retained. Configuration changes on disk require Reload before Apply; invalid or failed saves preserve the active configuration. Feature file/folder rules and card editing are available; folder-derived generation follows in 70-71. Scope rules alone do not create features.

**Feature dossier (93).** Choose **Feature dossier** among the plugin shortcuts in Project Lens and pick a feature to see its IDs by role with their statuses, definition excerpts, links inside and outside the feature, recent dates, and defining files, each opening its source. It lists the same IDs as the feature's **Group by > Feature** group, plus feature conflicts that name the feature. See `bundled-plugins/feature-dossier/README.md`.

**Generated summaries (94).** Plugins that declare the summary capability can ask Specular for a short summary of a feature or a set of IDs. Specular builds the text it sends from what the specifications record (IDs with titles, categories, and statuses, the recorded links between them, and definition excerpts, up to 24,000 characters), asks once per project before sending it to Codex or Claude Code, and runs one turn without tools. Summaries are saved as JSON in the project's `.specular/summaries/<kind>/` folder, are regenerated only when you ask, and show what changed since they were generated. **Agent setup** shows when a project allows summaries and can stop allowing them. In the **Feature dossier**, the collapsible **Generated summary** section below the summary card generates, shows, and regenerates the selected feature's summary, links its citations, and says what changed when it is out of date.

**Agent activity (95).** Activity views read what Claude Code and Codex logged on this computer while working in the project: sessions, prompts as turns, and tool calls with their files, commands, and outcomes, without message text. Turn it on per project in **Agent setup > Read agent sessions for this project**; nothing is sent anywhere. A session belongs to the project when its working folder is the project or inside it. Specular reads the agents' own folders (`~/.claude` and `~/.codex`, or `CLAUDE_CONFIG_DIR` and `CODEX_HOME` when set), at most 500 sessions and 20,000 tool calls, newest first, and checks for new activity every 10 s while a view is open and on **Refresh**. Choose **Agent activity** among the plugin shortcuts in Project Lens to see it: **Sessions** expand into turns and tool calls with failures marked; **Resources** lists project files by agent reads and writes, with specification files marked and opening in Specular; **Commands** groups shell commands by their first words (`npm test`, `git status`, `npx playwright test`) with counts and failures, and marks a group that failed at least 3 times in one session as a repeated failure. Filter by agent, date range, and session. See `bundled-plugins/agent-activity/README.md`.

### Edit features from an ID card

Choose **Edit features** on a Project Lens ID card. The dialog identifies the ID and optional scope, shows current inherited or exact-override membership and its evidence, and lists existing feature names. Select any number of features and choose **Apply**, or **Cancel** to discard the selection. A conflicting assignment requires an explicit choice. **Unassign all features** saves an empty exact override; **Use file/folder assignments** removes that override and restores inheritance, including any conflicts.

Edits preserve modules, categories, statuses, Markdown buffers and undo history. Saved overrides survive restart and appear in Application features. **Feature assignment** on a card shows rule paths, override evidence, and clickable definition sources. If no features exist, **Open Project configuration** provides access to setup. A retained configuration draft must be applied or cancelled before a card assignment can save. External configuration or Markdown changes require **Reload assignment**; failed saves retain the selection, and changing projects closes the editor.

## Application modules

Open **Project configuration > Application modules**. Add module names (for example GUI and Backend), expand a module, and use **Add file rule** in its **ID assignment rules** section. Choose a file or folder path; the containing module is assigned automatically. Add multiple rules as needed. Renaming preserves assignments. Preview assignments and conflicts before Apply. Category, semantic role, and category color remain independent of module membership.

Existing rules that assign multiple modules appear under each target. Opening or renaming a module preserves those stored rules. Changing a rule's path or match mode separates that module's assignment while keeping every other target's original behavior. Removing a rule under one module removes only that assignment. The project supports 128 stored file/folder rules; at the limit, adding rules and editing shared rules that need another slot are disabled with guidance to remove a rule first. Single-target edits and removal remain available.

Each module also has a matching **ID overrides** section. Use **Add ID override** to assign an exact ID to that module, replacing file/folder inheritance. Existing shared overrides appear under each target. Editing a shared ID changes only this module; when you leave the ID field, an existing destination ID keeps its other explicit memberships. Removing an override here removes only this module; removing its last target moves the ID to **Unassigned IDs** below the module editors. That section supports **Add unassigned ID** and **Restore file/folder assignments**. Renaming an override with only one target (or an unassigned override) moves it to the new ID; the former ID resumes inheritance. The project supports 256 stored overrides, including unassigned IDs, and blocks shared edits needing an additional slot at capacity. Removing a module cleans its file rules and override targets while preserving emptied overrides as explicitly unassigned. All changes remain in the draft until Preview and Apply; Cancel leaves saved configuration intact.

Add these optional fields beside `categories` and `rules` in `.specular/project.json`:

```json
{
"modules": [
  { "key": "gui", "name": "GUI" },
  { "key": "backend", "name": "Backend" }
],
"moduleRules": [
  { "key": "gui-files", "scope": "folder", "path": "docs/gui", "modules": ["gui"] },
  { "key": "shared", "scope": "file", "path": "docs/shared.md", "modules": ["gui", "backend"] }
],
"moduleOverrides": [
  { "id": "REQ-01", "modules": ["backend"] },
  { "id": "TASK-02", "modules": [] }
]
}
```

Paths are project-relative, case-sensitive, and use forward slashes. File rules match one exact file; folder rules include descendants (`.` matches the whole project). Absolute paths, wildcards, backslashes, empty segments, `..`, and trailing slashes are rejected. Paths may refer to files not yet present.

Overlapping rules combine memberships. Assignment comes from definition files, so mentioning a GUI requirement in a backend document does not reassign it. Exact-ID overrides replace all file-derived membership; an empty array explicitly unassigns the ID. Spelling is exact: REQ-1 and REQ-01 are different IDs. References inherit the definition assignment; references without definitions are unassigned unless an override exists.

Duplicate definitions with different memberships show **Module conflict** and retain all evidence without choosing a membership. An override resolves the module conflict while the ordinary duplicate-ID warning remains. Cards expose **Module assignment** evidence with rule/path details and source navigation. The module filter includes named modules, Unassigned, and Module conflict. Named filters exclude conflicts. Category colors remain visible in both themes.

### Edit modules from an ID card

Choose **Edit modules** on a Project Lens ID card. Select one or more existing modules and choose **Apply** to save an exact-ID override in `.specular/project.json`. **Cancel** or Escape discards the selection. Numbered names distinguish modules with the same display name; internal keys stay hidden.

**Unassign all modules**, or clearing every checkbox, saves an explicitly empty membership and prevents file/folder rules from reassigning the ID. **Use file/folder assignments**, followed by Apply, removes the override and restores inherited membership, including any duplicate-definition conflicts. A conflicting ID requires an explicit choice; the editor shows the contributing definition files and memberships. Its duplicate-ID warning remains even when an override resolves module membership.

Saved changes refresh cards, module filters, and assignment evidence and appear in **Project configuration > Application modules**. The assignment survives restart. Markdown and unsaved source edits stay intact. **Open Project configuration** opens on Discover; choose **Application modules** to create or configure modules; an existing configuration draft must be applied or cancelled before a separate card edit can save.

Failed saves retain your selection and the previous assignment. If configuration or Markdown changes during editing, use **Reload assignment (discard selection)** to review current settings. Stale cards cannot edit another project, and Apply is disabled while saving.

Refresh after moving files or editing configuration externally to recompute membership. Old source actions are rejected after revisions change. Apply persists configuration across restart. Projects without module fields retain their previous presentation. Removing a referenced module requires correcting its rules before Apply.

Bounds: 64 modules, 128 file rules, 256 exact-ID overrides, and at most 256 evidence entries per ID. Exceeding the evidence bound reports an indexing error instead of silently truncating provenance. Section/inline assignments and custom module colors remain future extensions.

## Authored statuses

Open **Project configuration > Authored statuses**. Choose **Rescan statuses** to scan the current Markdown (including unsaved buffers) with the draft ID rules. Opening the tab does not scan or modify the draft. Review the discovered values, add future values with **Add status**, and choose separate light/dark colors using a picker or six-digit hex input. Combined previews show category, module, and status. **Preview matches**, then **Apply**, saves the palette; Cancel leaves the project file unchanged.

**Delete all statuses** removes every configured display name, matching rule, and light/dark color in one draft action. Use **Preview matches > Apply** to save or **Cancel** to discard the deletion. The empty list remains empty when reopening the section or restarting; use **Add status** or explicitly **Rescan statuses** to populate it again. Rescanning discovers authored values without restoring deleted custom mappings or colors. Markdown, categories, and modules stay unchanged; authored statuses continue to appear with neutral fallback badges and source evidence. The bulk action is disabled when no statuses are configured.

**Rescan statuses** adds newly discovered values without replacing existing colors or removing unused entries. Case and surrounding whitespace are ignored when matching names. No fixed list or semantic roles are assigned to statuses. New values are displayed with a neutral default until configured; reset removes the chosen theme override. Renaming or removing a palette entry never rewrites the Markdown.

Status comes only from a direct, standalone `Status: value` paragraph immediately within an ID heading's section, or the Status cell of an ID table row:

```md
# REQ-01 Login
Status: Reviewed

| ID | Description | Status |
| --- | --- | --- |
| TASK-01 | Login form | Draft |
```

Any intervening heading ends direct ownership; statuses in nested notes, lists, blockquotes, code blocks, arbitrary prose, or non-ID tables are excluded. Authored matching text may contain up to 4096 characters on one line; display names are limited to 128 characters. A status paragraph continued on the next line, such as `Status: Confirmed.` followed by `Related requirements: ...`, reads its first line. Longer lines remain ordinary prose. Missing status has no badge. Conflicting values show **Status conflict** with every source value, including conflicts across duplicate definitions. Capitalization variants agree while source spelling remains visible. Each card's **Authored status** details navigate to revision-checked evidence. A label such as Completed is an authored statement, not verified implementation.

The optional `statuses` array sits beside `categories`, `rules`, and module fields in `.specular/project.json`:

```json
{
  "statuses": [
    { "name": "Reviewed", "colors": { "light": "#176c63", "dark": "#83d8c5" } },
    { "name": "Released" }
  ]
}
```

This is a fragment to merge into the existing version-1 configuration. Up to 128 distinct palette names are supported. Scanning requires valid draft ID rules; configuration and source changes invalidate pending previews. At most 256 status evidence entries per ID are accepted; an exceeded evidence bound reports an indexing error. No status metadata is added to the public plugin API in this increment.

### Matching text and display names

Each status now separates its **Display status name** and colors from its **matching rules**. Renaming a scanned status to Implemented preserves its original exact-text rule. Edit the rule to broaden it, or add several matching rules to the same status.

- **Exact text** compares the whole authored value.
- **Starts with** compares a literal prefix (no wildcards).
- **Advanced regex** uses a JavaScript Unicode regular expression, without slash delimiters. Matching ignores case; use anchors to match the whole value. For example, `^implemented\b.*$` matches Implemented followed by further explanation. Switching to regex prefills an escaped pattern from the existing exact/prefix rule.

All modes trim surrounding whitespace and ignore case. A display name alone is not an additional match when explicit rules are present. Multiple rules for the same display status are allowed. If different statuses match the same authored text, Preview reports the ambiguous text and names and blocks Apply. Remove the redundant scanned status or narrow its rule; list order does not decide the winner. Different authored values mapped to the same display status agree, while their original evidence remains available.

The scan keeps a **Found authored texts (unchanged)** list. Rescan recognizes existing mappings and does not recreate an entry for every matched phrase. Preview matches shows the found text, resulting display badge, and source link. Rule matching runs in the time-limited worker; invalid or over-budget regexes cannot be applied. Source Markdown is never rewritten.

Example entry in the `statuses` array:

```json
{
  "name": "Implemented",
  "rules": [
    { "mode": "startsWith", "value": "Implemented" },
    { "mode": "exact", "value": "Done" }
  ],
  "colors": { "light": "#176c63", "dark": "#83d8c5" }
}
```

For a regex rule use `"mode": "regex"`; JSON requires doubled backslashes, for example `"value": "^implemented\\b.*$"`. Old entries without `rules` retain exact-name matching and become explicit exact rules when edited in the dialog. An empty rules list matches nothing. Each status supports up to 64 rules, each with up to 4096 characters. Scanned long texts receive a shortened editable display name while retaining the full exact match.

### Compact configuration entries

Statuses, categories, ID recognition rules, modules, module file rules, and exact-ID overrides are numbered, collapsible entries. Existing entries initially show their name or identifying text; click the heading (or focus it and press Enter/Space) to edit. New entries open automatically. Headers update as names change, and expansion state survives edits and rescans within the current draft. Status entry numbers correspond to the collision errors, which list the conflicting names and positions.

The configuration dialog uses its main scrollbar for these lists, avoiding nested editor scroll boxes on smaller screens. Matching rules retain separate labeled controls for match type and text/regular expression.

## Dates (increments 79-80)

Specular records dates stated in Markdown and shares them with plugins through the project model; the Project timeline shows them. Typed **date rules** say where a date is written, how it is spelled, and what it means:

| Site | Example | Default meaning |
| --- | --- | --- |
| `status` | `Status: Implemented on 2026-10-13.` under an ID heading | the status's own meaning (its configured name) |
| `list-entry` | `- 2026-09-15: Added the timeline` | recorded entry |
| `heading` | `## [0.23.2] - 2026-05-22`, `### Session 2025-11-21`, `### Increment 1 progress — 2026-09-12` | milestone, labelled by the heading text without its date (`[0.23.2]`) |
| `field` | `**Created**: 2025-12-12` (bold optional, label case-insensitive) | milestone or snapshot, labelled by the field and named by the document's first level-one heading |

Each rule's `pattern` is a Unicode regular expression of 1-512 characters with a named `(?<date>...)` capture; only the first real calendar day counts, and patterns run only in the terminable index worker. List entries use the fixed ISO format. Quoted and fenced examples and invalid dates are ignored; dates in prose are never guessed. A date belongs to the ID whose section contains it; a heading that defines an ID owns its own date, and other dates are identified by their file. A dated status is never repeated as an event.

**Kinds.** `milestone` marks something that happened (Created, Ratified, Date, releases, sessions). `snapshot` marks "last touched" dates such as `Last Updated`, which are overwritten on every edit, so they record neither history nor what happened; their rules are disabled by default. Whether a status date is planned or completed comes from the configured status name, not from the date.

The optional `dates` object in version-1 `.specular/project.json` holds the rule list and an exclusion list; omission uses these defaults:

```json
"dates": {
  "exclude": [],
  "rules": [
    { "key": "status-date", "site": "status", "pattern": "\\bon (?<date>\\d{4}-\\d{2}-\\d{2})\\b" },
    { "key": "list-entry", "site": "list-entry", "kind": "entry" },
    { "key": "heading", "site": "heading", "pattern": "(?<date>\\d{4}-\\d{2}-\\d{2})", "kind": "milestone" },
    { "key": "created", "site": "field", "label": "Created", "kind": "milestone" },
    { "key": "ratified", "site": "field", "label": "Ratified", "kind": "milestone" },
    { "key": "date", "site": "field", "label": "Date", "kind": "milestone" },
    { "key": "last-updated", "site": "field", "label": "Last Updated", "kind": "snapshot", "enabled": false },
    { "key": "last-amended", "site": "field", "label": "Last Amended", "kind": "snapshot", "enabled": false }
  ]
}
```

A `rules` list replaces the defaults entirely, so copy the defaults you want to keep. Keys are unique lowercase names; `pattern` defaults to the patterns above; `enabled` defaults to `true`; field rules need a one-line `label` without colons or emphasis marks; status rules take no `kind`. `exclude` lists project-relative folders or files, such as `Vendor/`, whose dates are ignored by every rule while their IDs stay indexed, which keeps vendored upstream changelogs out of the timeline. The increment 79 form (`statusDates`, `events`) is still accepted and is converted into the default rule list.

### Edit date rules in Specular (increment 81)

Open **Project Lens > Project configuration** and choose the **Dates** tab. Each rule has an **Enabled** switch, a **Site** (Status value, List entry, Heading, or Labelled field), a **Field label** for labelled fields, and a **Kind** (Recorded entry, Milestone, or Last updated) for everything but status rules. Its date pattern sits under **Advanced**, with **Restore default pattern**. Rules can be added for any site, removed, and moved up or down; order matters for status rules, where the first rule that finds a date wins. Rule keys are internal and are generated when a rule is added. **Excluded from date rules** lists folders and files, with suggestions from the project's folders. **Restore default date rules** removes the `dates` object, which means the defaults.

A rule with a problem, such as a label containing a colon or a pattern without a `date` capture, explains it on its row and blocks Apply. **Preview matches** shows, for each rule, how many dates it finds and the first five with source links (**Show more** adds twenty at a time), flags enabled rules that find nothing, and counts the Markdown files skipped by exclusions. **Apply** saves through the usual configuration workflow, and the project model and timeline refresh.

## Discover locally (increment 47)

Open **Project configuration > Discover**. The tab groups controls into two collapsible sections: **Discover with an agent** (below) and **Discover by patterns**. **Markdown scope** sits inside Discover by patterns and applies only to it; the agent always explores all indexable Markdown. Expand **Discover by patterns**, optionally adjust its Markdown scope, and run its action; **Cancel discovery** stops a scan. This scan is local and uses no agent. IDs inside system paths (Windows, Unix, relative, and quoted paths) and links (including link labels, destinations, and automatic URL links) are excluded. A suggested format must have at least two distinct identifiers across the selected files; a single occurrence or repeated occurrences of the same identifier do not produce a suggestion. It works before a project configuration file exists and is independent of the active recognition rules. Current unsaved buffers are included.

Increment 59 adds **Select all / Deselect all** inside Markdown scope. These actions cover every available file, including offscreen entries. Markdown scope follows the folder hierarchy: expand or collapse folders, select individual files, or check/uncheck a folder to include/exclude all descendant Markdown recursively, even while collapsed. Partially selected folders show an indeterminate checkbox. Counts include files only. Counts update immediately. Empty selections cannot run either discovery action, and selecting all does not bypass the local or agent limits. Changing the scope cancels obsolete work and clears its review; selecting an unchanged scope preserves the current review.

Expand a numbered candidate to inspect occurrence counts, definition-like contexts, uncertainty, and up to eight source examples. Use **Delete** at the right end of each candidate header to discard it without expanding it, or **Delete all suggestions** to clear the current review. The toolbar shows the remaining count; there are no Use suggestion checkboxes or Selected markers. Other suggestions retain their edited names, roles, regexes, local definition sites, and expanded state. After deletion, keyboard focus moves to the next entry, the previous entry if needed, or Discover by patterns when none remain. Edit the new category's name, role, and regex as needed. Source buttons navigate to the example and retain the review when you reopen Project configuration.

Increment 67 adds **ID definition sites** inside each discovered category. Choose **Inherit project settings** or **Override for this category** to edit heading, table, and list sites; **Restore inheritance** removes the local override. These are the same controls used in Categories. Switching tabs, opening source evidence, and deleting another suggestion preserve the settings. **Add suggestions to draft** carries them into the matching category for shared Preview/Apply.

**List definitions** (increment 103). When most of a prefix's definition-like matches, and at least two, start list items, as Spec Kit writes `- **FR-001**: System MUST ...`, the suggestion overrides its definition sites with the default headings and tables plus unordered and ordered list items, so the staged category defines those items; its explanation gives the counts. When at least 80% of the definition-like matches sit in files of one name, such as `spec.md`, while others sit elsewhere (checklists, plans, research notes), the suggestion also limits definitions to those files (`definitionPaths`: `specs/*/spec.md` with a scope per specification, `**/spec.md` without one), so list items elsewhere refer to them. Files in tool folders (`.specify/templates` and the others listed under excluded paths) do not count, since discovery proposes excluding them. Lists stay off, and the explanation says why, when more than a tenth of the listed IDs would be defined more than once in a scope, as when plans list the user stories of their specification again or review notes reuse per-file labels: turning lists on would report them as duplicates. A task suggestion of the Spec Kit profile keeps the profile's checkbox-only sites.

**Add suggestions to draft** explicitly validates and stages every remaining suggestion together. The action is disabled when none remain. Preview matches previews the current draft and does not stage discovery suggestions; it reports how many remain outside the draft. The staging confirmation names the new categories and rules. Review their nested recognition rules in Categories, adjust modules and overlapping rules, then **Preview matches > Apply**. Invalid staging preserves the review without adding a partial result. Deletion never removes configured or already-staged categories, rules, modules, or Markdown. A new scan or agent run starts a new review and may produce deleted candidates again unless they now exist in the current draft; switching tabs preserves deletions. Increment 61 removes the Category dropdown and classifies discovered suggestions against saved and unsaved draft rules in the bounded worker. Existing categories are omitted. Ambiguous suggestions remain visible with a reason and are never merged automatically; exact duplicate edits with mismatched evidence are blocked before staging. Rescan statuses after adding new ID rules to find their authored values.

Increment 60 defines the classification used by the next filtering step. The current draft is authoritative, including unsaved categories already added during this configuration session. The decision table is:

| Candidate relationship to the current draft | Classification | Increment 61 behavior |
| --- | --- | --- |
| Same prefix/separator/case rule, identical regex rule, or the exact local regex form of one prefix rule; every example belongs only to that category | Existing | Omit it from review |
| No example is recognized, no equivalent rule/name collision exists, and proposal identity is consistent | New | Show it for review |
| Renamed existing category with the same rule and unanimous evidence | Existing | Omit it; display names do not establish identity |
| Wider/different regex whose finite examples happen to fit an existing rule | Ambiguous | Report it; do not merge or hide it |
| Only some examples are recognized, examples span categories, or rules overlap | Ambiguous | Report it; do not merge or hide it |
| Display name collides without rule identity, or one proposal category key has conflicting metadata | Ambiguous | Report it; do not infer identity from the name/key |
| Several rules share one internally consistent new proposal category key | New category with several rules | Keep the rules together |

This contract never tries to prove arbitrary regular expressions equivalent. Evidence matching runs in the bounded matcher; the classifier itself does not execute proposal regexes. Increment 61 implements the final column, including all-known empty states and reclassification immediately before staging.

Coverage is deliberately limited: ASCII letter prefixes of 1-32 letters, an optional hyphen or underscore, and 1-12 digits. Examples include REF-01, DEC_2, and TASK3. Dates, fenced/inline code, blockquotes, HTML, and link destinations are excluded. Heading-start, ID-table, and leading list-item contexts are heuristic hints of possible definitions, independent of the configured definition sites; since increment 103, list-item hints can turn on a suggestion's list definitions, as described above. Bulleted, numbered, nested, and task-list items support leading plain or emphasized IDs, including `- **FR-001**: requirement text`; later mentions and later paragraphs do not count as definition-like. These counts describe discovery evidence, not the authoritative Preview index. An incidental token such as USB3 may be a false positive. Use the normal **Add rule** controls for unfamiliar formats this heuristic misses. Category roles and application modules are not inferred locally.

Bounds: 2000 selected Markdown files, 20 MB of text, 20,000 candidate occurrences, 128 candidate groups, and eight examples per group. Exceeding a bound reports an error rather than silently claiming full coverage. Worker analysis has the recognition worker's time limit: 5 seconds plus 1 second per million characters of Markdown, at most 30 seconds. Source/configuration/draft changes invalidate the review; cancellation and late results cannot modify configuration.

### Keyword-heading conventions (increment 85c)

**Discover by patterns** also looks for conventions that name or number their elements in headings:

- **Named keyword headings**, such as `### Requirement: User login` and `#### Scenario: Valid credentials`, become categories with a **Keyword and name** definition site at the levels where they occur. A keyword is proposed when it heads at least 3 headings in 2 files, or 5 in one file, with names that vary. Names repeated under delta sections (`## MODIFIED Requirements` in archived changes) do not count against the variety when the keyword also has headings outside them (increment 85d). Repeated template headings such as `## Format: [ID] Description` are therefore not proposed, and neither are document titles (a file's first level-1 heading, such as `# Change: Add realms`). Since increment 102, the suggestion keeps the separator its headings use: `### Test Steps - Save` or `## Fact Tables — Sales` gives a site with separator `-` or `—` (the colon is left out as the default). Recognition reads one separator per category, so when a keyword's headings mix separators, the most common one is chosen (the colon on ties), the counts, the variety check, and the overlap warning cover only the headings it recognizes, and the explanation says how many headings use another separator and are left out.
- **Same names in two keyword categories** (increment 101). When two keyword suggestions that are not nested define the same name, such as `## Command: Start` and `## Event: Start`, each suggestion's explanation names the other and the shared names: adding both recognizes the name in two categories, which stops recognition, so keep one.
- **Namespaced identifiers** (increment 101), such as `### NET:GET_CONFIG` and `### MQTT:GET_CONFIG` in a command reference: an uppercase prefix, a colon without a space, and an uppercase name (letters, digits, underscores) form one identifier. Each prefix with at least two distinct identifiers becomes a category named by the prefix, with a regex rule over the whole identifier, such as `NET:[A-Z][A-Z0-9_]*`, and heading definitions at the levels found. The prefix is part of the ID, so `NET:GET_CONFIG` and `MQTT:GET_CONFIG` are different IDs, and mentions in prose are references. These headings are not proposed as keyword headings (a keyword category would read both as `GET_CONFIG`, in two categories). Identifiers headed in more than one file are listed, since they index as duplicates. Headings with a space after the colon or a lowercase name, such as `## Step: Install`, stay keyword headings.
- **Parents.** When at least 80% of one keyword's headings sit under another keyword's headings at a higher level, the suggestion is nested in it, as Scenario in Requirement.
- **Numbered keyword headings**, such as `## Task 1: Split the tests` or `### Property 3: ...`, become a regex rule such as `\bTask \d+\b` with heading definitions. When the numbers restart in each file of one folder, a per-file scope such as `docs/plans/*.md` is proposed; when they restart in each child folder of one root, a folder scope such as `specs/*`.
- **Capabilities.** Spec files laid out as `<root>/<capability>/spec.md` give a derived Capability suggestion and capability scopes for the keyword categories found in them, including `<changes>/**/specs/{capability}/spec.md` when change folders have specs. Since increment 96c, capabilities grouped in folders (`openspec/specs/<group>/<capability>/spec.md`) are derived with `openspec/specs/**/{capability}/spec.md`, the requirement and scenario scopes use the same pattern, and change deltas under `specs/<group>/<capability>/` use `openspec/changes/**/specs/**/{capability}/spec.md`. Capabilities are named by their folder, so same-named capabilities in different groups become one element; the suggestion lists such names.
- **Changes.** At least two folders with a `proposal.md` under one root (archived ones included) give a derived Change suggestion that declares capabilities. Keyword categories found under ADDED/MODIFIED/REMOVED/RENAMED sections there record changes, and those whose names are backticked elsewhere link backticked names.

These suggestions have no regex. The review shows what they define instead: the keyword and levels, the parent, the scopes, and the derived pattern. Deleting a suggestion removes the parent or capability references to it. On staging, parent and capability references follow renamed keys, and a reference to a suggestion that is not staged is dropped. A suggestion whose keyword or derive pattern matches an existing category is reported as that existing category. Discover with an agent (increments 86a-86b) can propose these conventions too.

### Scopes for restarting numbers (increment 96b)

Kiro and Spec Kit number their records from 1 in every specification: `### Requirement 1` and `### Property 1` in each Kiro specification, `FR-001` in each Spec Kit `spec.md`. Without a scope per specification, these records collide as duplicates. **Discover by patterns** therefore checks, for each numbered keyword heading and each prefix candidate, which specification folder (as found for folder-derived features below) defines each number or ID. When one is defined in at least two specification folders, the suggestion gets a scope per specification:

- `<root>/*` when the specifications are child folders of one root, as in `specs/*` or `.kiro/specs/*`;
- `<root>/**/{spec}/*.md` when they sit at more than one depth. The capture names each scope after its specification folder, so folders with the same name in different groups share one scope; the suggestion lists such names.

At least 80% of the definitions must lie in specification folders. When some lie elsewhere, such as a test README or a template that uses the same headings, the suggestion also sets **Recognize only inside its scopes**, so those files read the headings as prose. The review shows the scopes and the option, which you can clear before adding the suggestion. Numbers that never repeat across specifications get no scope, and candidates outside specification folders keep the per-folder and per-file scopes of 85c. Records written twice within one specification, such as a phase heading in both `design.md` and `tasks.md`, remain duplicates.

### Folder-derived features (increments 96-96a)

When the project keeps one specification per folder, **Discover by patterns** also proposes each such root as **Folder-derived features**. A root qualifies when at least two of its child folders each hold a `spec.md`, `requirements.md`, `bugfix.md`, `design.md`, `tasks.md`, `plan.md`, or `proposal.md`: `specs/*` in Spec Kit, `.kiro/specs/*` in Kiro, and `openspec/specs/*` for OpenSpec capabilities. OpenSpec change folders are changes, not features, and are not proposed; a root nested in another proposed root is not proposed separately.

Increment 96a handles specifications grouped in area or group folders, as in `.kiro/specs/<Area>/<spec>/` or `openspec/specs/<group>/<capability>/`. Roots nested in another root, roots that share a parent, and roots whose parent holds a specification folder itself join into one root. When any of its specification folders sits deeper than a child folder, the suggestion is `<root>/**` (see below) instead of `<root>/*`, so every specification, at any depth, becomes one feature and group folders do not.

- The suggestion appears after the ID categories in **Candidate suggestions**. It shows the pattern and the folders Update derives (up to eight, with the defined IDs each would receive under the current draft; for a `*` pattern, child folders without a specification file are marked), and the first heading of one specification per folder, which opens its source.
- **Add suggestions to draft** adds the pattern as a folder generator for features and runs **Update features**, so the features, named after their folders, are staged together with the categories. Rename them afterwards in **Application features**.
- A root that the draft already derives features from, or one that overlaps it, is omitted ("Omitted 1 folder pattern already in the draft").
- Nothing existing is removed or renamed. When Update is blocked, for example because a folder name equals a manual feature's name, nothing is staged; the status explains the collision. Delete the folder suggestion, or rename the manual feature, and add again.
- Discover by patterns proposes features only. Modules follow the structure of the code, which the Markdown alone does not show; **Discover with an agent** may propose them when the Markdown organizes components by folder.

### Tool folders to exclude (increment 99a)

**Discover by patterns** also proposes **Exclude tool folders from analysis** when the analyzed Markdown includes folders where specification tools keep templates and agent commands: `.specify/templates`, `.claude/commands`, `.claude/skills/speckit-*`, `.github/prompts`, `.cursor/commands`, `.windsurf/workflows`, `.devin/workflows`, `.opencode/command`, `.codex/prompts`, `.gemini/commands`, `.qwen/commands`, `.kilocode/workflows`, `.roo/commands`, `.augment/commands`, `.amazonq/prompts`, and Spec Kitty's `.kittify/missions` and `.kittify/overrides`. A folder is proposed only when its files add something to the index under the current draft; the suggestion lists each with its files, definitions, and pending items.

- **Add suggestions to draft** adds the folders to `excludedPaths`, each once. Nothing is excluded without this step; delete the suggestion to keep a folder analyzed.
- The other suggestions of the same scan were computed with the folders still analyzed, so scan again after adding it.
- Once excluded, a folder is no longer analyzed, so it is not proposed again.

### Discovery providers and tool profiles (increments 97a-97e)

Conventions that belong to one specification tool come from **discovery providers** organized by tool. A provider only proposes: its suggestions are validated, measured, reviewed, and staged like Specular's own. In the review, a provider's suggestions follow Specular's, their title ends with the tool (`2. Criterion 1.1 - Acceptance criterion · Kiro`), and they say "Proposed by the Kiro discovery profile". A provider that cannot run, such as one with an invalid profile, is named in the status after **Discover by patterns**; the others still propose.

A **profile** is a provider written as JSON, with no code. Specular bundles three profiles: **Kiro** (`src/core/profiles/kiro.json`), the acceptance criteria numbered by position (96d), the bugfix criteria with their behaviour tags (96e-96f), and the checkbox tasks (104); **Spec Kit** (`src/core/profiles/spec-kit.json`, increment 97b), the phase and priority tags of tasks (96g); and **Trae** (`src/core/profiles/trae.json`, increment 97e), the `Task N` and `SubTask N.N` items of each `.trae/specs/<name>/tasks.md`, scoped per spec folder and defined by their checkbox items or task headings, so lines such as `Task 2 depends on Task 1` cite them. Since increment 106, the Trae categories scope and define at any depth (`**/.trae/specs/*` and `**/.trae/specs/*/tasks.md`), as the detectors already looked, so sub-projects that each keep their own `.trae/specs` folder have their tasks defined, each spec folder of each sub-project its own scope. OpenSpec's capability layout, change folders, and deltas stay in Specular itself, since they adjust its generic keyword suggestions rather than adding their own; so do Conductor's `## Phase N` headings, which Specular already scopes per track (`conductor/tracks/*`). A profile has:

- `schema` (1), `id` (lowercase letters, digits, hyphens), `tool` (shown in the review), `versions` (the templates it covers), an optional `description`, and an optional `applies` condition (increment 97d, below); without it the profile applies to every project.
- `detectors`, each with an `id`, a `kind`, and a `min` count:
  - `list-section`: ordered lists under a section `heading` (ignoring case, emphasis, and a trailing colon) inside numbered keyword headings (`"within": "numbered-keyword"`), counted per keyword. `citations` is an optional pattern counting their citations, in which `{{keyword}}` is the escaped keyword.
  - `paragraph-sections`: paragraph lines matching `line` under the headings named in `sections` (name to heading text); the first capture is the example.
  - `heading-sections` (97b): in files matching the `files` globs, headings matching the `headings` entries (`name`, `pattern` tested ignoring case, section `tag`, and `describe` with `{{count}}`), and up to 64 IDs starting checkbox items under them. An entry counts when at least `min` headings match it.
  - `matching-lines` (97e): in files matching the `files` globs, list items and headings whose text, after the marker and an optional checkbox, matches `pattern`; the first capture is the example. With `"checkboxOnly": true`, only list items with a checkbox count (headings always do). It holds when at least `min` lines match.
- `proposals`, each naming its `detector`; the kind decides the shape:
  - for `list-section`, one suggestion per keyword: `key` and `name`, `numberedItems.id` (the template of 96d), `"scope": "parent"` (the keyword's scopes), and `references`: labelled-list citation rules for the proposed category (`self`) or the keyword's (`parent`).
  - for `paragraph-sections`, `"join": "numbered-items"` adds a defining `rule`, `idDefinitionSites`, and a `sectionTag` per section to the suggestion with numbered items, or `create`s a category scoped by the specification folders.
  - for `heading-sections`, `"join": "matching-ids"` gives the suggestion whose rule matches at least half of those IDs the entries that counted as section tags, `defaultDefinitionSites` when it has none of its own, and `tagReason` (with `{{files}}` and `{{described}}`, the entries' descriptions joined) appended to its explanation. That suggestion is Specular's own, so it carries no tool label.
  - for `matching-lines`, `"join": "category"` proposes a category of the profile's own: `create` (`key`, `name`, optional `role`, `idScopes` as patterns, and `definitionPaths`), a `rule` (`key` and `pattern`), and `idDefinitionSites`, all checked as the project configuration would; the explanation may use `{{count}}`, `{{files}}`, and `{{folders}}`. Since increment 104, `create.scope` may be `"spec-folders"` (one scope per specification folder holding the matches, `idScopes` being the fallback), the `rule` may be a defining templated rule (`id` and `defines`), `statusSites` sets the category's status sites, and `names` (`keyword` and a `rule` with `key` and `pattern`) adds a rule recognizing the elements by name and replaces Specular's numbered keyword suggestion for that keyword.
  - `uncertainty` (and `tagReason`) are lists of texts; a text with `when` appears only when that count is not zero.

Texts and templates use `{{name}}` for what the detector found (`{{keyword}}`, `{{keywordPattern}}`, `{{keywordLower}}`, `{{section}}`, `{{items}}`, `{{files}}`, `{{citations}}`, `{{count}}`, `{{sections.<name>}}`) and for keys (`{{parent}}`, `{{self}}`). Single braces, such as `{parent}` in `Criterion {parent}.{item}`, belong to the configuration and are kept. **Discover with an agent** sees the providers' findings under `providerCandidates` in `heuristic_candidates`, and `template_profiles` lists every provider with its source and switch and, for the enabled ones, what they found and propose.

**Project profiles** (increment 97b). A project may add its own profiles as `.specular/profiles/*.json`: regular files of at most 64 KB, 16 at most, read with the project configuration (use Refresh after editing them). They run after the bundled ones and are reviewed under their `tool`. A file that is not valid JSON, an invalid profile, or one that reuses another provider's id is listed as skipped, and the others still run.

**Turning providers off** (increment 97b). **Discover by patterns** has a **Providers by tool** list: each provider with its source (bundled or its file) and versions, and a switch. Turning one off takes effect at the next scan and is saved in `project.json` as `"discoveryProviders": { "disabled": ["spec-kit"] }` when you Apply; the agent's hints follow it too.

**Where a provider applies** (increment 97d). A provider declares where it applies with an `applies` condition over the project's Markdown paths, which Specular evaluates without running the provider:

- `{ "files": "<glob>", "min": n }`: at least `n` Markdown files match the glob.
- `{ "folders": "<glob>", "min": n }`: at least `n` folders match the glob and hold Markdown files, directly or in subfolders.
- `{ "any": [...] }` and `{ "all": [...] }` combine them, up to 16 conditions and two levels deep.

`*` matches within a path segment and `**` across folders; matching ignores case, and `min` defaults to 1. The 97a form `"applies": { "files": ["<glob>", …] }` still works and means `any` of those globs. The bundled conditions are fitted to the survey projects and to a path survey of 489 GitHub repositories: Kiro applies with `{ "folders": "**/.kiro/specs/*" }`, Trae with `{ "folders": "**/.trae/specs/*" }`, and Spec Kit with a `.specify` folder or, failing that, `specs/*/` folders holding `spec.md`, `plan.md`, and `tasks.md`.

A provider is **on by default exactly where it applies**. **Providers by tool** shows each one as *detected* (with the number of matching files and an example), *not detected*, or *applies to every project* when it declares no condition. A switch that differs from that default is stored: `"discoveryProviders": { "disabled": ["spec-kit"], "enabled": ["kiro"] }` turns Spec Kit off where it applies and Kiro on where it does not. A switch set back to its default is removed. The agent's `template_profiles` reports each provider's `applies` and `enabled`.

**Installed profiles** (increment 97c). Detection that a JSON profile cannot express, such as reading YAML front matter, comes from an installed profile: a plugin package that declares a discovery contribution (see the plugin SDK guide). An installed profile declares its condition as `discovery.applies` in its manifest; where it does not apply and is not turned on, it is not started. Profiles are not abstractions: they add no views and are installed and managed from the **Project** menu (**Install profile folder…**, **Install profile archive (.zip)…**, **Manage profiles…**), not from **Abstractions**. Each path refuses the other kind: a package without views is not an abstraction, and one without a discovery contribution is not a profile. It runs in the plugin sandbox over a read-only Markdown model of the selected files, after the profiles, and is stopped after 10 seconds. Its suggestions are validated and reviewed like a profile's and say "Proposed by the Spec Kitty installed profile"; its **Gaps**, conventions the configuration cannot express, are listed below the suggestions as notes and never applied. It appears in **Providers by tool** as `installed <id>`, and its switch is saved under its id, such as `"disabled": ["example.spec-kitty"]`. A profile that fails, times out, or returns an invalid suggestion is named in the status, and the others still run. **Discover with an agent** does not run them. The example `examples/plugins/spec-kitty` proposes Spec Kitty work packages and subtasks.

## Folder-derived features and modules (increments 70-71)

Open **Project configuration > Application features** or **Application modules**. In **Folder-derived features/modules**, choose **Add folder pattern** and enter a project-relative pattern such as `specs/*` (or `spec/*`). Since increment 96a a pattern may also end in `/**`, such as `.kiro/specs/**`: it derives one entry per folder under the root that directly holds a specification file (`spec.md`, `requirements.md`, `bugfix.md`, `design.md`, `tasks.md`, `plan.md`, or `proposal.md`) and is not inside another such folder. Group folders without a specification file are not entries; a specification folder inside another one, such as Spec Kit's `checklists/`, belongs to the outer one. Entries are named by their folder and saved with their full path; a `**` pattern and a `*` pattern of the same target may not share or nest their roots. **Preview folder features/modules** inspects proposed entries without staging them. **Update features/modules** prepares one named entry per immediate child folder and stages its folder mapping in the configuration draft. Review **Preview matches**, then **Apply** to persist the complete draft. Files in deeper folders contribute to that child; files directly under `specs/` do not. Feature and module patterns are independent of each other and of category ID scopes.

The preview uses current draft recognition rules and Markdown buffers. Expand **Affected IDs** to see scoped identities, definition locations, conflicts and preserved exact-ID overrides. Equal raw IDs in different scopes remain distinct. Ordinary mentions never assign memberships. Excluded folders are optional project-relative descendant paths, one per line, such as `specs/authentication/drafts`. Standard workspace exclusions still apply. Folders without included `.md` or `.markdown` files are omitted; folders with Markdown but no definitions appear with zero IDs.

Name collisions are flagged without merging existing entries and block the entire Update. Rename an existing entry or adjust the patterns/exclusions, then retry. Overlapping patterns in the same dimension are rejected. Changes compare with generated entries already in the configuration draft. Missing/excluded folders or removed generators retain their entries and last saved mappings as removal/possible-rename candidates; new paths appear as additions. No rename or deletion is inferred. Remove an unwanted feature/module explicitly, then Preview/Apply. A matching generator can recreate a removed entry on a later Update; remove or narrow its pattern to prevent that. Manual classifications and exact-ID overrides, including explicitly unassigned IDs, stay intact.

Generator settings, stable entry identities, edited display names and folder mappings survive restart. Repeated Update reuses the same identities without duplicates. New child folders do not create entries until Update and Apply. New definitions within an already saved folder mapping participate immediately in normal indexing. Changing a generator's pattern/exclusions alone does not change saved mappings: Update explicitly refreshes those snapshots. You can save settings alone with Preview matches/Apply, then update later.

Generated entries show a **Generated folder mapping** section instead of editable manual file-rule controls. Their display names and exact-ID overrides remain editable. **Preview folder features/modules** does not enable Apply; Update stages changes, and Preview matches reviews their actual effect before Apply. Cancel, reload and switching projects discard unsaved drafts. Source or generator-setting changes after Update require another Update before Preview/Apply. Configuration conflicts, stale previews and failed saves retain the draft without partial writes. Markdown is never changed by this workflow.

Limits: 32 generators per dimension, 64 exclusions per generator, 64 proposed/retained plus manual entries per dimension, 10,000 source files, 50,000 definitions, and 20,000 membership evidence entries. The shared worker enforces its recognition limits: 20 MB, and 5 seconds plus 1 second per million characters, at most 30 seconds; excess work fails without accepting partial results. Affected IDs are paged in groups of 50. The existing 64 KB project-configuration size limit still applies.

The optional `folderGenerators` and `generatedFolders` fields extend the version-1 configuration format. Each generated mapping references an existing feature/module key and stores its generator key, target, canonical child folder, and the pattern/exclusions snapshot from the last Update. These internal keys are separate from display names. For example, alongside the usual category and recognition settings:

```json
{
  "features": [{ "key": "generated1", "name": "Authentication" }],
  "folderGenerators": [{ "key": "bySpec", "target": "features", "pattern": "specs/*", "exclusions": [] }],
  "generatedFolders": [{ "generator": "bySpec", "target": "features", "folder": "specs/authentication", "entry": "generated1", "pattern": "specs/*", "exclusions": [] }]
}
```

Mappings may outlive a removed generator for explicit review. Deleting the entry also removes its mapping and cleans its exact-override memberships using the existing deletion rules. Manual file rules cannot target generated entries; exact-ID overrides can. Absent fields preserve older configurations.

## Discover with an agent (increments 86a-87, 92)

Open **Project configuration > Discover** and use **Discover with an agent**, the first discovery method. Choose the **Agent**:

- **Codex** uses its connection: connect it in **Agent setup** first.
- **Claude Code** uses the installation found in **Agent setup** (its executable path, or PATH) and its own sign-in: run `claude` once in a terminal and log in if you have not. A run uses your Claude plan or API key like any other Claude Code session.

Optionally enter a **Model** (for Claude Code an alias such as `sonnet` or a full model name), then choose **Run agent discovery**; a run takes a few minutes.

The agent explores the project instead of receiving a sample. It works only through Specular's read-only tools, served by a local MCP server that exists for the duration of the run:

| Tool | What the agent gets |
|---|---|
| `project_overview` | Folders with Markdown counts and sizes, sample paths, the detected layout (Spec Kit, OpenSpec, Kiro), and the current configuration |
| `list_markdown` | Paged paths under a folder or glob |
| `read_markdown` | One file or a line range, at most 20,000 characters per call |
| `search_markdown` | Regex matches per file with examples; matches in code and HTML are counted separately |
| `heuristic_candidates` | The Discover by patterns inventory, as a starting point |
| `configuration_schema` | The configuration format described on this page |
| `evaluate_configuration` | A draft run through the same validation and analyzer as Preview: per-category definitions, references, distinct IDs, duplicates, unresolved references, errors, and examples. Also status metrics (occurrences per status site and category, IDs with and without a status, conflicts, and the most frequent values with the status each maps to) and date metrics (dates per rule with examples, enabled rules that find nothing, and files per exclusion) |
| `list_matches` | Pages through one category's matches, to spot tokens that are not records; also its conflicting, unmapped, or missing statuses, or the dates one date rule found |
| `submit_proposal` | The final configuration, or the `evaluationId` of a draft evaluated in the run, with a rationale per category, a rationale for changed status and date settings, and gaps; an invalid one is returned to the agent with its errors |

- **What the agent can reach.** Only the Markdown that Specular indexes for this project, read from disk when the run starts. It has no shell, file, edit, or web tools and no network access, and the agent works in an empty directory rather than the project. Codex gets an ephemeral read-only thread with its built-in tools turned off. Claude Code runs headless with no built-in tools, refuses anything not allowed, and loads no user or project settings, hooks, skills, commands, `CLAUDE.md`, or other MCP servers. If the agent is offered any other tool, or uses another MCP server, the run stops without a proposal. Since increment 107, a Claude Code agent that asks for a tool the session does not offer, such as a Specular tool by its bare name (`read_markdown` instead of `mcp__specular__read_markdown`) or a built-in such as `Bash`, is refused by Claude Code with an error it can act on, and nothing runs: the run goes on, lists the refused call in its progress, and records it in its result (`refusedTools`). Refused calls use none of the tool-call limit; the fifth in one run stops it. Claude Code agents are also told that the tools carry the `mcp__specular__` prefix.
- **Progress and limits.** Each tool call is listed as it happens, for example "Evaluated draft 3: 12 categories, 18 duplicates". **Tool-call limit** sets how many tool calls a run may use, from 20 to 200 (default 80 since increment 92; 60 before). The time limit follows it: 10 seconds per call, between 10 and 30 minutes, as the hint under the field states. The agent is told its limit. When 10 or fewer calls remain (at most a quarter of the limit), each tool result tells it how many are left and asks it to submit its best evaluated draft. After the limit, it may still call `submit_proposal` twice, for example to correct an invalid submission; any other call ends the run. A run also stops when a single call takes over 30 seconds. **Cancel run**, closing the dialog, and switching projects stop it.
- **Best draft (increment 92).** A draft's problems are its duplicates plus unresolved references, and Specular keeps every draft the agent evaluates during the run.
  - **Submission by ID.** The agent can submit an earlier draft unchanged with its `evaluationId`.
  - **Worse-draft check.** A submission with at least 10 and 20% more problems than the best other draft is returned to the agent once, with both drafts' counts. Submitting it again accepts it, so the agent decides; Specular never swaps drafts itself.
  - **Follow-up.** If the agent ends its turn without submitting, after at least one valid evaluation and with tool calls left, Specular asks it once, in the same conversation, to submit its best draft, naming that draft's ID and counts. If it ends again without submitting, the run fails and the message states the best draft's counts.
  - **Clearer rejections.** A misplaced field is named with where it belongs, such as `definitionPaths` inside definition sites. A scope pattern ending in a literal folder gets a glob suggestion such as `specs/013-*`, or a pointer to definition paths.
- **Review.** The proposal lists each category with its rules, definition sites, scopes, the counts Specular measured, and the agent's rationale, all marked as agent-generated. Categories that are new or differ from the draft are selected; **Add selected to draft** adds them or replaces their draft versions with their rules. Categories the agent did not propose stay as they are, and project-wide ID definition sites are a separate choice. Then **Preview matches** and **Apply** as usual. The agent never writes the configuration or Markdown.
- **Statuses and dates (increment 87).** The agent may also propose project-wide status sites (including checkbox markers), the status list with matching rules and colours, and date rules. A draft that leaves them out keeps the current settings. When the proposal changes them, the review shows **Statuses** and **Date rules** parts with the current and proposed settings, the measured counts, and the agent's rationale. Each has its own checkbox and replaces the draft's status settings, or its date settings, as a whole. A category's own status sites belong to the category and come with it.
- **Features and modules (increment 96).** The agent may propose folder generators (`folderGenerators`): features for spec folders, and modules only when the Markdown itself organizes components or services by folder. Its evaluations measure each generator with the same preview as Update: the folders, the IDs per folder, the defined IDs outside every derived folder, and name collisions. When the proposal adds generators, the review shows a **Features and modules** part with the current and added patterns, these counts, and the agent's rationale, with its own include checkbox. **Add selected to draft** adds the new patterns and runs Update for their targets; existing features, modules, and patterns stay as they are. A draft that leaves `folderGenerators` out keeps the current ones.
- **Section tags (increment 96h).** The instructions ask the agent to look for headings that divide one category's records into kinds (functional and non-functional requirements, priorities, releases, phases, bugfix behaviours) and to propose `sectionTags` only when they are measured. When a draft category has section tags, its evaluation reports, per category, the distinct defined IDs per tag with an example, the untagged IDs, the entries that tag nothing, and headings whose captures give no valid tag; `list_matches` pages a tag's definitions (`kind: "tag"`, `tag`) or the untagged ones (`kind: "untagged"`). A proposal that adds tags needs a `tagRationale`. The review shows a **Section tags** part with the proposed entries per category, the measured counts, and the rationale. Tags of a new category come with it. For a category the draft already has, including the part adds the entries to it even when the category itself is not selected, keeping its existing entries.
- **Gaps.** Conventions the agent found but the configuration cannot express are listed as **Gaps**, with example locations. They are notes only, never applied; **Copy gaps** copies them as a Markdown list.
- If Markdown or the configuration changes on disk during the run, or the draft changes before you add the proposal, the proposal is discarded.

The earlier single-prompt **Discover by AI** (increment 48), which sent a sample of the Markdown to Codex in one request without tools, was removed in increment 86c.
