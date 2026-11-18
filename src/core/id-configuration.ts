import { unknownField } from './configuration-fields';
import { validateFolderGeneration, type FolderGenerationConfiguration } from './folder-generators';
import { validateFeatureConfiguration, type FeatureConfiguration } from './features';
import { fileInScopes, pathsContain, validateCapturePattern, validateDefinitionPaths, validateExcludedPaths, validateIdScopes, type IdScopeRule } from './id-scopes';
import { DEFAULT_STATUS_SITES, validateStatusSites, type StatusSites } from './status-sites';
import { DEFAULT_ID_DEFINITION_SITES, hasNamedCapture, validateIdDefinitionSites, type IdDefinitionSites } from './definition-sites';
import { validateStatuses, type StatusPalette } from './statuses';
import { validateDateSettings, type DateSettings } from './dates';
import { validateLayers, type TraceLayer } from './layers';
import { validateModuleConfiguration, type ModuleConfiguration } from './module-configuration';
/** Data-only project conventions. Regex execution belongs in the analysis worker. */
/** `parent` (85a): keyword elements are identified within the nearest enclosing heading of that category. `derive` (85a): each Markdown file matching the pattern defines an element named by its capture. */
/**
 * 85b: `deltas` makes keyword elements under ADDED/MODIFIED/REMOVED/RENAMED sections change records; `nameReferences`
 * links backticked names to this category's elements; `changes` makes derived elements changes (Active, or Archived
 * inside the `archive` folder) and names the category of capabilities their proposals declare.
 * 90: `onlyInScopes` limits recognition to files inside the category's scopes; outside `definitionPaths`, its definition sites give references.
 */
export interface IdCategory { key: string; name: string; role?: 'requirement' | 'design' | 'task'; colors?: { light?: string; dark?: string }; idScopes?: IdScopeRule[]; onlyInScopes?: boolean; definitionPaths?: string[]; idDefinitionSites?: IdDefinitionSites; statusSites?: StatusSites; parent?: string; derive?: { pattern: string }; deltas?: boolean; nameReferences?: boolean; sectionTags?: SectionTag[]; changes?: { archive?: string; capabilities?: string }; numberedItems?: NumberedItems }
/** Increment 96d: items of ordered lists inside an element of `parent` (and under a `section` heading) define elements numbered by position: `{parent}` is the parent's last number, `{item}` the 1-based position. */
export interface NumberedItems { parent: string; section?: string; id: string }
/** Increment 96f: definitions of the category under an enclosing heading with this text get the tag, e.g. `bugfix:expected`.
 * 96g: or under a heading the `pattern` matches (ignoring case), with `{name}` in the tag taken from its named captures. */
export interface SectionTag { heading?: string; pattern?: string; tag: string }
export const MAX_SECTION_TAGS = 16;
export const DEFAULT_NUMBERED_ITEM_ID = '{parent}.{item}';
/** A labelled list (increment 82) turns each item after a label into a reference to the templated ID, e.g. `Requirements: 1.1, 2.3`. */
export interface IdListRule { label: string; item: string; id: string }
/** `id` (increment 89): a pattern rule's matches become references to the templated ID, e.g. `US1` refers to `User Story {n}`. */
/**
 * `defines` (increment 96e): a templated rule's matches define their templated ID at definition sites and are ignored elsewhere.
 * Increment 104: when its pattern starts with `^`, it runs only where its category can define: at the category's enabled
 * definition sites and inside its definition paths, so its bare numbers elsewhere neither match nor overlap other rules.
 */
export interface IdRule { key: string; category: string; prefix?: string; separator?: '-' | '_' | ''; pattern?: string; id?: string; defines?: boolean; list?: IdListRule; ignoreCase?: boolean }
/** Increment 97b-97d: providers this project turns off, or (97d) on where they do not apply; a provider in neither follows its applicability. */
export interface DiscoveryProviderSwitches { disabled?: string[]; enabled?: string[] }
export interface IdConfiguration extends ModuleConfiguration, FeatureConfiguration, FolderGenerationConfiguration { version: 1; idDefinitionSites?: IdDefinitionSites; statusSites?: StatusSites; statuses?: StatusPalette[]; dates?: DateSettings; categories: IdCategory[]; rules: IdRule[];
  /** Increment 97b: discovery providers this project turns off, or (97d) on, by profile id or (97c) discovery plugin id. */ discoveryProviders?: DiscoveryProviderSwitches;
  /** Increment 99a: paths left out of analysis (IDs, pending work, statuses, dates, discovery), still browsable and editable. */ excludedPaths?: string[];
  /** Increment 100b: ordered traceability layers for Focus and the Relationships list; without them, layers come from roles. */ layers?: TraceLayer[] }
/** Increment 99a: whether the configuration leaves a project file out of analysis. */
export function excludedFromAnalysis(file: string, configuration?: Pick<IdConfiguration, 'excludedPaths'>) {
  return !!configuration?.excludedPaths?.length && pathsContain(file, configuration.excludedPaths);
}
/** Increment 99a: the first excluded-path pattern that covers a file, for explanations. */
export function exclusionFor(file: string, configuration?: Pick<IdConfiguration, 'excludedPaths'>) {
  return configuration?.excludedPaths?.find(pattern => pathsContain(file, [pattern]));
}
/** Increment 99a: the documents that are analyzed, without those under excluded paths. */
export function analyzedDocuments<T>(documents: Record<string, T>, configuration?: Pick<IdConfiguration, 'excludedPaths'>): Record<string, T> {
  if (!configuration?.excludedPaths?.length) return documents;
  return Object.fromEntries(Object.entries(documents).filter(([file]) => !excludedFromAnalysis(file, configuration)));
}
/** Increment 97b: a profile file in .specular/profiles/, parsed but not yet validated, or why it could not be read. */
export interface ProjectProfileFile { file: string; profile?: unknown; error?: string }
export interface IdConfigurationState { configuration: IdConfiguration; revision: string; diskVersion: string; warning?: string; /** Increment 97b. */ profiles?: ProjectProfileFile[] }
export const CONFIG_PATH = '.specular/project.json';
export const LEGACY_PREFIXES = ['REQ', 'DD', 'TASK', 'Q', 'IP', 'PH', 'AT', 'US', 'STORY', 'SM', 'STATE'];
export const LEGACY_ID_CONFIGURATION: IdConfiguration = {
  version: 1,
  categories: LEGACY_PREFIXES.map(key => ({ key, name: key,
    ...({ REQ: { role: 'requirement' as const }, DD: { role: 'design' as const }, TASK: { role: 'task' as const } }[key] ?? {}) })),
  rules: LEGACY_PREFIXES.map(prefix => ({ key: prefix, category: prefix, prefix })),
};
/** A project without `.specular/project.json` starts with no categories or rules; its IDs come from configuration or discovery. */
export const EMPTY_ID_CONFIGURATION: IdConfiguration = { version: 1, categories: [], rules: [] };
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Rules whose whole match is the ID. Labelled-list and templated rules only reference IDs that other rules define. */
export const matchesIds = (rule: IdRule) => rule.list === undefined && rule.id === undefined;
export const DEFAULT_LIST_ITEM = '(?<number>\\d+)(?:\\.\\d+)?';
export function ruleRegex(rule: IdRule): RegExp {
  if (rule.list) throw new Error('Labelled-list rules have no ID pattern.');
  return new RegExp(rule.prefix !== undefined ? `\\b${escapeRegex(rule.prefix)}${escapeRegex(rule.separator ?? '-')}\\d+\\b` : rule.pattern!, rule.ignoreCase ? 'giu' : 'gu');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a configuration object.');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(unknownField('configuration', key, allowed));
}
function key(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) throw new Error('Keys must start with a letter and contain up to 64 letters, digits, underscores or hyphens.');
  return value;
}
/** Increment 97b: up to 32 provider ids, each once; 97d adds `enabled`, for providers turned on where they do not apply. The lists are disjoint. */
const providerSwitches = (switches: DiscoveryProviderSwitches) => Object.keys(switches).length ? { discoveryProviders: switches } : {};
function validateDiscoveryProviders(input: unknown): DiscoveryProviderSwitches {
  const value = object(input); fields(value, ['disabled', 'enabled']);
  const ids = (list: unknown, name: string) => {
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.length > 32 || list.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63})?$/u.test(id)) || new Set(list).size !== list.length) throw new Error(`discoveryProviders.${name} must list up to 32 distinct provider ids, such as spec-kit or the publisher.name of a discovery plugin.`);
    return [...list] as string[];
  };
  const disabled = ids(value.disabled, 'disabled'), enabled = ids(value.enabled, 'enabled');
  if (enabled.some(id => disabled.includes(id))) throw new Error('discoveryProviders: a provider cannot be both enabled and disabled.');
  return { ...(disabled.length ? { disabled } : {}), ...(enabled.length ? { enabled } : {}) };
}
export function validateIdConfiguration(input: unknown): IdConfiguration {
  const value = object(input); fields(value, ['folderGenerators', 'generatedFolders', 'idScopes', 'version', 'categories', 'rules', 'modules', 'moduleRules', 'moduleOverrides', 'features', 'featureRules', 'featureOverrides', 'statuses', 'idDefinitionSites', 'statusSites', 'dates', 'discoveryProviders', 'excludedPaths', 'layers']);
  if (value.version !== 1) throw new Error('Unsupported project configuration version; expected 1.');
  if (!Array.isArray(value.categories) || value.categories.length > 64 || !Array.isArray(value.rules) || value.rules.length > 64) throw new Error('Provide categories and rules arrays with at most 64 entries each.');
  // Normalize the initial global format into independent category settings on load.
  const legacyScopes = value.idScopes === undefined ? undefined : validateIdScopes(value.idScopes);
  const categories: IdCategory[] = value.categories.map((entry, index) => {
    const item = object(entry); fields(item, ['key', 'name', 'role', 'colors', 'idScopes', 'onlyInScopes', 'definitionPaths', 'idDefinitionSites', 'statusSites', 'parent', 'derive', 'deltas', 'nameReferences', 'changes', 'numberedItems', 'sectionTags']);
    for (const flag of ['deltas', 'nameReferences', 'onlyInScopes'] as const) if (item[flag] !== undefined && typeof item[flag] !== 'boolean') throw new Error(`Category ${index + 1}: ${flag} must be a boolean.`);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 128) throw new Error('Each category needs a name of 1–128 characters.');
    if (item.role !== undefined && !['requirement', 'design', 'task'].includes(String(item.role))) throw new Error('Category role must be requirement, design or task.');
    let colors: IdCategory['colors'];
    if (item.colors !== undefined) {
      const input = object(item.colors); fields(input, ['light', 'dark']); colors = {};
      for (const mode of ['light', 'dark'] as const) if (input[mode] !== undefined) {
        if (typeof input[mode] !== 'string' || !/^#[0-9a-f]{6}$/i.test(input[mode])) throw new Error(`Category ${index + 1}: ${mode} color must be a six-digit hex value such as #ffcc00.`);
        colors[mode] = input[mode].toLowerCase();
      }
    }
    const idScopes = item.idScopes === undefined && legacyScopes === undefined ? undefined : validateIdScopes(item.idScopes === undefined ? legacyScopes : item.idScopes);
    if (item.onlyInScopes && !idScopes?.some(rule => rule.enabled !== false)) throw new Error(`Category ${index + 1}: recognizing only inside scopes needs at least one enabled scope pattern.`);
    let definitionPaths: string[] | undefined;
    if (item.definitionPaths !== undefined) try { definitionPaths = validateDefinitionPaths(item.definitionPaths); } catch (error) { throw new Error(`Category ${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
    return { key: key(item.key), name: item.name.trim(), ...(item.role ? { role: item.role as IdCategory['role'] } : {}), ...(colors ? { colors } : {}),
      ...(idScopes === undefined ? {} : { idScopes }), ...(item.onlyInScopes ? { onlyInScopes: true } : {}), ...(definitionPaths ? { definitionPaths } : {}),
      ...(item.idDefinitionSites === undefined ? {} : { idDefinitionSites: validateIdDefinitionSites(item.idDefinitionSites) }),
      ...(item.statusSites === undefined ? {} : { statusSites: validateStatusSites(item.statusSites) }),
      ...(item.parent === undefined ? {} : { parent: key(item.parent) }),
      ...(item.derive === undefined ? {} : { derive: { pattern: validateCapturePattern((fields(object(item.derive), ['pattern']), object(item.derive).pattern)) } }),
      ...(item.deltas ? { deltas: true } : {}), ...(item.nameReferences ? { nameReferences: true } : {}),
      ...(item.changes === undefined ? {} : { changes: validateChanges(item.changes, index + 1) }),
      ...(item.numberedItems === undefined ? {} : { numberedItems: validateNumberedItems(item.numberedItems, index + 1) }),
      ...(item.sectionTags === undefined ? {} : { sectionTags: validateSectionTags(item.sectionTags, index + 1) }) };
  });
  if (new Set(categories.map(item => item.key)).size !== categories.length) throw new Error('Category keys must be unique.');
  for (const category of categories) {
    if (category.changes && !category.derive) throw new Error(`Category ${category.name}: changes are derived elements; add a derive pattern such as openspec/changes/**/{change}/proposal.md.`);
    if (category.changes?.capabilities !== undefined && !categories.some(item => item.key === category.changes!.capabilities && item !== category)) throw new Error(`Category ${category.name} names an unknown capability category.`);
    if (category.numberedItems && !categories.some(item => item.key === category.numberedItems!.parent && item !== category)) throw new Error(`Category ${category.name}: numbered list items need another category as their parent, such as the requirements whose acceptance criteria they number.`);
  }
  for (const category of categories) if (category.parent !== undefined) {
    const seen = new Set([category.key]);
    for (let parent: string | undefined = category.parent; parent !== undefined; parent = categories.find(item => item.key === parent)!.parent) {
      if (!categories.some(item => item.key === parent)) throw new Error(`Category ${category.name} names an unknown parent category.`);
      if (seen.has(parent)) throw new Error(`Category ${category.name} has a cyclic parent category.`);
      seen.add(parent);
    }
  }
  const rules: IdRule[] = value.rules.map((entry, index) => {
    const item = object(entry); fields(item, ['key', 'category', 'prefix', 'separator', 'pattern', 'id', 'defines', 'list', 'ignoreCase']);
    const rule: IdRule = { key: key(item.key), category: key(item.category) };
    if (!categories.some(category => category.key === rule.category)) throw new Error(`Rule ${index + 1} names an unknown category.`);
    if ([item.prefix, item.pattern, item.list].filter(value => value !== undefined).length !== 1) throw new Error(`Rule ${index + 1} needs exactly one prefix, pattern, or labelled list.`);
    if (item.id !== undefined && item.pattern === undefined) throw new Error(`Rule ${index + 1}: an ID template applies only to regex pattern rules.`);
    if (item.defines !== undefined && (typeof item.defines !== 'boolean' || (item.defines && item.id === undefined))) throw new Error(`Rule ${index + 1}: defines applies only to regex pattern rules with an ID template.`);
    if (item.list !== undefined) {
      if (item.separator !== undefined) throw new Error('Separator applies only to prefix rules.');
      rule.list = validateListRule(item.list, index + 1);
    } else if (item.prefix !== undefined) {
      if (typeof item.prefix !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.prefix)) throw new Error(`Rule ${index + 1}: use a simple letter-led prefix, or an advanced pattern.`);
      rule.prefix = item.prefix;
      if (item.separator !== undefined) {
        if (!['-', '_', ''].includes(item.separator as string)) throw new Error('Separator must be a hyphen, underscore, or empty string.');
        rule.separator = item.separator as IdRule['separator'];
      }
    } else {
      if (item.separator !== undefined) throw new Error('Separator applies only to prefix rules.');
      if (typeof item.pattern !== 'string' || !item.pattern || item.pattern.length > 512) throw new Error(`Rule ${index + 1}: pattern must contain 1–512 characters.`);
      rule.pattern = item.pattern;
      if (item.id !== undefined) rule.id = validateTemplate(item.id, item.pattern, index + 1, 'pattern', 'User Story {n}');
      if (item.defines) rule.defines = true;
    }
    if (item.ignoreCase !== undefined && typeof item.ignoreCase !== 'boolean') throw new Error('ignoreCase must be a boolean.');
    if (item.ignoreCase !== undefined) rule.ignoreCase = item.ignoreCase;
    if (!rule.list) try { ruleRegex(rule); } catch { throw new Error(`Rule ${index + 1} has an invalid Unicode regular expression.`); }
    return rule;
  });
  if (new Set(rules.map(item => item.key)).size !== rules.length) throw new Error('Rule keys must be unique.');
  if (value.idDefinitionSites !== undefined && object(object(value.idDefinitionSites).headings).mode === 'keyword') throw new Error('Keyword headings are configured per category.');
  const configuration: IdConfiguration = { version: 1, categories, rules, ...(value.statusSites === undefined ? {} : { statusSites: validateStatusSites(value.statusSites) }), ...(value.idDefinitionSites === undefined ? {} : { idDefinitionSites: validateIdDefinitionSites(value.idDefinitionSites) }), ...validateModuleConfiguration(value), ...validateFeatureConfiguration(value), ...(value.statuses === undefined ? {} : { statuses: validateStatuses(value.statuses) }), ...(value.dates === undefined ? {} : { dates: validateDateSettings(value.dates) }), ...(value.discoveryProviders === undefined ? {} : providerSwitches(validateDiscoveryProviders(value.discoveryProviders))), ...(value.excludedPaths === undefined ? {} : { excludedPaths: validateExcludedPaths(value.excludedPaths) }), ...(value.layers === undefined ? {} : { layers: validateLayers(value.layers, categories.map(item => item.key)) }) };
  return { ...configuration, ...validateFolderGeneration(value, configuration) };
}

/** `listed` marks a labelled-list item or templated match: its source text (index..end) is not the ID, and it is only ever a reference.
 * `defines` (96e): a templated match of a defining rule, offered only to definition sites; `text` is its source text. */
export interface IdMatch { id: string; index: number; end: number; rule: string; category: IdCategory; listed?: true; defines?: true; text?: string }
/** Increment 104: the definition site a text region is read at, if any; anchored defining rules run only at their categories' enabled sites. */
export type DefinitionSiteKind = 'headings' | 'tables' | 'lists' | 'paragraphs';
export type IdMatcher = ((text: string, site?: DefinitionSiteKind) => IdMatch[]) & {
  definitionSites?: IdDefinitionSites;
  definitionSitesByCategory?: Map<string, IdDefinitionSites>;
  categories?: Map<string, IdCategory>;
  statusSites?: StatusSites;
  statusSitesByCategory?: Map<string, StatusSites>;
  statuses?: StatusPalette[];
  /** Increment 90: the matcher for one file, without the rules of categories recognized only inside scopes that exclude it. */
  forFile?: (file: string) => IdMatcher;
};
/** Synchronous by design: only execute custom matchers in a terminable worker. */
export function compileIdMatcher(configuration: IdConfiguration = LEGACY_ID_CONFIGURATION): IdMatcher {
  const validated = validateIdConfiguration(configuration);
  const categories = new Map(validated.categories.map(category => [category.key, category]));
  const numbered = validated.rules.map((rule, index) => ({ ...rule, number: index + 1 }));
  const inheritedSites = validated.idDefinitionSites ?? DEFAULT_ID_DEFINITION_SITES;
  const sitesOf = (category: string) => categories.get(category)?.idDefinitionSites ?? inheritedSites;
  // 104: anchored defining rules, with the sites where their category defines.
  const compiledRules = numbered.filter(rule => !rule.list).map(rule => ({ ...rule, regex: ruleRegex(rule),
    ...(rule.defines && rule.pattern?.startsWith('^') ? { sites: new Set((['headings', 'tables', 'lists', 'paragraphs'] as const).filter(site => sitesOf(rule.category)[site]?.enabled)) } : {}) }));
  const compiledLists = numbered.filter(rule => rule.list).map(rule => ({ ...rule, ...compileListRule(rule.list!, rule.ignoreCase, rule.number) }));
  const ruleNumbers = new Map(numbered.map(rule => [rule.key, rule.number]));
  for (const rule of compiledRules) if (rule.regex.test('')) throw new Error(`Rule ${rule.number} matches empty text. IDs must be nonempty.`);
  const matcherFor = (rules: typeof compiledRules, lists: typeof compiledLists): IdMatcher => (text, site) => {
    if (text.length > 2 * 1024 * 1024) throw new Error('ID recognition input exceeds 2 MB.');
    const found: IdMatch[] = [];
    for (const rule of rules) {
      if (rule.sites && (!site || !rule.sites.has(site))) continue;
      rule.regex.lastIndex = 0;
      for (const match of text.matchAll(rule.regex)) {
        if (!match[0].length) throw new Error(`Rule ${rule.number} matches empty text at offset ${match.index}.`);
        if (found.length >= 50000) throw new Error('ID recognition exceeds 50,000 matches in one text region.');
        const at = { index: match.index!, end: match.index! + match[0].length, rule: rule.key, category: categories.get(rule.category)! };
        found.push(rule.id === undefined ? { id: match[0], ...at } : { id: fillTemplate(rule.id, match.groups ?? {}), ...at, listed: true, ...(rule.defines ? { defines: true as const, text: match[0] } : {}) });
      }
    }
    for (const rule of lists) for (const item of rule.items(text)) {
      if (found.length >= 50000) throw new Error('ID recognition exceeds 50,000 matches in one text region.');
      found.push({ ...item, rule: rule.key, category: categories.get(rule.category)!, listed: true });
    }
    found.sort((a, b) => a.index - b.index || a.end - b.end);
    for (let i = 1; i < found.length; i++) if (found[i].index < found[i - 1].end) {
      throw new Error(`Rules ${ruleNumbers.get(found[i - 1].rule)} and ${ruleNumbers.get(found[i].rule)} overlap on ${JSON.stringify(found[i].id)} at offset ${found[i].index}. Adjust the rules; recognition is incomplete.`);
    }
    return found;
  };
  const matcher = matcherFor(compiledRules, compiledLists);
  const limited = validated.categories.filter(category => category.onlyInScopes);
  // 104: anchored defining rules of categories that define only in some paths.
  const pathBound = compiledRules.filter(rule => rule.sites && categories.get(rule.category)?.definitionPaths);
  if (limited.length || pathBound.length) matcher.forFile = file => {
    // Overlaps are checked only among the rules that run in the file.
    const excluded = new Set(limited.filter(category => !fileInScopes(file, category.idScopes)).map(category => category.key));
    const outside = new Set(pathBound.filter(rule => !pathsContain(file, categories.get(rule.category)!.definitionPaths!)).map(rule => rule.key));
    if (!excluded.size && !outside.size) return matcher;
    const runs = <T extends { category: string; key: string }>(rule: T) => !excluded.has(rule.category) && !outside.has(rule.key);
    return Object.assign(matcherFor(compiledRules.filter(runs), compiledLists.filter(runs)), matcher, { forFile: undefined });
  };
  matcher.definitionSites = validated.idDefinitionSites;
  matcher.categories = categories;
  matcher.definitionSitesByCategory = new Map(validated.categories.map(category => [category.key, category.idDefinitionSites ?? inheritedSites]));
  matcher.statusSites = validated.statusSites;
  const inheritedStatusSites = validated.statusSites ?? DEFAULT_STATUS_SITES;
  matcher.statusSitesByCategory = new Map(validated.categories.map(category => [category.key, category.statusSites ?? inheritedStatusSites]));
  matcher.statuses = validated.statuses;
  return matcher;
}

const LIST_SEPARATOR = /[ \t]*(?:,[ \t]*(?:and[ \t]+)?|[ \t]+and[ \t]+|&|[-\u2013])[ \t]*/uy;
function validateChanges(input: unknown, number: number): NonNullable<IdCategory['changes']> {
  const value = object(input); fields(value, ['archive', 'capabilities']);
  if (value.archive !== undefined && (typeof value.archive !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.archive))) throw new Error(`Category ${number}: the archive folder must be one folder name, such as archive.`);
  return { ...(value.archive === undefined ? {} : { archive: value.archive as string }), ...(value.capabilities === undefined ? {} : { capabilities: key(value.capabilities) }) };
}
function validateNumberedItems(input: unknown, number: number): NumberedItems {
  const value = object(input); fields(value, ['parent', 'section', 'id']);
  if (value.section !== undefined && (typeof value.section !== 'string' || !value.section.trim() || value.section.length > 128 || /[\r\n]/.test(value.section))) throw new Error(`Category ${number}: the numbered-items section must be a heading text of 1-128 characters, such as Acceptance Criteria.`);
  const id = value.id === undefined ? DEFAULT_NUMBERED_ITEM_ID : value.id;
  if (typeof id !== 'string' || !id.trim() || id.length > 128 || /[\r\n]/.test(id) ||!id.includes('{item}') || placeholders(id).some(name => name !== 'parent' && name !== 'item')) throw new Error(`Category ${number}: the numbered-items ID template needs {item} and may use {parent}, such as Criterion {parent}.{item}.`);
  return { parent: key(value.parent), ...(value.section === undefined ? {} : { section: (value.section as string).trim() }), id };
}
/** Heading text as section tags (96f-96g) see it: no surrounding emphasis, trailing colon, or repeated spaces. */
export const sectionHeadingDisplay = (value: string) => value.replace(/[*_`:\s]+$/u, '').replace(/^[*_`\s]+/u, '').replace(/\s+/gu, ' ');
/** Heading text as exact section tags (96f) and numbered-item sections (96d) compare it, also ignoring case. */
export const sectionHeadingText = (value: string) => sectionHeadingDisplay(value).toLocaleLowerCase();
export const SECTION_TAG = /^[a-z0-9:_-]{1,64}$/u;
/** Increment 96g: the tag of a pattern entry for one heading, or undefined when the heading does not match; captured values are lowercased and other characters become hyphens. */
export function sectionPatternTag(entry: SectionTag, regex: RegExp, heading: string): string | undefined {
  const match = regex.exec(heading);
  if (!match) return undefined;
  return entry.tag.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_all, name: string) => (match.groups?.[name] ?? '').toLocaleLowerCase().replace(/[^a-z0-9:_-]+/gu, '-').replace(/^-+|-+$/gu, ''));
}
export const sectionTagRegex = (entry: SectionTag) => new RegExp(entry.pattern!, 'iu');
/** Increment 96h: what makes two entries the same, so merged tags skip the entries a category already has. */
export const sectionTagKey = (entry: SectionTag) => entry.heading !== undefined ? 'heading:' + sectionHeadingText(entry.heading) : 'pattern:' + entry.pattern;
/** Increment 96h: the entries of `proposed` that `current` lacks. */
export const newSectionTags = (current: readonly SectionTag[] | undefined, proposed: readonly SectionTag[] | undefined) => { const have = new Set((current ?? []).map(sectionTagKey)); return (proposed ?? []).filter(entry => !have.has(sectionTagKey(entry))); };
function validateSectionTags(input: unknown, number: number): SectionTag[] {
  if (!Array.isArray(input) || input.length > MAX_SECTION_TAGS) throw new Error(`Category ${number}: section tags must be a list of at most ${MAX_SECTION_TAGS} entries.`);
  const tags = input.map((entry, index) => {
    const value = object(entry); fields(value, ['heading', 'pattern', 'tag']);
    if ((value.heading === undefined) === (value.pattern === undefined)) throw new Error(`Category ${number}: section tag ${index + 1} needs either a heading text or a pattern.`);
    if (value.heading !== undefined) {
      if (typeof value.heading !== 'string' || !value.heading.trim() || value.heading.length > 128 || /[\r\n]/.test(value.heading)) throw new Error(`Category ${number}: a section tag needs a heading text of 1-128 characters, such as Expected Behavior (Correct).`);
      if (typeof value.tag !== 'string' || !SECTION_TAG.test(value.tag)) throw new Error(`Category ${number}: tags use up to 64 lowercase letters, digits, colons, underscores, or hyphens, such as bugfix:expected.`);
      return { heading: value.heading.trim(), tag: value.tag };
    }
    if (typeof value.pattern !== 'string' || !value.pattern || value.pattern.length > 512) throw new Error(`Category ${number}: a section tag pattern must contain 1-512 characters.`);
    try { new RegExp(value.pattern, 'iu'); } catch { throw new Error(`Category ${number}: section tag pattern ${index + 1} is not a valid Unicode regular expression.`); }
    // A pattern's tag may name its captures, such as priority:{priority}.
    const literal = typeof value.tag === 'string' ? value.tag.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, '') : '';
    if (typeof value.tag !== 'string' || !value.tag || value.tag.length > 128 || !/^[a-z0-9:_-]*$/u.test(literal) || (literal === value.tag && !SECTION_TAG.test(value.tag))) throw new Error(`Category ${number}: a pattern's tag uses lowercase letters, digits, colons, underscores, hyphens, and {captures}, such as priority:{priority}.`);
    for (const name of placeholders(value.tag)) if (!hasNamedCapture(value.pattern, name)) throw new Error(`Category ${number}: the tag uses {${name}}, which section tag pattern ${index + 1} does not capture.`);
    return { pattern: value.pattern, tag: value.tag };
  });
  const keys = tags.map(sectionTagKey);
  if (new Set(keys).size !== tags.length) throw new Error(`Category ${number}: each section tag heading or pattern may appear once.`);
  return tags;
}
function placeholders(template: string) { return [...template.matchAll(/\{([^{}]*)\}/gu)].map(match => match[1]); }
function validateListRule(input: unknown, number: number): IdListRule {
  const value = object(input); fields(value, ['label', 'item', 'id']);
  const text = (field: unknown, name: string, max: number) => {
    if (typeof field !== 'string' || !field || field.length > max || /[\r\n\u0000]/.test(field)) throw new Error(`Rule ${number}: list ${name} must contain 1-${max} characters on one line.`);
    return field;
  };
  const list = { label: text(value.label, 'label', 512), item: value.item === undefined ? DEFAULT_LIST_ITEM : text(value.item, 'item pattern', 512), id: text(value.id, 'ID template', 128) };
  for (const [name, pattern] of [['label', list.label], ['item pattern', list.item]] as const) {
    try { new RegExp(pattern, 'gu'); } catch { throw new Error(`Rule ${number}: list ${name} is an invalid Unicode regular expression.`); }
    if (new RegExp(pattern, 'u').test('')) throw new Error(`Rule ${number}: list ${name} matches empty text.`);
  }
  if (!hasNamedCapture(list.item, 'number')) throw new Error(`Rule ${number}: list item pattern needs a named (?<number>...) capture.`);
  validateTemplate(list.id, list.item, number, 'item pattern', 'Requirement {number}');
  return list;
}
/** Placeholders are `{name}`, `{name:int}` (drop leading zeros), or `{name:0N}` (drop them, then pad to N digits). */
function validateTemplate(template: unknown, pattern: string, number: number, source: string, example: string) {
  if (typeof template !== 'string' || !template || template.length > 128 || /[\r\n\u0000]/.test(template)) throw new Error(`Rule ${number}: the ID template must contain 1-128 characters on one line.`);
  const names = placeholders(template);
  if (!names.length || /\{|\}/.test(template.replace(/\{[^{}]*\}/gu, ''))) throw new Error(`Rule ${number}: the ID template needs {placeholders} such as ${example}.`);
  for (const placeholder of names) {
    const [name, format, ...rest] = placeholder.split(':');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !hasNamedCapture(pattern, name)) throw new Error(`Rule ${number}: the ID template uses {${name}}, which the ${source} does not capture.`);
    if (format !== undefined && (rest.length || !/^(?:int|0[1-9])$/.test(format))) throw new Error(`Rule ${number}: the ID template format in {${placeholder}} is unknown; use :int, or a padding such as :03.`);
  }
  return template;
}
function fillTemplate(template: string, groups: Record<string, string | undefined>) {
  return template.replace(/\{([^{}]*)\}/gu, (_all, placeholder: string) => {
    const [name, format] = placeholder.split(':'), value = groups[name] ?? '';
    if (!format || !/^\d+$/.test(value)) return value;
    const number = value.replace(/^0+(?=\d)/u, '');
    return format === 'int' ? number : number.padStart(Number(format.slice(1)), '0');
  });
}
/** Read the items following each label: `Requirements: 1.1, 2.3 and 4` gives three items; a range `3.4-3.10` gives two. */
function compileListRule(list: IdListRule, ignoreCase: boolean | undefined, number: number) {
  const flags = ignoreCase ? 'iu' : 'u', label = new RegExp(list.label, 'g' + flags), item = new RegExp(list.item, 'y' + flags);
  const separator = new RegExp(LIST_SEPARATOR.source, 'y' + (ignoreCase ? 'iu' : 'u')), space = /[ \t]*/uy, word = /[\p{L}\p{N}_]/u;
  return { items(text: string) {
    const found: { id: string; index: number; end: number }[] = [];
    label.lastIndex = 0;
    for (const head of text.matchAll(label)) {
      if (!head[0].length) throw new Error(`Rule ${number}: list label matches empty text at offset ${head.index}.`);
      space.lastIndex = head.index! + head[0].length; space.exec(text);
      let at = space.lastIndex;
      for (;;) {
        item.lastIndex = at; const match = item.exec(text);
        if (!match || !match[0].length || word.test(text[at + match[0].length] ?? '')) break;
        found.push({ id: fillTemplate(list.id, match.groups ?? {}), index: at, end: at + match[0].length });
        if (found.length > 50000) throw new Error('ID recognition exceeds 50,000 matches in one text region.');
        separator.lastIndex = at + match[0].length; if (!separator.exec(text)) break;
        at = separator.lastIndex;
      }
    }
    return found;
  } };
}
