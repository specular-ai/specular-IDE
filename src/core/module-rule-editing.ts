import { idKey } from './id-identity';
import type { ModuleConfiguration, ModuleFileRule, ModuleOverride } from './module-configuration';

/** Copy on edit keeps a shared rule's other targets and evidence key intact. */
export function editModuleFileRule(config: ModuleConfiguration, rule: ModuleFileRule, module: string, patch: Partial<Pick<ModuleFileRule, 'path' | 'scope'>>) {
  if (!config.moduleRules?.includes(rule) || !rule.modules.includes(module)) throw new Error('The module rule is no longer available.');
  if ((patch.path === undefined || patch.path === rule.path) && (patch.scope === undefined || patch.scope === rule.scope)) return rule;
  if (rule.modules.length === 1) { Object.assign(rule, patch); return rule; }
  if (config.moduleRules.length >= 128) throw new Error('Remove a file rule before editing a shared rule independently. The project limit is 128 rules.');
  const used = new Set(config.moduleRules.map(item => item.key));
  let key = 'files', n = 2; while (used.has(key)) key = `files-${n++}`;
  const owned = { ...rule, ...patch, key, modules: [module] };
  rule.modules = rule.modules.filter(key => key !== module);
  config.moduleRules.push(owned);
  return owned;
}

export function removeModuleFileRule(config: ModuleConfiguration, rule: ModuleFileRule, module: string) {
  if (!config.moduleRules?.includes(rule) || !rule.modules.includes(module)) return;
  rule.modules = rule.modules.filter(key => key !== module);
  if (!rule.modules.length) config.moduleRules.splice(config.moduleRules.indexOf(rule), 1);
}

export function removeProjectModule(config: ModuleConfiguration, module: string) {
  if (config.generatedFolders) config.generatedFolders = config.generatedFolders.filter(mapping => mapping.target !== 'modules' || mapping.entry !== module);
  config.modules = config.modules?.filter(item => item.key !== module);
  for (const rule of [...config.moduleRules ?? []]) removeModuleFileRule(config, rule, module);
  for (const override of config.moduleOverrides ?? []) override.modules = override.modules.filter(key => key !== module);
}

/** An ID edit under one module cannot rename another module's override. */
export function editModuleOverride(config: ModuleConfiguration, rule: ModuleOverride, module: string, id: string, scope: string | undefined = rule.scope) {
  if (!config.moduleOverrides?.includes(rule) || !rule.modules.includes(module)) throw new Error('The ID override is no longer available.');
  if (rule.id === id && rule.scope === scope) return rule;
  if (rule.modules.length === 1) { rule.id = id; if (scope) rule.scope = scope; else delete rule.scope; return rule; }
  if (config.moduleOverrides.length >= 256) throw new Error('Remove an ID override before editing a shared override independently. The project limit is 256 overrides.');
  const owned = { id, ...(scope ? { scope } : {}), modules: [module] };
  rule.modules = rule.modules.filter(key => key !== module); config.moduleOverrides.push(owned); return owned;
}

/** Merge a finished ID edit, never partially typed IDs, into its existing membership set. */
export function mergeModuleOverride(config: ModuleConfiguration, rule: ModuleOverride) {
  if (!rule.id.trim() || !rule.modules.length || !config.moduleOverrides?.includes(rule)) return rule;
  const existing = config.moduleOverrides.find(item => item !== rule && idKey(item) === idKey(rule));
  if (!existing) return rule;
  existing.modules = [...new Set([...existing.modules, ...rule.modules])];
  config.moduleOverrides.splice(config.moduleOverrides.indexOf(rule), 1); return existing;
}

export function removeModuleOverride(config: ModuleConfiguration, rule: ModuleOverride, module: string) {
  if (config.moduleOverrides?.includes(rule)) rule.modules = rule.modules.filter(key => key !== module);
}
