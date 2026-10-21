import { toString } from 'mdast-util-to-string';
import type { Nodes } from 'mdast';
import { parseMarkdown } from './documents';
import { definitionSourceOffset } from './definition-sites';
import { escapeRegex, validateIdConfiguration, type IdCategory, type IdConfiguration, type IdRule } from './id-configuration';
import type { ModuleFileRule, ProjectModule } from './module-configuration';
export interface CandidateEvidence { id: string; file: string; offset: number; end: number; context: 'heading' | 'id-table' | 'list-item' | 'mention' }
export interface IdCandidate { prefix: string; separator: string; count: number; distinctIds: number; definitions: number; evidence: CandidateEvidence[] }
/** Increment 85c: a recurring keyword heading, named (`Requirement: <name>`) or numbered (`Task 1: ...`). */
export interface KeywordCandidate { keyword: string; numbered: boolean; count: number; files: number; levels: number[]; evidence: CandidateEvidence[]; parent?: string; scope?: string; inSpecs: boolean; inDeltas: number; nameReferences: number }
/** Increment 85c: an OpenSpec-like layout: capability spec folders and change folders with proposals. */
export interface LayoutCandidate { specRoot?: string; specEvidence: CandidateEvidence[]; changeRoot?: string; changeEvidence: CandidateEvidence[]; changeSpecs: boolean }
export interface CandidateInventory { files: string[]; candidates: IdCandidate[]; occurrences: number; excluded: string; keywords?: KeywordCandidate[]; layout?: LayoutCandidate }
/** A token suggestion has a rule; a keyword or derived suggestion (85c) defines elements through its category instead. */
export interface ConventionSuggestion { key: string; category: IdCategory; rule?: IdRule; modules?: ProjectModule[]; moduleRules?: ModuleFileRule[]; evidence: CandidateEvidence[]; uncertainty: string }
export interface ConventionProposal { version: 1; suggestions: ConventionSuggestion[] }
export const DISCOVERY_COVERAGE = 'ASCII letter prefixes (1-32 letters), optional hyphen/underscore, and 1-12 digits. Headings, ID-table cells, list items, and prose only. Definition-like counts are heuristic hints, independent of configured definition sites; enable list sites explicitly to recognize list definitions. Dates, code/inline-code, quotes, HTML, system paths, and links (including labels, destinations, and automatic URL links) are excluded. Pattern suggestions require at least two distinct identifiers with the same prefix and separator across selected files. Counts cover selected files; up to 8 source examples per group. Keyword headings ("Requirement: <name>", "Task 1: ...") are proposed when they recur (3 in 2 files, or 5 in one) with varying names, excluding document titles; capability folders (<root>/<name>/spec.md) and change folders with a proposal.md are proposed as derived elements. This is not an exhaustive detector. Use Add rule for other formats.';

/** Source-backed leading list paragraphs, shared by inventory and proposal validation. */
function listStarts(tree: Nodes, source: string): Map<number, { node: Nodes; value: string }> {
  const starts = new Map<number, { node: Nodes; value: string }>();
  const visit = (node: Nodes) => {
    if (['blockquote', 'code', 'inlineCode', 'html'].includes(node.type)) return;
    if (node.type === 'listItem' && node.children[0]?.type === 'paragraph') {
      const first = node.children[0], value = toString(first);
      if (value) {
        const offset = definitionSourceOffset(first, source, { id: value[0], index: 0, end: 1 }, ['text']);
        if (offset !== undefined) starts.set(offset, { node: first, value });
      }
    }
    if ('children' in node) node.children.forEach(visit);
  };
  visit(tree); return starts;
}
function isListEvidence(e: Pick<CandidateEvidence, 'id' | 'offset' | 'end'>, starts: ReturnType<typeof listStarts>, source: string) {
  const start = starts.get(e.offset);
  return !!start && start.value.startsWith(e.id)
    && (!start.value[e.id.length] || /[\s\u2014:\u2013]/u.test(start.value[e.id.length]))
    && definitionSourceOffset(start.node, source, { id: e.id, index: 0, end: e.id.length }, ['text']) === e.offset;
}

/** Path-shaped tokens, including quoted paths with spaces, in original source coordinates. */
function pathSpans(source: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  // A separator must belong to a token: a standalone slash in prose is not a path.
  const paths = /"[^\s"\\/]*[/\\][^"\r\n]*"|'[^\s'\\/]*[/\\][^'\r\n]*'|[^\s`"'<>|,;()[\]{}]+/gu;
  for (const match of source.matchAll(paths)) {
    const value = match[0];
    if (/[/\\]/u.test(value) && value.replace(/["'\/\\]/gu, '').trim()) spans.push({ start: match.index!, end: match.index! + value.length });
  }
  return spans;
}

const NAMED_HEADING = /^([A-Z][A-Za-z]*(?: [A-Za-z]+){0,2})\s*(?::|\u2014|\u2013|\s-)\s*(\S.*)$/u;
const NUMBERED_HEADING = /^([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)?) (\d{1,4})(?=$|[\s:.\u2013\u2014-])/u;
const DELTA_HEADING = /^(ADDED|MODIFIED|REMOVED|RENAMED)\s+\S/u;
const dirname = (file: string) => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
function commonFolder(folders: string[]) {
  if (!folders.length) return '';
  let parts = folders[0].split('/');
  for (const folder of folders.slice(1)) { const other = folder.split('/'); let n = 0; while (n < parts.length && n < other.length && parts[n] === other[n]) n++; parts = parts.slice(0, n); }
  return parts.join('/');
}
/** Increment 85c: keyword headings, their nesting and numbering, and OpenSpec-like layouts, across the selected files. */
function discoverKeywords(documents: Record<string, string>): { keywords: KeywordCandidate[]; layout: LayoutCandidate } {
  type Group = KeywordCandidate & { fileSet: Set<string>; levelSet: Set<number>; ancestors: Map<string, number>; numbers: Map<string, Set<string>>; names: Set<string>; ownNames: string[] };
  const groups = new Map<string, Group>(), codeSpans = new Map<string, number>(), firstHeadings = new Map<string, CandidateEvidence>(), deltaFiles = new Set<string>();
  for (const [file, text] of Object.entries(documents)) {
    const tree = parseMarkdown(text), stack: { depth: number; key?: string }[] = [];
    let delta: number | undefined;
    const content = (node: Extract<Nodes, { type: 'heading' }>) => {
      const start = node.children[0]?.position?.start.offset, end = node.children.at(-1)?.position?.end.offset;
      return start === undefined || end === undefined || end <= start ? undefined : { start, end };
    };
    const visit = (node: Nodes) => {
      if (['blockquote', 'code', 'html'].includes(node.type)) return;
      if (node.type === 'inlineCode') { const value = node.value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(); if (value) codeSpans.set(value, (codeSpans.get(value) ?? 0) + 1); return; }
      if (node.type === 'heading') {
        while (stack.length && stack.at(-1)!.depth >= node.depth) stack.pop();
        if (delta !== undefined && node.depth <= delta) delta = undefined;
        const value = toString(node).trim(), span = content(node);
        // A document title such as "# Change: Add realms" or "# Feature Specification: Login" names the file, not a record.
        const title = node.depth === 1 && !firstHeadings.has(file);
        if (span && !firstHeadings.has(file)) firstHeadings.set(file, { id: text.slice(span.start, span.end), file, offset: span.start, end: span.end, context: 'heading' });
        const numbered = title ? null : NUMBERED_HEADING.exec(value), named = numbered || title ? null : NAMED_HEADING.exec(value);
        let key: string | undefined;
        if ((numbered || named) && span && (groups.has((numbered ? '#' : '') + (numbered ?? named)![1].toLocaleLowerCase()) || groups.size < 256)) {
          const keyword = (numbered ?? named)![1];
          key = (numbered ? '#' : '') + keyword.toLocaleLowerCase();
          let group = groups.get(key);
          if (!group) {
            group = { keyword, numbered: !!numbered, count: 0, files: 0, levels: [], evidence: [], inSpecs: false, inDeltas: 0, nameReferences: 0, fileSet: new Set(), levelSet: new Set(), ancestors: new Map(), numbers: new Map(), names: new Set(), ownNames: [] };
            groups.set(key, group);
          }
          group.count++; group.fileSet.add(file); group.levelSet.add(node.depth);
          if (/\/spec\.md$/u.test(file)) group.inSpecs = true;
          if (delta !== undefined) group.inDeltas++;
          const ancestor = [...stack].reverse().find(entry => entry.key)?.key;
          if (ancestor) group.ancestors.set(ancestor, (group.ancestors.get(ancestor) ?? 0) + 1);
          if (numbered) group.numbers.set(file, (group.numbers.get(file) ?? new Set()).add(numbered[2]));
          else {
            const name = named![2].replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
            group.names.add(name);
            if (delta === undefined) group.ownNames.push(name);
          }
          // Numbered evidence is the token ("Task 1"); named evidence is the heading content.
          const token = numbered ? numbered[0].trimEnd().replace(/[\s:.\u2013\u2014-]+$/u, '') : undefined;
          const offset = token ? definitionSourceOffset(node, text, { id: token, index: 0, end: token.length }) : span.start;
          if (offset !== undefined && group.evidence.length < 8) {
            const end = token ? offset + token.length : span.end;
            group.evidence.push({ id: text.slice(offset, end), file, offset, end, context: 'heading' });
          }
        }
        stack.push({ depth: node.depth, key });
        if (DELTA_HEADING.test(value)) { delta = node.depth; deltaFiles.add(file); }
      }
      if ('children' in node) for (const child of node.children) visit(child);
    };
    visit(tree);
  }
  // Recurring headings whose names vary: template headings that repeat one name ("Format: [ID] [P?] ...") are not records.
  // Increment 85d: archived change deltas repeat the names they modify, so variety counts headings outside delta sections when there are any.
  const varied = (group: Group) => {
    const names = group.ownNames.length ? new Set(group.ownNames) : group.names, count = group.ownNames.length || group.count;
    return names.size >= Math.max(2, Math.ceil(count / 2));
  };
  const keywords = [...groups.entries()].filter(([, group]) => ((group.count >= 3 && group.fileSet.size >= 2) || group.count >= 5) && (group.numbered || varied(group)));
  const kept = new Map(keywords);
  const result = keywords.map(([key, group]) => {
    const files = [...group.fileSet];
    // A parent is the keyword heading that encloses at least 80% of these headings at a higher level.
    const [ancestor, count] = [...group.ancestors].sort((a, b) => b[1] - a[1])[0] ?? [];
    const parent = ancestor && count >= 0.8 * group.count && kept.get(ancestor) && !kept.get(ancestor)!.numbered && Math.min(...kept.get(ancestor)!.levelSet) < Math.min(...group.levelSet) ? ancestor : undefined;
    // Numbers that restart per file (or per folder) suggest per-file (or folder) scopes.
    let scope: string | undefined;
    if (group.numbered) {
      const seen = new Map<string, string[]>();
      for (const [file, numbers] of group.numbers) for (const number of numbers) seen.set(number, [...(seen.get(number) ?? []), file]);
      const repeated = [...seen.values()].filter(list => list.length > 1);
      if (repeated.length) {
        const folders = [...new Set(files.map(dirname))];
        const perFolder = repeated.every(list => new Set(list.map(dirname)).size === list.length);
        const root = commonFolder(folders.map(dirname));
        if (folders.length === 1 && folders[0]) scope = `${folders[0]}/*.md`;
        else if (perFolder && root && folders.every(folder => dirname(folder) === root)) scope = `${root}/*`;
      }
    }
    const names = group.numbered ? 0 : [...group.names].reduce((n, name) => n + (codeSpans.get(name) ?? 0), 0);
    return { keyword: group.keyword, numbered: group.numbered, count: group.count, files: files.length, levels: [...group.levelSet].sort(), evidence: group.evidence,
      ...(parent ? { parent: kept.get(parent)!.keyword } : {}), ...(scope ? { scope } : {}), inSpecs: group.inSpecs, inDeltas: group.inDeltas, nameReferences: names };
  });
  // Layout: `<root>/<capability>/spec.md` spec folders, and change folders holding a proposal.md (archived ones included).
  const specs = Object.keys(documents).filter(file => /^.+\/[^/]+\/spec\.md$/u.test(file));
  const proposals = Object.keys(documents).filter(file => /(^|\/)proposal\.md$/u.test(file) && file.includes('/'));
  const changeRoot = proposals.length >= 2 ? commonFolder(proposals.map(file => dirname(dirname(file))).map(folder => folder.replace(/\/archive$/u, ''))) || undefined : undefined;
  const ownSpecs = specs.filter(file => !changeRoot || !file.startsWith(changeRoot + '/'));
  const roots = new Map<string, string[]>();
  for (const file of ownSpecs) { const root = dirname(dirname(file)); roots.set(root, [...(roots.get(root) ?? []), file]); }
  const [specRoot, specFiles] = [...roots].filter(([root, list]) => list.length >= 2 || root.split('/').at(-1) === 'specs').sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  const evidence = (list: string[]) => list.flatMap(file => firstHeadings.has(file) ? [firstHeadings.get(file)!] : []).slice(0, 8);
  const layout: LayoutCandidate = { ...(specRoot ? { specRoot } : {}), specEvidence: specFiles ? evidence(specFiles) : [], ...(changeRoot ? { changeRoot } : {}), changeEvidence: evidence(proposals),
    changeSpecs: !!changeRoot && specs.some(file => file.startsWith(changeRoot + '/') && /\/specs\/[^/]+\/spec\.md$/u.test(file)) };
  if (!deltaFiles.size) for (const keyword of result) keyword.inDeltas = 0;
  return { keywords: result, layout };
}

export function discoverIds(documents: Record<string, string>): CandidateInventory {
  if (Object.keys(documents).length > 2000 || Object.values(documents).reduce((n, text) => n + text.length, 0) > 20 * 1024 * 1024) throw new Error('Discovery supports at most 2000 files and 20 MB of Markdown. Select fewer files.');
  const groups = new Map<string, IdCandidate>(); let occurrences = 0;
  const identifiers = new Map<string, Set<string>>();
  for (const [file, text] of Object.entries(documents)) {
    const tree = parseMarkdown(text), starts = listStarts(tree, text), paths = pathSpans(text);
    let pathIndex = 0;
    const visit = (node: Nodes, context: CandidateEvidence['context'] = 'mention') => {
      if (['blockquote', 'code', 'inlineCode', 'html', 'link', 'linkReference'].includes(node.type)) return;
      if (node.type === 'heading') {
        // Heading context applies only to an ID at the start of the heading text.
        node.children.forEach((child, i) => visit(child, i === 0 ? 'heading' : 'mention')); return;
      }
      if (node.type === 'table') {
        const idColumn = node.children[0].children.findIndex(c => toString(c).trim().toLowerCase() === 'id');
        for (const row of node.children.slice(1)) row.children.forEach((cell, i) => visit(cell, i === idColumn ? 'id-table' : 'mention')); return;
      }
      if (node.type === 'text') {
        const start = node.position?.start.offset ?? 0, raw = text.slice(start, node.position?.end.offset);
        const regex = /(?<![\p{L}\p{N}_-])([A-Za-z]{1,32})([-_]?)([0-9]{1,12})(?![\p{L}\p{N}_-])/gu;
        for (const match of raw.matchAll(regex)) {
          const offset = start + match.index!;
          while (pathIndex < paths.length && paths[pathIndex].end <= offset) pathIndex++;
          if (paths[pathIndex] && paths[pathIndex].start <= offset) continue;
          if (++occurrences > 20000) throw new Error('Discovery exceeds 20,000 occurrences. Select fewer files.');
          const key = match[1] + ':' + match[2];
          if (!groups.has(key)) {
            if (groups.size >= 128) throw new Error('Discovery exceeds 128 candidate groups. Select fewer files.');
            groups.set(key, { prefix: match[1], separator: match[2], count: 0, distinctIds: 0, definitions: 0, evidence: [] });
            identifiers.set(key, new Set());
          }
          const group = groups.get(key)!;
          identifiers.get(key)!.add(match[0]); group.distinctIds = identifiers.get(key)!.size;
          const span = { id: match[0], offset: start + match.index!, end: start + match.index! + match[0].length };
          const kind = isListEvidence(span, starts, text) ? 'list-item' : context === 'id-table' && raw.trim() === match[0] ? 'id-table' : context === 'heading' && !raw.slice(0, match.index).trim() ? 'heading' : 'mention';
          group.count++; if (kind !== 'mention') group.definitions++;
          const evidence: CandidateEvidence = { id: match[0], file, offset: start + match.index!, end: start + match.index! + match[0].length, context: kind };
          if (group.evidence.length < 8) group.evidence.push(evidence);
          else if (kind !== 'mention' && group.evidence.every(e => e.context === 'mention')) group.evidence[7] = evidence;
        }
      } else if ('children' in node) for (const child of node.children) visit(child, context);
    };
    visit(tree);
  }
  return { files: Object.keys(documents), candidates: [...groups.values()].sort((a, b) => b.definitions - a.definitions || b.count - a.count || a.prefix.localeCompare(b.prefix)), occurrences, excluded: DISCOVERY_COVERAGE, ...discoverKeywords(documents) };
}
export function candidateProposal(inventory: CandidateInventory): ConventionProposal {
  const suggestions: ConventionSuggestion[] = inventory.candidates.filter(candidate => candidate.distinctIds >= 2).map((candidate, i) => {
    const key = `discovered-${i + 1}`;
    return { key, category: { key, name: candidate.prefix }, rule: { key, category: key, pattern: `\\b${escapeRegex(candidate.prefix + candidate.separator)}\\d+\\b` }, evidence: candidate.evidence,
      uncertainty: `${candidate.count} occurrences; ${candidate.definitions} definition-like matches. Category role and application module are unknown. Delete incidental tokens before adding suggestions to the draft.` };
  });
  // Increment 85c: keyword headings, capabilities, and changes.
  const layout = inventory.layout, keywords = inventory.keywords ?? [];
  const keyFor = new Map(keywords.map((keyword, i) => [keyword.keyword.toLocaleLowerCase() + (keyword.numbered ? '#' : ''), `discovered-k${i + 1}`]));
  const capability = layout?.specRoot && layout.specEvidence.length ? 'discovered-capability' : undefined;
  const capabilityScopes = layout?.specRoot ? [{ pattern: `${layout.specRoot}/{capability}/spec.md` }, ...(layout.changeRoot && layout.changeSpecs ? [{ pattern: `${layout.changeRoot}/**/specs/{capability}/spec.md` }] : [])] : [];
  keywords.forEach(keyword => {
    const key = keyFor.get(keyword.keyword.toLocaleLowerCase() + (keyword.numbered ? '#' : ''))!, sites = { headings: { enabled: true, levels: keyword.levels, mode: 'start' as const }, tables: { enabled: false, column: 'ID', mode: 'exact' as const } };
    const where = `${keyword.count} headings in ${keyword.files} files at level ${keyword.levels.join(', ')}`;
    if (keyword.numbered) {
      suggestions.push({ key, category: { key, name: keyword.keyword, idDefinitionSites: sites, ...(keyword.scope ? { idScopes: [{ pattern: keyword.scope }] } : {}) },
        rule: { key, category: key, pattern: `\\b${escapeRegex(keyword.keyword).replace(/ /g, '\\s+')} \\d+\\b` }, evidence: keyword.evidence,
        uncertainty: `Numbered keyword headings such as "${keyword.evidence[0]?.id}": ${where}.${keyword.scope ? ` Numbers restart, so ${keyword.scope} gives each its own scope.` : ''} Delete it if these headings are not records.` });
      return;
    }
    const parent = keyword.parent ? keyFor.get(keyword.parent.toLocaleLowerCase()) : undefined;
    suggestions.push({ key, category: { key, name: keyword.keyword,
      idDefinitionSites: { ...sites, headings: { ...sites.headings, mode: 'keyword', keyword: keyword.keyword } },
      ...(parent ? { parent } : {}), ...(keyword.inSpecs && capabilityScopes.length ? { idScopes: capabilityScopes } : {}),
      ...(keyword.inDeltas && layout?.changeRoot ? { deltas: true } : {}), ...(keyword.nameReferences ? { nameReferences: true } : {}) }, evidence: keyword.evidence,
      uncertainty: `Keyword headings "${keyword.keyword}: <name>": ${where}. The name after the keyword is the element's ID.${parent ? ` Nested in ${keyword.parent} headings, so it is identified within them.` : ''}${keyword.inDeltas && layout?.changeRoot ? ` ${keyword.inDeltas} appear under ADDED/MODIFIED/REMOVED/RENAMED sections, recorded as changes.` : ''}${keyword.nameReferences ? ` ${keyword.nameReferences} backticked mentions name them.` : ''} Delete it if these headings are not records.` });
  });
  if (capability) suggestions.push({ key: capability, category: { key: capability, name: 'Capability', derive: { pattern: `${layout!.specRoot}/{capability}/spec.md` } }, evidence: layout!.specEvidence,
    uncertainty: `Each folder in ${layout!.specRoot}/ with a spec.md is a capability, named by the folder.` });
  if (layout?.changeRoot && layout.changeEvidence.length) suggestions.push({ key: 'discovered-change', category: { key: 'discovered-change', name: 'Change', derive: { pattern: `${layout.changeRoot}/**/{change}/proposal.md` }, changes: capability ? { capabilities: capability } : {} },
    evidence: layout.changeEvidence, uncertainty: `Each folder in ${layout.changeRoot}/ with a proposal.md is a change, Active or Archived by location${capability ? '; its proposal declares capabilities' : ''}.` });
  return { version: 1, suggestions };
}
function keys(value: any, allowed: string[]) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k)); }
export function validateProposal(input: unknown, documents: Record<string, string>): ConventionProposal {
  if (JSON.stringify(input)?.length > 256 * 1024) throw new Error('Proposal exceeds 256 KB.');
  const p = input as ConventionProposal;
  if (!keys(p, ['version', 'suggestions']) || p.version !== 1 || !Array.isArray(p.suggestions) || p.suggestions.length > 128) throw new Error('Expected a version-1 proposal with at most 128 suggestions.');
  const names = new Set<string>();
  const lists = new Map<string, ReturnType<typeof listStarts>>();
  const suggestions = p.suggestions.map(s => {
    if (!keys(s, ['key', 'category', 'rule', 'modules', 'moduleRules', 'evidence', 'uncertainty']) || typeof s.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s.key) || names.has(s.key) || typeof s.uncertainty !== 'string' || !s.uncertainty.trim() || s.uncertainty.length > 2000) throw new Error('Suggestions need unique keys and an uncertainty explanation.');
    names.add(s.key);
    // Parent and capability references point at other suggestions, so they are checked across the proposal below.
    const { parent: _parent, changes, ...own } = s.category as IdCategory;
    const category = { ...own, ...(changes ? { changes: { ...(changes.archive ? { archive: changes.archive } : {}) } } : {}) };
    const validated = validateIdConfiguration({ version: 1, categories: [category], rules: s.rule === undefined ? [] : [s.rule], ...(s.modules === undefined ? {} : { modules: s.modules }), ...(s.moduleRules === undefined ? {} : { moduleRules: s.moduleRules }) });
    if (validated.rules[0]?.list || validated.rules[0]?.id !== undefined) throw new Error('Suggestions need a prefix or pattern rule; labelled lists and ID templates are configured manually.');
    if (!s.rule && validated.categories[0].idDefinitionSites?.headings.mode !== 'keyword' && !validated.categories[0].derive) throw new Error('Suggestions without a rule need a keyword heading site or derived elements.');
    if (!Array.isArray(s.evidence) || !s.evidence.length || s.evidence.length > 8) throw new Error('Each suggestion needs 1-8 source examples.');
    for (const e of s.evidence) {
      if (!keys(e, ['id', 'file', 'offset', 'end', 'context']) || typeof e.id !== 'string' || !e.id || e.id.length > 512 || typeof e.file !== 'string' || !Object.hasOwn(documents, e.file) || !Number.isInteger(e.offset) || !Number.isInteger(e.end) || e.offset < 0 || e.end <= e.offset || e.end > documents[e.file].length || documents[e.file].slice(e.offset, e.end) !== e.id || !['heading', 'id-table', 'list-item', 'mention'].includes(e.context)) throw new Error('Proposal evidence is missing, stale, or outside the selected Markdown.');
      if (e.context === 'list-item') {
        if (!lists.has(e.file)) lists.set(e.file, listStarts(parseMarkdown(documents[e.file]), documents[e.file]));
        if (!isListEvidence(e, lists.get(e.file)!, documents[e.file])) throw new Error('Proposal list-item evidence must identify a leading plain or emphasized ID in a Markdown list item.');
      }
    }
    const restored = { ...validated.categories[0], ...(s.category.parent ? { parent: s.category.parent } : {}), ...(changes ? { changes: { ...validated.categories[0].changes, ...(changes.capabilities ? { capabilities: changes.capabilities } : {}) } } : {}) };
    return { ...s, category: restored, ...(validated.rules[0] ? { rule: validated.rules[0] } : {}), ...(validated.modules ? { modules: validated.modules } : {}), ...(validated.moduleRules ? { moduleRules: validated.moduleRules } : {}) };
  });
  for (const s of suggestions) for (const target of [s.category.parent, s.category.changes?.capabilities]) {
    if (target !== undefined && !suggestions.some(other => other !== s && other.category.key === target)) throw new Error('Suggestion parent and capability references must name other suggestions.');
  }
  return { version: 1, suggestions };
}
/** Merge reviewed suggestions without overwriting existing entries or requiring key editing. */
export function mergeProposal(base: IdConfiguration, proposal: ConventionProposal): IdConfiguration {
  const draft = structuredClone(base);
  const remapped = new WeakMap<object, Map<string, string>>();
  const merge = <T extends { key: string }>(list: T[], value: T) => {
    // Remember identical proposal entries shared by several suggestions, including collisions.
    const identity = JSON.stringify(value);
    if (!remapped.has(list)) remapped.set(list, new Map());
    const mappings = remapped.get(list)!;
    const previous = mappings.get(identity); if (previous) return previous;
    const existing = list.find(v => v.key === value.key);
    let key = value.key;
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      let suffix = 2; const prefix = key.slice(0, 56);
      do { key = `${prefix}-${suffix++}`; } while (list.some(v => v.key === key));
    }
    if (!existing || key !== value.key) list.push(structuredClone({ ...value, key }));
    mappings.set(identity, key); return key;
  };
  const merged = new Map<string, string>();
  for (const s of proposal.suggestions) {
    const category = merge(draft.categories, s.category); merged.set(s.category.key, category);
    if (s.rule) merge(draft.rules, { ...s.rule, category });
    const modules = new Map((s.modules ?? []).map(m => [m.key, merge(draft.modules ??= [], m)]));
    for (const r of s.moduleRules ?? []) merge(draft.moduleRules ??= [], { ...r, modules: r.modules.map(key => modules.get(key) ?? key) });
  }
  // 85c: parents and declared capabilities follow renamed keys; a reference to a suggestion that was not added is dropped.
  for (const s of proposal.suggestions) {
    const category = draft.categories.find(item => item.key === merged.get(s.category.key));
    if (!category) continue;
    if (category.parent !== undefined) { const target = merged.get(category.parent); if (target) category.parent = target; else delete category.parent; }
    if (category.changes?.capabilities !== undefined) { const target = merged.get(category.changes.capabilities); if (target) category.changes.capabilities = target; else delete category.changes.capabilities; }
  }
  return validateIdConfiguration(draft);
}
