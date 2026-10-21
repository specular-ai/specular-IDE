import { generatedMappingsForFile } from './folder-generators';
import type { FolderGenerationConfiguration } from './folder-generators';
import { idKey, idLabel, keyLabel } from './id-identity';
import { validModulePath, validScopeValue } from './module-configuration';
import type { FeatureAssignment, Occurrence, ProjectIndex, SourceLocation } from '../shared/types';

const location = (item: SourceLocation): SourceLocation => ({ file: item.file, offset: item.offset, end: item.end, line: item.line, column: item.column });

export interface ProjectFeature { key: string; name: string }
export interface FeatureOverride { id: string; scope?: string; features: string[] }
export interface FeatureFileRule { key: string; path: string; scope: 'file' | 'folder'; features: string[] }
export interface FeatureConfiguration extends FolderGenerationConfiguration { features?: ProjectFeature[]; featureRules?: FeatureFileRule[]; featureOverrides?: FeatureOverride[] }

export function validateFeatureConfiguration(input: Record<string, unknown>): FeatureConfiguration {
  const result: FeatureConfiguration = {};
  const list = (value: unknown, limit: number): unknown[] => {
    if (!Array.isArray(value) || value.length > limit) throw new Error(`Expected a feature list with at most ${limit} entries.`);
    return value;
  };
  const object = (value: unknown, fields: string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Invalid feature configuration fields.');
    return value as Record<string, unknown>;
  };
  const key = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) throw new Error('Feature keys must start with a letter and contain up to 64 letters, digits, underscores or hyphens.');
    return value;
  };
  if (input.features !== undefined) result.features = list(input.features, 64).map(value => {
    const item = object(value, ['key', 'name']);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 128) throw new Error('Each feature needs a name of 1-128 characters.');
    return { key: key(item.key), name: item.name.trim() };
  });
  const known = new Set(result.features?.map(item => item.key));
  if (known.size !== (result.features?.length ?? 0)) throw new Error('Feature keys must be unique.');
  if (input.featureRules !== undefined) result.featureRules = list(input.featureRules, 128).map(value => {
    const item = object(value, ['key', 'path', 'scope', 'features']);
    if (!['file', 'folder'].includes(item.scope as string) || !validModulePath(item.path, item.scope)) throw new Error('Feature rules need a project-relative file or folder path using forward slashes, without wildcards or parent traversal. Use . for the project folder.');
    const features = list(item.features, 64).map(key);
    if (!features.length || new Set(features).size !== features.length || features.some(key => !known.has(key))) throw new Error('File rules must assign existing features without duplicates.');
    return { key: key(item.key), path: item.path, scope: item.scope as FeatureFileRule['scope'], features };
  });
  if (new Set(result.featureRules?.map(rule => rule.key)).size !== (result.featureRules?.length ?? 0)) throw new Error('Feature file-rule keys must be unique.');
  if (input.featureOverrides !== undefined) result.featureOverrides = list(input.featureOverrides, 256).map(value => {
    const item = object(value, ['id', 'scope', 'features']);
    if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 512 || /[\r\n\u0000]/.test(item.id)) throw new Error('Feature assignments need an exact ID of 1-512 characters.');
    if (item.scope !== undefined && !validScopeValue(item.scope)) throw new Error('An exact-ID scope must be a canonical project-relative folder or file, or a captured scope such as capability:identity.');
    const features = list(item.features, 64).map(key);
    if (new Set(features).size !== features.length || features.some(key => !known.has(key))) throw new Error('Assignments must use existing features without duplicates.');
    return { id: item.id, ...(item.scope === undefined ? {} : { scope: item.scope as string }), features };
  });
  if (new Set(result.featureOverrides?.map(idKey)).size !== (result.featureOverrides?.length ?? 0)) throw new Error('Each exact ID and scope may have only one feature assignment.');
  return result;
}

/** Deleting a feature preserves other memberships and explicit empty assignments. */
export function removeProjectFeature(config: FeatureConfiguration, key: string) {
  if (config.generatedFolders) config.generatedFolders = config.generatedFolders.filter(mapping => mapping.target !== 'features' || mapping.entry !== key);
  config.features = config.features?.filter(feature => feature.key !== key);
  for (const rule of [...config.featureRules ?? []]) removeFeatureFileRule(config, rule, key);
  for (const override of config.featureOverrides ?? []) {
    if (!override.features.includes(key)) continue;
    override.features = override.features.filter(member => member !== key);
    if (!override.features.length && !override.id.trim()) config.featureOverrides = config.featureOverrides!.filter(item => item !== override);
  }
}

export function editFeatureFileRule(config: FeatureConfiguration, rule: FeatureFileRule, feature: string, patch: Partial<Pick<FeatureFileRule, 'path' | 'scope'>>) {
  if ((patch.path === undefined || patch.path === rule.path) && (patch.scope === undefined || patch.scope === rule.scope)) return rule;
  if (rule.features.length === 1) { Object.assign(rule, patch); return rule; }
  if ((config.featureRules?.length ?? 0) >= 128) throw new Error('Remove a file rule before editing a shared rule independently.');
  let n = 1; while (config.featureRules?.some(item => item.key === `files${n}`)) n++;
  const owned = { ...rule, ...patch, key: `files${n}`, features: [feature] };
  rule.features = rule.features.filter(key => key !== feature); config.featureRules!.push(owned); return owned;
}

export function removeFeatureFileRule(config: FeatureConfiguration, rule: FeatureFileRule, feature: string) {
  rule.features = rule.features.filter(key => key !== feature);
  if (!rule.features.length) config.featureRules = config.featureRules?.filter(item => item !== rule);
}

/** Editing one feature's selector preserves the other memberships of a shared ID. */
export function editFeatureOverride(config: FeatureConfiguration, rule: FeatureOverride, feature: string, id: string, scope = rule.scope) {
  if (rule.id === id && rule.scope === scope) return rule;
  if (rule.features.length === 1) { rule.id = id; if (scope) rule.scope = scope; else delete rule.scope; return rule; }
  if ((config.featureOverrides?.length ?? 0) >= 256) throw new Error('Remove an ID assignment before editing a shared assignment independently.');
  const owned = { id, ...(scope ? { scope } : {}), features: [feature] };
  rule.features = rule.features.filter(key => key !== feature); config.featureOverrides!.push(owned); return owned;
}

export function mergeFeatureOverride(config: FeatureConfiguration, rule: FeatureOverride) {
  if (!rule.id.trim() || !rule.features.length || !config.featureOverrides?.includes(rule)) return rule;
  const existing = config.featureOverrides.find(item => item !== rule && idKey(item) === idKey(rule));
  if (!existing) return rule;
  existing.features = [...new Set([...existing.features, ...rule.features])];
  config.featureOverrides.splice(config.featureOverrides.indexOf(rule), 1); return existing;
}

export function assignFeatures(index: ProjectIndex, config: FeatureConfiguration): ProjectIndex {
  if (config.features === undefined && config.featureRules === undefined && config.featureOverrides === undefined) return index;
  const features = new Map((config.features ?? []).map(feature => [feature.key, feature]));
  const members = (keys: string[]) => [...new Set(keys)].sort().map(key => features.get(key)!);
  const overrides = new Map((config.featureOverrides ?? []).map(rule => [idKey(rule), rule]));
  const groups = new Map<string, Occurrence[]>();
  for (const item of [...index.definitions, ...index.references]) if (!groups.has(idKey(item))) groups.set(idKey(item), []);
  for (const item of index.definitions) groups.get(idKey(item))!.push(item);
  const assignments = new Map<string, FeatureAssignment>();
  const fileRules = new Map<string, NonNullable<FeatureConfiguration['featureRules']>>();
  for (const [id, definitions] of groups) {
    const override = overrides.get(id);
    if (override) {
      const values = members(override.features);
      assignments.set(id, { explicit: true, state: values.length ? 'assigned' : 'unassigned', features: values, evidence: [{ kind: 'id-override', id: override.id, features: values }] }); continue;
    }
    const evidence: FeatureAssignment['evidence'] = [], candidates: string[] = [];
    for (const definition of definitions) {
      let rules = fileRules.get(definition.file);
      if (!rules) {
        rules = (config.featureRules ?? []).filter(rule => rule.scope === 'file' ? definition.file === rule.path : rule.path === '.' || definition.file.startsWith(rule.path + '/'));
        rules.push(...generatedMappingsForFile(config, 'features', definition.file).map(mapping => ({ key: `generated-${mapping.entry}`, path: mapping.folder, scope: 'folder' as const, features: [mapping.entry] })));
        fileRules.set(definition.file, rules);
      }
      const values = members(rules.flatMap(rule => rule.features)); candidates.push(JSON.stringify(values.map(value => value.key)));
      if (!rules.length) evidence.push({ kind: 'unassigned', source: location(definition), features: [] });
      else for (const rule of rules) evidence.push({ kind: 'file-rule', rule: rule.key, path: rule.path, scope: rule.scope, source: location(definition), features: members(rule.features) });
      if (evidence.length > 256) throw new Error(`${keyLabel(id)}: feature assignment exceeds 256 evidence entries. Narrow the file rules or resolve duplicate definitions.`);
    }
    if (!definitions.length) evidence.push({ kind: 'unassigned', features: [] });
    const conflict = new Set(candidates).size > 1;
    const values = conflict || !candidates.length ? [] : members(JSON.parse(candidates[0]));
    assignments.set(id, { explicit: false, state: conflict ? 'conflict' : values.length ? 'assigned' : 'unassigned', features: values, evidence });
  }
  const definitions = index.definitions.map(item => ({ ...item, featureAssignment: assignments.get(idKey(item))! }));
  const findings = [...index.findings];
  for (const item of definitions) if (item.featureAssignment.state === 'conflict') findings.push({ ...location(item), kind: 'feature-conflict', message: `${idLabel(item)}: duplicate definitions have conflicting feature assignments. Inspect their file rules or add an exact-ID override.` });
  return { ...index, definitions, references: index.references.map(item => ({ ...item, featureAssignment: assignments.get(idKey(item))! })), findings };
}
