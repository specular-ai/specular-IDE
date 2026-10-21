import { idKey } from '../core/id-identity';
import { buildDependencyGraph } from '../core/dependencies';
import type { FeatureAssignment, IdElement, PhysicalModel, ProjectConfiguration, ProjectModel, ThemeColors } from '../../packages/plugin-api/src/index';
import type { Occurrence } from '../shared/types';
import type { WorkspaceViewSnapshot } from './abstraction-views';

export type HostModels = { project: ProjectModel; physical: PhysicalModel };
/** Bump when the project model's content changes under the same `project@1` contract. */
export const PROJECT_EXTRACTOR_VERSION = '6';
const range = (o: { file: string; offset: number; end: number }) => ({ file: o.file, start: o.offset, end: o.end });
const dateRecord = (file: string, d: { value: string; text: string; offset: number; end: number }, rule: 'status-date' | 'event') => ({ value: d.value, text: d.text, source: { file, start: d.offset, end: d.end }, rule });
const category = (c: NonNullable<Occurrence['category']>) => ({ key: c.key, name: c.name, ...(c.role ? { role: c.role } : {}) });
const colors = (value?: { light?: string; dark?: string }): { colors?: ThemeColors } =>
  value && (value.light || value.dark) ? { colors: { ...(value.light ? { light: value.light } : {}), ...(value.dark ? { dark: value.dark } : {}) } } : {};
const moduleAssignment = (a: NonNullable<Occurrence['moduleAssignment']>) => ({ ...a, evidence: a.evidence.map(({ source, ...e }) => ({ ...e, ...(source ? { source: range(source) } : {}) })) });
// `explicit` is an internal editing hint; the public shape mirrors module assignments.
const featureAssignment = ({ explicit: _explicit, ...a }: NonNullable<Occurrence['featureAssignment']>): FeatureAssignment =>
  ({ ...a, evidence: a.evidence.map(({ source, ...e }) => ({ ...e, ...(source ? { source: range(source) } : {}) })) });

/** One element per distinct ID. Status and features are aggregated per ID by the indexer, so any occurrence carries them. */
function idElements(occurrences: readonly Occurrence[]): IdElement[] {
  const groups = new Map<string, Occurrence[]>();
  for (const o of occurrences) { const key = idKey(o); groups.set(key, [...(groups.get(key) ?? []), o]); }
  return [...groups].map(([key, group]) => {
    const definitions = group.filter(o => o.kind === 'definition'), first = definitions[0] ?? group[0];
    const status = first.authoredStatus;
    return { key, id: first.id, ...(first.scope ? { scope: first.scope } : {}), ...(first.category ? { category: category(first.category) } : {}),
      definitions: definitions.map(range),
      ...(first.moduleAssignment ? { modules: moduleAssignment(first.moduleAssignment) } : {}),
      ...(first.featureAssignment ? { features: featureAssignment(first.featureAssignment) } : {}),
      ...(status ? { status: { state: status.state, occurrences: status.evidence.map(e => ({ value: e.value, name: e.display ?? e.value, ...(e.site ? { site: e.site } : {}), source: range(e.source), ...(e.date ? { date: dateRecord(e.source.file, e.date, 'status-date') } : {}) })) } } : {}) };
  });
}
/** Names and colours only: matching rules, recognition patterns, and site settings stay inside Specular. */
function configurationLists(snapshot: WorkspaceViewSnapshot): ProjectConfiguration {
  const c = snapshot.configuration;
  return {
    categories: c.categories.map(item => ({ ...category(item), ...colors(item.colors) })),
    statuses: (c.statuses ?? []).map(item => ({ name: item.name, ...colors(item.colors) })),
    modules: (c.modules ?? []).map(item => ({ key: item.key, name: item.name })),
    features: (c.features ?? []).map(item => ({ key: item.key, name: item.name })),
  };
}

/** Each published snapshot is turned into models once and shared by every plugin view. */
const builtModels = new WeakMap<WorkspaceViewSnapshot, HostModels>();
export function modelsFor(snapshot: WorkspaceViewSnapshot): HostModels {
  const cached = builtModels.get(snapshot); if (cached) return cached;
  const indexed = snapshot.ready ? [...snapshot.index.definitions, ...snapshot.index.references] : [];
  // The same recorded graph Specular builds for its own views: one link per (owner, mentioned) pair, evidence in index order.
  const graph = snapshot.ready ? buildDependencyGraph(snapshot.index) : undefined;
  // 85b: a link recorded by a change also lists its delta kinds (added, modified, removed, renamed, new) in evidence order.
  const relationships = graph ? [...graph.edges.values()].map(edge => {
    const deltas = [...new Set(edge.evidence.flatMap(item => item.delta ? [item.delta] : []))];
    return { from: edge.from, to: edge.to, evidence: edge.evidence.map(range), ...(deltas.length ? { deltas } : {}) };
  }) : [];
  const occurrences = indexed.map(o => {
    // A change record (85b) is owned by its change, defined in another file of the change folder.
    const owner = o.owner && snapshot.index.definitions.find(d => d.file === (o.owner!.file ?? o.file) && d.offset === o.owner!.offset);
    return { ...(o.moduleAssignment ? { moduleAssignment: moduleAssignment(o.moduleAssignment) } : {}), ...(o.category ? { category: category(o.category) } : {}), ...(o.scope || o.id.startsWith('@') ? { key: idKey(o), ...(o.scope ? { scope: o.scope } : {}) } : {}), id: o.id, kind: o.kind, label: o.label, source: range(o), ...(owner ? { owner: { ...(owner.scope || owner.id.startsWith('@') ? { key: idKey(owner), ...(owner.scope ? { scope: owner.scope } : {}) } : {}), id: owner.id, source: range(owner) } } : {}) };
  });
  const envelope = (extractor: string, extractorVersion: string) => ({ version: 1 as const, revision: snapshot.revision, provenance: { extractor, extractorVersion,
    ...(extractor === 'specular.project' && snapshot.index.configurationRevision !== undefined ? { configurationRevision: snapshot.index.configurationRevision } : {}) } });
  const models: HostModels = {
    project: { name: 'project', ...envelope('specular.project', PROJECT_EXTRACTOR_VERSION), ready: snapshot.ready, warnings: [], occurrences, ids: idElements(indexed), relationships, unownedMentions: graph?.unownedMentions ?? 0,
      events: snapshot.ready ? (snapshot.index.events ?? []).map(e => ({ date: dateRecord(e.file, e.date, 'event'), text: e.text, source: range(e), mentionedIds: [...e.mentioned], ...(e.owner ? { owner: e.owner } : {}), site: e.site, kind: e.kind, ...(e.label ? { label: e.label } : {}) })) : [],
      configuration: configurationLists(snapshot) },
    physical: { name: 'physical', ...envelope('specular.physical', '1'), ready: true, folders: [...snapshot.folders], files: snapshot.files.map(file => ({ path: file.path, markdown: file.markdown })),
      documents: Object.entries(snapshot.documents).map(([file, text]) => ({ file, text })),
      warnings: snapshot.warnings.length ? [`The project has ${snapshot.warnings.length} file-reading warning(s).`] : [] },
  };
  builtModels.set(snapshot, models); return models;
}
