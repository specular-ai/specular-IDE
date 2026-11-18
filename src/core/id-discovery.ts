import { toString } from 'mdast-util-to-string';
import type { Nodes } from 'mdast';
import { parseMarkdown } from './documents';
import { DEFAULT_ID_DEFINITION_SITES, definitionSourceOffset, KEYWORD_SEPARATORS, keywordName } from './definition-sites';
import { escapeRegex, MAX_SECTION_TAGS, newSectionTags, ruleRegex, validateIdConfiguration, type IdCategory, type IdConfiguration, type IdRule, type SectionTag } from './id-configuration';
import { isSpecFile, patternRoot, validateFolderGenerators } from './folder-generators';
import { pathsContain, validateExcludedPaths, validScopePath } from './id-scopes';
import { TOOL_FOLDERS, type ToolFolder } from './excluded-paths';
import { BUNDLED_PROFILES, fillTemplate, profileText, runProfiles, validateProfile, type DetectorResult, type DiscoveryProfile, type HeadingSectionsDetector, type HeadingSectionsResult, type MatchingIdsProposal, type MatchingLinesResult, type CategoryProposal, type ListSectionProposal, type ListSectionResult, type ParagraphSectionsDetector, type ParagraphSectionsProposal, type ParagraphSectionsResult, type ProfileDetector, type ProfileProposal, type ProfileReference, type ProviderResult } from './discovery-profiles';
import type { IdDefinitionSites } from './definition-sites';
export interface CandidateEvidence { id: string; file: string; offset: number; end: number; context: 'heading' | 'id-table' | 'list-item' | 'mention' }
export interface IdCandidate { prefix: string; separator: string; count: number; distinctIds: number; definitions: number; evidence: CandidateEvidence[]; specScope?: SpecScope;
  /** Increment 103: definition-like matches that start list items, and the files holding them. */ listDefinitions?: number; listFiles?: number;
  /** Increment 103: the files, by name, that hold most definition-like matches, when list items elsewhere would define the IDs again. */ definitionFiles?: { name: string; paths: string[]; elsewhere: number };
  /** Increment 103: IDs that would start list items more than once in one scope (after `definitionFiles`), and the IDs listed; many repeats keep list definitions off. */ listRepeats?: { repeated: number; ids: number } }
/** Increment 96b: a scope per specification folder for numbering that restarts in each one. */
export interface SpecScope { scope: string; onlyInScopes?: true; /** Files outside the specification folders that define the candidate. */ outside: number; /** Folder names that capture scopes join across groups. */ shared?: string[] }
/** Increment 85c: a recurring keyword heading, named (`Requirement: <name>`) or numbered (`Task 1: ...`). */
export interface KeywordCandidate { keyword: string; numbered: boolean; count: number; files: number; levels: number[]; evidence: CandidateEvidence[]; parent?: string; scope?: string; specScope?: SpecScope; inSpecs: boolean; inDeltas: number; nameReferences: number;
  /** Increment 101: other top-level keyword candidates whose headings define some of the same names (at most 8 shown). */ overlaps?: { keyword: string; names: string[] }[];
  /** Increment 102: the separator after a named keyword, left out for the colon, and how many of its headings use another one and are left out. */ separator?: string; otherSeparators?: number }
/** Increment 101: headings that start with a namespaced identifier such as `NET:GET_CONFIG`, grouped by prefix. */
export interface NamespacedCandidate { prefix: string; count: number; files: number; distinctIds: number; levels: number[]; evidence: CandidateEvidence[]; /** Identifiers headed in more than one file, which index as duplicates. */ repeated: string[] }
/** Increment 85c: an OpenSpec-like layout: capability spec folders and change folders with proposals. */
export interface LayoutCandidate { specRoot?: string; specEvidence: CandidateEvidence[]; changeRoot?: string; changeEvidence: CandidateEvidence[]; changeSpecs: boolean; specFolders?: SpecFolderCandidate[];
  /** Increment 96c: capabilities also sit in group folders under specRoot, or change deltas under specs/<group>/. */ specGrouped?: true; changeSpecsGrouped?: true; /** Capability names found in more than one group. */ sharedCapabilities?: string[] }
/** Increment 96: a folder holding specification folders (Spec Kit, Kiro, OpenSpec capabilities), one feature per folder. 96a: `<root>/**` when they sit at more than one depth. */
export interface SpecFolderCandidate { root: string; pattern: string; /** The folders Update derives. */ folders: string[]; /** Derived folders without a specification file (`*` patterns). */ withoutSpec?: string[]; evidence: CandidateEvidence[]; /** Defined IDs each folder receives under the current draft, in `folders` order; set by the analysis worker. */ ids?: number[] }
export interface CandidateInventory { files: string[]; candidates: IdCandidate[]; occurrences: number; excluded: string; keywords?: KeywordCandidate[]; layout?: LayoutCandidate;
  /** Increment 101: namespaced heading identifiers by prefix. */ namespaced?: NamespacedCandidate[];
  /** Increment 97a: what each discovery provider found, and the providers that could not run. */ providers?: ProviderResult[]; providerErrors?: string[];
  /** Increment 99a: tool folders present in the analyzed Markdown, with what each contributes under the current draft. */ toolFolders?: ToolFolder[] }
/** A token suggestion has a rule; a keyword or derived suggestion (85c) defines elements through its category instead. */
export interface ConventionSuggestion { key: string; category: IdCategory; rule?: IdRule; /** Increment 96d: labelled-list rules citing this category or its numbered-items parent; (104) or a pattern rule of its own category, such as the names of Kiro tasks. */ references?: IdRule[]; evidence: CandidateEvidence[]; uncertainty: string;
  /** Increment 96h: why the category's section tags are proposed, with their counts; it explains them when they go to an existing category instead. */ tagReason?: string;
  /** Increment 103: why list items define the category's IDs, with their counts, for an existing category whose list definitions are off. */ listReason?: string;
  /** Increment 97a: the tool whose discovery provider proposed it, such as Kiro; Specular's own heuristics leave it out. */ provider?: string }
/** Increment 96: a proposed folder generator; staging adds it and runs Update features. */
export interface FolderSuggestion { key: string; target: 'features'; pattern: string; folders: string[]; withoutSpec?: string[]; ids?: number[]; evidence: CandidateEvidence[]; uncertainty: string }
/**
 * Increment 96h: section tags for a category the draft already has, staged into it without the suggestion's rule. With `checkboxLists`, checkbox list items define the category's IDs when its list definitions are off.
 * Increment 103: with `lists`, list items define them; the suggestion may then have no section tags.
 */
export interface TagSuggestion { key: string; category: string; sectionTags: SectionTag[]; checkboxLists?: true; lists?: true; evidence: CandidateEvidence[]; uncertainty: string }
/** Increment 99a: tool folders to leave out of analysis, with per folder its Markdown files, definitions, and pending items. */
export interface ExclusionSuggestion { key: string; paths: string[]; files: number[]; definitions: number[]; pending: number[]; uncertainty: string }
export interface ConventionProposal { version: 1; suggestions: ConventionSuggestion[]; folders?: FolderSuggestion[]; tags?: TagSuggestion[]; exclusions?: ExclusionSuggestion[] }
export const DISCOVERY_COVERAGE = 'ASCII letter prefixes (1-32 letters), optional hyphen/underscore, and 1-12 digits. Headings, ID-table cells, list items, and prose only. Definition-like counts are heuristic hints, independent of configured definition sites; a prefix whose definition-like matches mostly start list items gets list definitions, limited to the file name holding most of them, unless its IDs would be defined twice in a scope. Dates, code/inline-code, quotes, HTML, system paths, and links (including labels, destinations, and automatic URL links) are excluded. Pattern suggestions require at least two distinct identifiers with the same prefix and separator across selected files. Counts cover selected files; up to 8 source examples per group. Keyword headings ("Requirement: <name>", "Task 1: ...") are proposed with their most common separator (colon, hyphen, en or em dash) when they recur (3 in 2 files, or 5 in one) with varying names, excluding document titles; namespaced heading identifiers ("NET:GET_CONFIG": an uppercase prefix, a colon without a space, an uppercase name) are proposed per prefix with at least two distinct identifiers, the prefix being part of the ID; capability folders (<root>/<name>/spec.md) and change folders with a proposal.md are proposed as derived elements; folders whose child folders each hold a spec, requirements, bugfix, design, tasks, plan, or proposal file are proposed as folder-derived features. This is not an exhaustive detector. Use Add rule for other formats.';

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

const NAMED_HEADING = /^([A-Z][A-Za-z]*(?: [A-Za-z]+){0,2})\s*(:|\u2014|\u2013|\s-)\s*(\S.*)$/u;
const NUMBERED_HEADING = /^([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)?) (\d{1,4})(?=$|[\s:.\u2013\u2014-])/u;
/** Increment 101: an uppercase prefix, a colon without a space, and an uppercase name form one identifier, such as `NET:GET_CONFIG`. */
const NAMESPACED_HEADING = /^([A-Z][A-Z0-9]{0,31}):[A-Z][A-Z0-9_]*(?![\p{L}\p{N}_])/u;
const DELTA_HEADING = /^(ADDED|MODIFIED|REMOVED|RENAMED)\s+\S/u;
const dirname = (file: string) => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
/** Increment 96: folders with at least two specification folders, outermost first; change folders are not features.
 * 96a: a root nested in another, roots that share a parent, and a root whose parent holds a specification folder itself join into one
 * `<root>/**` root, so grouped specifications stay together. */
function specFolders(files: string[], changeRoot: string | undefined, firstHeadings: Map<string, CandidateEvidence>): SpecFolderCandidate[] {
  const allowed = (folder: string) => !!folder && validScopePath(folder) && !(changeRoot && (folder === changeRoot || folder.startsWith(changeRoot + '/')));
  const first = new Map<string, string>();
  for (const file of [...files].sort((a, b) => a.localeCompare(b))) if (isSpecFile(file) && allowed(dirname(file)) && !first.has(dirname(file))) first.set(dirname(file), file);
  // Specification folders inside another one belong to it, like Spec Kit's checklists/.
  const outer = [...first.keys()].filter(folder => ![...first.keys()].some(other => folder.startsWith(other + '/')));
  const parents = new Map<string, number>();
  for (const folder of outer) if (allowed(dirname(folder))) parents.set(dirname(folder), (parents.get(dirname(folder)) ?? 0) + 1);
  // Every parent takes part in the joining (96b), so single specifications at two depths can join; a root needs two specification folders.
  let roots = [...parents.keys()];
  for (let merged = true; merged;) {
    roots = roots.filter(root => !roots.some(other => root.startsWith(other + '/')));
    merged = false;
    const siblings = new Map<string, string[]>();
    for (const root of roots) if (allowed(dirname(root))) siblings.set(dirname(root), [...(siblings.get(dirname(root)) ?? []), root]);
    for (const [parent, group] of siblings) if (group.length >= 2 || parents.has(parent)) { roots = [...roots.filter(root => !group.includes(root)), parent]; merged = true; break; }
  }
  roots = roots.filter(root => outer.filter(folder => folder.startsWith(root + '/')).length >= 2);
  return roots.map(root => {
    const specs = outer.filter(folder => folder.startsWith(root + '/')), deep = specs.some(folder => dirname(folder) !== root);
    // The folders Update derives: specification folders for `**`, every child folder with Markdown for `*`.
    const folders = deep ? specs : [...new Set(files.filter(file => file.startsWith(root + '/') && file.slice(root.length + 1).includes('/')).map(file => root + '/' + file.slice(root.length + 1).split('/')[0]))].sort((a, b) => a.localeCompare(b));
    const withoutSpec = deep ? [] : folders.filter(folder => !specs.includes(folder));
    return { root, pattern: `${root}/${deep ? '**' : '*'}`, folders, ...(withoutSpec.length ? { withoutSpec } : {}),
      evidence: folders.flatMap(folder => first.has(folder) && firstHeadings.has(first.get(folder)!) ? [firstHeadings.get(first.get(folder)!)!] : []).slice(0, 8) };
  }).sort((a, b) => b.folders.length - a.folders.length || a.root.localeCompare(b.root)).slice(0, 8);
}
function commonFolder(folders: string[]) {
  if (!folders.length) return '';
  let parts = folders[0].split('/');
  for (const folder of folders.slice(1)) { const other = folder.split('/'); let n = 0; while (n < parts.length && n < other.length && parts[n] === other[n]) n++; parts = parts.slice(0, n); }
  return parts.join('/');
}
/** Increment 96b: the specification-folder scope for definitions ([number or ID, file]) whose numbering restarts per specification.
 * The root holding most definitions is used when it holds at least 80% of them; definitions elsewhere make the scope exclusive. */
function specScope(definitions: [string, string][], roots: SpecFolderCandidate[] | undefined): SpecScope | undefined {
  if (!roots?.length || !definitions.length) return undefined;
  let best: { root: SpecFolderCandidate; folderOf: (file: string) => string | undefined; inside: number } | undefined;
  for (const root of roots) {
    const deep = root.pattern.endsWith('/**'), prefix = root.root + '/';
    const folderOf = (file: string) => deep ? root.folders.find(folder => file.startsWith(folder + '/'))
      : file.startsWith(prefix) && file.slice(prefix.length).includes('/') ? prefix + file.slice(prefix.length).split('/')[0] : undefined;
    const inside = definitions.filter(([, file]) => folderOf(file)).length;
    if (!best || inside > best.inside) best = { root, folderOf, inside };
  }
  if (!best || best.inside < 0.8 * definitions.length) return undefined;
  const { root, folderOf } = best, places = new Map<string, Set<string>>();
  for (const [id, file] of definitions) { const folder = folderOf(file); if (folder) places.set(id, (places.get(id) ?? new Set<string>()).add(folder)); }
  if (![...places.values()].some(folders => folders.size >= 2)) return undefined;
  const deep = root.pattern.endsWith('/**'), outside = new Set(definitions.filter(([, file]) => !folderOf(file)).map(([, file]) => file)).size;
  const names = [...new Set([...places.values()].flatMap(folders => [...folders]))].map(folder => folder.slice(folder.lastIndexOf('/') + 1));
  const shared = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  return { scope: deep ? `${root.root}/**/{spec}/*.md` : `${root.root}/*`, ...(outside ? { onlyInScopes: true as const } : {}), outside, ...(deep && shared.length ? { shared } : {}) };
}
const scopeText = (scoped: SpecScope) => ` Numbering restarts in each specification, so ${scoped.scope} gives each one its own scope.`
  + (scoped.onlyInScopes ? ` ${scoped.outside} ${scoped.outside === 1 ? 'file' : 'files'} outside the specification folders also ${scoped.outside === 1 ? 'uses' : 'use'} it; with "Recognize only inside its scopes" they read it as prose.` : '')
  + (scoped.shared ? ` Specification folders named ${scoped.shared.join(', ')} share one scope.` : '');
/** Increment 85c: keyword headings, their nesting and numbering, and OpenSpec-like layouts, across the selected files. */
function discoverKeywords(documents: Record<string, string>): { keywords: KeywordCandidate[]; layout: LayoutCandidate; namespaced: NamespacedCandidate[] } {
  type Group = KeywordCandidate & { mark: string; fileSet: Set<string>; levelSet: Set<number>; ancestors: Map<string, number>; numbers: Map<string, Set<string>>; names: Set<string>; ownNames: string[]; spelled: Set<string> };
  type Namespace = { prefix: string; count: number; fileSet: Set<string>; levelSet: Set<number>; ids: Map<string, Set<string>>; evidence: CandidateEvidence[] };
  const namespaces = new Map<string, Namespace>();
  const groups = new Map<string, Group>(), codeSpans = new Map<string, number>(), firstHeadings = new Map<string, CandidateEvidence>(), deltaFiles = new Set<string>();
  for (const [file, text] of Object.entries(documents)) {
    const tree = parseMarkdown(text), stack: { depth: number; key?: string }[] = [];
    let delta: number | undefined;
    const content = (node: Extract<Nodes, { type: 'heading' }>) => {
      const start = node.children[0]?.position?.start.offset, end = node.children.at(-1)?.position?.end.offset;
      return start === undefined || end === undefined || end <= start ? undefined : { start, end };
    };
    const visit = (node: Nodes, inItem = false) => {
      if (['blockquote', 'code', 'html'].includes(node.type)) return;
      if (node.type === 'inlineCode') { const value = node.value.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(); if (value) codeSpans.set(value, (codeSpans.get(value) ?? 0) + 1); return; }
      if (node.type === 'heading') {
        while (stack.length && stack.at(-1)!.depth >= node.depth) stack.pop();
        if (delta !== undefined && node.depth <= delta) delta = undefined;
        const value = toString(node).trim(), span = content(node);
        // A document title such as "# Change: Add realms" or "# Feature Specification: Login" names the file, not a record.
        const title = node.depth === 1 && !firstHeadings.has(file);
        if (span && !firstHeadings.has(file)) firstHeadings.set(file, { id: text.slice(span.start, span.end), file, offset: span.start, end: span.end, context: 'heading' });
        // Increment 101: a namespaced identifier ("NET:GET_CONFIG") is one ID, not a keyword and a name.
        const namespaced = title ? null : NAMESPACED_HEADING.exec(value);
        if (namespaced && span && (namespaces.has(namespaced[1]) || namespaces.size < 128)) {
          const id = namespaced[0];
          let ns = namespaces.get(namespaced[1]);
          if (!ns) namespaces.set(namespaced[1], ns = { prefix: namespaced[1], count: 0, fileSet: new Set(), levelSet: new Set(), ids: new Map(), evidence: [] });
          ns.count++; ns.fileSet.add(file); ns.levelSet.add(node.depth); ns.ids.set(id, (ns.ids.get(id) ?? new Set<string>()).add(file));
          const offset = definitionSourceOffset(node, text, { id, index: 0, end: id.length });
          if (offset !== undefined && ns.evidence.length < 8) ns.evidence.push({ id, file, offset, end: offset + id.length, context: 'heading' });
        }
        const numbered = title || namespaced ? null : NUMBERED_HEADING.exec(value), named = numbered || title || namespaced ? null : NAMED_HEADING.exec(value);
        let key: string | undefined;
        // Increment 102: named headings group by keyword and separator, since recognition reads one separator per category.
        const mark = named ? named[2].trim() : '';
        if ((numbered || named) && span && (groups.has((numbered ? '#' : '') + (numbered ?? named)![1].toLocaleLowerCase() + mark) || groups.size < 256)) {
          const keyword = (numbered ?? named)![1];
          key = (numbered ? '#' : '') + keyword.toLocaleLowerCase() + mark;
          let group = groups.get(key);
          if (!group) {
            group = { keyword, mark, numbered: !!numbered, count: 0, files: 0, levels: [], evidence: [], inSpecs: false, inDeltas: 0, nameReferences: 0, fileSet: new Set(), levelSet: new Set(), ancestors: new Map(), numbers: new Map(), names: new Set(), ownNames: [], spelled: new Set() };
            groups.set(key, group);
          }
          group.count++; group.fileSet.add(file); group.levelSet.add(node.depth);
          if (/\/spec\.md$/u.test(file)) group.inSpecs = true;
          if (delta !== undefined) group.inDeltas++;
          const ancestor = [...stack].reverse().find(entry => entry.key)?.key;
          if (ancestor) group.ancestors.set(ancestor, (group.ancestors.get(ancestor) ?? 0) + 1);
          if (numbered) group.numbers.set(file, (group.numbers.get(file) ?? new Set()).add(numbered[2]));
          else {
            const name = named![3].replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
            group.names.add(name);
            if (delta === undefined) {
              group.ownNames.push(name);
              // The name as recognition reads it with the suggested separator.
              const spelled = keywordName(value, group.keyword, mark)?.name;
              if (spelled) group.spelled.add(spelled);
            }
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
      if ('children' in node) for (const child of node.children) visit(child, inItem || node.type === 'listItem');
    };
    visit(tree);
  }
  // Recurring headings whose names vary: template headings that repeat one name ("Format: [ID] [P?] ...") are not records.
  // Increment 85d: archived change deltas repeat the names they modify, so variety counts headings outside delta sections when there are any.
  const varied = (group: Group) => {
    const names = group.ownNames.length ? new Set(group.ownNames) : group.names, count = group.ownNames.length || group.count;
    return names.size >= Math.max(2, Math.ceil(count / 2));
  };
  // Increment 102: a named keyword keeps its most common separator (the colon on ties); headings with another one are left out.
  const bySeparator = new Map<string, Group[]>();
  for (const group of groups.values()) if (!group.numbered) { const lower = group.keyword.toLocaleLowerCase(); bySeparator.set(lower, [...(bySeparator.get(lower) ?? []), group]); }
  const majority = new Map<Group, number>();
  for (const list of bySeparator.values()) {
    const [chosen, ...rest] = [...list].sort((a, b) => b.count - a.count || KEYWORD_SEPARATORS.indexOf(a.mark) - KEYWORD_SEPARATORS.indexOf(b.mark));
    majority.set(chosen, rest.reduce((n, group) => n + group.count, 0));
  }
  const keywords = [...groups.entries()].filter(([, group]) => (group.numbered || majority.has(group)) && ((group.count >= 3 && group.fileSet.size >= 2) || group.count >= 5) && (group.numbered || varied(group)));
  const kept = new Map(keywords);
  const result: KeywordCandidate[] = keywords.map(([key, group]) => {
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
      ...(parent ? { parent: kept.get(parent)!.keyword } : {}), ...(scope ? { scope } : {}), inSpecs: group.inSpecs, inDeltas: group.inDeltas, nameReferences: names,
      ...(group.mark && group.mark !== ':' ? { separator: group.mark } : {}), ...(majority.get(group) ? { otherSeparators: majority.get(group) } : {}) };
  });
  // Layout: `<root>/<capability>/spec.md` spec folders, and change folders holding a proposal.md (archived ones included).
  const specs = Object.keys(documents).filter(file => /^.+\/[^/]+\/spec\.md$/u.test(file));
  const proposals = Object.keys(documents).filter(file => /(^|\/)proposal\.md$/u.test(file) && file.includes('/'));
  const changeRoot = proposals.length >= 2 ? commonFolder(proposals.map(file => dirname(dirname(file))).map(folder => folder.replace(/\/archive$/u, ''))) || undefined : undefined;
  const ownSpecs = specs.filter(file => !changeRoot || !file.startsWith(changeRoot + '/'));
  const roots = new Map<string, string[]>();
  for (const file of ownSpecs) { const root = dirname(dirname(file)); roots.set(root, [...(roots.get(root) ?? []), file]); }
  // Increment 96c: capabilities in group folders join the root above them, which then derives them at any depth.
  let grouped = false;
  for (let merged = true; merged;) {
    merged = false;
    for (const [root, list] of roots) {
      const outer = [...roots.keys()].find(other => other !== root && root.startsWith(other + '/'))
        ?? ([...roots.keys()].some(other => other !== root && dirname(other) === dirname(root)) && dirname(root) && (!changeRoot || !dirname(root).startsWith(changeRoot)) ? dirname(root) : undefined);
      if (!outer) continue;
      roots.set(outer, [...(roots.get(outer) ?? []), ...list]); roots.delete(root); grouped = merged = true; break;
    }
  }
  const [specRoot, specFiles] = [...roots].filter(([root, list]) => list.length >= 2 || root.split('/').at(-1) === 'specs').sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  const deep = !!specRoot && grouped && specFiles!.some(file => dirname(dirname(file)) !== specRoot);
  const names = deep ? specFiles!.map(file => dirname(file).slice(dirname(file).lastIndexOf('/') + 1)) : [];
  const sharedCapabilities = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  const evidence = (list: string[]) => list.flatMap(file => firstHeadings.has(file) ? [firstHeadings.get(file)!] : []).slice(0, 8);
  const layout: LayoutCandidate = { ...(specRoot ? { specRoot } : {}), specEvidence: specFiles ? evidence(specFiles) : [], ...(changeRoot ? { changeRoot } : {}), changeEvidence: evidence(proposals),
    changeSpecs: !!changeRoot && specs.some(file => file.startsWith(changeRoot + '/') && /\/specs\/(?:[^/]+\/)+spec\.md$/u.test(file)),
    ...(deep ? { specGrouped: true as const } : {}), ...(sharedCapabilities.length ? { sharedCapabilities } : {}),
    ...(changeRoot && specs.some(file => file.startsWith(changeRoot + '/') && /\/specs\/[^/]+\/(?:[^/]+\/)+spec\.md$/u.test(file)) ? { changeSpecsGrouped: true as const } : {}) };
  const folders = specFolders(Object.keys(documents), changeRoot, firstHeadings);
  if (folders.length) layout.specFolders = folders;
  // Increment 96b: numbering that restarts in each specification folder gets one scope per folder, replacing 85c's scope.
  keywords.forEach(([, group], i) => {
    const scoped = group.numbered ? specScope([...group.numbers].flatMap(([file, numbers]) => [...numbers].map(number => [number, file] as [string, string])), folders) : undefined;
    if (scoped) Object.assign(result[i], { scope: scoped.scope, specScope: scoped });
  });
  if (!deltaFiles.size) for (const keyword of result) keyword.inDeltas = 0;
  // Increment 101: top-level keyword categories that define the same name would recognize one ID in two categories.
  keywords.forEach(([, group], i) => {
    if (group.numbered || result[i].parent) return;
    const overlaps = keywords.flatMap(([, other], j) => {
      if (j === i || other.numbered || result[j].parent) return [];
      const names = [...group.spelled].filter(name => other.spelled.has(name)).sort((a, b) => a.localeCompare(b));
      return names.length ? [{ keyword: other.keyword, names: names.slice(0, 8) }] : [];
    });
    if (overlaps.length) result[i].overlaps = overlaps;
  });
  const namespaced = [...namespaces.values()].filter(ns => ns.ids.size >= 2)
    .map(ns => ({ prefix: ns.prefix, count: ns.count, files: ns.fileSet.size, distinctIds: ns.ids.size, levels: [...ns.levelSet].sort(), evidence: ns.evidence,
      repeated: [...ns.ids].filter(([, files]) => files.size > 1).map(([id]) => id).sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
  return { keywords: result, layout, namespaced };
}

export function discoverIds(documents: Record<string, string>, profiles: readonly unknown[] = BUNDLED_PROFILES): CandidateInventory {
  if (Object.keys(documents).length > 2000 || Object.values(documents).reduce((n, text) => n + text.length, 0) > 20 * 1024 * 1024) throw new Error('Discovery supports at most 2000 files and 20 MB of Markdown. Select fewer files.');
  const groups = new Map<string, IdCandidate>(); let occurrences = 0;
  const identifiers = new Map<string, Set<string>>(), defined = new Map<string, [string, string][]>(), listed = new Map<string, Set<string>>(), listItems = new Map<string, [string, string][]>();
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
          group.count++; if (kind !== 'mention') { group.definitions++; (defined.get(key) ?? defined.set(key, []).get(key)!).push([match[0], file]); }
          if (kind === 'list-item') {
            group.listDefinitions = (group.listDefinitions ?? 0) + 1; (listed.get(key) ?? listed.set(key, new Set()).get(key)!).add(file); group.listFiles = listed.get(key)!.size;
            (listItems.get(key) ?? listItems.set(key, []).get(key)!).push([match[0], file]);
          }
          const evidence: CandidateEvidence = { id: match[0], file, offset: start + match.index!, end: start + match.index! + match[0].length, context: kind };
          if (group.evidence.length < 8) group.evidence.push(evidence);
          else if (kind !== 'mention' && group.evidence.every(e => e.context === 'mention')) group.evidence[7] = evidence;
        }
      } else if ('children' in node) for (const child of node.children) visit(child, context);
    };
    visit(tree);
  }
  const keywords = discoverKeywords(documents);
  // Increment 96b: prefix IDs that restart in each specification folder, such as Spec Kit's FR-001.
  for (const [key, group] of groups) { const scoped = specScope(defined.get(key) ?? [], keywords.layout.specFolders); if (scoped) group.specScope = scoped; }
  // Increment 103: list definitions of IDs whose definitions sit mostly in files of one name, such as spec.md, are limited to those files.
  // Tool folders' templates (99a), which discovery proposes to exclude, do not count.
  const own = (file: string) => !pathsContain(file, TOOL_FOLDERS);
  const nameOf = (file: string) => file.slice(file.lastIndexOf('/') + 1);
  for (const [key, group] of groups) {
    if (!listDefined(group)) continue;
    const definitions = (defined.get(key) ?? []).filter(([, file]) => own(file)), names = new Map<string, number>();
    for (const [, file] of definitions) names.set(nameOf(file), (names.get(nameOf(file)) ?? 0) + 1);
    const [name, count] = [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? ['', 0];
    const scope = group.specScope?.scope;
    if (count && count < definitions.length && count >= 0.8 * definitions.length)
      group.definitionFiles = { name, paths: [scope ? `${scope.endsWith('/{spec}/*.md') ? scope.slice(0, -'/{spec}/*.md'.length) : scope}/${name}` : `**/${name}`], elsewhere: group.definitions - count };
    // Each listed ID is defined once per scope, as FR-001 in each spec.md; IDs listed or headed again (plans repeating stories, per-file review labels) would be duplicates.
    const root = scope?.replace(/\/(?:\*\*\/\{spec\}\/\*\.md|\*)$/u, '');
    const scopeOf = (file: string) => !root ? '' : scope!.endsWith('/{spec}/*.md') ? dirname(file) : file.startsWith(root + '/') ? file.slice(0, file.indexOf('/', root.length + 1)) : '';
    const seen = new Map<string, number>(), ids = new Set((listItems.get(key) ?? []).map(([id]) => id));
    for (const [id, file] of defined.get(key) ?? []) {
      if (!ids.has(id)) continue;
      if (!own(file) || (group.definitionFiles && nameOf(file) !== name)) continue;
      const place = `${scopeOf(file)}\u0000${id}`; seen.set(place, (seen.get(place) ?? 0) + 1);
    }
    const repeated = [...seen.values()].filter(n => n > 1).length;
    if (repeated) group.listRepeats = { repeated, ids: seen.size };
  }
  // 97a: discovery providers, such as the bundled Kiro profile.
  const { providers, errors } = runProfiles(profiles, documents, value => NUMBERED_HEADING.exec(value)?.[1]);
  return { files: Object.keys(documents), candidates: [...groups.values()].sort((a, b) => b.definitions - a.definitions || b.count - a.count || a.prefix.localeCompare(b.prefix)), occurrences, excluded: DISCOVERY_COVERAGE, ...keywords,
    ...(providers.length ? { providers } : {}), ...(errors.length ? { providerErrors: errors } : {}) };
}
type Applied<R extends DetectorResult = DetectorResult, P extends ProfileProposal = ProfileProposal> = { tool: string; detector: ProfileDetector; result: R; proposal: P };
/** 97a: each provider result with the proposals of its profile that use its detector. */
function providerProposals(providers: readonly ProviderResult[], profiles: readonly unknown[]): Applied[] {
  const byId = new Map<string, DiscoveryProfile>();
  for (const input of profiles) { try { const profile = validateProfile(input); byId.set(profile.id, profile); } catch { /* reported by discovery */ } }
  return providers.flatMap(({ provider, tool, results }) => {
    const profile = byId.get(provider);
    return profile ? results.flatMap(result => profile.proposals.filter(proposal => proposal.detector === result.detector).map(proposal => ({ tool, detector: profile.detectors.find(d => d.id === result.detector)!, result, proposal }))) : [];
  });
}
/** A provider's citation rules, filled in, for the proposed category (`self`) or the keyword category its items belong to (`parent`). */
function providerReferences(references: readonly ProfileReference[] | undefined, values: Record<string, string | number>, self: string, parent: string): IdRule[] {
  return (references ?? []).filter(reference => !reference.when || Number(values[reference.when])).map(reference => ({ key: fillTemplate(reference.key, values), category: reference.category === 'self' ? self : parent,
    list: { label: fillTemplate(reference.list.label, values), item: fillTemplate(reference.list.item, values), id: fillTemplate(reference.list.id, values) } }));
}
export function candidateProposal(inventory: CandidateInventory, profiles: readonly unknown[] = BUNDLED_PROFILES): ConventionProposal {
  // 103: what each prefix suggestion says about list items, removed when a profile sets the sites instead.
  const listNotes = new Map<string, { note: string; paths: boolean }>();
  const suggestions: ConventionSuggestion[] = inventory.candidates.filter(candidate => candidate.distinctIds >= 2).map((candidate, i) => {
    const key = `discovered-${i + 1}`;
    const scoped = candidate.specScope;
    // Increment 103: IDs that mostly start list items, as in Spec Kit's `- **FR-001**: ...`, are defined there; lists are off by default.
    const listed = listDefined(candidate) && listUnique(candidate), repeats = listDefined(candidate) && !listed ? candidate.listRepeats : undefined;
    const only = listed ? candidate.definitionFiles : undefined;
    const note = (listed ? listSentence(candidate) : '')
      + (repeats ? ` ${candidate.listDefinitions} of them start list items, but ${repeats.repeated} of ${repeats.ids} IDs would be defined more than once ${candidate.specScope ? 'in a specification' : 'in the selected files'}, so list definitions stay off; turn them on in its definition sites if those items define the IDs.` : '')
      + (only ? ` Most are in ${only.name} files, so they define only in ${only.paths.join(', ')}; the ${only.elsewhere} elsewhere ${only.elsewhere === 1 ? 'refers' : 'refer'} to them.` : '');
    if (note) listNotes.set(key, { note, paths: !!only });
    return { key, category: { key, name: candidate.prefix, ...(scoped ? { idScopes: [{ pattern: scoped.scope }], ...(scoped.onlyInScopes ? { onlyInScopes: true } : {}) } : {}),
      ...(listed ? { idDefinitionSites: listSites() } : {}), ...(only ? { definitionPaths: [...only.paths] } : {}) },
      rule: { key, category: key, pattern: `\\b${escapeRegex(candidate.prefix + candidate.separator)}\\d+\\b` }, evidence: candidate.evidence,
      uncertainty: `${candidate.count} occurrences; ${candidate.definitions} definition-like matches.${scoped ? scopeText(scoped) : ''}`
        + note + ' Category role and application module are unknown. Delete incidental tokens before adding suggestions to the draft.', ...(listed ? { listReason: listText(candidate) } : {}) };
  });
  // Increment 101: namespaced identifiers, one category per prefix whose rule recognizes the whole identifier.
  (inventory.namespaced ?? []).forEach((candidate, i) => {
    const key = `discovered-n${i + 1}`, example = candidate.evidence[0]?.id ?? `${candidate.prefix}:NAME`;
    suggestions.push({ key, category: { key, name: candidate.prefix, idDefinitionSites: { headings: { enabled: true, levels: candidate.levels, mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' } } },
      rule: { key, category: key, pattern: `\\b${escapeRegex(candidate.prefix)}:[A-Z][A-Z0-9_]*\\b` }, evidence: candidate.evidence,
      uncertainty: `Namespaced headings "${candidate.prefix}:<NAME>": ${candidate.count} headings in ${candidate.files} files at level ${candidate.levels.join(', ')}, with ${candidate.distinctIds} distinct identifiers such as ${example}. `
        + (candidate.repeated.length ? `${candidate.repeated.length} ${candidate.repeated.length === 1 ? 'is' : 'are'} headed in more than one file (such as ${candidate.repeated[0]}), so ${candidate.repeated.length === 1 ? 'it indexes as a duplicate' : 'they index as duplicates'}. ` : '')
        + 'The prefix is part of each ID, so the same name under another prefix is a different ID. Delete it if these headings are not records.' });
  });
  // Increment 85c: keyword headings, capabilities, and changes.
  // The scopes of the specification folders holding these files (97a bugfix criteria, 104 Kiro tasks), one per folder: a pattern per
  // specification root holding them (106: every root, as with sub-projects that each keep `.kiro/specs`), and `fallback` for files under none.
  const specFoldersScopes = (files: readonly string[], fallback: readonly string[] = []) => {
    const roots = (inventory.layout?.specFolders ?? []).filter(candidate => candidate.folders.some(folder => files.some(file => file.startsWith(folder + '/'))));
    const covered = (file: string) => roots.some(root => root.folders.some(folder => file.startsWith(folder + '/')));
    return [...roots.map(root => root.pattern.endsWith('/**') ? `${root.root}/**/{spec}/*.md` : `${root.root}/*`), ...(files.some(file => !covered(file)) || !roots.length ? fallback : [])];
  };
  const layout = inventory.layout, keywords = inventory.keywords ?? [], applied = providerProposals(inventory.providers ?? [], profiles);
  const keyFor = new Map(keywords.map((keyword, i) => [keyword.keyword.toLocaleLowerCase() + (keyword.numbered ? '#' : ''), `discovered-k${i + 1}`]));
  const capability = layout?.specRoot && layout.specEvidence.length ? 'discovered-capability' : undefined;
  // Increment 96c: grouped capabilities and change deltas are matched at any depth.
  const capabilityPattern = layout?.specRoot ? `${layout.specRoot}/${layout.specGrouped ? '**/' : ''}{capability}/spec.md` : undefined;
  const capabilityScopes = capabilityPattern ? [{ pattern: capabilityPattern }, ...(layout!.changeRoot && layout!.changeSpecs ? [{ pattern: `${layout!.changeRoot}/**/specs/${layout!.changeSpecsGrouped ? '**/' : ''}{capability}/spec.md` }] : [])] : [];
  keywords.forEach(keyword => {
    const key = keyFor.get(keyword.keyword.toLocaleLowerCase() + (keyword.numbered ? '#' : ''))!, sites = { headings: { enabled: true, levels: keyword.levels, mode: 'start' as const }, tables: { enabled: false, column: 'ID', mode: 'exact' as const } };
    const where = `${keyword.count} headings in ${keyword.files} files at level ${keyword.levels.join(', ')}`;
    if (keyword.numbered) {
      const itemized = applied.filter(({ result }) => result.kind === 'list-section' && result.keyword.toLocaleLowerCase() === keyword.keyword.toLocaleLowerCase()) as Applied<ListSectionResult, ListSectionProposal>[];
      suggestions.push({ key, category: { key, name: keyword.keyword, idDefinitionSites: sites, ...(keyword.scope ? { idScopes: [{ pattern: keyword.scope }] } : {}), ...(keyword.specScope?.onlyInScopes ? { onlyInScopes: true } : {}) },
        // 96d: with items numbered inside it, "Requirement 1.9" cites an item, so the requirement rule does not read its "Requirement 1".
        rule: { key, category: key, pattern: `\\b${escapeRegex(keyword.keyword).replace(/ /g, '\\s+')} \\d+\\b${itemized.length ? '(?!\\.\\d)' : ''}` }, evidence: keyword.evidence,
        uncertainty: `Numbered keyword headings such as "${keyword.evidence[0]?.id}": ${where}.${keyword.specScope ? scopeText(keyword.specScope) : keyword.scope ? ` Numbers restart, so ${keyword.scope} gives each its own scope.` : ''} Delete it if these headings are not records.` });
      // 97a: providers' items numbered by position inside this keyword's elements, such as Kiro's acceptance criteria, and the labelled lists citing them.
      for (const { tool, result, proposal } of itemized) {
        const values: Record<string, string | number> = { keyword: keyword.keyword, keywordPattern: escapeRegex(keyword.keyword), keywordLower: keyword.keyword.toLocaleLowerCase(), section: result.section, items: result.items, files: result.files, citations: result.citations, parent: key };
        const self = values.self = fillTemplate(proposal.key, values);
        const references = providerReferences(proposal.references, values, self, key);
        suggestions.push({ key: self, category: { key: self, name: proposal.name, numberedItems: { parent: key, section: result.section, id: proposal.numberedItems.id },
          ...(keyword.scope ? { idScopes: [{ pattern: keyword.scope }] } : {}), ...(keyword.specScope?.onlyInScopes ? { onlyInScopes: true } : {}) },
          ...(references.length ? { references } : {}), evidence: result.evidence, uncertainty: profileText(proposal.uncertainty, values), provider: tool });
      }
      return;
    }
    const parent = keyword.parent ? keyFor.get(keyword.parent.toLocaleLowerCase()) : undefined;
    suggestions.push({ key, category: { key, name: keyword.keyword,
      idDefinitionSites: { ...sites, headings: { ...sites.headings, mode: 'keyword', keyword: keyword.keyword, ...(keyword.separator ? { separator: keyword.separator } : {}) } },
      ...(parent ? { parent } : {}), ...(keyword.inSpecs && capabilityScopes.length ? { idScopes: capabilityScopes } : {}),
      ...(keyword.inDeltas && layout?.changeRoot ? { deltas: true } : {}), ...(keyword.nameReferences ? { nameReferences: true } : {}) }, evidence: keyword.evidence,
      uncertainty: `Keyword headings "${keyword.keyword}${keyword.separator ? ` ${keyword.separator}` : ':'} <name>": ${where}. The name after the keyword is the element's ID.`
        + (keyword.otherSeparators ? ` ${keyword.otherSeparators} other ${keyword.keyword} ${keyword.otherSeparators === 1 ? 'heading uses' : 'headings use'} another separator and ${keyword.otherSeparators === 1 ? 'is' : 'are'} left out.` : '')
        + `${parent ? ` Nested in ${keyword.parent} headings, so it is identified within them.` : ''}${keyword.inDeltas && layout?.changeRoot ? ` ${keyword.inDeltas} appear under ADDED/MODIFIED/REMOVED/RENAMED sections, recorded as changes.` : ''}${keyword.nameReferences ? ` ${keyword.nameReferences} backticked mentions name them.` : ''} Delete it if these headings are not records.`
        + (keyword.overlaps ?? []).map(overlap => ` ${overlap.keyword} headings define the same ${overlap.names.length === 1 ? 'name' : 'names'} (${overlap.names.map(name => `"${name}"`).join(', ')}): `
          + `adding both recognizes ${overlap.names.length === 1 ? 'it' : 'them'} in two categories, which stops recognition, so keep one.`).join('') });
  });
  // 97a: providers' numbered paragraphs, such as Kiro's bugfix criteria (`2.1 The system SHALL …`), join the suggestion with numbered items, or a new category.
  for (const { tool, detector, result, proposal } of applied as Applied<ParagraphSectionsResult, ParagraphSectionsProposal>[]) {
    if (result.kind !== 'paragraph-sections') continue;
    const values: Record<string, string | number> = { count: result.count, files: result.files, ...Object.fromEntries(Object.entries(result.sections).map(([section, count]) => [`sections.${section}`, count])) };
    let target = suggestions.find(s => s.category.numberedItems);
    if (!target) {
      // Without numbered items, the new category takes the scope of the specification folders holding the paragraphs.
      const scopes = specFoldersScopes(result.evidence.map(e => e.file));
      const self = values.self = fillTemplate(proposal.create.key, values);
      const references = providerReferences(proposal.create.references, values, self, self);
      target = { key: self, category: { key: self, name: proposal.create.name, ...(scopes.length ? { idScopes: scopes.map(pattern => ({ pattern })) } : {}) }, ...(references.length ? { references } : {}), evidence: result.evidence, uncertainty: '', provider: tool };
      suggestions.push(target);
    }
    values.self = target.key;
    target.rule = { key: fillTemplate(proposal.rule.key, values), category: target.key, pattern: proposal.rule.pattern, id: proposal.rule.id, ...(proposal.rule.defines ? { defines: true } : {}) };
    if (proposal.idDefinitionSites) target.category.idDefinitionSites = structuredClone(proposal.idDefinitionSites) as unknown as IdDefinitionSites;
    // Increment 96f: the section of each paragraph becomes its tag.
    if (proposal.sectionTag) target.category.sectionTags = Object.entries((detector as ParagraphSectionsDetector).sections).map(([section, heading]) => ({ heading, tag: fillTemplate(proposal.sectionTag!, { section }) }));
    target.uncertainty = `${target.uncertainty ? target.uncertainty + ' ' : ''}${profileText(proposal.uncertainty, values)}`;
    if (proposal.tagReason) target.tagReason = profileText(proposal.tagReason, values);
    target.provider ??= tool;
  }
  // 97e: providers' own categories from matching lines, such as Trae's tasks and subtasks per spec folder, and (104) Kiro's tasks.
  for (const { tool, result, proposal } of applied as Applied<MatchingLinesResult, CategoryProposal>[]) {
    if (result.kind !== 'matching-lines') continue;
    const values: Record<string, string | number> = { count: result.count, files: result.files, folders: result.folders };
    const key = values.self = fillTemplate(proposal.create.key, values), { create, rule } = proposal;
    const scopes = create.scope === 'spec-folders' ? specFoldersScopes(result.paths, create.idScopes) : create.idScopes;
    // 104: the elements' names, such as "Task 7"; Specular's numbered keyword suggestion for them is replaced, unless another suggestion builds on it.
    const names = proposal.names, keyword = names?.keyword.toLocaleLowerCase();
    const replaced = names ? suggestions.findIndex(s => !s.provider && s.rule?.pattern?.startsWith(`\\b${escapeRegex(names.keyword)} \\d+`) && s.category.name.toLocaleLowerCase() === keyword
      && !suggestions.some(other => other.category.numberedItems?.parent === s.key || other.category.parent === s.key)) : -1;
    const counted = replaced >= 0 ? inventory.keywords?.find(item => item.numbered && item.keyword.toLocaleLowerCase() === keyword) : undefined;
    if (replaced >= 0) suggestions.splice(replaced, 1);
    const nameText = names ? ` Mentions such as "${names.keyword} 7" refer to them, and "${names.keyword} N" headings in their files define them.`
      + (counted ? ` This replaces the "${names.keyword} N" heading suggestion (${counted.count} headings in ${counted.files} files); elsewhere those headings refer to these ${names.keyword.toLocaleLowerCase()}s.` : '') : '';
    suggestions.push({ key, category: { key, name: create.name, ...(create.role ? { role: create.role } : {}), ...(scopes?.length ? { idScopes: scopes.map(pattern => ({ pattern })) } : {}),
      ...(create.definitionPaths ? { definitionPaths: [...create.definitionPaths] } : {}), ...(proposal.idDefinitionSites ? { idDefinitionSites: structuredClone(proposal.idDefinitionSites) as unknown as IdDefinitionSites } : {}),
      ...(proposal.statusSites ? { statusSites: structuredClone(proposal.statusSites) as unknown as IdCategory['statusSites'] } : {}) },
      rule: { key: fillTemplate(rule.key, values), category: key, pattern: rule.pattern, ...(rule.id !== undefined ? { id: rule.id } : {}), ...(rule.defines ? { defines: true } : {}) },
      ...(names ? { references: [{ key: fillTemplate(names.rule.key, values), category: key, pattern: names.rule.pattern }] } : {}),
      evidence: result.evidence, uncertainty: profileText(proposal.uncertainty, values) + nameText, provider: tool });
  }
  // 97b: providers' heading sections, such as Spec Kit's phase and priority headings: the suggestion whose rule matches most IDs under them gets their tags.
  for (const { detector, result, proposal } of applied as Applied<HeadingSectionsResult, MatchingIdsProposal>[]) {
    if (result.kind !== 'heading-sections') continue;
    const matches = (suggestion: ConventionSuggestion) => {
      if (!suggestion.rule || suggestion.rule.id !== undefined || suggestion.rule.list) return 0;
      const regex = new RegExp(`^(?:${suggestion.rule.prefix !== undefined ? `${escapeRegex(suggestion.rule.prefix)}${escapeRegex(suggestion.rule.separator ?? '-')}\\d+` : suggestion.rule.pattern!.replace(/^\\b|\\b$/gu, '')})$`, suggestion.rule.ignoreCase ? 'iu' : 'u');
      return result.ids.filter(id => regex.test(id)).length;
    };
    const target = suggestions.map(suggestion => ({ suggestion, count: matches(suggestion) })).sort((a, b) => b.count - a.count)[0];
    if (!target || target.count * 2 < result.ids.length) continue;
    const headings = (detector as HeadingSectionsDetector).headings.filter(entry => result.counts[entry.name] >= detector.min);
    const category = target.suggestion.category;
    category.sectionTags = [...(category.sectionTags ?? []), ...headings.map(({ pattern, tag }) => ({ pattern, tag }))].slice(0, MAX_SECTION_TAGS);
    // The IDs start checkbox items, so they define there; other list items, such as parallel examples, keep referring.
    // 103: the profile's sites replace the list sites the prefix suggestion took from those same items.
    const listNote = listNotes.get(target.suggestion.key);
    if (proposal.defaultDefinitionSites && (!category.idDefinitionSites || target.suggestion.listReason)) {
      category.idDefinitionSites = structuredClone(proposal.defaultDefinitionSites) as unknown as IdDefinitionSites;
      if (listNote) {
        target.suggestion.uncertainty = target.suggestion.uncertainty.replace(listNote.note, '');
        if (listNote.paths) delete category.definitionPaths;
      }
      delete target.suggestion.listReason;
    }
    const described = headings.map(entry => fillTemplate(entry.describe, { count: result.counts[entry.name] })).join(' and ');
    target.suggestion.tagReason = profileText(proposal.tagReason, { files: result.files, described });
    target.suggestion.uncertainty += ' ' + target.suggestion.tagReason;
  }
  if (capability) suggestions.push({ key: capability, category: { key: capability, name: 'Capability', derive: { pattern: capabilityPattern! } }, evidence: layout!.specEvidence,
    uncertainty: `Each folder in ${layout!.specRoot}/${layout!.specGrouped ? ', or in its group folders,' : ''} with a spec.md is a capability, named by the folder.`
      + (layout!.sharedCapabilities ? ` Capabilities named ${layout!.sharedCapabilities.join(', ')} appear in more than one group and become one element.` : '') });
  if (layout?.changeRoot && layout.changeEvidence.length) suggestions.push({ key: 'discovered-change', category: { key: 'discovered-change', name: 'Change', derive: { pattern: `${layout.changeRoot}/**/{change}/proposal.md` }, changes: capability ? { capabilities: capability } : {} },
    evidence: layout.changeEvidence, uncertainty: `Each folder in ${layout.changeRoot}/ with a proposal.md is a change, Active or Archived by location${capability ? '; its proposal declares capabilities' : ''}.` });
  const folders: FolderSuggestion[] = (layout?.specFolders ?? []).map((candidate, i) => ({ key: `discovered-folders-${i + 1}`, target: 'features', pattern: candidate.pattern, folders: candidate.folders,
    ...(candidate.withoutSpec ? { withoutSpec: candidate.withoutSpec } : {}), ...(candidate.ids ? { ids: candidate.ids } : {}), evidence: candidate.evidence,
    uncertainty: (candidate.pattern.endsWith('/**')
      ? `${candidate.folders.length} specification folders in ${candidate.root}/ sit at more than one depth, so each folder holding a specification file is a feature named by its folder; group folders are not.`
      : `${candidate.folders.length} folders in ${candidate.root}/ hold the specifications, so each can be a feature named by its folder.`)
      + ' Adding this suggestion runs Update features; rename the features afterwards in Application features.' }));
  dropKeywordNamesOfOtherIds(suggestions);
  const exclusions = exclusionSuggestions(inventory.toolFolders);
  return { version: 1, suggestions, ...(folders.length ? { folders } : {}), ...(exclusions.length ? { exclusions } : {}) };
}
/**
 * Keyword headings whose name is another suggestion's ID, such as Spec Kit's "## Parallel Example: User Story 1", are sections about
 * that ID: recognition does not define them (documents.ts), so their examples go, and a suggestion left without examples is not offered.
 */
function dropKeywordNamesOfOtherIds(suggestions: ConventionSuggestion[]) {
  const recognizers = suggestions.filter(s => s.rule && s.rule.id === undefined && !s.rule.list).map(s => ({ name: s.category.name, regex: ruleRegex(s.rule!) }));
  if (!recognizers.length) return;
  const ownedBy = (name: string) => recognizers.find(item => { item.regex.lastIndex = 0; const match = item.regex.exec(name); return !!match && match.index === 0 && match[0].length === name.length; });
  for (let i = suggestions.length - 1; i >= 0; i--) {
    const suggestion = suggestions[i], headings = suggestion.category.idDefinitionSites?.headings;
    if (suggestion.rule || headings?.mode !== 'keyword' || !headings.keyword) continue;
    const colliding = suggestion.evidence.map(evidence => ({ evidence, name: keywordName(evidence.id, headings.keyword!, headings.separator)?.name }))
      .map(item => ({ ...item, owner: item.name === undefined ? undefined : ownedBy(item.name) })).filter(item => item.owner);
    if (!colliding.length) continue;
    const children = suggestions.some(other => other.category.parent === suggestion.category.key || other.category.numberedItems?.parent === suggestion.category.key);
    if (colliding.length === suggestion.evidence.length && !children) { suggestions.splice(i, 1); continue; }
    // With child suggestions it stays, keeping its examples when all of them collide (a suggestion needs at least one).
    if (colliding.length < suggestion.evidence.length) suggestion.evidence = suggestion.evidence.filter(evidence => !colliding.some(item => item.evidence === evidence));
    suggestion.uncertainty += ` Headings naming ${colliding[0].owner!.name} IDs, such as "${colliding[0].evidence.id}", are about those IDs and define nothing.`;
  }
}
/** Increment 99a: one suggestion listing the tool folders present; it is staged into `excludedPaths`, never applied silently. */
function exclusionSuggestions(folders: readonly ToolFolder[] = []): ExclusionSuggestion[] {
  if (!folders.length) return [];
  const total = (field: 'files' | 'definitions' | 'pending') => folders.reduce((n, folder) => n + folder[field], 0);
  return [{ key: 'discovered-exclusions', paths: folders.map(f => f.path), files: folders.map(f => f.files), definitions: folders.map(f => f.definitions), pending: folders.map(f => f.pending),
    uncertainty: `${folders.length === 1 ? 'This folder holds' : 'These folders hold'} the templates and agent commands of specification tools (${total('files')} Markdown files): their IDs, checkboxes, and markers are placeholders, `
      + `adding ${total('definitions')} definitions and ${total('pending')} pending items under the current draft. Excluded files stay in the Explorer and can still be opened and edited. Scan again after adding it to update the other suggestions.` }];
}
function keys(value: any, allowed: string[]) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k)); }
export function validateProposal(input: unknown, documents: Record<string, string>): ConventionProposal {
  if (JSON.stringify(input)?.length > 256 * 1024) throw new Error('Proposal exceeds 256 KB.');
  const p = input as ConventionProposal;
  if (!keys(p, ['version', 'suggestions', 'folders', 'tags', 'exclusions']) || p.version !== 1 || !Array.isArray(p.suggestions) || p.suggestions.length > 128) throw new Error('Expected a version-1 proposal with at most 128 suggestions.');
  const names = new Set<string>();
  const lists = new Map<string, ReturnType<typeof listStarts>>();
  const checkEvidence = (evidence: CandidateEvidence[]) => {
    for (const e of evidence) {
      if (!keys(e, ['id', 'file', 'offset', 'end', 'context']) || typeof e.id !== 'string' || !e.id || e.id.length > 512 || typeof e.file !== 'string' || !Object.hasOwn(documents, e.file) || !Number.isInteger(e.offset) || !Number.isInteger(e.end) || e.offset < 0 || e.end <= e.offset || e.end > documents[e.file].length || documents[e.file].slice(e.offset, e.end) !== e.id || !['heading', 'id-table', 'list-item', 'mention'].includes(e.context)) throw new Error('Proposal evidence is missing, stale, or outside the selected Markdown.');
      if (e.context === 'list-item') {
        if (!lists.has(e.file)) lists.set(e.file, listStarts(parseMarkdown(documents[e.file]), documents[e.file]));
        if (!isListEvidence(e, lists.get(e.file)!, documents[e.file])) throw new Error('Proposal list-item evidence must identify a leading plain or emphasized ID in a Markdown list item.');
      }
    }
  };
  const suggestions = p.suggestions.map(s => {
    if (!keys(s, ['key', 'category', 'rule', 'references', 'evidence', 'uncertainty', 'tagReason', 'listReason', 'provider']) || typeof s.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s.key) || names.has(s.key) || typeof s.uncertainty !== 'string' || !s.uncertainty.trim() || s.uncertainty.length > 2000 || (s.tagReason !== undefined && (typeof s.tagReason !== 'string' || s.tagReason.length > 2000)) || (s.listReason !== undefined && (typeof s.listReason !== 'string' || s.listReason.length > 2000)) || (s.provider !== undefined && (typeof s.provider !== 'string' || !s.provider || s.provider.length > 64))) throw new Error('Suggestions need unique keys and an uncertainty explanation.');
    names.add(s.key);
    // Parent and capability references point at other suggestions, so they are checked across the proposal below.
    const { parent: _parent, changes, ...own } = s.category as IdCategory;
    const category = { ...own, ...(changes ? { changes: { ...(changes.archive ? { archive: changes.archive } : {}) } } : {}) };
    // 96d: the numbered-items parent and the citation rules may name another suggestion or an existing category; a stand-in checks them here.
    const parentKey = category.numberedItems?.parent, references = s.references ?? [];
    if (!Array.isArray(references) || references.length > 4) throw new Error('A suggestion has at most 4 citation rules.');
    const others = [...new Set([parentKey, ...references.map(rule => rule?.category)])].filter((other): other is string => typeof other === 'string' && other !== category.key);
    if (references.some(rule => !rule || (rule.list ? rule.category !== category.key && rule.category !== parentKey : rule.category !== category.key || rule.pattern === undefined || rule.id !== undefined || rule.prefix !== undefined))) throw new Error('Citation rules are labelled lists of the suggestion\'s category or its numbered-items parent, or pattern rules of its category.');
    const validated = validateIdConfiguration({ version: 1, categories: [category, ...others.map(other => ({ key: other, name: other }))], rules: [...(s.rule === undefined ? [] : [s.rule]), ...references] });
    const rule = s.rule === undefined ? undefined : validated.rules[0];
    // 96e: a templated rule that defines (bugfix criteria) may be proposed; other templates and labelled lists are configured manually.
    if (rule?.list || (rule?.id !== undefined && !rule.defines)) throw new Error('Suggestions need a prefix or pattern rule; labelled lists and ID templates are configured manually.');
    if (!s.rule && validated.categories[0].idDefinitionSites?.headings.mode !== 'keyword' && !validated.categories[0].derive && !validated.categories[0].numberedItems) throw new Error('Suggestions without a rule need a keyword heading site, derived elements, or numbered list items.');
    if (!Array.isArray(s.evidence) || !s.evidence.length || s.evidence.length > 8) throw new Error('Each suggestion needs 1-8 source examples.');
    checkEvidence(s.evidence);
    const restored = { ...validated.categories[0], ...(s.category.parent ? { parent: s.category.parent } : {}), ...(changes ? { changes: { ...validated.categories[0].changes, ...(changes.capabilities ? { capabilities: changes.capabilities } : {}) } } : {}) };
    return { ...s, category: restored, ...(rule ? { rule } : {}), ...(references.length ? { references: validated.rules.slice(rule ? 1 : 0) } : {}) };
  });
  for (const s of suggestions) for (const target of [s.category.parent, s.category.changes?.capabilities]) {
    if (target !== undefined && !suggestions.some(other => other !== s && other.category.key === target)) throw new Error('Suggestion parent and capability references must name other suggestions.');
  }
  // Increment 96: folder generators for features, with their folders and examples.
  if (p.folders !== undefined && (!Array.isArray(p.folders) || p.folders.length > 8)) throw new Error('A proposal has at most 8 folder suggestions.');
  const folders = p.folders?.map(f => {
    if (!keys(f, ['key', 'target', 'pattern', 'folders', 'withoutSpec', 'ids', 'evidence', 'uncertainty']) || typeof f.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(f.key) || names.has(f.key) || f.target !== 'features' || typeof f.uncertainty !== 'string' || !f.uncertainty.trim() || f.uncertainty.length > 2000) throw new Error('Folder suggestions need unique keys, the features target, and an explanation.');
    names.add(f.key);
    const [generator] = validateFolderGenerators([{ key: 'proposed', target: f.target, pattern: f.pattern, exclusions: [] }]);
    if (!Array.isArray(f.folders) || !f.folders.length || f.folders.length > 2000 || f.folders.some(folder => typeof folder !== 'string' || !folder.startsWith(patternRoot(generator.pattern) + '/'))) throw new Error('Folder suggestions list the child folders of their pattern.');
    if (f.withoutSpec !== undefined && (!Array.isArray(f.withoutSpec) || f.withoutSpec.some(folder => !f.folders.includes(folder)))) throw new Error('Folder suggestions mark only their own folders.');
    if (f.ids !== undefined && (!Array.isArray(f.ids) || f.ids.length !== f.folders.length || f.ids.some(n => !Number.isInteger(n) || n < 0))) throw new Error('Folder suggestion counts must match their folders.');
    if (!Array.isArray(f.evidence) || f.evidence.length > 8) throw new Error('Each folder suggestion has at most 8 source examples.');
    checkEvidence(f.evidence);
    return { ...f, pattern: generator.pattern };
  });
  // Increment 96h: section tags for existing categories; mergeProposal checks that the category is in the draft.
  if (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.length > 16)) throw new Error('A proposal has at most 16 section tag suggestions.');
  const tags = p.tags?.map(t => {
    if (!keys(t, ['key', 'category', 'sectionTags', 'checkboxLists', 'lists', 'evidence', 'uncertainty']) || typeof t.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(t.key) || names.has(t.key) || typeof t.category !== 'string' || (t.checkboxLists !== undefined && t.checkboxLists !== true) || (t.lists !== undefined && t.lists !== true) || typeof t.uncertainty !== 'string' || !t.uncertainty.trim() || t.uncertainty.length > 2000) throw new Error('Section tag suggestions need unique keys, a category, and an explanation.');
    names.add(t.key);
    const [category] = validateIdConfiguration({ version: 1, categories: [{ key: t.category, name: t.category, sectionTags: t.sectionTags }], rules: [] }).categories;
    if (!category.sectionTags?.length && !t.lists) throw new Error('Section tag suggestions need at least one entry.');
    if (!Array.isArray(t.evidence) || t.evidence.length > 8) throw new Error('Each section tag suggestion has at most 8 source examples.');
    checkEvidence(t.evidence);
    return { ...t, sectionTags: category.sectionTags ?? [] };
  });
  // 99a: one exclusion suggestion, its counts aligned with its paths.
  if (p.exclusions !== undefined && (!Array.isArray(p.exclusions) || p.exclusions.length > 1)) throw new Error('A proposal has at most one exclusion suggestion.');
  const exclusions = p.exclusions?.map(x => {
    if (!keys(x, ['key', 'paths', 'files', 'definitions', 'pending', 'uncertainty']) || typeof x.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(x.key) || names.has(x.key) || typeof x.uncertainty !== 'string' || x.uncertainty.length > 2000) throw new Error('Invalid exclusion suggestion.');
    const paths = validateExcludedPaths(x.paths);
    for (const field of ['files', 'definitions', 'pending'] as const) if (!Array.isArray(x[field]) || x[field].length !== paths.length || x[field].some(n => !Number.isInteger(n) || n < 0)) throw new Error('Exclusion counts must match their paths.');
    names.add(x.key);
    return { ...x, paths };
  });
  return { version: 1, suggestions, ...(folders?.length ? { folders } : {}), ...(tags?.length ? { tags } : {}), ...(exclusions?.length ? { exclusions } : {}) };
}
/** Increment 97c: a convention a discovery plugin found that the configuration cannot express; a note, never applied. */
export interface ProviderGap { tool: string; text: string; evidence: CandidateEvidence[] }
/**
 * Increment 97c: a discovery plugin's result, checked against the selected Markdown like any proposal and labelled with its tool.
 * Keys the review already uses (`taken`) are renamed throughout the plugin's suggestions; gap examples that do not match the text are dropped.
 */
export function pluginProposal(tool: string, result: { readonly suggestions: readonly unknown[]; readonly gaps?: readonly { readonly text: string; readonly evidence?: readonly unknown[] }[] }, documents: Record<string, string>, taken: ReadonlySet<string>): { suggestions: ConventionSuggestion[]; gaps: ProviderGap[] } {
  const { suggestions } = validateProposal({ version: 1, suggestions: (result.suggestions as Record<string, unknown>[]).map(({ provider: _provider, ...suggestion }) => suggestion) }, documents);
  const used = new Set(taken), renamed = new Map<string, string>();
  const unique = (key: string) => { let next = key, n = 2; while (used.has(next)) next = `${key.slice(0, 56)}-${n++}`; used.add(next); return next; };
  for (const suggestion of suggestions) renamed.set(suggestion.category.key, unique(suggestion.category.key));
  const name = (key: string) => renamed.get(key) ?? key;
  for (const suggestion of suggestions) {
    suggestion.key = suggestion.category.key = name(suggestion.category.key); suggestion.provider = tool;
    if (suggestion.rule) { suggestion.rule.category = name(suggestion.rule.category); suggestion.rule.key = suggestion.rule.key === suggestion.key ? suggestion.key : unique(suggestion.rule.key); }
    for (const rule of suggestion.references ?? []) { rule.category = name(rule.category); rule.key = unique(rule.key); }
    const category = suggestion.category;
    if (category.parent) category.parent = name(category.parent);
    if (category.changes?.capabilities) category.changes.capabilities = name(category.changes.capabilities);
    if (category.numberedItems) category.numberedItems.parent = name(category.numberedItems.parent);
  }
  const example = (value: unknown): value is CandidateEvidence => { const e = value as CandidateEvidence; return !!e && typeof e.file === 'string' && Object.hasOwn(documents, e.file) && Number.isInteger(e.offset) && Number.isInteger(e.end) && e.offset >= 0 && e.end > e.offset && typeof e.id === 'string' && documents[e.file].slice(e.offset, e.end) === e.id && ['heading', 'id-table', 'list-item', 'mention'].includes(e.context); };
  const gaps = (result.gaps ?? []).map(gap => ({ tool, text: gap.text.trim(), evidence: (gap.evidence ?? []).filter(example).map(({ id, file, offset, end, context }) => ({ id, file, offset, end, context })) }));
  return { suggestions, gaps };
}
/** Merge reviewed suggestions without overwriting existing entries or requiring key editing. */
/**
 * Increment 96h: the section tags of suggestions whose evidence one existing category recognizes (`owners[i]`), offered for that category,
 * so the tags are not lost with an omitted suggestion or tied to an ambiguous one. Entries the category already has are left out.
 */
export function existingCategoryTags(draft: IdConfiguration, suggestions: readonly ConventionSuggestion[], owners: readonly (string | undefined)[]): TagSuggestion[] {
  const used = new Set(suggestions.map(suggestion => suggestion.key));
  return suggestions.flatMap((suggestion, index) => {
    const category = draft.categories.find(item => item.key === owners[index]);
    const entries = category ? newSectionTags(category.sectionTags, suggestion.category.sectionTags) : [];
    // Increment 103: list items define the suggestion's IDs, but not the existing category's.
    const lists = !!category && !!suggestion.listReason && !!suggestion.category.idDefinitionSites?.lists?.enabled && !suggestion.category.idDefinitionSites.lists.checkboxOnly && !listDefinitionsOn(draft, category);
    if (!category || (!entries.length && !lists)) return [];
    let key = `${suggestion.key.slice(0, 58)}-tags`, n = 2; while (used.has(key)) key = `${suggestion.key.slice(0, 55)}-tags-${n++}`; used.add(key);
    const checkboxLists = !!suggestion.category.idDefinitionSites?.lists?.checkboxOnly && !listDefinitionsOn(draft, category);
    if (!entries.length) return [{ key, category: category.key, sectionTags: [], lists: true as const, evidence: suggestion.evidence,
      uncertainty: `${suggestion.listReason} ${category.name} already recognizes these IDs, but its list definitions are off, so they are references there. Adding this suggestion turns list definitions on for ${category.name}.` }];
    return [{ key, category: category.key, sectionTags: entries, ...(checkboxLists ? { checkboxLists: true as const } : {}), ...(lists ? { lists: true as const } : {}), evidence: suggestion.evidence,
      uncertainty: `${suggestion.tagReason ?? 'The suggestion tags its IDs by their enclosing section headings.'} ${category.name} already recognizes these IDs, so the tags can be added to it without the suggested rule.${lists ? ` ${suggestion.listReason} Its list definitions are off; adding this suggestion turns them on.` : ''}` }];
  });
}
/** Increment 103: most definition-like matches, and at least two, start list items. */
const listDefined = (candidate: IdCandidate) => (candidate.listDefinitions ?? 0) >= 2 && candidate.listDefinitions! * 2 > candidate.definitions;
/** At most a tenth of the listed IDs start list items again in their scope. */
const listUnique = (candidate: IdCandidate) => !candidate.listRepeats || candidate.listRepeats.repeated * 10 <= candidate.listRepeats.ids;
const listSentence = (candidate: IdCandidate) => ` ${candidate.listDefinitions} of them start list items in ${candidate.listFiles} ${candidate.listFiles === 1 ? 'file' : 'files'}, so list items that start with these IDs define them.`;
const listText = (candidate: IdCandidate) => `${candidate.listDefinitions} of ${candidate.definitions} definition-like matches of these IDs start list items in ${candidate.listFiles} ${candidate.listFiles === 1 ? 'file' : 'files'}.`;
/** Default definition sites with list items defining, unordered and ordered. */
const listSites = (): IdDefinitionSites => ({ ...structuredClone(DEFAULT_ID_DEFINITION_SITES), lists: { ...DEFAULT_ID_DEFINITION_SITES.lists!, enabled: true } });
/** Increment 96h: whether list items define a category's IDs, through its own definition sites or the project's. */
export const listDefinitionsOn = (configuration: IdConfiguration, category: IdCategory) => !!(category.idDefinitionSites ?? configuration.idDefinitionSites ?? DEFAULT_ID_DEFINITION_SITES).lists?.enabled;
/** The category's definition sites with checkbox list items defining, as 96g proposes for Spec Kit tasks, or (103) all list items. */
function checkboxListSites(configuration: IdConfiguration, category: IdCategory, checkboxOnly = true) {
  const sites = structuredClone(category.idDefinitionSites ?? configuration.idDefinitionSites ?? DEFAULT_ID_DEFINITION_SITES);
  const { checkboxOnly: _checkbox, ...lists } = { ...DEFAULT_ID_DEFINITION_SITES.lists!, ...sites.lists };
  return { ...sites, lists: { ...lists, enabled: true, ...(checkboxOnly ? { checkboxOnly: true } : {}) } };
}
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
  }
  // 96d: citation rules name their category after every suggestion has its key; a category not proposed stays as named (an existing one).
  for (const s of proposal.suggestions) for (const rule of s.references ?? []) merge(draft.rules, { ...rule, category: merged.get(rule.category) ?? rule.category });
  // 85c: parents and declared capabilities follow renamed keys; a reference to a suggestion that was not added is dropped.
  for (const s of proposal.suggestions) {
    const category = draft.categories.find(item => item.key === merged.get(s.category.key));
    if (!category) continue;
    if (category.parent !== undefined) { const target = merged.get(category.parent); if (target) category.parent = target; else delete category.parent; }
    if (category.changes?.capabilities !== undefined) { const target = merged.get(category.changes.capabilities); if (target) category.changes.capabilities = target; else delete category.changes.capabilities; }
    if (category.numberedItems) category.numberedItems.parent = merged.get(category.numberedItems.parent) ?? category.numberedItems.parent;
  }
  // 96h: section tags join an existing category; its own entries stay and the same heading or pattern is not added twice.
  for (const t of proposal.tags ?? []) {
    const category = draft.categories.find(item => item.key === t.category);
    if (!category) throw new Error(`Section tags name the category "${t.category}", which is not in the draft. Scan again.`);
    category.sectionTags = [...category.sectionTags ?? [], ...newSectionTags(category.sectionTags, t.sectionTags)];
    if (category.sectionTags.length > MAX_SECTION_TAGS) throw new Error(`${category.name} would have more than ${MAX_SECTION_TAGS} section tags. Delete some of its entries in Categories, or delete the section tag suggestion.`);
    if (t.lists && !listDefinitionsOn(draft, category)) category.idDefinitionSites = checkboxListSites(draft, category, false);
    else if (t.checkboxLists && !listDefinitionsOn(draft, category)) category.idDefinitionSites = checkboxListSites(draft, category);
  }
  // 99a: excluded paths join the draft's own, each once.
  const excluded = [...draft.excludedPaths ?? []];
  for (const path of (proposal.exclusions ?? []).flatMap(x => x.paths)) if (!excluded.some(item => item.toLowerCase() === path.toLowerCase())) excluded.push(path);
  if (excluded.length > 64) throw new Error('The draft would exclude more than 64 paths. Remove some in Project configuration, or delete the exclusion suggestion.');
  if (excluded.length) draft.excludedPaths = excluded;
  return validateIdConfiguration(draft);
}
