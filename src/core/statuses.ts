import { idKey } from './id-identity';
import { definitionSourceOffset } from './definition-sites';
import { DEFAULT_STATUS_SITES, checkboxMarker, compileStatusSite, validateStatusSites, type StatusSites, type StatusSite, type TextStatusSite } from './status-sites';
import { toString } from 'mdast-util-to-string';
import type { Nodes, Root } from 'mdast';
import type { Occurrence, ProjectIndex, SourceLocation } from '../shared/types';
import { resolveStatusCandidates } from './status-precedence';

export interface StatusRule { mode: 'exact' | 'startsWith' | 'regex'; value: string }
export interface StatusPalette { rules?: StatusRule[]; name: string; colors?: { light?: string; dark?: string }; statusSites?: StatusSites }
export interface AuthoredStatus { state: 'authored' | 'conflict'; evidence: { site?: StatusSite; display?: string; value: string; source: SourceLocation; date?: import('./dates').DateMatch }[] }
export const statusKey = (value: string) => value.trim().toLowerCase();
export function validateStatuses(value: unknown): StatusPalette[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error('Provide at most 128 authored statuses.');
  const result = value.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['name', 'colors', 'rules', 'statusSites'].includes(k)) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 128 || /[\r\n\u0000]/.test(item.name)) throw new Error('Each status needs a name of 1-128 characters.');
    const colors: StatusPalette['colors'] = {};
    if (item.colors !== undefined) {
      if (!item.colors || typeof item.colors !== 'object' || Array.isArray(item.colors) || Object.keys(item.colors).some(k => !['light', 'dark'].includes(k))) throw new Error('Status colors accept only light and dark.');
      for (const mode of ['light', 'dark'] as const) if (item.colors[mode] !== undefined) {
        if (typeof item.colors[mode] !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.colors[mode])) throw new Error('Status colors must be six-digit hex values such as #ffcc00.');
        colors[mode] = item.colors[mode].toLowerCase();
      }
    }
    let rules: StatusRule[] | undefined;
    if (item.rules !== undefined) {
      if (!Array.isArray(item.rules) || item.rules.length > 64) throw new Error('Provide at most 64 matching rules per status.');
      rules = item.rules.map((r: any) => {
        if (!r || typeof r !== 'object' || Object.keys(r).some(k => !['mode', 'value'].includes(k)) || !['exact', 'startsWith', 'regex'].includes(r.mode) || typeof r.value !== 'string' || !r.value.trim() || r.value.length > 4096 || /[\r\n\u0000]/.test(r.value)) throw new Error('Status rules need a matching mode and nonempty text of at most 4096 characters.');
        if (r.mode === 'regex') { try { new RegExp(r.value, 'iu'); } catch { throw new Error('Invalid status regular expression.'); } }
        return { mode: r.mode, value: r.value };
      });
    }
    return { name: item.name.trim(), ...(rules === undefined ? {} : { rules }), ...(item.colors === undefined ? {} : { colors }),
      ...(item.statusSites === undefined ? {} : { statusSites: validateStatusSites(item.statusSites) }) };
  });
  const groups = new Map<string, number[]>();
  result.forEach((item, index) => { const key = statusKey(item.name); groups.set(key, [...(groups.get(key) ?? []), index]); });
  const collisions = [...groups.values()].filter(indices => indices.length > 1);
  if (collisions.length) {
    const details = collisions.map(indices => indices.map(index => `entry ${index + 1} ${JSON.stringify(value[index].name)}`).join(' and ')).join('; ');
    throw new Error(`Status names must be unique, ignoring case and surrounding whitespace. Conflicting display names: ${details}. Rename or remove the duplicate entries.`);
  }
  return result;
}

/** Status ownership follows accepted ID definition sites and ends at the next heading. */
export function extractStatuses(root: Root, definitions: Map<Nodes, Occurrence>, source: string,
  location: (offset: number, length: number) => SourceLocation, sites: StatusSites = DEFAULT_STATUS_SITES,
  sitesByCategory?: Map<string, StatusSites>, palettes: StatusPalette[] = []) {
  type Evidence = AuthoredStatus['evidence'][number];
  type Candidate = { value: string; evidence: Evidence };
  type Bucket = { baseline: Candidate[]; local: Map<string, Candidate[]>; count: number };
  const buckets = new Map<Occurrence, Bucket>(), compiled = new Map<StatusSites, Record<TextStatusSite, ReturnType<typeof compileStatusSite>>>();
  const matchers = (settings: StatusSites) => {
    let value = compiled.get(settings);
    if (!value) {
      value = { headings: compileStatusSite(settings.headings), paragraphs: compileStatusSite(settings.paragraphs), tables: compileStatusSite(settings.tables) };
      compiled.set(settings, value);
    }
    return value;
  };
  const lanes = (owner: Occurrence) => ({
    baseline: sitesByCategory?.get(owner.category?.key ?? '') ?? sites,
    local: palettes.filter(status => status.statusSites).map(status => ({ status: status.name, sites: status.statusSites! })),
  });
  const push = (owner: Occurrence, candidate: Candidate, status?: string) => {
    const bucket: Bucket = buckets.get(owner) ?? { baseline: [], local: new Map(), count: 0 }; buckets.set(owner, bucket);
    if (bucket.count++ >= 256) throw new Error('Authored status exceeds 256 extraction candidates.');
    if (status) bucket.local.set(status, [...(bucket.local.get(status) ?? []), candidate]); else bucket.baseline.push(candidate);
  };
  const add = (owner: Occurrence | undefined, node: Nodes, site: TextStatusSite, settings: StatusSites, status?: string, listItem = false) => {
    if (!owner || !node.position || !settings[site].enabled || (listItem && !settings.paragraphs.listItems)) return;
    try {
      const rendered = toString(node), text = site === 'tables' ? rendered.trim() : rendered;
      const leading = site === 'tables' ? rendered.length - rendered.trimStart().length : 0;
      for (const capture of matchers(settings)[site](text)) {
        const { start, end } = node.position;
        let evidenceSource: SourceLocation = { file: owner.file, offset: start.offset!, end: end.offset!, line: start.line, column: start.column };
        if (capture.exact) {
          const offset = definitionSourceOffset(node, source, { id: capture.value, index: capture.index + leading, end: capture.end + leading });
          if (offset === undefined) throw new Error(`Captured status ${JSON.stringify(capture.value)} has no reliable literal source span: the (?<status>...) capture must match text written contiguously in the source, so it must not span Markdown formatting such as ** or a link. Narrow the capture or use literal mode.`);
          evidenceSource = location(offset, capture.value.length);
        }
        push(owner, { value: capture.value, evidence: { site, value: capture.value, source: evidenceSource } }, status);
      }
    } catch (error) { throw new Error('Line ' + node.position.start.line + ', status ' + site + ': ' + String(error)); }
  };
  const addNode = (owner: Occurrence | undefined, node: Nodes, site: Exclude<TextStatusSite, 'tables'>, listItem = false) => {
    if (!owner) return;
    const effective = lanes(owner); add(owner, node, site, effective.baseline, undefined, listItem);
    for (const lane of effective.local) add(owner, node, site, lane.sites, lane.status, listItem);
  };
  const addTable = (owner: Occurrence | undefined, row: Extract<Nodes, { type: 'tableRow' }>, headings: string[]) => {
    if (!owner) return;
    const effective = lanes(owner), candidates: { sites: StatusSites; status?: string }[] = [{ sites: effective.baseline }, ...effective.local];
    for (const candidate of candidates) {
      const column = statusKey(candidate.sites.tables.column);
      const indexes = headings.flatMap((heading, index) => heading === column ? [index] : []);
      for (const index of indexes) {
        const cell = row.children[index];
        if (cell) add(owner, cell, 'tables', candidate.sites, candidate.status);
      }
    }
  };
  let owner: Occurrence | undefined;
  for (const node of root.children) {
    if (node.type === 'heading') {
      owner = definitions.get(node);
      addNode(owner, node, 'headings');
    } else if (node.type === 'paragraph') {
      // A paragraph definition (increment 82) owns the status paragraphs that follow it until the next heading.
      owner = definitions.get(node) ?? owner;
      addNode(owner, node, 'paragraphs');
    } else if (node.type === 'list') {
      // List-item status labels (increment 91): `- **Status**: DONE` reads as a status paragraph where the site enables listItems.
      for (const item of node.children) {
        const first = item.children[0];
        if (!definitions.has(item) && first?.type === 'paragraph') addNode(owner, first, 'paragraphs', true);
      }
    }
    else if (node.type === 'table') {
      const headings = node.children[0].children.map(cell => statusKey(toString(cell)));
      for (const row of node.children.slice(1)) addTable(definitions.get(row), row, headings);
    }
  }
  // Checkbox markers (increment 88): the bracketed character after the bullet of an ID-defining list item, read from the source.
  for (const [node, owner] of definitions) {
    if (node.type !== 'listItem' || node.position?.start.offset === undefined) continue;
    const found = checkboxMarker(source, node.position.start.offset);
    if (!found) continue;
    const effective = lanes(owner);
    for (const lane of [{ sites: effective.baseline, status: undefined as string | undefined }, ...effective.local]) {
      const site = lane.sites.checkboxes, value = site?.enabled ? site.markers[found.marker] : undefined;
      if (value) push(owner, { value, evidence: { site: 'checkboxes', value, source: location(found.offset, found.end - found.offset) } }, lane.status);
    }
  }
  for (const [definition, bucket] of buckets) {
    const resolved = resolveStatusCandidates(bucket.baseline, bucket.local, palettes);
    if (resolved.candidates.length) definition.authoredStatus = {
      state: resolved.state === 'conflict' ? 'conflict' : 'authored',
      evidence: resolved.candidates.map(candidate => candidate.evidence),
    };
  }
}
/** Execute only in the terminable indexing/preview worker. */
export function mapStatuses(index: ProjectIndex, palettes: StatusPalette[]): ProjectIndex {
  const rules = palettes.flatMap(p => (p.rules ?? [{ mode: 'exact' as const, value: p.name }]).map(r => ({ ...r, name: p.name, regex: r.mode === 'regex' ? new RegExp(r.value, 'iu') : undefined })));
  const cache = new Map<string, string>();
  const map = (value: string) => {
    if (cache.has(value)) return cache.get(value)!;
    const names = [...new Set(rules.filter(r => r.regex ? r.regex.test(value.trim()) : r.mode === 'exact' ? statusKey(value) === statusKey(r.value) : statusKey(value).startsWith(statusKey(r.value))).map(r => r.name))];
    if (names.length > 1) throw new Error(`Ambiguous status mapping for "${value}": ${names.join(', ')}. Adjust the matching rules before Apply.`);
    const display = names[0] ?? value; cache.set(value, display); return display;
  };
  const convert = (d: Occurrence): Occurrence => {
    if (!d.authoredStatus) return d;
    const evidence = d.authoredStatus.evidence.map(e => ({ ...e, display: map(e.value) }));
    return { ...d, authoredStatus: { state: new Set(evidence.map(e => statusKey(e.display))).size > 1 ? 'conflict' : 'authored', evidence } };
  };
  return { ...index, definitions: index.definitions.map(convert), references: index.references.map(convert) };
}
export function aggregateStatuses(index: ProjectIndex): ProjectIndex {
  const grouped = new Map<string, AuthoredStatus['evidence']>();
  for (const d of index.definitions) if (d.authoredStatus) grouped.set(idKey(d), [...(grouped.get(idKey(d)) ?? []), ...d.authoredStatus.evidence]);
  const statuses = new Map<string, AuthoredStatus>();
  for (const [id, evidence] of grouped) {
    if (evidence.length > 256) throw new Error(`${id}: authored status exceeds 256 evidence entries.`);
    statuses.set(id, { state: new Set(evidence.map(e => statusKey(e.value))).size > 1 ? 'conflict' : 'authored', evidence });
  }
  return { ...index, definitions: index.definitions.map(d => ({ ...d, authoredStatus: statuses.get(idKey(d)) })), references: index.references.map(d => ({ ...d, authoredStatus: statuses.get(idKey(d)) })) };
}
