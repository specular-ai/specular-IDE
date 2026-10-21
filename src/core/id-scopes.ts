import { validModulePath, validScopeValue } from './module-configuration';
export { validScopeValue };
import { EXCLUDED_FOLDERS } from './project-paths';

export interface IdScopeRule { pattern: string; enabled?: boolean }
export function validScopePath(value: unknown): value is string {
  return validModulePath(value, 'file') && !value.split('/').some(part => EXCLUDED_FOLDERS.has(part.toLowerCase()));
}
/** Does `file` belong to `scope`? Folder scopes contain it and file scopes are it; captured scopes span folders. */
export function scopeContains(scope: string, file: string) {
  return validModulePath(scope, 'file') ? file === scope || file.startsWith(scope + '/') : validScopeValue(scope);
}
/**
 * Scope patterns (increment 85a). Segments are literals, `*` (one segment), `**` (any number of segments),
 * one `{name}` capture, or globs such as `004-*` or, as the last segment, a Markdown file glob such as `*.md` or `P3_*.md`.
 * A folder pattern ends in `*` or `{name}` and scopes everything below the matched folder; a file pattern ends
 * in a `.md` segment and makes each matching file its own scope. The legacy `folder/*` form is a folder pattern.
 */
interface CompiledScope { rule: IdScopeRule; regex: RegExp; capture?: string; file: boolean; literal: number; segments: number; order: number }
const CAPTURE = /^\{([a-z][a-z0-9-]{0,31})\}$/;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `paths` (increment 90): definition paths have no captures, and a folder pattern may end in a literal folder name. */
function compileScope(rule: IdScopeRule, order: number, paths = false): CompiledScope {
  const fail = () => { throw new Error(paths
    ? `Definition path ${JSON.stringify(rule.pattern)} is invalid. Use project-relative segments without captures, such as specs/*/tasks.md, docs/specs, or plans/*.md; excluded folders are not allowed.`
    : `ID scope pattern ${JSON.stringify(rule.pattern)} is invalid. Use project-relative segments such as specs/*, openspec/specs/{capability}/spec.md, openspec/changes/**/specs/{capability}/spec.md, or plans/*.md; excluded folders are not allowed.`); };
  const pattern = rule.pattern;
  if (typeof pattern !== 'string' || !pattern || pattern.length > 4096 || pattern.startsWith('/') || pattern.endsWith('/') || /[\\\r\n\u0000]/.test(pattern)) fail();
  const parts = pattern.split('/'), last = parts.length - 1;
  const file = /\.md$/i.test(parts[last]);
  let source = '^', capture: string | undefined, literal = 0;
  parts.forEach((part, index) => {
    const name = CAPTURE.exec(part)?.[1];
    if (!part || part === '.' || part === '..') fail();
    if (part === '**') {
      if (index === last) fail();
      source += '(?:[^/]+/)*'; return;
    }
    if (name) {
      if (paths || capture || (file && index === last)) fail();
      capture = name; source += `(?<scope>[^/]+)`;
    } else if (part === '*') source += '[^/]+';
    else if (part.includes('*')) {
      if (/[{}]/.test(part) || part.split('*').some(piece => piece && (EXCLUDED_FOLDERS.has(piece.toLowerCase()) || !validModulePath(piece, 'file')))) fail();
      const pieces = part.split('*'); literal += pieces.join('').length;
      source += pieces.map(escape).join('[^/]*');
    } else {
      if (/[{}]/.test(part) || EXCLUDED_FOLDERS.has(part.toLowerCase()) || !validModulePath(part, 'file')) fail();
      literal += part.length; source += escape(part);
    }
    if (index < last) source += '/';
  });
  if (!literal) fail();
  if (!paths && !file && !CAPTURE.test(parts[last]) && !parts[last].includes('*')) {
    // Increment 92: a literal last folder is a common mistake; suggest a glob, or definition paths, which accept folders.
    const prefix = /^[^-_]+[-_]/.exec(parts[last])?.[0];
    const glob = prefix && last ? [...parts.slice(0, last), prefix + '*'].join('/') : last ? [...parts.slice(0, last), '*'].join('/') : `${pattern}/*`;
    throw new Error(`ID scope pattern ${JSON.stringify(pattern)} ends in a literal folder. A scope pattern needs a wildcard, glob, or {name} capture as its last folder segment, such as ${glob}, or a .md file segment. To limit where the category defines IDs, use definitionPaths, which accepts folders.`);
  }
  source += file ? '$' : '/';
  return { rule, regex: new RegExp(source, 'u'), ...(capture ? { capture } : {}), file, literal, segments: parts.length, order };
}
export function validateIdScopes(value: unknown): IdScopeRule[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error('Provide at most 64 ID scope patterns.');
  const rules = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['pattern', 'enabled'].includes(key)) ||
      typeof item.pattern !== 'string' || (item.enabled !== undefined && typeof item.enabled !== 'boolean')) throw new Error('ID scopes need a project-relative pattern such as specs/*.');
    const rule = { pattern: item.pattern, ...(item.enabled === undefined ? {} : { enabled: item.enabled }) } as IdScopeRule;
    compileScope(rule, 0); return rule;
  });
  if (new Set(rules.map(rule => rule.pattern.toLowerCase())).size !== rules.length) throw new Error('ID scope patterns must be unique.');
  return rules;
}
/** Folder generators keep the original form: `folder/*` patterns whose roots do not overlap. */
export function validateFolderPatterns(value: unknown): IdScopeRule[] {
  const rules = validateIdScopes(value);
  for (const rule of rules) if (!rule.pattern.endsWith('/*') || !validScopePath(rule.pattern.slice(0, -2)) || rule.pattern.slice(0, -2).includes('*')) {
    throw new Error('ID scopes need a canonical project-relative pattern such as specs/*, ending in exactly one child wildcard. Excluded folders are not allowed.');
  }
  const roots = rules.map(rule => rule.pattern.slice(0, -2).toLowerCase());
  for (let i = 0; i < roots.length; i++) for (let j = 0; j < i; j++) {
    if (roots[i] === roots[j] || roots[i].startsWith(roots[j] + '/') || roots[j].startsWith(roots[i] + '/')) throw new Error('ID scope roots must not overlap, including disabled patterns.');
  }
  return rules;
}
const compiled = new WeakMap<readonly IdScopeRule[], CompiledScope[]>();
function compiledScopes(rules: readonly IdScopeRule[]) {
  let value = compiled.get(rules);
  if (!value) { value = rules.map((rule, order) => compileScope(rule, order)); compiled.set(rules, value); }
  return value;
}
/**
 * Only canonical files supplied by the workspace scanner participate; never traverse folders here.
 * When several patterns match, the most specific wins: the most literal characters, then the most segments, then the first listed.
 */
export function scopeForFile(file: string, rules: readonly IdScopeRule[] = []): string | undefined {
  if (!rules.length || !validScopePath(file)) return undefined;
  let best: { scope: CompiledScope; match: RegExpExecArray } | undefined;
  for (const scope of compiledScopes(rules)) {
    if (scope.rule.enabled === false) continue;
    const match = scope.regex.exec(file);
    if (!match) continue;
    if (!best || scope.literal > best.scope.literal || (scope.literal === best.scope.literal && scope.segments > best.scope.segments)) best = { scope, match };
  }
  if (!best) return undefined;
  if (best.scope.capture) return `${best.scope.capture}:${best.match.groups!.scope}`;
  return best.scope.file ? file : best.match[0].slice(0, -1);
}
/** The captured segment of a single-capture pattern for `file`, used to derive elements such as capabilities. */
export function captureForFile(file: string, pattern: string): string | undefined {
  if (!validScopePath(file)) return undefined;
  const scope = compileScope({ pattern }, 0);
  return scope.capture ? scope.regex.exec(file)?.groups?.scope : undefined;
}
/** The capture name of a single-capture pattern, such as `capability`; derived elements live in the `capability:<name>` scope. */
export function captureName(pattern: string): string | undefined { return compileScope({ pattern }, 0).capture; }
export function validateCapturePattern(pattern: unknown): string {
  if (typeof pattern !== 'string') throw new Error('Derived elements need a path pattern with one {name} capture.');
  const scope = compileScope({ pattern }, 0);
  if (!scope.capture || !scope.file) throw new Error('Derived elements need a Markdown file pattern with one {name} capture, such as openspec/specs/{capability}/spec.md.');
  return pattern;
}
/** Increment 90: a category with `onlyInScopes` is recognized only in files that one of its enabled scope patterns matches. */
export function fileInScopes(file: string, rules: readonly IdScopeRule[] = []) { return scopeForFile(file, rules) !== undefined; }
/** Definition paths (increment 90): 1-32 scope-style patterns without captures; a folder pattern matches everything below it. */
export function validateDefinitionPaths(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 32 || value.some(item => typeof item !== 'string')) throw new Error('Definition paths need 1-32 project-relative patterns such as specs/*/tasks.md.');
  for (const pattern of value) compileScope({ pattern }, 0, true);
  if (new Set(value.map(item => item.toLowerCase())).size !== value.length) throw new Error('Definition paths must be unique.');
  return [...value];
}
const compiledPaths = new WeakMap<readonly string[], RegExp[]>();
export function pathsContain(file: string, paths: readonly string[]) {
  let value = compiledPaths.get(paths);
  if (!value) { value = paths.map(pattern => compileScope({ pattern }, 0, true).regex); compiledPaths.set(paths, value); }
  return validScopePath(file) && value.some(regex => regex.test(file));
}
