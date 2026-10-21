export const API_VERSION = '0.2.0' as const;
export const MANIFEST_VERSION = 1 as const;

export type Capability = 'workspace.read' | 'source.navigate';
export type ViewKind = 'list' | 'graph' | 'timeline' | 'custom';
/** A named development model and its major version, as declared in a manifest. */
export type ModelReference = 'project@1' | 'physical@1';
export const MODELS: readonly ModelReference[] = ['project@1', 'physical@1'];
export interface PluginManifest {
  readonly manifestVersion: 1;
  readonly id: string;
  readonly title?: string;
  readonly version: string;
  readonly api: string;
  readonly entry: string;
  /** Version 1 adds bounded, session-only custom-view state. Older hosts reject this field. */
  readonly customApi?: 1;
  readonly capabilities: readonly Capability[];
  /** Models this plugin reads. Requests contain exactly these models. */
  readonly models: readonly ModelReference[];
  readonly views: readonly { readonly id: string; readonly title: string; readonly kind: ViewKind }[];
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
}
/** Configured names and colours, including entries no ID uses. Matching rules are not exported. */
export interface ProjectConfiguration {
  readonly categories: readonly (IdCategory & { readonly colors?: ThemeColors })[];
  /** In configured order. */
  readonly statuses: readonly { readonly name: string; readonly colors?: ThemeColors }[];
  readonly modules: readonly ProjectModule[];
  readonly features: readonly ProjectFeature[];
}
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
export interface Models {
  readonly project?: ProjectModel;
  readonly physical?: PhysicalModel;
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
  /** Available with manifest customApi: 1. Opaque JSON text, at most 64 KiB. */
  saveState?(state: string): void;
}
export interface CustomViewInstance {
  update(request: RenderRequest): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
export interface CustomPluginModule {
  activate(context: CustomViewContext): CustomViewInstance | Promise<CustomViewInstance>;
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
  const keys = ['manifestVersion', 'id', 'title', 'version', 'api', 'entry', 'capabilities', 'models', 'views', 'customApi'];
  if (Object.keys(input).some(key => !keys.includes(key))) errors.push('Unknown manifest field.');
  if (input.manifestVersion !== MANIFEST_VERSION) errors.push('Unsupported manifestVersion.');
  if (input.customApi !== undefined && input.customApi !== 1) errors.push('Unsupported customApi version.');
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120)) errors.push('Invalid plugin title.');
  if (typeof input.id !== 'string' || input.id.length > 128 || !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(input.id))
    errors.push('id must be publisher.name using lowercase letters, digits, and hyphens.');
  if (typeof input.version !== 'string' || !version(input.version)) errors.push('version must be a stable semantic version.');
  if (typeof input.api !== 'string' || !isApiCompatible(input.api, hostVersion)) errors.push('Invalid or incompatible API range.');
  if (typeof input.entry !== 'string' || !isPackagePath(input.entry) || !input.entry.endsWith('.js'))
    errors.push('entry must be a package-relative .js path.');
  if (!Array.isArray(input.capabilities) || input.capabilities.length > 2 ||
      input.capabilities.some(c => c !== 'workspace.read' && c !== 'source.navigate') ||
      new Set(input.capabilities).size !== input.capabilities.length || !input.capabilities.includes('workspace.read'))
    errors.push('Declare workspace.read and optionally source.navigate, without duplicates.');
  if (!Array.isArray(input.models) || input.models.length === 0 || input.models.length > MODELS.length ||
      input.models.some(model => !MODELS.includes(model as ModelReference)) || new Set(input.models).size !== input.models.length)
    errors.push(`Declare 1-${MODELS.length} distinct models from: ${MODELS.join(', ')}.`);
  if (!Array.isArray(input.views) || input.views.length === 0 || input.views.length > 32) errors.push('Declare 1-32 views.');
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
