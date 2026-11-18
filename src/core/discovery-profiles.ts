import { toString } from 'mdast-util-to-string';
import type { Nodes } from 'mdast';
import { parseMarkdown } from './documents';
import { appliesError, type AppliesCondition } from '../../packages/plugin-api/src/index';
import { escapeRegex, validateIdConfiguration, type DiscoveryProviderSwitches, type ProjectProfileFile } from './id-configuration';
import type { CandidateEvidence } from './id-discovery';
import kiro from './profiles/kiro.json';
import specKit from './profiles/spec-kit.json';
import trae from './profiles/trae.json';

/**
 * Discovery providers (increment 97a, DD-063). A provider proposes conventions of one specification tool; a profile is a provider
 * written as data: detectors find the tool's layout in the Markdown, and proposals turn what they found into suggestions, which
 * Specular validates, measures, and reviews like its own. Profiles contain no code; each detector kind has a fixed meaning.
 */
export const PROFILE_SCHEMA = 1;
/** The profiles bundled with Specular, validated where they are used, so a broken one is reported like any other. */
export const BUNDLED_PROFILES: readonly unknown[] = [kiro, specKit, trae];
/** Ordered lists under a section heading (such as "Acceptance Criteria") inside numbered keyword headings (such as "Requirement 1"), per keyword. */
export interface ListSectionDetector { id: string; kind: 'list-section'; /** The section heading's text, ignoring case, emphasis, and a trailing colon. */ heading: string; within: 'numbered-keyword'; /** Items needed per keyword. */ min: number;
  /** Counts citations of the items across the Markdown: a regular expression in which {{keyword}} stands for the escaped keyword. */ citations?: string }
/** Paragraph lines matching a pattern under named section headings, such as numbered bugfix criteria under the behaviour headings. */
export interface ParagraphSectionsDetector { id: string; kind: 'paragraph-sections'; /** Each line of a paragraph matching this pattern counts; its first capture is the example. */ line: string;
  /** Section name to heading text, matched ignoring case, emphasis, and a trailing colon. */ sections: Record<string, string>; /** Lines needed in all sections together. */ min: number }
/** Increment 97b: headings matching patterns in files matching globs, and the IDs starting checkbox items under them, such as Spec Kit's phase and priority headings in tasks.md. */
export interface HeadingSectionsDetector { id: string; kind: 'heading-sections'; files: string[];
  /** Each pattern is tested on the heading text, ignoring case; `tag` is its section tag and `describe` explains its {{count}} headings. */ headings: { name: string; pattern: string; tag: string; describe: string }[];
  /** Headings needed for an entry to be proposed. */ min: number }
/** Increment 97e: list items and headings matching a pattern in files matching globs, such as Trae's `- [x] Task 1:` items; a leading checkbox is ignored. */
export interface MatchingLinesDetector { id: string; kind: 'matching-lines'; files: string[]; /** Tested on the item's or heading's text after its marker and checkbox; the first capture, or the match, is the example. */ pattern: string;
  /** Only list items with a checkbox count; headings always do. */ checkboxOnly?: boolean; /** Lines needed in all files together. */ min: number }
export type ProfileDetector = ListSectionDetector | ParagraphSectionsDetector | HeadingSectionsDetector | MatchingLinesDetector;
/** A sentence of a proposal's explanation; with `when`, only when that count is not zero. */
export interface ProfileText { text: string; when?: string }
/** A labelled-list citation rule; `self` is the proposed category and `parent` the keyword category the items belong to. */
export interface ProfileReference { key: string; category: 'self' | 'parent'; when?: string; list: { label: string; item: string; id: string } }
/** Per numbered keyword suggestion with a list-section result: a category numbering the items by position within its elements. */
export interface ListSectionProposal { detector: string; key: string; name: string; numberedItems: { id: string }; scope: 'parent'; references?: ProfileReference[]; uncertainty: ProfileText[] }
/** With a paragraph-sections result: a defining rule joined to the suggestion with numbered items, or to a new category. */
export interface ParagraphSectionsProposal { detector: string; join: 'numbered-items'; create: { key: string; name: string; scope: 'spec-folders'; references?: ProfileReference[] };
  rule: { key: string; pattern: string; id: string; defines?: true }; idDefinitionSites?: Record<string, unknown>; /** A section tag per section, built from {{section}}. */ sectionTag?: string;
  uncertainty: ProfileText[]; tagReason?: ProfileText[] }
/** Increment 97b: with a heading-sections result, the suggestion whose rule matches at least half of the IDs under those headings gets their section tags; it gets `defaultDefinitionSites` when it has none, and `tagReason` is appended to its explanation. */
export interface MatchingIdsProposal { detector: string; join: 'matching-ids'; defaultDefinitionSites?: Record<string, unknown>; tagReason: ProfileText[] }
/**
 * Increment 97e: with a matching-lines result, a category of the provider's own, with its rule, scopes, definition paths, and definition sites.
 * Increment 104: `scope: "spec-folders"` gives each specification folder holding the matches its own scope (106: per specification root holding them;
 * `idScopes` covers matches under no root found, or all of them when none is);
 * the rule may be a defining templated rule (`id`, `defines`), and `statusSites` sets the category's status sites, such as checkbox statuses.
 * With `names`, a second rule recognizes the elements by name (`Task 7`), and Specular's numbered keyword suggestion for that keyword is dropped.
 */
export interface CategoryProposal { detector: string; join: 'category'; create: { key: string; name: string; role?: 'requirement' | 'design' | 'task'; scope?: 'spec-folders'; idScopes?: string[]; definitionPaths?: string[] };
  rule: { key: string; pattern: string; id?: string; defines?: true }; names?: { keyword: string; rule: { key: string; pattern: string } };
  idDefinitionSites?: Record<string, unknown>; statusSites?: Record<string, unknown>; uncertainty: ProfileText[] }
export type ProfileProposal = ListSectionProposal | ParagraphSectionsProposal | MatchingIdsProposal | CategoryProposal;
export interface DiscoveryProfile { schema: 1; id: string; tool: string; /** The template versions the profile covers. */ versions: string; description?: string;
  /** Increment 97d: where the provider applies (see AppliesCondition); the 97a form `{ files: [globs] }` is read as `any` of them. */ applies?: AppliesCondition; detectors: ProfileDetector[]; proposals: ProfileProposal[] }

export interface ListSectionResult { kind: 'list-section'; detector: string; /** The keyword as first written. */ keyword: string; section: string; items: number; files: number; citations: number; evidence: CandidateEvidence[] }
export interface ParagraphSectionsResult { kind: 'paragraph-sections'; detector: string; count: number; files: number; sections: Record<string, number>; evidence: CandidateEvidence[] }
export interface HeadingSectionsResult { kind: 'heading-sections'; detector: string; files: number; /** Headings per entry name. */ counts: Record<string, number>; /** Up to 64 IDs starting checkbox items under them. */ ids: string[]; evidence: CandidateEvidence[] }
export interface MatchingLinesResult { kind: 'matching-lines'; detector: string; count: number; files: number; /** Folders holding the matching files. */ folders: number; evidence: CandidateEvidence[];
  /** Increment 106: the matching files, for scopes per specification root. */ paths: string[] }
export type DetectorResult = ListSectionResult | ParagraphSectionsResult | HeadingSectionsResult | MatchingLinesResult;
/** What a provider found, carried with the discovery inventory from the analysis worker. */
export interface ProviderResult { provider: string; tool: string; results: DetectorResult[] }

const KEY = /^[a-z][a-z0-9-]{0,63}$/u, PLACEHOLDER = /\{\{([A-Za-z.]+)\}\}/gu;
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max;
/** Replace {{name}} with its value; configuration templates such as {parent} keep their single braces. */
export const fillTemplate = (template: string, values: Record<string, string | number>) => template.replace(PLACEHOLDER, (all, name: string) => name in values ? String(values[name]) : all);
function regex(source: string, where: string, flags = 'u') { try { return new RegExp(source, flags); } catch { throw new Error(`${where} is not a valid Unicode regular expression.`); } }

/** Check a profile's shape, its regular expressions, and that each proposal names a detector of its kind. */
export function validateProfile(input: unknown): DiscoveryProfile {
  const p = record(input), name = typeof p.id === 'string' ? `Profile ${p.id}` : 'A profile';
  const fail = (message: string): never => { throw new Error(`${name}: ${message}`); };
  if (p.schema !== PROFILE_SCHEMA) fail(`schema must be ${PROFILE_SCHEMA}.`);
  if (typeof p.id !== 'string' || !KEY.test(p.id)) fail('id must be 1-64 lowercase letters, digits, or hyphens, starting with a letter.');
  if (!text(p.tool, 64) || !text(p.versions, 128)) fail('needs a tool name and the template versions it covers.');
  if (p.applies !== undefined && Array.isArray(record(p.applies).files) && Object.keys(p.applies).length === 1) p.applies = { any: (p.applies.files as unknown[]).map(files => ({ files })) };
  if (p.applies !== undefined) { const error = appliesError(p.applies); if (error) fail(error); }
  if (!Array.isArray(p.detectors) || !p.detectors.length || p.detectors.length > 16) fail('needs 1-16 detectors.');
  if (!Array.isArray(p.proposals) || !p.proposals.length || p.proposals.length > 16) fail('needs 1-16 proposals.');
  const kinds = new Map<string, string>();
  for (const [i, value] of (p.detectors as unknown[]).entries()) {
    const d = record(value), where = `detector ${i + 1}`;
    if (typeof d.id !== 'string' || !KEY.test(d.id) || kinds.has(d.id)) fail(`${where} needs a unique id.`);
    if (!Number.isInteger(d.min) || d.min < 1 || d.min > 1000) fail(`${where} needs a minimum count of 1-1000.`);
    if (d.kind === 'list-section') {
      if (!text(d.heading, 128) || d.within !== 'numbered-keyword') fail(`${where} needs a section heading and "within": "numbered-keyword".`);
      if (d.citations !== undefined) { if (!text(d.citations, 512)) fail(`${where}: citations must be a pattern of 1-512 characters.`); regex(fillTemplate(d.citations, { keyword: 'Requirement' }), `${name}, ${where} citations`); }
    } else if (d.kind === 'paragraph-sections') {
      if (!text(d.line, 512)) fail(`${where} needs a line pattern.`);
      regex(d.line, `${name}, ${where} line`);
      const sections = Object.entries(record(d.sections));
      if (!sections.length || sections.length > 16 || sections.some(([key, heading]) => !KEY.test(key) || !text(heading, 128))) fail(`${where} needs 1-16 sections, each a name and a heading text.`);
    } else if (d.kind === 'heading-sections') {
      if (!Array.isArray(d.files) || !d.files.length || d.files.length > 16 || d.files.some((glob: unknown) => !text(glob, 256))) fail(`${where} needs 1-16 file globs.`);
      if (!Array.isArray(d.headings) || !d.headings.length || d.headings.length > 16) fail(`${where} needs 1-16 headings.`);
      for (const value of d.headings as unknown[]) {
        const h = record(value);
        if (typeof h.name !== 'string' || !KEY.test(h.name) || !text(h.pattern, 512) || !text(h.tag, 128) || !text(h.describe, 500)) fail(`${where}: each heading needs a name, a pattern, a tag, and a description.`);
        // The entry is proposed as a section tag, so it must be a valid one.
        try { validateIdConfiguration({ version: 1, categories: [{ key: 'x', name: 'x', sectionTags: [{ pattern: h.pattern, tag: h.tag }] }], rules: [] }); }
        catch (error) { fail(`${where}, heading ${h.name}: ${(error as Error).message.replace(/^Category 1: /u, '')}`); }
      }
    } else if (d.kind === 'matching-lines') {
      if (!Array.isArray(d.files) || !d.files.length || d.files.length > 16 || d.files.some((glob: unknown) => !text(glob, 256))) fail(`${where} needs 1-16 file globs.`);
      if (!text(d.pattern, 512)) fail(`${where} needs a pattern.`);
      regex(d.pattern, `${name}, ${where} pattern`);
      if (d.checkboxOnly !== undefined && typeof d.checkboxOnly !== 'boolean') fail(`${where}: checkboxOnly must be true or false.`);
    } else fail(`${where} has an unknown kind; use list-section, paragraph-sections, heading-sections, or matching-lines.`);
    kinds.set(d.id, d.kind);
  }
  const texts = (value: unknown, where: string) => { if (!Array.isArray(value) || !value.length || value.some(item => !text(record(item).text, 1000) || (record(item).when !== undefined && typeof record(item).when !== 'string'))) fail(`${where} needs a list of texts.`); };
  const references = (value: unknown, where: string) => {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length > 4) fail(`${where}: at most 4 references.`);
    for (const ref of value as unknown[]) {
      const r = record(ref), list = record(r.list);
      if (!text(r.key, 128) || !['self', 'parent'].includes(r.category) || !text(list.label, 512) || !text(list.item, 512) || !text(list.id, 128)) fail(`${where}: a reference needs a key, a category (self or parent), and a list label, item, and id.`);
      for (const part of ['label', 'item'] as const) regex(fillTemplate(list[part], { keyword: 'Requirement', keywordPattern: 'Requirement' }), `${name}, ${where} reference ${part}`);
    }
  };
  for (const [i, value] of (p.proposals as unknown[]).entries()) {
    const q = record(value), where = `proposal ${i + 1}`, kind = kinds.get(q.detector);
    if (!kind) fail(`${where} names no detector of this profile.`);
    if (kind === 'matching-lines') {
      // 97e: the category is checked as the configuration would, with its rule.
      const create = record(q.create), rule = record(q.rule);
      if (q.join !== 'category' || !text(create.key, 64) || !text(create.name, 128) || !text(rule.key, 128) || !text(rule.pattern, 512)) fail(`${where} needs "join": "category", a category to create with a key and a name, and a rule with a key and a pattern.`);
      if (create.scope !== undefined && create.scope !== 'spec-folders') fail(`${where}: the category's scope can only be "spec-folders".`);
      const names = q.names === undefined ? undefined : record(q.names), named = names && record(names.rule);
      if (names && (!text(names.keyword, 64) || !text(named!.key, 128) || !text(named!.pattern, 512))) fail(`${where}: names needs a keyword and a rule with a key and a pattern.`);
      try {
        validateIdConfiguration({ version: 1, categories: [{ key: 'x', name: 'x', ...(create.role === undefined ? {} : { role: create.role }), ...(create.idScopes === undefined ? {} : { idScopes: Array.isArray(create.idScopes) ? create.idScopes.map((pattern: unknown) => ({ pattern })) : create.idScopes }),
          ...(create.definitionPaths === undefined ? {} : { definitionPaths: create.definitionPaths }), ...(q.idDefinitionSites === undefined ? {} : { idDefinitionSites: q.idDefinitionSites }), ...(q.statusSites === undefined ? {} : { statusSites: q.statusSites }) }],
          rules: [{ key: 'x', category: 'x', pattern: rule.pattern, ...(rule.id === undefined ? {} : { id: rule.id }), ...(rule.defines === undefined ? {} : { defines: rule.defines }) },
            ...(named ? [{ key: 'y', category: 'x', pattern: named.pattern }] : [])] });
      } catch (error) { fail(`${where}: ${(error as Error).message.replace(/^(Category|Rule) 1: /u, '')}`); }
      texts(q.uncertainty, where);
      continue;
    }
    if (kind === 'heading-sections') {
      // 97b: the explanation is the tag reason, appended to the joined suggestion's own.
      if (q.join !== 'matching-ids') fail(`${where} needs "join": "matching-ids".`);
      if (q.defaultDefinitionSites !== undefined) validateIdConfiguration({ version: 1, categories: [{ key: 'x', name: 'x', idDefinitionSites: q.defaultDefinitionSites }], rules: [] });
      texts(q.tagReason, where);
      continue;
    }
    texts(q.uncertainty, where);
    if (kind === 'list-section') {
      if (!text(q.key, 64) || !text(q.name, 128) || !text(record(q.numberedItems).id, 128) || q.scope !== 'parent') fail(`${where} needs a key, a name, numberedItems.id, and "scope": "parent".`);
      references(q.references, where);
    } else {
      const create = record(q.create), rule = record(q.rule);
      if (q.join !== 'numbered-items' || !text(create.key, 64) || !text(create.name, 128) || create.scope !== 'spec-folders') fail(`${where} needs "join": "numbered-items" and a category to create with a key, a name, and "scope": "spec-folders".`);
      if (!text(rule.key, 128) || !text(rule.pattern, 512) || !text(rule.id, 128)) fail(`${where} needs a rule with a key, a pattern, and an id template.`);
      regex(rule.pattern, `${name}, ${where} rule`);
      references(create.references, where);
      if (q.sectionTag !== undefined && !text(q.sectionTag, 128)) fail(`${where}: sectionTag must be a tag template.`);
      if (q.tagReason !== undefined) texts(q.tagReason, where);
    }
  }
  return structuredClone(p) as DiscoveryProfile;
}

/** Increment 97d: whether a provider applies to the project's Markdown paths, with the files that made it apply. */
export interface Applicability { applies: boolean; /** False when the provider declares no condition, and so applies everywhere. */ declared: boolean; files: number; example?: string }
/** Evaluate an applicability condition over Markdown paths; `folders` conditions see every folder holding Markdown, directly or below. */
export function evaluateApplies(condition: AppliesCondition | undefined, paths: readonly string[]): Applicability {
  if (!condition) return { applies: true, declared: false, files: 0 };
  let folders: Map<string, string[]> | undefined;
  const folderFiles = () => {
    if (folders) return folders;
    folders = new Map();
    for (const file of paths) { const parts = file.split('/'); for (let i = 1; i < parts.length; i++) { const folder = parts.slice(0, i).join('/'); folders.set(folder, [...folders.get(folder) ?? [], file]); } }
    return folders;
  };
  const holds = (item: AppliesCondition): string[] | undefined => {
    if ('any' in item || 'all' in item) {
      const results = ('any' in item ? item.any : item.all).map(holds), held = results.filter((files): files is string[] => !!files);
      return ('any' in item ? held.length > 0 : held.length === results.length) ? [...new Set(held.flat())] : undefined;
    }
    const pattern = glob('files' in item ? item.files : item.folders), min = item.min ?? 1;
    if ('files' in item) { const files = paths.filter(file => pattern.test(file)); return files.length >= min ? files : undefined; }
    const matched = [...folderFiles()].filter(([folder]) => pattern.test(folder));
    return matched.length >= min ? [...new Set(matched.flatMap(([, files]) => files))] : undefined;
  };
  const files = holds(condition);
  return files ? { applies: true, declared: true, files: files.length, ...(files.length ? { example: [...files].sort()[0] } : {}) } : { applies: false, declared: true, files: 0 };
}
/** A provider as Project configuration lists it (97b); 97c adds discovery plugins, identified by their plugin id; 97d adds applicability, which sets `enabled` unless the project chose. */
export interface ProviderInfo extends Applicability { id: string; tool: string; versions: string; description?: string; source: 'bundled' | 'project' | 'plugin'; file?: string; enabled: boolean }
/** Increment 97c: an installed, enabled plugin with a discovery contribution. */
export interface DiscoveryPluginInfo { id: string; tool: string; versions: string; description?: string; applies?: AppliesCondition }
/**
 * Increment 97b: the bundled profiles, then the project's own (`.specular/profiles/*.json`), validated; `profiles` are those to run.
 * A project profile that is invalid or reuses another provider's id is reported and skipped. 97d: a provider is on where it applies to
 * `paths` (the project's Markdown files), unless the project turns it off, or on where it does not apply.
 */
export function discoveryProviders(projectFiles: readonly ProjectProfileFile[] = [], switches: DiscoveryProviderSwitches = {}, plugins: readonly DiscoveryPluginInfo[] = [], paths: readonly string[] = []) {
  const providers: ProviderInfo[] = [], profiles: DiscoveryProfile[] = [], errors: string[] = [];
  const enabled = (id: string, applicability: Applicability) => switches.enabled?.includes(id) ? true : switches.disabled?.includes(id) ? false : applicability.applies;
  const add = (input: unknown, source: ProviderInfo['source'], file?: string) => {
    let profile: DiscoveryProfile;
    try { profile = validateProfile(input); } catch (error) { errors.push(`${file ? file + ': ' : ''}${error instanceof Error ? error.message : String(error)}`); return; }
    if (providers.some(provider => provider.id === profile.id)) { errors.push(`${file}: profile ${profile.id} uses the id of another provider.`); return; }
    const applicability = evaluateApplies(profile.applies, paths), on = enabled(profile.id, applicability);
    providers.push({ id: profile.id, tool: profile.tool, versions: profile.versions, ...(profile.description ? { description: profile.description } : {}), source, ...(file ? { file } : {}), ...applicability, enabled: on });
    if (on) profiles.push(profile);
  };
  for (const profile of BUNDLED_PROFILES) add(profile, 'bundled');
  for (const entry of projectFiles) { if (entry.error) errors.push(`${entry.file} ${entry.error}`); else add(entry.profile, 'project', entry.file); }
  // 97c: plugin ids contain a dot, so they never collide with profile ids; `plugins` are those to run.
  const run: DiscoveryPluginInfo[] = [];
  for (const { applies, ...plugin } of plugins) {
    const applicability = evaluateApplies(applies, paths), on = enabled(plugin.id, applicability);
    providers.push({ ...plugin, source: 'plugin', ...applicability, enabled: on });
    if (on) run.push({ ...plugin, ...(applies ? { applies } : {}) });
  }
  return { providers, profiles, errors, plugins: run };
}
/** `*` within a segment, `**` across folders. */
function glob(pattern: string) {
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { i++; if (pattern[i + 1] === '/') { i++; source += '(?:[^/]+/)*'; } else source += '.*'; }
    else if (c === '*') source += '[^/]*';
    else source += escapeRegex(c);
  }
  return new RegExp(source + '$', 'iu');
}
const sectionText = (value: string) => value.replace(/[*_:\s]+$/u, '');
/** Run each profile's detectors over the Markdown. An invalid profile is reported and skipped; the others still run. `keywordOf` names a heading's numbered keyword as written; keywords differing in case are one. */
export function runProfiles(profiles: readonly unknown[], documents: Record<string, string>, keywordOf: (heading: string) => string | undefined): { providers: ProviderResult[]; errors: string[] } {
  const providers: ProviderResult[] = [], errors: string[] = [];
  for (const input of profiles) {
    let profile: DiscoveryProfile;
    try { profile = validateProfile(input); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); continue; }
    // 97d: applicability is decided by discoveryProviders, so a provider turned on where it does not apply still runs.
    try {
      const results = detect(profile.detectors, documents, keywordOf);
      if (results.length) providers.push({ provider: profile.id, tool: profile.tool, results });
    } catch (error) { errors.push(`Profile ${profile.id}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { providers, errors };
}
function detect(detectors: readonly ProfileDetector[], documents: Record<string, string>, keywordOf: (heading: string) => string | undefined): DetectorResult[] {
  const lists = detectors.filter((d): d is ListSectionDetector => d.kind === 'list-section'), paragraphs = detectors.filter((d): d is ParagraphSectionsDetector => d.kind === 'paragraph-sections');
  const listFound = new Map<string, Map<string, { keyword: string; section: string; items: number; files: Set<string>; evidence: CandidateEvidence[] }>>(lists.map(d => [d.id, new Map()]));
  const paragraphFound = new Map(paragraphs.map(d => [d.id, { files: new Set<string>(), sections: Object.fromEntries(Object.keys(d.sections).map(key => [key, 0])) as Record<string, number>, evidence: [] as CandidateEvidence[], line: new RegExp(d.line, 'gmu') }]));
  for (const [file, text] of Object.entries(documents)) {
    const stack: { depth: number; keyword?: string }[] = [];
    let first = true, listSection: { detector: ListSectionDetector; keyword: string; text: string }[] = [], paragraphSection: { detector: ParagraphSectionsDetector; section: string }[] = [];
    const visit = (node: Nodes, inItem = false) => {
      if (['blockquote', 'code', 'html'].includes(node.type)) return;
      if (node.type === 'paragraph' && !inItem && node.position?.start.offset !== undefined) for (const { detector, section } of paragraphSection) {
        // Each line of the paragraph may start a match, since consecutive lines form one paragraph.
        const found = paragraphFound.get(detector.id)!, source = text.slice(node.position.start.offset, node.position.end.offset);
        found.line.lastIndex = 0;
        for (const line of source.matchAll(found.line)) {
          const start = node.position.start.offset + line.index!, id = line[1] ?? line[0];
          found.sections[section]++; found.files.add(file);
          if (found.evidence.length < 8) found.evidence.push({ id, file, offset: start, end: start + id.length, context: 'mention' });
        }
      }
      if (node.type === 'list' && node.ordered && !inItem) for (const { detector, keyword, text: heading } of listSection) {
        const byKeyword = listFound.get(detector.id)!, found = byKeyword.get(keyword.toLocaleLowerCase()) ?? { keyword, section: heading, items: 0, files: new Set<string>(), evidence: [] };
        found.items += node.children.length; found.files.add(file); byKeyword.set(keyword.toLocaleLowerCase(), found);
        // The example is the first item's first line.
        const item = node.children[0]?.children[0], start = item?.position?.start.offset;
        if (start !== undefined && found.evidence.length < 8) {
          const newline = text.indexOf('\n', start), end = Math.min(item!.position!.end.offset ?? start, newline < 0 ? text.length : text[newline - 1] === '\r' ? newline - 1 : newline);
          if (end > start) found.evidence.push({ id: text.slice(start, end), file, offset: start, end, context: 'mention' });
        }
      }
      if (node.type === 'heading') {
        while (stack.length && stack.at(-1)!.depth >= node.depth) stack.pop();
        const value = toString(node).trim(), empty = !value;
        // A document title names the file, not a record.
        const keyword = first && node.depth === 1 ? undefined : keywordOf(value);
        if (!empty) first = false;
        stack.push({ depth: node.depth, keyword });
        const enclosing = [...stack].slice(0, -1).reverse().find(entry => entry.keyword)?.keyword, heading = sectionText(value);
        listSection = enclosing ? lists.filter(d => heading.toLocaleLowerCase() === d.heading.toLocaleLowerCase()).map(detector => ({ detector, keyword: enclosing, text: heading })) : [];
        paragraphSection = paragraphs.flatMap(detector => Object.entries(detector.sections).filter(([, text]) => heading.toLocaleLowerCase() === text.toLocaleLowerCase()).map(([section]) => ({ detector, section })));
      }
      if ('children' in node) for (const child of node.children) visit(child, inItem || node.type === 'listItem');
    };
    visit(parseMarkdown(text));
  }
  const results: DetectorResult[] = [];
  for (const detector of lists) for (const found of listFound.get(detector.id)!.values()) {
    if (found.items < detector.min) continue;
    // Raw Markdown keeps emphasis (`_Requirements: 1.1_`), so the citation pattern decides what may precede the label.
    const citations = detector.citations ? new RegExp(fillTemplate(detector.citations, { keyword: escapeRegex(found.keyword) }), 'gu') : undefined;
    results.push({ kind: 'list-section', detector: detector.id, keyword: found.keyword, section: found.section, items: found.items, files: found.files.size,
      citations: citations ? Object.values(documents).reduce((n, text) => n + [...text.matchAll(citations)].length, 0) : 0, evidence: found.evidence });
  }
  for (const detector of paragraphs) {
    const found = paragraphFound.get(detector.id)!, count = Object.values(found.sections).reduce((n, value) => n + value, 0);
    if (count >= detector.min) results.push({ kind: 'paragraph-sections', detector: detector.id, count, files: found.files.size, sections: found.sections, evidence: found.evidence });
  }
  for (const detector of detectors) if (detector.kind === 'heading-sections') { const result = headingSections(detector, documents); if (result) results.push(result); }
  for (const detector of detectors) if (detector.kind === 'matching-lines') { const result = matchingLines(detector, documents); if (result) results.push(result); }
  return results;
}
/** Increment 97e: a line scan of the matching files, outside fences: list items and headings whose text, after an optional checkbox, matches. */
function matchingLines(detector: MatchingLinesDetector, documents: Record<string, string>): MatchingLinesResult | undefined {
  const globs = detector.files.map(glob), pattern = new RegExp(detector.pattern, 'u'), files = new Set<string>(), evidence: CandidateEvidence[] = [];
  let count = 0;
  for (const [file, text] of Object.entries(documents)) {
    if (!globs.some(item => item.test(file))) continue;
    let fenced = false, offset = 0;
    for (const line of text.split('\n')) {
      const start = offset; offset += line.length + 1;
      if (/^\s*(```|~~~)/u.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      const marker = /^(\s*(?:[-*+]|\d+[.)])\s+|#{1,6}\s+)(\[[ xX~-]\]\s+)?\**/u.exec(line);
      if (!marker || (detector.checkboxOnly && !marker[2] && !marker[1].trimStart().startsWith('#'))) continue;
      const match = pattern.exec(line.slice(marker[0].length));
      if (!match) continue;
      count++; files.add(file);
      const id = match[1] ?? match[0], at = start + marker[0].length + match.index + (match[1] ? match[0].indexOf(match[1]) : 0);
      if (evidence.length < 8) evidence.push({ id, file, offset: at, end: at + id.length, context: marker[0].trimStart().startsWith('#') ? 'heading' : 'mention' });
    }
  }
  return count >= detector.min ? { kind: 'matching-lines', detector: detector.id, count, files: files.size, folders: new Set([...files].map(file => file.slice(0, file.lastIndexOf('/')))).size, evidence, paths: [...files] } : undefined;
}
/** A line scan of the matching files, as Spec Kit task lists are flat: headings, fences, and checkbox items. */
function headingSections(detector: HeadingSectionsDetector, documents: Record<string, string>): HeadingSectionsResult | undefined {
  const globs = detector.files.map(glob), regexes = detector.headings.map(entry => ({ name: entry.name, regex: new RegExp(entry.pattern, 'iu') }));
  const counts = Object.fromEntries(detector.headings.map(entry => [entry.name, 0])) as Record<string, number>, files = new Set<string>(), ids = new Set<string>(), evidence: CandidateEvidence[] = [];
  for (const [file, text] of Object.entries(documents)) {
    if (!globs.some(pattern => pattern.test(file))) continue;
    let fenced = false, inSection = false, offset = 0;
    for (const line of text.split('\n')) {
      const start = offset; offset += line.length + 1;
      if (/^\s*(```|~~~)/u.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/u.exec(line);
      if (heading) {
        const value = heading[1].replace(/[*_`:\s]+$/u, '').replace(/^[*_`\s]+/u, '');
        const names = regexes.filter(item => item.regex.test(value)).map(item => item.name);
        inSection = names.length > 0;
        for (const name of names) counts[name]++;
        if (inSection) { files.add(file); if (evidence.length < 8) evidence.push({ id: value, file, offset: start, end: start + line.length, context: 'heading' }); }
        continue;
      }
      const item = inSection && /^\s*[-*+] \[[ xX]\] \**([A-Za-z][A-Za-z0-9_-]*\d)\b/u.exec(line);
      if (item && ids.size < 64) ids.add(item[1]);
    }
  }
  return Object.values(counts).some(count => count >= detector.min) && ids.size ? { kind: 'heading-sections', detector: detector.id, files: files.size, counts, ids: [...ids], evidence } : undefined;
}
/** The explanation of a proposal: its texts whose count is not zero, filled in. */
export const profileText = (parts: readonly ProfileText[], values: Record<string, string | number>) => parts.filter(part => !part.when || Number(values[part.when])).map(part => fillTemplate(part.text, values)).join('');
