import { idKey, idLabel } from './id-identity';
import { scopeForFile, validScopePath, validateFolderPatterns } from './id-scopes';
import type { IdConfiguration } from './id-configuration';
import type { Occurrence, ProjectIndex } from '../shared/types';
import type { SpecFolderCandidate } from './id-discovery';

export type GeneratorTarget = 'features' | 'modules';
export interface FolderGenerator { key: string; target: GeneratorTarget; pattern: string; exclusions: string[] }
export interface FolderProvenance { generator: string; target: GeneratorTarget; folder: string }
/** A saved mapping is a snapshot, so editing a generator never silently changes assignments. */
export interface GeneratedFolderMapping extends FolderProvenance { entry: string; pattern: string; exclusions: string[] }
export interface FolderGenerationConfiguration { folderGenerators?: FolderGenerator[]; generatedFolders?: GeneratedFolderMapping[] }
export interface GeneratedMember { key: string; label: string; state: 'assigned' | 'override' | 'conflict'; sources: string[] }
export interface GeneratedFolder {
  provenance: FolderProvenance; name: string; pattern: string; files: number; members: GeneratedMember[];
  issues: string[]; blocked?: boolean; change: 'new' | 'existing' | 'retained';
}
export interface FolderPreview { entries: GeneratedFolder[]; notices: string[] }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const provenanceKey = (p: FolderProvenance) => JSON.stringify([p.target, p.generator, p.folder]);
/** Increment 96a: specification file names; a folder holding one directly is a specification folder. */
export const SPEC_FILES = new Set(['spec.md', 'requirements.md', 'bugfix.md', 'design.md', 'tasks.md', 'plan.md', 'proposal.md']);
export const isSpecFile = (file: string) => SPEC_FILES.has(file.slice(file.lastIndexOf('/') + 1).toLowerCase());
/** `<root>/**` derives one entry per specification folder at any depth (96a); `<root>/*` one per child folder. */
export const deepPattern = (pattern: string) => pattern.endsWith('/**');
export const patternRoot = (pattern: string) => pattern.slice(0, deepPattern(pattern) ? -3 : -2);
/** Increment 96a: the folders under `root` that directly hold a specification file and are not inside another one. */
export function specificationFolders(root: string, files: readonly string[]) {
  const folders = new Set<string>();
  for (const file of files) if (file.startsWith(root + '/') && isSpecFile(file)) { const folder = file.slice(0, file.lastIndexOf('/')); if (folder !== root) folders.add(folder); }
  return [...folders].filter(folder => ![...folders].some(other => folder.startsWith(other + '/'))).sort(compare);
}
function validatePatterns(patterns: { pattern: string }[]) {
  // A `**` pattern shares the root syntax and the overlap rule of `*` patterns, so it is checked as its `*` form.
  const checked = patterns.map(({ pattern }) => ({ pattern: typeof pattern === 'string' && deepPattern(pattern) ? pattern.slice(0, -1) : pattern }));
  const roots = checked.map(({ pattern }) => typeof pattern === 'string' ? pattern.slice(0, -2).toLowerCase() : '');
  if (patterns.some(({ pattern }, i) => pattern !== checked[i].pattern) && roots.some((root, i) => roots.some((other, j) => j !== i && root && (root === other || root.startsWith(other + '/'))))) throw new Error('Folder generator roots must not overlap, including disabled patterns.');
  try { validateFolderPatterns(checked); }
  catch (error) {
    let message = (error instanceof Error ? error.message : String(error)).replace(/ID scopes/g, 'Folder generators').replace(/ID scope/g, 'Folder generator');
    patterns.forEach(({ pattern }, i) => { if (pattern !== checked[i].pattern) message = message.split(`"${checked[i].pattern}"`).join(`"${pattern}"`); });
    throw new Error(message.replace('ending in exactly one child wildcard', 'ending in one child wildcard (/*) or any-depth specification folders (/**)'));
  }
}

export function validateFolderGenerators(value: unknown): FolderGenerator[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('Provide at most 32 folder generators per dimension.');
  const result: FolderGenerator[] = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['key', 'target', 'pattern', 'exclusions'].includes(key)) ||
      typeof item.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.key) || !['features', 'modules'].includes(item.target)) throw new Error('Invalid folder generator.');
    validatePatterns([{ pattern: item.pattern }]);
    const base = patternRoot(item.pattern);
    if (!Array.isArray(item.exclusions) || item.exclusions.length > 64 || item.exclusions.some((path: unknown) => !validScopePath(path) || !path.startsWith(base + '/'))) throw new Error('Exclusions must be project-relative descendant folders of the generating pattern (at most 64).');
    if (new Set(item.exclusions.map((path: string) => path.toLowerCase())).size !== item.exclusions.length) throw new Error('Folder exclusions must be unique.');
    return { key: item.key, target: item.target, pattern: item.pattern, exclusions: [...item.exclusions].sort(compare) };
  });
  if (new Set(result.map(item => item.key)).size !== result.length) throw new Error('Folder generator keys must be unique.');
  for (const target of ['features', 'modules']) {
    const rules = result.filter(item => item.target === target);
    if (rules.length > 32) throw new Error('Provide at most 32 folder generators per dimension.');
    validatePatterns(rules.map(item => ({ pattern: item.pattern })));
  }
  return result;
}

export function validateFolderGeneration(input: Record<string, unknown>, configuration: IdConfiguration): FolderGenerationConfiguration {
  const result: FolderGenerationConfiguration = {};
  if (input.folderGenerators !== undefined) result.folderGenerators = validateFolderGenerators(input.folderGenerators);
  if (input.generatedFolders !== undefined) {
    if (!Array.isArray(input.generatedFolders) || input.generatedFolders.length > 128) throw new Error('Provide at most 128 generated folder mappings.');
    result.generatedFolders = input.generatedFolders.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['generator', 'target', 'folder', 'entry', 'pattern', 'exclusions'].includes(key))) throw new Error('Invalid generated folder mapping.');
      const [rule] = validateFolderGenerators([{ key: item.generator, target: item.target, pattern: item.pattern, exclusions: item.exclusions }]);
      const inside = deepPattern(rule.pattern) ? item.folder.startsWith(patternRoot(rule.pattern) + '/') : scopeForFile(item.folder + '/example.md', [{ pattern: rule.pattern }]) === item.folder;
      if (!validScopePath(item.folder) || !inside ||
        typeof item.entry !== 'string' || !configuration[rule.target]?.some(entry => entry.key === item.entry)) throw new Error('Generated mappings need an existing entry and an immediate child folder of their saved pattern.');
      const manual = rule.target === 'features' ? configuration.featureRules?.some(entry => entry.features.includes(item.entry)) : configuration.moduleRules?.some(entry => entry.modules.includes(item.entry));
      if (manual) throw new Error('Generated entries obtain file mappings from their generator; manual file rules must target explicit entries.');
      const generator = result.folderGenerators?.find(entry => entry.key === rule.key);
      if (generator && generator.target !== rule.target) throw new Error('A generated mapping cannot change its generator dimension.');
      return { generator: rule.key, target: rule.target, folder: item.folder, entry: item.entry, pattern: rule.pattern, exclusions: rule.exclusions };
    });
    if (new Set(result.generatedFolders.map(provenanceKey)).size !== result.generatedFolders.length || new Set(result.generatedFolders.map(item => JSON.stringify([item.target, item.entry]))).size !== result.generatedFolders.length) throw new Error('Generated provenance and entry mappings must be unique.');
  }
  return result;
}

export function generatedMappingsForFile(config: FolderGenerationConfiguration, target: GeneratorTarget, file: string) {
  if (!validScopePath(file)) return [];
  return (config.generatedFolders ?? []).filter(mapping => mapping.target === target && file.startsWith(mapping.folder + '/') && !mapping.exclusions.some(folder => file.toLowerCase().startsWith(folder.toLowerCase() + '/')));
}

export function generatedFolderHistory(configuration: IdConfiguration, target: GeneratorTarget): GeneratedFolder[] {
  return (configuration.generatedFolders ?? []).filter(mapping => mapping.target === target).map(mapping => ({
    provenance: { generator: mapping.generator, target, folder: mapping.folder }, pattern: mapping.pattern,
    name: configuration[target]!.find(entry => entry.key === mapping.entry)!.name,
    files: 0, members: [], issues: [], change: 'existing',
  }));
}

/** Pure, bounded reconciliation. Only scanner-supplied Markdown and definition evidence participate.
 * Previous entries are review history, never an instruction to delete or rename a configured entry. */
export function previewFolderGenerators(input: readonly FolderGenerator[], files: readonly string[], index: ProjectIndex,
  configuration: IdConfiguration, previous: readonly GeneratedFolder[] = []): FolderPreview {
  const generators = validateFolderGenerators(input);
  if (files.length > 10000 || index.definitions.length > 50000 || previous.length > 128) throw new Error('Folder preview exceeds its file, definition or previous-entry limit. Narrow the project scope.');
  const documents = [...new Set(files.filter(file => validScopePath(file) && /\.(md|markdown)$/i.test(file)))].sort(compare);
  const allowed = new Set(documents), definitions = new Map<string, Occurrence[]>();
  for (const definition of index.definitions) {
    if (!allowed.has(definition.file)) throw new Error('Folder preview has stale or excluded definition sources. Refresh and preview again.');
    const key = idKey(definition), group = definitions.get(key) ?? []; group.push(definition); definitions.set(key, group);
  }
  const prior = new Map(previous.map(entry => [provenanceKey(entry.provenance), entry]));
  const entries: GeneratedFolder[] = [], notices: string[] = [];
  const manualSignatures = new Map<string, string>();
  let evidenceCount = 0;
  for (const generator of generators) {
    const specs = deepPattern(generator.pattern) ? specificationFolders(patternRoot(generator.pattern), documents) : undefined;
    const match = (file: string) => generator.exclusions.some(path => file.toLowerCase().startsWith(path.toLowerCase() + '/')) ? undefined
      : specs ? specs.find(folder => file.startsWith(folder + '/')) : scopeForFile(file, [{ pattern: generator.pattern }]);
    const folders = new Map<string, string[]>();
    for (const file of documents) {
      const folder = match(file); if (!folder) continue;
      const contents = folders.get(folder) ?? []; contents.push(file); folders.set(folder, contents);
    }
    const members = new Map<string, GeneratedMember[]>();
    const overrides = new Set((generator.target === 'features' ? configuration.featureOverrides : configuration.moduleOverrides)?.map(idKey));
    for (const [key, group] of definitions) {
      const destinations = new Set(group.map(item => match(item.file)));
      const manualConflict = new Set(group.map(item => {
        const cacheKey = JSON.stringify([generator.target, item.file]);
        let signature = manualSignatures.get(cacheKey);
        if (signature === undefined) {
          const rules = generator.target === 'features' ? configuration.featureRules ?? [] : configuration.moduleRules ?? [];
          signature = JSON.stringify([...new Set(rules.filter(rule => rule.scope === 'file' ? item.file === rule.path : rule.path === '.' || item.file.startsWith(rule.path + '/')).flatMap(rule => 'features' in rule ? rule.features : rule.modules))].sort(compare));
          manualSignatures.set(cacheKey, signature);
        }
        return signature;
      })).size > 1;
      const state = overrides.has(key) ? 'override' : destinations.size > 1 || manualConflict ? 'conflict' : 'assigned';
      for (const folder of destinations) {
        if (!folder) continue;
        const sources = group.map(item => `${item.file}:${item.line}`).sort(compare);
        evidenceCount += sources.length;
        if (evidenceCount > 20000) throw new Error('Folder preview exceeds 20,000 membership evidence entries. Narrow the project scope.');
        const list = members.get(folder) ?? []; list.push({ key, label: idLabel(group[0]), state, sources }); members.set(folder, list);
      }
    }
    for (const [folder, contents] of folders) {
      const provenance = { generator: generator.key, target: generator.target, folder }, old = prior.get(provenanceKey(provenance));
      const name = old?.name ?? folder.slice(folder.lastIndexOf('/') + 1);
      const issues: string[] = [];
      if (name.length > 128) issues.push('Folder name exceeds the 128-character display-name limit.');
      entries.push({ provenance, pattern: generator.pattern, name, files: contents.length, ...(issues.length ? { blocked: true } : {}),
        members: (members.get(folder) ?? []).sort((a, b) => compare(a.key, b.key)), issues, change: old ? 'existing' : 'new' });
      if (entries.length > 128) throw new Error('Folder preview exceeds 128 entries. Narrow the patterns.');
    }
  }
  const current = new Set(entries.map(entry => provenanceKey(entry.provenance)));
  for (const old of previous) if (!current.has(provenanceKey(old.provenance))) {
    entries.push({ ...structuredClone(old), change: 'retained', members: [], files: 0,
      issues: ['Folder or generator no longer matches. Retain for explicit review; a rename is treated as removal plus addition.'] });
  }
  for (const target of ['features', 'modules'] as const) {
    const generated = new Set(configuration.generatedFolders?.filter(mapping => mapping.target === target).map(mapping => mapping.entry));
    const selected = entries.filter(entry => entry.provenance.target === target), manual = (configuration[target] ?? []).filter(entry => !generated.has(entry.key));
    if (selected.length + manual.length > 64) throw new Error(`Folder preview exceeds the 64 ${target} limit, including retained and manual entries.`);
    for (const entry of selected) {
      const name = entry.name.trim().toLowerCase();
      if (manual.some(item => item.name.trim().toLowerCase() === name) || selected.some(other => other !== entry && other.name.trim().toLowerCase() === name)) { entry.blocked = true; entry.issues.push('Name collision. Rename an existing entry or adjust the patterns/exclusions before updating.'); }
      if (selected.some(other => other !== entry && other.provenance.folder.toLowerCase() === entry.provenance.folder.toLowerCase())) { entry.blocked = true; entry.issues.push('Folder paths differ only by case; resolve before applying.'); }
      if (entry.members.some(member => member.state === 'conflict')) entry.issues.push('Duplicate definitions disagree on folder or existing manual membership. No membership inferred for conflicting IDs.');
    }
  }
  if (!entries.length) notices.push('No matching folders with included Markdown.');
  notices.push('Folders without included Markdown are omitted. Markdown-only folders with no ID definitions appear with zero IDs. Ordinary mentions never assign membership.');
  return { entries: entries.sort((a, b) => compare(provenanceKey(a.provenance), provenanceKey(b.provenance))), notices };
}

/** Increment 96: does the draft already derive this target from the pattern's root, or from a root that overlaps it? */
export function folderRootTaken(configuration: IdConfiguration, target: GeneratorTarget, pattern: string) {
  const root = patternRoot(pattern).toLowerCase();
  return (configuration.folderGenerators ?? []).some(rule => {
    const other = patternRoot(rule.pattern).toLowerCase();
    return rule.target === target && (other === root || other.startsWith(root + '/') || root.startsWith(other + '/'));
  });
}
/** Increment 96: add proposed generators to a draft, keyed like Add folder pattern; patterns whose root is already derived are skipped. */
export function addFolderGenerators(configuration: IdConfiguration, proposed: readonly Pick<FolderGenerator, 'target' | 'pattern' | 'exclusions'>[]) {
  const draft = structuredClone(configuration), added: FolderGenerator[] = [];
  const used = new Set([...(draft.folderGenerators ?? []).map(rule => rule.key), ...(draft.generatedFolders ?? []).map(mapping => mapping.generator)]);
  for (const item of proposed) {
    if (folderRootTaken(draft, item.target, item.pattern)) continue;
    let n = 1; while (used.has(`generator${n}`)) n++;
    const rule = { key: `generator${n}`, target: item.target, pattern: item.pattern, exclusions: [...item.exclusions] };
    used.add(rule.key); (draft.folderGenerators ??= []).push(rule); added.push(rule);
  }
  validateFolderGenerators(draft.folderGenerators ?? []);
  return { configuration: draft, added };
}
/** Increment 96: defined IDs each spec folder would receive under a draft, as Update assigns them. Counts stay unknown past the preview's limits. */
export function measureSpecFolders(candidates: SpecFolderCandidate[], files: readonly string[], index: ProjectIndex, configuration: IdConfiguration) {
  for (const candidate of candidates) {
    try {
      const preview = previewFolderGenerators([{ key: 'proposed', target: 'features', pattern: candidate.pattern, exclusions: [] }], files, index, configuration);
      const counts = new Map(preview.entries.map(entry => [entry.provenance.folder, entry.members.filter(member => member.state === 'assigned').length]));
      candidate.ids = candidate.folders.map(folder => counts.get(folder) ?? 0);
    } catch { delete candidate.ids; }
  }
}

/** Explicit update only. No mutation and no partial staging when a naming/path collision blocks review. */
export function stageFolderUpdate(configuration: IdConfiguration, target: GeneratorTarget, files: readonly string[], index: ProjectIndex): { preview: FolderPreview; configuration?: IdConfiguration } {
  const rules = (configuration.folderGenerators ?? []).filter(rule => rule.target === target);
  const preview = previewFolderGenerators(rules, files, index, configuration, generatedFolderHistory(configuration, target));
  if (preview.entries.some(entry => entry.blocked)) return { preview };
  const draft = structuredClone(configuration);
  const mappings = draft.generatedFolders ??= [], entries = draft[target] ??= [];
  for (const proposed of preview.entries) {
    if (proposed.change === 'retained') continue;
    const generator = rules.find(rule => rule.key === proposed.provenance.generator)!;
    const old = mappings.find(mapping => provenanceKey(mapping) === provenanceKey(proposed.provenance));
    if (old) { old.pattern = generator.pattern; old.exclusions = [...generator.exclusions]; continue; }
    let n = 1; while (entries.some(entry => entry.key === `generated${n}`)) n++;
    const entry = `generated${n}`;
    entries.push({ key: entry, name: proposed.name });
    mappings.push({ ...proposed.provenance, entry, pattern: generator.pattern, exclusions: [...generator.exclusions] });
  }
  return { preview, configuration: draft };
}
