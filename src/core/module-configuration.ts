import type { FolderGenerationConfiguration } from './folder-generators';
import { idKey } from './id-identity';
export interface ProjectModule { key: string; name: string }
export interface ModuleFileRule { key: string; path: string; scope: 'file' | 'folder'; modules: string[] }
export interface ModuleOverride { scope?: string; id: string; modules: string[] }
export interface ModuleConfiguration extends FolderGenerationConfiguration { modules?: ProjectModule[]; moduleRules?: ModuleFileRule[]; moduleOverrides?: ModuleOverride[] }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a module configuration object.'); return value as Record<string, unknown>;
};
function fields(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown module configuration field.'); }
function key(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) throw new Error('Module and file-rule keys must start with a letter and contain up to 64 letters, digits, underscores or hyphens.'); return value; }
function array(value: unknown, limit: number): unknown[] { if (!Array.isArray(value) || value.length > limit) throw new Error(`Expected a module configuration list with at most ${limit} entries.`); return value; }
export function validModulePath(value: unknown, scope: unknown): value is string {
  if (scope === 'folder' && value === '.') return true;
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\\:*?"<>|\u0000-\u001f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !/[. ]$/.test(part));
}
/** A scope value: a folder or file path, or `name:value` for a captured path segment (increment 85a). Paths never contain `:`. */
export function validScopeValue(value: unknown): value is string {
  return validModulePath(value, 'file') || (typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}:[^/\\\r\n\u0000]{1,255}$/u.test(value));
}
export function validateModuleConfiguration(input: Record<string, unknown>): ModuleConfiguration {
  const result: ModuleConfiguration = {};
  if (input.modules !== undefined) result.modules = array(input.modules, 64).map(value => {
    const item = object(value); fields(item, ['key', 'name']);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 128) throw new Error('Each module needs a name of 1-128 characters.');
    return { key: key(item.key), name: item.name.trim() };
  });
  const known = new Set((result.modules ?? []).map(module => module.key));
  if (known.size !== (result.modules ?? []).length) throw new Error('Module keys must be unique.');
  const membership = (value: unknown, allowEmpty: boolean) => {
    const values = array(value, 64).map(key);
    if (!allowEmpty && !values.length) throw new Error('Each file rule must assign at least one module.');
    if (new Set(values).size !== values.length || values.some(value => !known.has(value))) throw new Error('Assignments must use existing modules without duplicates.');
    return values;
  };
  if (input.moduleRules !== undefined) result.moduleRules = array(input.moduleRules, 128).map(value => {
    const item = object(value); fields(item, ['key', 'path', 'scope', 'modules']);
    if (!['file', 'folder'].includes(item.scope as string) || !validModulePath(item.path, item.scope)) throw new Error('Module rules need a project-relative file or folder path using forward slashes, without wildcards or parent traversal. Use . for the project folder.');
    return { key: key(item.key), path: item.path, scope: item.scope as ModuleFileRule['scope'], modules: membership(item.modules, false) };
  });
  if (new Set(result.moduleRules?.map(rule => rule.key)).size !== (result.moduleRules ?? []).length) throw new Error('Module file-rule keys must be unique.');
  if (input.moduleOverrides !== undefined) result.moduleOverrides = array(input.moduleOverrides, 256).map(value => {
    const item = object(value); fields(item, ['id', 'scope', 'modules']);
    if (typeof item.id !== 'string' || !item.id.trim() || item.id.length > 512 || /[\r\n\u0000]/.test(item.id)) throw new Error('Module overrides need an exact ID of 1-512 characters.');
    if (item.scope !== undefined && !validScopeValue(item.scope)) throw new Error('An exact-ID scope must be a canonical project-relative folder or file, or a captured scope such as capability:identity.');
    return { id: item.id, ...(item.scope === undefined ? {} : { scope: item.scope as string }), modules: membership(item.modules, true) };
  });
  if (new Set(result.moduleOverrides?.map(idKey)).size !== (result.moduleOverrides ?? []).length) throw new Error('Each exact ID may have only one module override.');
  return result;
}
