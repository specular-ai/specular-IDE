import type { IdCategory, IdElement, Models, ProjectModel, SourceRange, SummaryChanges, ThemeColors } from '@specular/plugin-api';

/** Recorded content only: every count, excerpt, link, and date below comes from the project and physical models. */
export interface FeatureChoice { key: string; name: string; count: number }
export interface Excerpt { source: SourceRange; line: number; text: string; truncated: boolean }
/** `defined` is false for an ID that is only mentioned; its target is then the first mention. */
export interface DossierLink { key: string; label: string; direction: 'out' | 'in' | 'both'; evidence: number; defined: boolean; target?: SourceRange }
export interface DossierId {
  key: string; label: string; title: string;
  status?: { name: string; conflict: boolean };
  featureConflict: boolean; referencedOnly: boolean; duplicate: boolean;
  excerpts: Excerpt[];
  inside: DossierLink[]; outside: DossierLink[];
}
export interface DossierSection { key: string; name: string; role?: IdCategory['role']; ids: DossierId[] }
export interface DossierDate { value: string; label: string; text: string; source: SourceRange; kind: 'status' | 'event' }
export interface Dossier {
  feature: FeatureChoice;
  sections: DossierSection[];
  summary: {
    statuses: { name: string; count: number; colors?: ThemeColors }[];
    noStatus: number; statusConflicts: number; featureConflicts: number; referencedOnly: number; duplicated: number;
  };
  dates: DossierDate[];
  files: { file: string; count: number; first: SourceRange }[];
}

export const MAX_EXCERPT_LINES = 12;
export const MAX_DATES = 5;
const ROLES: (IdCategory['role'] | undefined)[] = ['requirement', 'design', 'task', undefined];
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** An ID belongs to a feature when its assignment lists it; a conflict belongs to every feature its evidence names. */
export function memberOf(element: IdElement, feature: string): boolean {
  const features = element.features;
  if (!features) return false;
  if (features.state === 'conflict') return features.evidence.some(e => e.features.some(f => f.key === feature));
  return features.features.some(f => f.key === feature);
}

export function featureChoices(project: ProjectModel): FeatureChoice[] {
  return project.configuration.features.map(f => ({ key: f.key, name: f.name, count: project.ids.filter(e => memberOf(e, f.key)).length }));
}

export const idLabel = (element: Pick<IdElement, 'id' | 'scope'>) => element.scope ? `${element.id} · ${element.scope}` : element.id;

/** The defining line and the block below it (after blank lines that follow a heading), up to a blank line or heading. */
export function excerpt(text: string, source: SourceRange): Excerpt {
  const start = text.lastIndexOf('\n', source.start - 1) + 1;
  const lines = text.slice(start).split('\n');
  const line = text.slice(0, start).split('\n').length;
  const taken = [lines[0]];
  let i = 1;
  if (/^#{1,6}\s/.test(lines[0])) while (i < lines.length && !lines[i].trim()) i++;
  let truncated = false;
  for (; i < lines.length; i++) {
    const next = lines[i];
    if (!next.trim() || /^#{1,6}\s/.test(next)) break;
    if (taken.length === MAX_EXCERPT_LINES) { truncated = true; break; }
    taken.push(next);
  }
  return { source, line, text: taken.join('\n'), truncated };
}

/** The text written at the ID's first definition (heading or row text) without the leading ID and its separator; empty when only referenced. */
export function titleOf(project: ProjectModel, element: IdElement): string {
  const first = element.definitions[0];
  const label = (first && project.occurrences.find(o => o.kind === 'definition' && o.source.file === first.file && o.source.start === first.start)?.label) ?? '';
  return label.startsWith(element.id) ? label.slice(element.id.length).replace(/^[\s:.\-–—|]+/u, '') || label : label;
}

export function buildDossier(models: Models, featureKey: string): Dossier | undefined {
  const project = models.project!, physical = models.physical!;
  const feature = featureChoices(project).find(f => f.key === featureKey);
  if (!feature) return;
  const documents = new Map(physical.documents.map(d => [d.file, d.text]));
  const byKey = new Map(project.ids.map(e => [e.key, e]));
  const members = project.ids.filter(e => memberOf(e, featureKey));
  const memberKeys = new Set(members.map(e => e.key));
  const linksOf = (key: string) => {
    const links = new Map<string, DossierLink>();
    for (const r of project.relationships) {
      const other = r.from === key ? r.to : r.to === key ? r.from : undefined;
      if (other === undefined || other === key) continue;
      const direction = r.from === key ? 'out' : 'in';
      const element = byKey.get(other);
      const link = links.get(other) ?? { key: other, label: element ? idLabel(element) : other, direction, evidence: 0, defined: !!element?.definitions.length,
        ...(element?.definitions[0] ? { target: element.definitions[0] } : r.evidence[0] ? { target: r.evidence[0] } : {}) };
      if (link.direction !== direction) link.direction = 'both';
      link.evidence += r.evidence.length;
      links.set(other, link);
    }
    const sorted = [...links.values()].sort((a, b) => natural.compare(a.label, b.label));
    return { inside: sorted.filter(l => memberKeys.has(l.key)), outside: sorted.filter(l => !memberKeys.has(l.key)) };
  };
  const ids = (elements: IdElement[]): DossierId[] => elements
    .sort((a, b) => natural.compare(a.id, b.id) || natural.compare(a.scope ?? '', b.scope ?? ''))
    .map(e => ({
      key: e.key, label: idLabel(e), title: titleOf(project, e),
      ...(e.status ? { status: { name: e.status.state === 'conflict' ? 'Status conflict' : e.status.occurrences[0].name, conflict: e.status.state === 'conflict' } } : {}),
      featureConflict: e.features?.state === 'conflict', referencedOnly: !e.definitions.length, duplicate: e.definitions.length > 1,
      excerpts: e.definitions.flatMap(d => documents.has(d.file) ? [excerpt(documents.get(d.file)!, d)] : []),
      ...linksOf(e.key),
    }));
  const categories = project.configuration.categories;
  const sectionOf = (e: IdElement) => e.category?.key ?? '';
  const sections: DossierSection[] = [];
  for (const role of ROLES) {
    const keys = categories.filter(c => c.role === role).map(c => c.key);
    // Categories absent from the configuration list (older hosts) follow the configured ones of the same role.
    for (const e of members) if ((e.category?.role) === role && !keys.includes(sectionOf(e))) keys.push(sectionOf(e));
    for (const key of keys) {
      const inSection = members.filter(e => sectionOf(e) === key && e.category?.role === role);
      if (!inSection.length) continue;
      const category = categories.find(c => c.key === key) ?? inSection[0].category;
      sections.push({ key: key || 'uncategorized', name: category?.name ?? 'Uncategorized IDs', ...(role ? { role } : {}), ids: ids(inSection) });
    }
  }
  const statusCounts = new Map<string, number>();
  for (const e of members) if (e.status?.state === 'authored') statusCounts.set(e.status.occurrences[0].name, (statusCounts.get(e.status.occurrences[0].name) ?? 0) + 1);
  const configured = project.configuration.statuses;
  const statuses = [
    ...configured.filter(s => statusCounts.has(s.name)).map(s => ({ name: s.name, count: statusCounts.get(s.name)!, ...(s.colors ? { colors: s.colors } : {}) })),
    ...[...statusCounts].filter(([name]) => !configured.some(s => s.name === name)).sort(([a], [b]) => natural.compare(a, b)).map(([name, count]) => ({ name, count })),
  ];
  const dates: DossierDate[] = [];
  for (const e of members) for (const s of e.status?.occurrences ?? []) if (s.date) dates.push({ value: s.date.value, label: idLabel(e), text: s.value, source: s.source, kind: 'status' });
  for (const event of project.events) if (event.owner && memberKeys.has(event.owner)) {
    const owner = byKey.get(event.owner)!;
    dates.push({ value: event.date.value, label: idLabel(owner), text: event.text, source: event.source, kind: 'event' });
  }
  dates.sort((a, b) => b.value.localeCompare(a.value) || a.source.file.localeCompare(b.source.file) || a.source.start - b.source.start);
  const files = new Map<string, { file: string; count: number; first: SourceRange }>();
  for (const e of members) for (const d of e.definitions) {
    const entry = files.get(d.file) ?? { file: d.file, count: 0, first: d };
    entry.count++; if (d.start < entry.first.start) entry.first = d;
    files.set(d.file, entry);
  }
  return {
    feature, sections,
    summary: {
      statuses,
      noStatus: members.filter(e => !e.status).length,
      statusConflicts: members.filter(e => e.status?.state === 'conflict').length,
      featureConflicts: members.filter(e => e.features?.state === 'conflict').length,
      referencedOnly: members.filter(e => !e.definitions.length).length,
      duplicated: members.filter(e => e.definitions.length > 1).length,
    },
    dates: dates.slice(0, MAX_DATES),
    files: [...files.values()].sort((a, b) => natural.compare(a.file, b.file)),
  };
}

/** Increment 94b: summary text split into plain text and `[ID]` citations of project IDs (by key); other brackets stay text. */
export type CitationPart = { text: string; key?: string };
export function citationParts(text: string, project: ProjectModel): CitationPart[] {
  const byLabel = new Map<string, string>();
  for (const e of project.ids) { byLabel.set(idLabel(e), e.key); if (!byLabel.has(e.id)) byLabel.set(e.id, e.key); }
  const parts: CitationPart[] = [];
  const plain = (value: string) => { if (!value) return; const last = parts.at(-1); if (last && last.key === undefined) last.text += value; else parts.push({ text: value }); };
  let at = 0;
  for (const match of text.matchAll(/\[([^\[\]\n]{1,160})\]/g)) {
    plain(text.slice(at, match.index)); at = match.index! + match[0].length;
    const names = match[1].split(/(\s*[,;]\s*)/);
    if (!names.some((name, i) => i % 2 === 0 && byLabel.has(name.trim()))) { plain(match[0]); continue; }
    plain('[');
    names.forEach((name, i) => { const key = i % 2 === 0 ? byLabel.get(name.trim()) : undefined; if (key) parts.push({ text: name.trim(), key }); else plain(name); });
    plain(']');
  }
  plain(text.slice(at));
  return parts;
}

/** A short description of what changed since a summary was generated, or undefined when it is current. */
export function changesText(changes: SummaryChanges): string | undefined {
  const count = (field: 'title' | 'status' | 'excerpt') => changes.changed.filter(c => c.fields.includes(field)).length;
  const items = [
    [changes.added.length, 'ID added', 'IDs added'], [changes.removed.length, 'ID removed', 'IDs removed'],
    [count('title'), 'title changed', 'titles changed'], [count('status'), 'status changed', 'statuses changed'], [count('excerpt'), 'definition edited', 'definitions edited'],
  ].filter(([n]) => n).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (changes.instruction) items.push('the summary instruction was updated');
  return items.length ? items.join(', ') : undefined;
}
