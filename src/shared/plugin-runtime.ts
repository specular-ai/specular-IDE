import { idKey } from '../core/id-identity';
import { validModulePath, validScopeValue } from '../core/module-configuration';
import { appearance, validTheme } from './appearance';
import { API_VERSION, type PluginManifest, type RenderRequest, type RenderResult, type SourceReference } from '../../packages/plugin-api/src/index';
export type { PluginManifest, RenderRequest, RenderResult };
export const INPUT_LIMIT = 8 * 1024 * 1024;
export const OUTPUT_LIMIT = 1024 * 1024;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, n = 4096): v is string => typeof v === 'string' && v.length <= n;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const keys = (v: Record<string, any>, names: string[]) => Object.keys(v).every(k => names.includes(k));
const isoDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const relative = (v: unknown): v is string => str(v) && !!v && !v.includes('\\') && !v.includes(':') && !v.includes('\0') && v.split('/').every(p => p !== '' && p !== '.' && p !== '..');
/** Host requests carry every model so source evidence can always be checked; `forPlugin` strips undeclared ones. */
export function parseRequest(json: unknown, manifest: PluginManifest): RenderRequest {
  if (!str(json, INPUT_LIMIT)) throw new Error('Plugin request exceeds 8 MiB.');
  const r = JSON.parse(json);
  if (!object(r) || r.apiVersion !== API_VERSION || !str(r.requestId, 128) || !manifest.views.some(v => v.id === r.viewId) || (r.targetId !== undefined && !str(r.targetId, 16384))) throw new Error('Invalid plugin request.');
  if (r.appearance !== undefined && (!object(r.appearance) || !validTheme(r.appearance.mode) || !object(r.appearance.colors) ||
    !keys(r.appearance, ['mode', 'colors']) || !keys(r.appearance.colors, Object.keys(appearance('dark').colors)) ||
    !Object.keys(appearance('dark').colors).every(key => /^#[0-9a-f]{6}$/i.test(r.appearance.colors[key])))) throw new Error('Invalid plugin appearance.');
  if (r.customState !== undefined && (manifest.customApi !== 1 || !str(r.customState, 65536))) throw new Error('Invalid custom view state.');
  const c = r.context, m = r.models;
  if (!object(c) || !keys(c, ['projectId', 'revision', 'currentFile']) || !str(c.projectId, 128) || !c.projectId || !integer(c.revision)) throw new Error('Invalid plugin context.');
  if (!object(m) || !keys(m, ['project', 'physical'])) throw new Error('Invalid plugin models.');
  const envelope = (v: any, name: string) => {
    if (!object(v) || v.name !== name || v.version !== 1 || v.revision !== c.revision || typeof v.ready !== 'boolean' || !Array.isArray(v.warnings) || v.warnings.length > 256 || !v.warnings.every((w: unknown) => str(w)) ||
      !object(v.provenance) || !keys(v.provenance, ['extractor', 'extractorVersion', 'configurationRevision']) || !str(v.provenance.extractor, 128) || !v.provenance.extractor || !str(v.provenance.extractorVersion, 64) || !v.provenance.extractorVersion ||
      (v.provenance.configurationRevision !== undefined && (!str(v.provenance.configurationRevision, 128) || !v.provenance.configurationRevision))) throw new Error(`Invalid ${name} model.`);
  };
  const physical = m.physical, project = m.project;
  envelope(physical, 'physical'); envelope(project, 'project');
  if (!keys(physical, ['name', 'version', 'revision', 'ready', 'provenance', 'warnings', 'folders', 'files', 'documents']) || !physical.ready ||
    !Array.isArray(physical.folders) || physical.folders.length > 4096 || !physical.folders.every(relative) || new Set(physical.folders).size !== physical.folders.length ||
    !Array.isArray(physical.files) || physical.files.length > 4096 || !physical.files.every((f: any) => object(f) && keys(f, ['path', 'markdown']) && relative(f.path) && typeof f.markdown === 'boolean') ||
    new Set(physical.files.map((f: any) => f.path)).size !== physical.files.length || !Array.isArray(physical.documents)) throw new Error('Invalid physical model.');
  const documents = new Map<string, string>();
  for (const d of physical.documents) {
    if (!object(d) || !keys(d, ['file', 'text']) || !relative(d.file) || !str(d.text, INPUT_LIMIT) || documents.has(d.file)) throw new Error('Invalid plugin document.');
    documents.set(d.file, d.text);
  }
  if (c.currentFile !== undefined && !documents.has(c.currentFile)) throw new Error('Invalid current document.');
  if (!keys(project, ['name', 'version', 'revision', 'ready', 'provenance', 'warnings', 'occurrences', 'ids', 'relationships', 'unownedMentions', 'events', 'configuration']) || !Array.isArray(project.occurrences) || !Array.isArray(project.ids) || project.ids.length > 100000 ||
    !Array.isArray(project.relationships) || project.relationships.length > 200000 || !integer(project.unownedMentions) || !Array.isArray(project.events) || project.events.length > 100000 ||
    (!project.ready && (project.occurrences.length || project.ids.length || project.relationships.length || project.unownedMentions || project.events.length))) throw new Error('Invalid project model.');
  const category = (v: any) => object(v) && keys(v, ['key', 'name', 'role']) && typeof v.key === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v.key) && str(v.name, 128) && !!v.name.trim() && (v.role === undefined || ['requirement', 'design', 'task'].includes(v.role));
  const range = (v: any) => object(v) && relative(v.file) && documents.has(v.file) && integer(v.start) && integer(v.end) && v.start <= v.end && v.end <= documents.get(v.file)!.length;
  const moduleKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v);
  const moduleList = (v: any, limit = 64) => Array.isArray(v) && v.length <= limit && v.every(m => object(m) && keys(m, ['key', 'name']) && moduleKey(m.key) && str(m.name, 128) && !!m.name.trim()) && new Set(v.map(m => m.key)).size === v.length;
  // Module and feature memberships share one shape; `field` names the member list.
  const assignment = (v: any, field: 'modules' | 'features' = 'modules') => object(v) && keys(v, ['state', field, 'evidence']) && ['assigned', 'unassigned', 'conflict'].includes(v.state) && moduleList(v[field]) && (v.state === 'assigned' ? v[field].length > 0 : v[field].length === 0) && Array.isArray(v.evidence) && v.evidence.length > 0 && v.evidence.length <= 256 && v.evidence.every((e: any) => {
    if (!object(e) || !keys(e, ['kind', 'rule', 'path', 'scope', 'id', 'source', field]) || !moduleList(e[field]) || (e.source !== undefined && !range(e.source))) return false;
    if (e.kind === 'file-rule') return moduleKey(e.rule) && ['file', 'folder'].includes(e.scope) && validModulePath(e.path, e.scope) && e.source !== undefined && e.id === undefined && e[field].length > 0;
    if (e.kind === 'id-override') return str(e.id, 512) && !!e.id.trim() && e.rule === undefined && e.path === undefined && e.scope === undefined && e.source === undefined;
    return e.kind === 'unassigned' && !e[field].length && e.rule === undefined && e.path === undefined && e.scope === undefined && e.id === undefined;
  });
  // Folder scopes contain the source file and file scopes are it; captured scopes (`capability:identity`) span folders (85a).
  const identity = (v: any) => (v.scope === undefined || (validModulePath(v.scope, 'file') ? v.source.file === v.scope || v.source.file.startsWith(v.scope + '/') : validScopeValue(v.scope))) &&
    (v.key === undefined ? v.scope === undefined : str(v.key, 16384) && v.key === idKey(v));
  const identityFields = (v: any) => ({ ...(v.key === undefined ? {} : { key: v.key }), ...(v.scope === undefined ? {} : { scope: v.scope }) });
  const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  const colors = (v: any) => v === undefined || (object(v) && keys(v, ['light', 'dark']) && (v.light === undefined || hex(v.light)) && (v.dark === undefined || hex(v.dark)));
  const config = project.configuration;
  if (!object(config) || !keys(config, ['categories', 'statuses', 'modules', 'features']) ||
    !Array.isArray(config.categories) || config.categories.length > 256 || !config.categories.every((v: any) => object(v) && category({ key: v.key, name: v.name, ...(v.role === undefined ? {} : { role: v.role }) }) && keys(v, ['key', 'name', 'role', 'colors']) && colors(v.colors)) ||
    new Set(config.categories.map((v: any) => v.key)).size !== config.categories.length ||
    !Array.isArray(config.statuses) || config.statuses.length > 128 || !config.statuses.every((v: any) => object(v) && keys(v, ['name', 'colors']) && str(v.name, 128) && !!v.name.trim() && colors(v.colors)) ||
    !moduleList(config.modules, 256) || !moduleList(config.features, 256)) throw new Error('Invalid project configuration.');
  // A date record is a real calendar day whose matched text lies in the physical text, found by the named rule.
  const dateRecord = (v: any, rule: string) => object(v) && keys(v, ['value', 'text', 'source', 'rule']) && v.rule === rule && isoDay(v.value) && str(v.text, 512) && !!v.text && range(v.source);
  const statusOccurrence = (v: any) => object(v) && keys(v, ['value', 'name', 'site', 'source', 'date']) && str(v.value) && !!v.value && str(v.name) && !!v.name && (v.site === undefined || ['paragraphs', 'tables', 'headings', 'checkboxes'].includes(v.site)) && range(v.source) &&
    (v.date === undefined || (dateRecord(v.date, 'status-date') && v.date.source.file === v.source.file));
  const element = (v: any) => object(v) && keys(v, ['key', 'id', 'scope', 'category', 'definitions', 'modules', 'features', 'status']) && str(v.id) && !!v.id && str(v.key, 16384) && v.key === idKey(v as { id: string; scope?: string }) &&
    (v.scope === undefined || validScopeValue(v.scope)) && (v.category === undefined || category(v.category)) &&
    Array.isArray(v.definitions) && v.definitions.length <= 256 && v.definitions.every((d: any) => range(d) && (v.scope === undefined || !validModulePath(v.scope, 'file') || d.file === v.scope || d.file.startsWith(v.scope + '/'))) &&
    (v.modules === undefined || assignment(v.modules)) && (v.features === undefined || assignment(v.features, 'features')) &&
    (v.status === undefined || (object(v.status) && keys(v.status, ['state', 'occurrences']) && ['authored', 'conflict'].includes(v.status.state) && Array.isArray(v.status.occurrences) && v.status.occurrences.length > 0 && v.status.occurrences.length <= 256 && v.status.occurrences.every(statusOccurrence)));
  if (!project.ids.every(element) || new Set(project.ids.map((v: any) => v.key)).size !== project.ids.length) throw new Error('Invalid project ID element.');
  // Links join known ID elements; evidence must point at real mentions in the physical text.
  const known = new Set(project.ids.map((v: any) => v.key)), pairs = new Set<string>();
  for (const v of project.relationships) {
    if (!object(v) || !keys(v, ['from', 'to', 'evidence', 'deltas']) || !known.has(v.from) || !known.has(v.to) || !Array.isArray(v.evidence) || !v.evidence.length || v.evidence.length > 100000 || !v.evidence.every(range) ||
      (v.deltas !== undefined && (!Array.isArray(v.deltas) || !v.deltas.length || new Set(v.deltas).size !== v.deltas.length || !v.deltas.every((d: unknown) => ['added', 'modified', 'removed', 'renamed', 'new'].includes(d as string))))) throw new Error('Invalid project relationship.');
    const pair = JSON.stringify([v.from, v.to]); if (pairs.has(pair)) throw new Error('Invalid project relationship.'); pairs.add(pair);
  }
  for (const v of project.events) {
    if (!object(v) || !keys(v, ['date', 'text', 'source', 'mentionedIds', 'owner', 'site', 'kind', 'label']) || !dateRecord(v.date, 'event') || typeof v.text !== 'string' || v.text.length > 65536 || !range(v.source) ||
      (v.site !== undefined && !['list-entry', 'heading', 'field'].includes(v.site)) || (v.kind !== undefined && !['entry', 'milestone', 'snapshot'].includes(v.kind)) ||
      (v.label !== undefined && (!str(v.label, 512) || !v.label.trim() || /[\r\n]/.test(v.label))) ||
      v.date.source.file !== v.source.file || v.date.source.start < v.source.start || v.date.source.end > v.source.end ||
      !Array.isArray(v.mentionedIds) || v.mentionedIds.length > 1024 || !v.mentionedIds.every((id: unknown) => known.has(id)) || new Set(v.mentionedIds).size !== v.mentionedIds.length ||
      (v.owner !== undefined && !known.has(v.owner))) throw new Error('Invalid project event.');
  }
  for (const o of project.occurrences) if (!object(o) || !str(o.id) || !str(o.label) || !['definition', 'reference'].includes(o.kind) || !range(o.source) || !identity(o) || (o.moduleAssignment !== undefined && !assignment(o.moduleAssignment)) || (o.category !== undefined && !category(o.category)) || (o.owner !== undefined && (!object(o.owner) || !str(o.owner.id) || !range(o.owner.source) || !identity(o.owner)))) throw new Error('Invalid plugin occurrence.');
  const projectModules = (values: any[]) => values.map(m => ({ key: m.key, name: m.name }));
  const projectAssignment = (v: any, field: 'modules' | 'features' = 'modules') => ({ state: v.state, [field]: projectModules(v[field]), evidence: v.evidence.map((e: any) => ({ kind: e.kind, [field]: projectModules(e[field]), ...(e.rule === undefined ? {} : { rule: e.rule }), ...(e.path === undefined ? {} : { path: e.path }), ...(e.scope === undefined ? {} : { scope: e.scope }), ...(e.id === undefined ? {} : { id: e.id }), ...(e.source === undefined ? {} : { source: { file: e.source.file, start: e.source.start, end: e.source.end } }) })) });
  const range0 = (v: any) => ({ file: v.file as string, start: v.start as number, end: v.end as number });
  const category0 = (v: any) => ({ key: v.key as string, name: v.name as string, ...(v.role === undefined ? {} : { role: v.role }) });
  const colors0 = (v: any) => v === undefined ? {} : { colors: { ...(v.light === undefined ? {} : { light: v.light as string }), ...(v.dark === undefined ? {} : { dark: v.dark as string }) } };
  const date0 = (v: any) => ({ value: v.value as string, text: v.text as string, source: range0(v.source), rule: v.rule });
  const envelopeFields = (v: any) => ({ version: 1 as const, revision: v.revision as number, ready: v.ready as boolean, warnings: [...v.warnings] as string[],
    provenance: { extractor: v.provenance.extractor as string, extractorVersion: v.provenance.extractorVersion as string, ...(v.provenance.configurationRevision === undefined ? {} : { configurationRevision: v.provenance.configurationRevision as string }) } });
  // Explicit projection keeps future internal/privileged fields out of the public boundary.
  return { apiVersion: API_VERSION, ...(r.appearance === undefined ? {} : { appearance: appearance(r.appearance.mode) }), requestId: r.requestId, viewId: r.viewId, ...(r.targetId === undefined ? {} : { targetId: r.targetId }), ...(r.customState === undefined ? {} : { customState: r.customState }),
    context: { projectId: c.projectId, revision: c.revision, ...(c.currentFile === undefined ? {} : { currentFile: c.currentFile }) },
    models: {
      project: { name: 'project', ...envelopeFields(project),
        occurrences: project.occurrences.map((o: any) => ({ ...(o.moduleAssignment === undefined ? {} : { moduleAssignment: projectAssignment(o.moduleAssignment) }), ...(o.category === undefined ? {} : { category: { key: o.category.key, name: o.category.name, ...(o.category.role === undefined ? {} : { role: o.category.role }) } }), ...identityFields(o), id: o.id, kind: o.kind, label: o.label, source: { file: o.source.file, start: o.source.start, end: o.source.end }, ...(o.owner === undefined ? {} : { owner: { ...identityFields(o.owner), id: o.owner.id, source: { file: o.owner.source.file, start: o.owner.source.start, end: o.owner.source.end } } }) })),
        ids: project.ids.map((v: any) => ({ key: v.key, id: v.id, ...(v.scope === undefined ? {} : { scope: v.scope }), ...(v.category === undefined ? {} : { category: category0(v.category) }), definitions: v.definitions.map(range0),
          ...(v.modules === undefined ? {} : { modules: projectAssignment(v.modules) }), ...(v.features === undefined ? {} : { features: projectAssignment(v.features, 'features') }),
          ...(v.status === undefined ? {} : { status: { state: v.status.state, occurrences: v.status.occurrences.map((o: any) => ({ value: o.value, name: o.name, ...(o.site === undefined ? {} : { site: o.site }), source: range0(o.source), ...(o.date === undefined ? {} : { date: date0(o.date) }) })) } }) })),
        relationships: project.relationships.map((v: any) => ({ from: v.from as string, to: v.to as string, evidence: v.evidence.map(range0), ...(v.deltas ? { deltas: [...v.deltas] } : {}) })), unownedMentions: project.unownedMentions as number,
        events: project.events.map((v: any) => ({ date: date0(v.date), text: v.text as string, source: range0(v.source), mentionedIds: [...v.mentionedIds] as string[], ...(v.owner === undefined ? {} : { owner: v.owner as string }),
          ...(v.site === undefined ? {} : { site: v.site }), ...(v.kind === undefined ? {} : { kind: v.kind }), ...(v.label === undefined ? {} : { label: v.label as string }) })),
        configuration: { categories: config.categories.map((v: any) => ({ ...category0(v), ...colors0(v.colors) })), statuses: config.statuses.map((v: any) => ({ name: v.name, ...colors0(v.colors) })),
          modules: projectModules(config.modules), features: projectModules(config.features) } },
      physical: { name: 'physical', ...envelopeFields(physical), folders: [...physical.folders] as string[], files: physical.files.map((f: any) => ({ path: f.path as string, markdown: f.markdown as boolean })),
        documents: physical.documents.map((d: any) => ({ file: d.file as string, text: d.text as string })) },
    } };
}
/** The copy a plugin receives: only the models its manifest declares. */
export function forPlugin(request: RenderRequest, manifest: PluginManifest): RenderRequest {
  const declared = new Set(manifest.models.map(model => model.split('@')[0]));
  return { ...request, models: Object.fromEntries(Object.entries(request.models).filter(([name]) => declared.has(name))) };
}
export function validSource(source: unknown, request: RenderRequest): source is SourceReference {
  if (!object(source) || !keys(source, ['projectId', 'revision', 'file', 'start', 'end'])) return false;
  const doc = request.models.physical?.documents.find(d => d.file === source.file);
  return !!doc && source.projectId === request.context.projectId && source.revision === request.context.revision && integer(source.start) && integer(source.end) && source.start <= source.end && source.end <= doc.text.length;
}
export function parseResult(json: unknown, request: RenderRequest, manifest: PluginManifest): RenderResult {
  if (!str(json, OUTPUT_LIMIT)) throw new Error('Plugin response exceeds 1 MiB.');
  const r = JSON.parse(json);
  if (!object(r) || !keys(r, ['apiVersion', 'requestId', 'viewId', 'projectId', 'revision', 'model']) || r.apiVersion !== API_VERSION || r.requestId !== request.requestId || r.viewId !== request.viewId || r.projectId !== request.context.projectId || r.revision !== request.context.revision) throw new Error('Invalid or stale plugin response.');
  const m = r.model, view = manifest.views.find(v => v.id === request.viewId)!;
  if (view.kind === 'custom') throw new Error('Custom views do not return host-rendered models.');
  if (!object(m) || m.kind !== view.kind) throw new Error('Plugin returned an undeclared view kind.');
  const sources = (v: any) => v === undefined || (manifest.capabilities.includes('source.navigate') && Array.isArray(v) && v.length <= 32 && v.every(s => validSource(s, request)));
  const entries = (items: any, limit: number, fields: string[], label: string) => {
    if (!Array.isArray(items) || items.length > limit) throw new Error('Plugin view exceeds item limit.');
    const ids = new Set<string>();
    for (const item of items) {
      if (!object(item) || !keys(item, fields) || !str(item.id, 256) || !item.id || ids.has(item.id) || !str(item[label]) || (item.description !== undefined && !str(item.description)) || !sources(item.sources)) throw new Error('Invalid plugin view item or source evidence.');
      ids.add(item.id);
    }
    return ids;
  };
  if (m.kind === 'list') {
    if (!keys(m, ['kind', 'items'])) throw new Error('Invalid list model.');
    entries(m.items, 2000, ['id', 'title', 'description', 'sources'], 'title');
  } else if (m.kind === 'timeline') {
    if (!keys(m, ['kind', 'items']) || !Array.isArray(m.items) || m.items.length > 2000) throw new Error('Invalid timeline model.');
    const ids = new Set<string>(), date = (value: unknown): value is string => str(value, 10) && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
    for (const item of m.items) {
      if (!object(item) || !keys(item, ['id', 'date', 'text', 'ids', 'sources']) || !str(item.id, 256) || !item.id || ids.has(item.id) || !date(item.date) || !str(item.text) ||
        (item.ids !== undefined && (!Array.isArray(item.ids) || item.ids.length > 32 || !item.ids.every((id: unknown) => str(id, 128)))) || !Array.isArray(item.sources) || !item.sources.length || !sources(item.sources)) throw new Error('Invalid timeline event or source evidence.');
      ids.add(item.id);
    }
  } else {
    if (!keys(m, ['kind', 'nodes', 'edges'])) throw new Error('Invalid graph model.');
    const ids = entries(m.nodes, 500, ['id', 'label', 'description', 'sources'], 'label');
    if (!Array.isArray(m.edges) || m.edges.length > 1000) throw new Error('Graph exceeds edge limit.');
    const edges = new Set();
    for (const e of m.edges) {
      if (!object(e) || !keys(e, ['id', 'from', 'to', 'label', 'sources']) || !str(e.id, 256) || !e.id || edges.has(e.id) || !ids.has(e.from) || !ids.has(e.to) || (e.label !== undefined && !str(e.label)) || !sources(e.sources)) throw new Error('Invalid graph edge or source evidence.');
      edges.add(e.id);
    }
  }
  return r as RenderResult;
}
