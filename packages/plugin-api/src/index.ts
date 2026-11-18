export const API_VERSION = '0.2.0' as const;
export const MANIFEST_VERSION = 1 as const;

/** `summary.generate` (increment 94, customApi 2) lets a custom view request summaries that Specular generates and stores. */
export type Capability = 'workspace.read' | 'source.navigate' | 'summary.generate';
export type ViewKind = 'list' | 'graph' | 'timeline' | 'custom';
/** A named development model and its major version, as declared in a manifest. */
export type ModelReference = 'project@1' | 'physical@1' | 'activity@1' | 'markdown@1';
/** `activity@1` (increment 95) and `markdown@1` (97c) are additive within API 0.2: hosts that do not know a declared model reject the manifest. */
export const MODELS: readonly ModelReference[] = ['project@1', 'physical@1', 'activity@1', 'markdown@1'];
/**
 * Increment 97c (DD-063): a discovery contribution proposes the conventions of one specification tool. Its entry exports `discover`,
 * which reads only the `markdown@1` model; Specular validates, measures, and reviews what it returns, and writes nothing on its own.
 */
export interface DiscoveryContribution {
  /** The tool, as the review labels its suggestions (`· Spec Kitty`). */
  readonly tool: string;
  /** The template versions it covers. */
  readonly versions: string;
  readonly description?: string;
  /** Increment 97d: where the profile applies. Without it, it applies to every project. */
  readonly applies?: AppliesCondition;
}
/**
 * Increment 97d: whether a discovery provider applies to a project, decided by Specular from the project's Markdown paths alone,
 * without running the provider. `files` counts Markdown files matching a glob; `folders` counts folders holding Markdown files,
 * directly or in subfolders. `*` matches within a path segment and `**` across folders; matching ignores case. `min` defaults to 1.
 */
export type AppliesCondition =
  | { readonly files: string; readonly min?: number }
  | { readonly folders: string; readonly min?: number }
  | { readonly any: readonly AppliesCondition[] }
  | { readonly all: readonly AppliesCondition[] };
/** Why `value` is not an applicability condition: at most 16 path conditions, combined with `any` or `all` at most two levels deep. */
export function appliesError(value: unknown): string | undefined {
  let leaves = 0;
  const check = (item: unknown, depth: number): boolean => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>, keys = Object.keys(record);
    if (keys.length === 1 && (keys[0] === 'any' || keys[0] === 'all')) {
      const list = record[keys[0]];
      return depth < 2 && Array.isArray(list) && list.length >= 1 && list.length <= 16 && list.every(entry => check(entry, depth + 1));
    }
    const kind = keys.find(key => key === 'files' || key === 'folders'), glob = kind && record[kind];
    leaves++;
    return !!kind && keys.every(key => key === kind || key === 'min') && typeof glob === 'string' && glob.length >= 1 && glob.length <= 256 &&
      (record.min === undefined || (Number.isInteger(record.min) && (record.min as number) >= 1 && (record.min as number) <= 1000));
  };
  return check(value, 0) && leaves <= 16 ? undefined
    : 'applies must be {files} or {folders} (a glob of 1-256 characters, optionally with min 1-1000), or {any} or {all} of them, with up to 16 conditions, two levels deep.';
}
export interface PluginManifest {
  readonly manifestVersion: 1;
  readonly id: string;
  readonly title?: string;
  readonly version: string;
  readonly api: string;
  readonly entry: string;
  /** Version 1 adds bounded, session-only custom-view state; version 2 (increment 94) adds `summaries` with the
   * `summary.generate` capability. Older hosts reject versions they do not know. */
  readonly customApi?: 1 | 2;
  readonly capabilities: readonly Capability[];
  /** Models this plugin reads. Requests contain exactly these models. */
  readonly models: readonly ModelReference[];
  /** With `discovery`, views may be empty. */
  readonly views: readonly { readonly id: string; readonly title: string; readonly kind: ViewKind }[];
  /** Increment 97c: required to declare `markdown@1`. */
  readonly discovery?: DiscoveryContribution;
}

/** Paths are project-relative POSIX paths. Offsets are zero-based UTF-16, end exclusive. */
export interface SourceRange {
  readonly file: string;
  readonly start: number;
  readonly end: number;
}
/** A host-issued project token and revision bind evidence to one immutable snapshot. */
export interface SourceReference extends SourceRange {
  readonly projectId: string;
  readonly revision: number;
}
/** Optional classification supplied by hosts with project ID configuration. */
export interface IdCategory {
  readonly key: string;
  readonly name: string;
  readonly role?: 'requirement' | 'design' | 'task';
}
export interface ProjectModule { readonly key: string; readonly name: string }
/** Explicit configuration-derived membership, independent of category. */
export interface ModuleAssignment {
  readonly state: 'assigned' | 'unassigned' | 'conflict';
  readonly modules: readonly ProjectModule[];
  readonly evidence: readonly { readonly kind: 'file-rule' | 'id-override' | 'unassigned'; readonly rule?: string; readonly path?: string; readonly scope?: 'file' | 'folder'; readonly id?: string; readonly source?: SourceRange; readonly modules: readonly ProjectModule[] }[];
}
export interface IdOccurrence {
  /** Opaque composite identity. Use key ?? id for grouping and lookup. */
  readonly key?: string;
  /** Scope: a project-relative folder or file, or a captured scope such as `capability:identity`; absent for project scope. */
  readonly scope?: string;
  readonly moduleAssignment?: ModuleAssignment;
  readonly category?: IdCategory;
  readonly id: string;
  readonly kind: 'definition' | 'reference';
  readonly label: string;
  readonly source: SourceRange;
  readonly owner?: { readonly key?: string; readonly scope?: string; readonly id: string; readonly source: SourceRange };
}
/** Request-level context shared by every model: the opaque project token, revision, and active document. */
export interface RequestContext {
  readonly projectId: string;
  /** Source-navigation revision; every model in a request was computed from it. */
  readonly revision: number;
  /** Active editor document, when it is a Markdown file in the physical model. */
  readonly currentFile?: string;
}
/** Common envelope of every development model. A future extractor plugin produces the same shape. */
export interface ModelEnvelope<Name extends string> {
  readonly name: Name;
  readonly version: 1;
  readonly revision: number;
  /** False while the model's content is still being computed; content is then empty. */
  readonly ready: boolean;
  readonly provenance: {
    readonly extractor: string;
    readonly extractorVersion: string;
    /** Opaque recognition/configuration revision, separate from the source-navigation revision. */
    readonly configurationRevision?: string;
  };
  readonly warnings: readonly string[];
}
/** Folders, text files, and current Markdown text (including unsaved editor contents). */
export interface PhysicalModel extends ModelEnvelope<'physical'> {
  readonly folders: readonly string[];
  readonly files: readonly { readonly path: string; readonly markdown: boolean }[];
  /** LF-normalized Markdown text; source ranges are UTF-16 offsets into this text. */
  readonly documents: readonly { readonly file: string; readonly text: string }[];
}
/** Light/dark display colours as six-digit hex values; either may be absent. */
export interface ThemeColors { readonly light?: string; readonly dark?: string }
export interface ProjectFeature { readonly key: string; readonly name: string }
/** Explicit feature membership, shaped like `ModuleAssignment` and independent of modules and category. */
export interface FeatureAssignment {
  readonly state: 'assigned' | 'unassigned' | 'conflict';
  readonly features: readonly ProjectFeature[];
  readonly evidence: readonly { readonly kind: 'file-rule' | 'id-override' | 'unassigned'; readonly rule?: string; readonly path?: string; readonly scope?: 'file' | 'folder'; readonly id?: string; readonly source?: SourceRange; readonly features: readonly ProjectFeature[] }[];
}
/** A date stated in the specifications: day precision, the matched text, and where it is written. */
export interface DateRecord {
  /** Real ISO calendar day (YYYY-MM-DD); no time of day. */
  readonly value: string;
  /** Matched text, e.g. "on 2026-10-13" in a status or "2026-09-15" in a list entry. */
  readonly text: string;
  readonly source: SourceRange;
  /** The configured rule that found it. */
  readonly rule: 'status-date' | 'event';
}
/** A free-standing dated entry, such as `- 2026-09-15: Added the timeline`. Recorded text, not verified fact. */
export interface ProjectEvent {
  readonly date: DateRecord;
  /** Entry text after the date with continuation lines, the heading text, or the document title for a labelled field. */
  readonly text: string;
  /** The whole entry. */
  readonly source: SourceRange;
  /** Keys of IDs referenced inside the entry. */
  readonly mentionedIds: readonly string[];
  /** Key of the ID whose section contains the date; a heading that defines an ID owns its own date. Without one, `source.file` names the document. */
  readonly owner?: string;
  /** Where the date was written (increment 80): a dated list entry, a heading, or a labelled field such as `**Created**:`. */
  readonly site?: 'list-entry' | 'heading' | 'field';
  /** `entry`: a recorded list entry; `milestone`: something happened; `snapshot`: a "last touched" date overwritten on every edit. */
  readonly kind?: 'entry' | 'milestone' | 'snapshot';
  /** The field label (`Created`) or the heading text without its date (`[0.23.2]`). */
  readonly label?: string;
}
/** One place where a specification writes an ID's status. Authored text, not verified fact. */
export interface StatusOccurrence {
  /** Raw authored value, e.g. "Implemented and validated on 2026-10-13. ...". */
  readonly value: string;
  /** Configured status the value maps to, or the value itself when no status rule matches. */
  readonly name: string;
  /** Kind of status site where it was found; `checkboxes` is a task list marker such as `[x]` (increment 88). */
  readonly site?: 'paragraphs' | 'tables' | 'headings' | 'checkboxes';
  readonly source: SourceRange;
  /** The date written in the value, found by the status-date rule (first match); planned or completed meaning comes from `name`. */
  readonly date?: DateRecord;
}
/** One distinct ID (`key ?? id` of its occurrences) with what the specifications state about it. */
export interface IdElement {
  /** Identity: equals `occurrence.key ?? occurrence.id` for every occurrence of this ID. */
  readonly key: string;
  readonly id: string;
  readonly scope?: string;
  readonly category?: IdCategory;
  /** Defining occurrences: none means the ID is only referenced; several mean duplicates. */
  readonly definitions: readonly SourceRange[];
  readonly modules?: ModuleAssignment;
  readonly features?: FeatureAssignment;
  /** Absent when no status is written; `conflict` when written values map to different names. */
  readonly status?: { readonly state: 'authored' | 'conflict'; readonly occurrences: readonly StatusOccurrence[] };
  /** Increment 96f: tags of the configured section headings enclosing the definitions, such as `bugfix:expected`; absent when none. */
  readonly tags?: readonly string[];
}
/** Configured names and colours, including entries no ID uses. Matching rules are not exported. */
export interface ProjectConfiguration {
  readonly categories: readonly (IdCategory & { readonly colors?: ThemeColors })[];
  /** In configured order. */
  readonly statuses: readonly { readonly name: string; readonly colors?: ThemeColors }[];
  readonly modules: readonly ProjectModule[];
  readonly features: readonly ProjectFeature[];
  /**
   * Increment 100b: the project's traceability layers in order, configured or derived from roles (requirements, design decisions, tasks).
   * Each category is in at most one layer; a category in none takes no part in Focus. Older hosts omit it.
   */
  readonly layers?: readonly TraceabilityLayer[];
}
/** A named, ordered group of category keys for traceability views. */
export interface TraceabilityLayer { readonly name: string; readonly categories: readonly string[] }
/** A recorded link: `to` is mentioned inside the section that defines `from`. Authored evidence, not proof of implementation. */
export interface ProjectRelationship {
  /** Key of the owning ID (an `IdElement.key`). */
  readonly from: string;
  /** Key of the mentioned ID (an `IdElement.key`). */
  readonly to: string;
  /** Every mention recording this link, in index order; each is a reference occurrence's source. */
  readonly evidence: readonly SourceRange[];
  /** Increment 85b: for a link recorded by a change (OpenSpec deltas or declared capabilities), the kinds of change it records. */
  readonly deltas?: readonly ('added' | 'modified' | 'removed' | 'renamed' | 'new')[];
}
/** What the specifications state: ID categories, IDs, their occurrences, statuses, features, relationships, and configured lists. */
export interface ProjectModel extends ModelEnvelope<'project'> {
  readonly occurrences: readonly IdOccurrence[];
  /** One entry per distinct ID; empty while the model is not ready. */
  readonly ids: readonly IdElement[];
  /** One entry per distinct (from, to) pair; empty while the model is not ready. */
  readonly relationships: readonly ProjectRelationship[];
  /** Mentions outside any ID's section: counted, with no link inferred. */
  readonly unownedMentions: number;
  /** Free-standing dated entries; dated statuses are not repeated here. Empty while the model is not ready. */
  readonly events: readonly ProjectEvent[];
  readonly configuration: ProjectConfiguration;
}
/**
 * Increment 95 (DD-061): what coding agents logged while working in this project, read from their local session logs.
 * Recorded by the agents, not verified. No message text. Edits made through shell commands appear as commands.
 */
export interface ActivityModel extends ModelEnvelope<'activity'> {
  /** False until the user turns on "Read agent sessions for this project"; sessions are then empty. */
  readonly enabled: boolean;
  /** Newest first; at most 500 sessions and 20,000 tool calls in all. */
  readonly sessions: readonly AgentSession[];
  /** Per-agent reader results, so views can explain gaps. */
  readonly sources: readonly ActivitySource[];
}
export interface ActivitySource {
  readonly agent: 'claude' | 'codex';
  /** Reader version, such as `claude-jsonl@1`. */
  readonly reader: string;
  /** Log files of this project that were read. */
  readonly files: number;
  /** Malformed, unknown, or oversized (over 1 MB) lines skipped. */
  readonly skippedLines: number;
  /** A session, tool-call, or total cap was reached. */
  readonly truncated: boolean;
}
export interface AgentSession {
  /** The agent's own session id; with `agent`, unique in the model. */
  readonly id: string;
  readonly agent: 'claude' | 'codex';
  /** ISO timestamps. */
  readonly started: string;
  readonly ended?: string;
  /** Project-relative POSIX folder the session started in; '' for the project root. */
  readonly cwd: string;
  readonly branch?: string;
  readonly model?: string;
  /** The agent's own session title, when it records one. */
  readonly title?: string;
  readonly turns: readonly AgentTurn[];
  readonly toolCalls: number;
  /** Tool calls with outcome `error` or `denied`. */
  readonly failures: number;
  /** More than 5,000 tool calls, or the model's total was reached. */
  readonly truncated: boolean;
}
/** One human prompt and the agent's work until the next. No message text. */
export interface AgentTurn {
  readonly index: number;
  readonly started: string;
  readonly toolCalls: readonly ToolCall[];
}
export interface ToolCall {
  readonly at: string;
  /** As named by the agent: `Edit`, `Bash`, `CommandExecution`, `FileChange`. */
  readonly tool: string;
  readonly kind: 'read' | 'write' | 'command' | 'search' | 'other';
  /** Project-relative POSIX paths named by the call (files read, written, or patched). */
  readonly paths: readonly string[];
  /** Paths outside the project, counted but not named. */
  readonly outside: number;
  /** Shell text, at most 500 characters. */
  readonly command?: string;
  readonly outcome: 'ok' | 'error' | 'denied' | 'unknown';
  readonly exitCode?: number;
  readonly durationMs?: number;
  /** Made by a subagent inside this turn. */
  readonly sidechain?: true;
  /** Short hash of the text an edit wrote, for locating edited sections later. */
  readonly editHash?: string;
}
export interface Models {
  readonly project?: ProjectModel;
  readonly physical?: PhysicalModel;
  readonly activity?: ActivityModel;
}
export interface ListViewModel {
  readonly kind: 'list';
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    readonly sources?: readonly SourceReference[];
  }[];
}
export interface GraphViewModel {
  readonly kind: 'graph';
  readonly nodes: readonly {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly sources?: readonly SourceReference[];
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly label?: string;
    readonly sources?: readonly SourceReference[];
  }[];
}
/** A dated, source-backed event. Equal dates deliberately have no implied time ordering. */
export interface TimelineViewModel {
  readonly kind: 'timeline';
  readonly items: readonly {
    readonly id: string;
    /** ISO calendar date (YYYY-MM-DD), with day-level precision only. */
    readonly date: string;
    readonly text: string;
    readonly ids?: readonly string[];
    readonly sources: readonly SourceReference[];
  }[];
}
export type ViewModel = ListViewModel | GraphViewModel | TimelineViewModel;
export interface Appearance {
  readonly mode: 'dark' | 'light';
  readonly colors: Readonly<Record<'background' | 'surface' | 'text' | 'muted' | 'border' | 'accent' | 'selection' | 'warning' | 'error', string>>;
}
export interface RenderRequest {
  /** Optional additive appearance contract. Missing appearance means legacy dark defaults.
   * Custom surfaces expose these colors as --specular-{name} and data-theme on html. */
  readonly appearance?: Appearance;
  readonly apiVersion: typeof API_VERSION;
  readonly requestId: string;
  readonly viewId: string;
  readonly context: RequestContext;
  /** Exactly the models declared in the manifest. */
  readonly models: Models;
  /** Focus identity: occurrence.key ?? occurrence.id. */
  readonly targetId?: string;
  readonly customState?: string;
}
export interface RenderResult {
  readonly apiVersion: typeof API_VERSION;
  readonly requestId: string;
  readonly viewId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly model: ViewModel;
}
/** Entry modules export render. The future host brokers these JSON-shaped inputs/outputs. */
export interface PluginModule {
  render(request: RenderRequest): RenderResult | Promise<RenderResult>;
  dispose?(): void | Promise<void>;
}
/** Custom views run in their own sandboxed document, separate from Specular's DOM. */
export interface CustomViewRoot {
  readonly ownerDocument: { createElement(tagName: string): any };
  append(...nodes: any[]): void;
  replaceChildren(...nodes: any[]): void;
  querySelector(selectors: string): any;
}
export interface CustomViewContext {
  readonly root: CustomViewRoot;
  readonly request: RenderRequest;
  openSource(source: SourceReference): void;
  /** Available with manifest customApi: 1 or 2. Opaque JSON text, at most 64 KiB. */
  saveState?(state: string): void;
  /** Available with manifest customApi: 2 and the `summary.generate` capability (increment 94). */
  readonly summaries?: SummaryApi;
}
/**
 * What to summarize. Specular builds the input from its own models; a plugin cannot send text of its own.
 * `feature`: a configured feature key. `ids`: 1-500 ID keys (`key ?? id`) with a display name of at most 128 characters.
 * Other kinds (`id`, `file`, `project`) may follow; unsupported kinds are rejected.
 */
export type SummarySubject =
  | { readonly kind: 'feature'; readonly key: string }
  | { readonly kind: 'ids'; readonly keys: readonly string[]; readonly name: string };
/** Since generation: ID keys added to and removed from the subject, IDs whose title, status, or excerpt changed, and a new instruction version. */
export interface SummaryChanges {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly { readonly key: string; readonly fields: readonly ('title' | 'status' | 'excerpt')[] }[];
  readonly instruction: boolean;
}
/** A generated summary: model text from the recorded specifications, not recorded content. */
export interface SummaryRecord {
  readonly subject: SummarySubject;
  readonly name: string;
  readonly text: string;
  /** ISO timestamp. */
  readonly generatedAt: string;
  readonly agent: 'codex' | 'claude';
  readonly model?: string;
  /** `[ID]` citations that name a project ID, as keys; and citations that do not. */
  readonly citedIds: readonly string[];
  readonly unknownCitations: readonly string[];
  /** Empty lists and `instruction: false` when the summary matches the current content. */
  readonly changes: SummaryChanges;
}
export interface SummaryApi {
  /** The stored summary compared with the current content, or undefined. Never calls a model. */
  get(subject: SummarySubject): Promise<SummaryRecord | undefined>;
  /** Generates, stores, and returns a new summary in one tool-less agent call. Rejects with a message on failure,
   * refused consent, an unsupported subject, or cancellation; a failure keeps the previous summary. */
  generate(subject: SummarySubject, options: { readonly agent: 'codex' | 'claude'; readonly model?: string }): Promise<SummaryRecord>;
  cancel(subject: SummarySubject): void;
}
export interface CustomViewInstance {
  update(request: RenderRequest): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
export interface CustomPluginModule {
  activate(context: CustomViewContext): CustomViewInstance | Promise<CustomViewInstance>;
}

/**
 * Increment 97c: the indexable Markdown files as a read-only structure, for discovery contributions only. Text is LF-normalized;
 * ranges are UTF-16 offsets into it, end exclusive. Code blocks, HTML, and front matter are not split into blocks.
 */
export interface MarkdownModel extends ModelEnvelope<'markdown'> {
  readonly files: readonly MarkdownFile[];
}
export interface MarkdownFile {
  readonly file: string;
  readonly text: string;
  /** A leading `---` YAML block: its data, or why it could not be parsed. */
  readonly frontMatter?: { readonly range: SourceRange } & ({ readonly data: unknown } | { readonly error: string });
  /** In document order; `parent` is the index of the enclosing heading. */
  readonly headings: readonly { readonly depth: number; readonly text: string; readonly range: SourceRange; readonly parent?: number }[];
  /** Paragraphs, list items, and tables in document order; `heading` is the index of the enclosing heading. */
  readonly blocks: readonly MarkdownBlock[];
}
export type MarkdownBlock =
  | { readonly kind: 'paragraph'; readonly text: string; readonly range: SourceRange; readonly heading?: number }
  /** The item's first paragraph; `checked` for task list items; `depth` 0 for top-level items. */
  | { readonly kind: 'list-item'; readonly text: string; readonly range: SourceRange; readonly heading?: number; readonly ordered: boolean; readonly depth: number; readonly checked?: boolean }
  /** Cell texts by row, the header row first. */
  | { readonly kind: 'table'; readonly rows: readonly (readonly string[])[]; readonly range: SourceRange; readonly heading?: number };
export interface DiscoveryRequest {
  readonly apiVersion: typeof API_VERSION;
  readonly requestId: string;
  readonly context: { readonly projectId: string; readonly revision: number };
  /** `markdown` when the manifest declares `markdown@1`. */
  readonly models: { readonly markdown?: MarkdownModel };
}
/** A source example: `id` is exactly the text at `offset`..`end` of `file`. */
export interface DiscoveryEvidence { readonly id: string; readonly file: string; readonly offset: number; readonly end: number; readonly context: 'heading' | 'id-table' | 'list-item' | 'mention' }
/**
 * A suggestion in the discovery contract (97a): a category and its rule as the project configuration writes them (see
 * docs/project-ids.md), 1-8 examples, and an explanation. Specular validates it like any provider's and labels it with the tool.
 */
export interface DiscoverySuggestion {
  readonly key: string;
  readonly category: { readonly key: string; readonly name: string; readonly [field: string]: unknown };
  readonly rule?: { readonly key: string; readonly category: string; readonly [field: string]: unknown };
  /** Labelled-list citation rules of this category or its numbered-items parent. */
  readonly references?: readonly { readonly key: string; readonly category: string; readonly [field: string]: unknown }[];
  readonly evidence: readonly DiscoveryEvidence[];
  readonly uncertainty: string;
  readonly tagReason?: string;
}
/** A convention found that the configuration cannot express, shown as a note and never applied. */
export interface DiscoveryGap { readonly text: string; readonly evidence?: readonly DiscoveryEvidence[] }
export interface DiscoveryResult {
  readonly apiVersion: typeof API_VERSION;
  readonly requestId: string;
  /** At most 32. */
  readonly suggestions: readonly DiscoverySuggestion[];
  /** At most 16. */
  readonly gaps?: readonly DiscoveryGap[];
}
export interface DiscoveryModule {
  discover(request: DiscoveryRequest): DiscoveryResult | Promise<DiscoveryResult>;
}

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function version(value: string): number[] | undefined {
  if (!stableVersion.test(value)) return;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}
function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
/** Deliberately supports exact stable versions or ">=x.y.z <x.y.z" only. */
export function isApiCompatible(range: string, hostVersion: string = API_VERSION): boolean {
  const host = version(hostVersion);
  if (!host) return false;
  const exact = version(range);
  if (exact) return compare(host, exact) === 0;
  const bounds = /^>=(\S+) <(\S+)$/.exec(range);
  if (!bounds) return false;
  const low = version(bounds[1]), high = version(bounds[2]);
  return !!low && !!high && compare(low, high) < 0 && compare(host, low) >= 0 && compare(host, high) < 0;
}
/** Local package paths use a portable restricted character set, never URLs or parent segments. */
export function isPackagePath(value: string): boolean {
  return value.length <= 240 && value.split('/').every(part =>
    /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) && !part.endsWith('.') &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export type ManifestValidation = { readonly ok: true; readonly manifest: PluginManifest } |
  { readonly ok: false; readonly errors: readonly string[] };
export function validateManifest(input: unknown, hostVersion: string = API_VERSION): ManifestValidation {
  const errors: string[] = [];
  const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!object(input)) return { ok: false, errors: ['Manifest must be an object.'] };
  const keys = ['manifestVersion', 'id', 'title', 'version', 'api', 'entry', 'capabilities', 'models', 'views', 'customApi', 'discovery'];
  if (Object.keys(input).some(key => !keys.includes(key))) errors.push('Unknown manifest field.');
  if (input.manifestVersion !== MANIFEST_VERSION) errors.push('Unsupported manifestVersion.');
  if (input.customApi !== undefined && input.customApi !== 1 && input.customApi !== 2) errors.push('Unsupported customApi version.');
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120)) errors.push('Invalid plugin title.');
  if (typeof input.id !== 'string' || input.id.length > 128 || !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(input.id))
    errors.push('id must be publisher.name using lowercase letters, digits, and hyphens.');
  if (typeof input.version !== 'string' || !version(input.version)) errors.push('version must be a stable semantic version.');
  if (typeof input.api !== 'string' || !isApiCompatible(input.api, hostVersion)) errors.push('Invalid or incompatible API range.');
  if (typeof input.entry !== 'string' || !isPackagePath(input.entry) || !input.entry.endsWith('.js'))
    errors.push('entry must be a package-relative .js path.');
  if (!Array.isArray(input.capabilities) || input.capabilities.length > 3 ||
      input.capabilities.some(c => c !== 'workspace.read' && c !== 'source.navigate' && c !== 'summary.generate') ||
      new Set(input.capabilities).size !== input.capabilities.length || !input.capabilities.includes('workspace.read'))
    errors.push('Declare workspace.read and optionally source.navigate and summary.generate, without duplicates.');
  // Summaries are built from Specular's models for a custom view (increment 94).
  else if (input.capabilities.includes('summary.generate') && (input.customApi !== 2 || !Array.isArray(input.models) || !input.models.includes('project@1') || !input.models.includes('physical@1') ||
      !Array.isArray(input.views) || !input.views.some(view => object(view) && view.kind === 'custom')))
    errors.push('summary.generate requires customApi 2, the project@1 and physical@1 models, and a custom view.');
  if (!Array.isArray(input.models) || input.models.length === 0 || input.models.length > MODELS.length ||
      input.models.some(model => !MODELS.includes(model as ModelReference)) || new Set(input.models).size !== input.models.length)
    errors.push(`Declare 1-${MODELS.length} distinct models from: ${MODELS.join(', ')}.`);
  // 97c: only a discovery contribution reads markdown@1, and it needs no view.
  const discovery = input.discovery;
  const short = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max;
  if (discovery !== undefined && (!object(discovery) || Object.keys(discovery).some(key => !['tool', 'versions', 'description', 'applies'].includes(key)) || !short(discovery.tool, 64) || !short(discovery.versions, 128) || (discovery.description !== undefined && !short(discovery.description, 500))))
    errors.push('discovery needs a tool (1-64 characters), versions (1-128), and optionally a description (1-500) and applies.');
  else if (discovery !== undefined && discovery.applies !== undefined) { const error = appliesError(discovery.applies); if (error) errors.push(`discovery.${error}`); }
  if (Array.isArray(input.models) && input.models.includes('markdown@1') && discovery === undefined) errors.push('markdown@1 is readable only with a discovery contribution.');
  if (!Array.isArray(input.views) || input.views.length > 32 || (input.views.length === 0 && discovery === undefined)) errors.push('Declare 1-32 views, or 0-32 with a discovery contribution.');
  else {
    const ids = new Set<string>();
    for (const view of input.views) {
      if (!object(view) || Object.keys(view).some(key => !['id', 'title', 'kind'].includes(key)) ||
          typeof view.id !== 'string' || view.id.length > 64 || !/^[a-z][a-z0-9-]*$/.test(view.id) ||
          typeof view.title !== 'string' || !view.title.trim() || view.title.length > 120 ||
          (view.kind !== 'list' && view.kind !== 'graph' && view.kind !== 'timeline' && view.kind !== 'custom')) { errors.push('Invalid view contribution.'); continue; }
      if (ids.has(view.id)) errors.push('Duplicate view id.');
      ids.add(view.id);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, manifest: input as unknown as PluginManifest };
}
