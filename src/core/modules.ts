import { generatedMappingsForFile } from './folder-generators';
import { idKey, idLabel, keyLabel } from './id-identity';
import type { ModuleConfiguration } from './module-configuration';
import type { ModuleAssignment, Occurrence, ProjectIndex, SourceLocation } from '../shared/types';
const location = (item: SourceLocation): SourceLocation => ({ file: item.file, offset: item.offset, end: item.end, line: item.line, column: item.column });
/** Classify the ID from its definitions, never from the files that merely mention it. */
export function assignModules(index: ProjectIndex, config: ModuleConfiguration): ProjectIndex {
  if (config.modules === undefined && config.moduleRules === undefined && config.moduleOverrides === undefined) return index;
  const modules = new Map((config.modules ?? []).map(module => [module.key, module]));
  const members = (keys: string[]) => [...new Set(keys)].sort().map(key => modules.get(key)!);
  const overrides = new Map((config.moduleOverrides ?? []).map(rule => [idKey(rule), rule]));
  const groups = new Map<string, Occurrence[]>();
  for (const item of [...index.definitions, ...index.references]) if (!groups.has(idKey(item))) groups.set(idKey(item), []);
  for (const item of index.definitions) groups.get(idKey(item))!.push(item);
  const assignments = new Map<string, ModuleAssignment>();
  const fileRules = new Map<string, NonNullable<ModuleConfiguration['moduleRules']>>();
  for (const [id, definitions] of groups) {
    const override = overrides.get(id);
    if (override) {
      const values = members(override.modules);
      assignments.set(id, { state: values.length ? 'assigned' : 'unassigned', modules: values, evidence: [{ kind: 'id-override', id: override.id, modules: values }] }); continue;
    }
    const evidence: ModuleAssignment['evidence'] = [], candidates: string[] = [];
    for (const definition of definitions) {
      let rules = fileRules.get(definition.file);
      if (!rules) {
        rules = (config.moduleRules ?? []).filter(rule => rule.scope === 'file' ? definition.file === rule.path : rule.path === '.' || definition.file.startsWith(rule.path + '/'));
        rules.push(...generatedMappingsForFile(config, 'modules', definition.file).map(mapping => ({ key: `generated-${mapping.entry}`, path: mapping.folder, scope: 'folder' as const, modules: [mapping.entry] })));
        fileRules.set(definition.file, rules);
      }
      const values = members(rules.flatMap(rule => rule.modules)); candidates.push(JSON.stringify(values.map(value => value.key)));
      if (!rules.length) evidence.push({ kind: 'unassigned', source: location(definition), modules: [] });
      else for (const rule of rules) evidence.push({ kind: 'file-rule', rule: rule.key, path: rule.path, scope: rule.scope, source: location(definition), modules: members(rule.modules) });
      if (evidence.length > 256) throw new Error(`${keyLabel(id)}: module assignment exceeds 256 evidence entries. Narrow the file rules or resolve duplicate definitions.`);
    }
    if (!definitions.length) evidence.push({ kind: 'unassigned', modules: [] });
    const conflict = new Set(candidates).size > 1;
    const values = conflict || !candidates.length ? [] : members(JSON.parse(candidates[0]));
    assignments.set(id, { state: conflict ? 'conflict' : values.length ? 'assigned' : 'unassigned', modules: values, evidence });
  }
  const definitions = index.definitions.map(item => ({ ...item, moduleAssignment: assignments.get(idKey(item))! }));
  const findings = [...index.findings];
  for (const item of definitions) if (item.moduleAssignment.state === 'conflict') findings.push({ ...location(item), kind: 'module-conflict', message: `${idLabel(item)}: duplicate definitions have conflicting module assignments. Inspect their file rules or add an exact-ID override.` });
  return { ...index, definitions, references: index.references.map(item => ({ ...item, moduleAssignment: assignments.get(idKey(item))! })), findings };
}
