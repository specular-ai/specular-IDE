import { toString } from 'mdast-util-to-string';
import type { Nodes } from 'mdast';
import type { IdMatch, IdMatcher } from './id-configuration';
import { unknownField } from './configuration-fields';

interface Pattern { pattern?: string; ignoreCase?: boolean }
export interface IdDefinitionSites {
  /** `keyword` (increment 85a, categories only): `Requirement: <name>` defines the element named by the rest of the heading. */
  headings: Pattern & { enabled: boolean; levels: number[]; mode: 'start' | 'anywhere' | 'regex' | 'keyword'; keyword?: string; separator?: string };
  tables: Pattern & { enabled: boolean; column: string; mode: 'exact' | 'regex' };
  /** `checkboxOnly` (increment 91): only items with a task checkbox define IDs; other items are references. */
  lists?: { enabled: boolean; types: ('unordered' | 'ordered')[]; mode: 'start'; checkboxOnly?: boolean };
  /** Increment 82: a plain paragraph starting with an ID followed by `:` or a dash. */
  paragraphs?: { enabled: boolean; mode: 'start' };
}
export const DEFAULT_ID_DEFINITION_SITES: IdDefinitionSites = {
  headings: { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' },
  tables: { enabled: true, column: 'ID', mode: 'exact' },
  lists: { enabled: false, types: ['unordered', 'ordered'], mode: 'start' },
  paragraphs: { enabled: false, mode: 'start' },
};
/** `name` identifies the site in rejections, as in `ID definition site tables must be an object.` (91). */
function object(value: unknown, allowed: string[], name: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown !== undefined) throw new Error(`Invalid ${name} fields. ${unknownField('ID definition site', unknown, allowed)}`);
  return value as Record<string, unknown>;
}
export function hasNamedCapture(pattern: string, name: string) {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.charCodeAt(i) === 92) { i++; continue; }
    if (pattern[i] === '[') inClass = true;
    else if (pattern[i] === ']') inClass = false;
    else if (!inClass && pattern.startsWith(`(?<${name}>`, i)) return true;
  }
  return false;
}
function patternFields(value: Record<string, unknown>): Pattern {
  if (value.mode !== 'regex') {
    if (value.pattern !== undefined || value.ignoreCase !== undefined) throw new Error('Definition site patterns apply only to Advanced pattern mode.');
    return {};
  }
  if (typeof value.pattern !== 'string' || !value.pattern || value.pattern.length > 512) throw new Error('Definition site pattern must contain 1-512 characters.');
  if (value.ignoreCase !== undefined && typeof value.ignoreCase !== 'boolean') throw new Error('Definition site ignoreCase must be boolean.');
  try { new RegExp(value.pattern, 'dgu'); } catch { throw new Error('Invalid definition site Unicode regular expression.'); }
  if (!hasNamedCapture(value.pattern, 'id')) throw new Error('Definition site pattern needs a named (?<id>...) capture.');
  return { pattern: value.pattern, ...(value.ignoreCase === undefined ? {} : { ignoreCase: value.ignoreCase }) };
}
export const KEYWORD_SEPARATORS = [':', '-', '\u2013', '\u2014', '.'];
function keywordFields(value: Record<string, unknown>): { keyword?: string; separator?: string } {
  if (value.mode !== 'keyword') {
    if (value.keyword !== undefined || value.separator !== undefined) throw new Error('Heading keywords apply only to Keyword heading mode.');
    return {};
  }
  if (value.pattern !== undefined || value.ignoreCase !== undefined) throw new Error('Definition site patterns apply only to Advanced pattern mode.');
  if (typeof value.keyword !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,63}$/u.test(value.keyword.trim())) throw new Error('A heading keyword needs 1-64 letters, digits, spaces, hyphens, or underscores, such as Requirement.');
  if (value.separator !== undefined && (typeof value.separator !== 'string' || !KEYWORD_SEPARATORS.includes(value.separator))) throw new Error('A heading keyword separator must be a colon, hyphen, en dash, em dash, or period.');
  return { keyword: value.keyword.trim(), ...(value.separator === undefined ? {} : { separator: value.separator }) };
}
/** Increment 85a: the name after `<keyword><separator>` in a heading, with whitespace collapsed, or undefined. */
export function keywordName(heading: string, keyword: string, separator = ':'): { name: string; index: number } | undefined {
  const match = new RegExp(`^\\s*${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+')}\\s*${separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?=\\S)`, 'iu').exec(heading);
  if (!match) return undefined;
  const name = heading.slice(match[0].length).replace(/\s+/gu, ' ').trim();
  return name && name.length <= 512 ? { name, index: match[0].length } : undefined;
}
export function validateIdDefinitionSites(input: unknown): IdDefinitionSites {
  const value = object(input, ['headings', 'tables', 'lists', 'paragraphs'], 'ID definition sites');
  const h = object(value.headings, ['enabled', 'levels', 'mode', 'pattern', 'ignoreCase', 'keyword', 'separator'], 'ID definition site headings');
  const t = object(value.tables, ['enabled', 'column', 'mode', 'pattern', 'ignoreCase'], 'ID definition site tables');
  if (typeof h.enabled !== 'boolean' || typeof t.enabled !== 'boolean') throw new Error('Definition site enable settings must be boolean.');
  if (!Array.isArray(h.levels) || h.levels.length > 6 || h.levels.some(n => !Number.isInteger(n) || n < 1 || n > 6) || new Set(h.levels).size !== h.levels.length) throw new Error('Select unique heading levels from H1 to H6.');
  if (!['start', 'anywhere', 'regex', 'keyword'].includes(String(h.mode)) || !['exact', 'regex'].includes(String(t.mode))) throw new Error('Unknown ID definition site mode.');
  const keyword = keywordFields(h);
  if (typeof t.column !== 'string' || !t.column.trim() || t.column.length > 128 || /[\r\n\u0000]/.test(t.column)) throw new Error('ID column name must contain 1-128 characters on one line.');
  let lists: IdDefinitionSites['lists'];
  if (value.lists !== undefined) {
    const l = object(value.lists, ['enabled', 'types', 'mode', 'checkboxOnly'], 'ID definition site lists');
    if (typeof l.enabled !== 'boolean' || l.mode !== 'start') throw new Error('Unknown list definition site setting.');
    if (!Array.isArray(l.types) || l.types.length > 2 || l.types.some(type => !['unordered', 'ordered'].includes(String(type))) || new Set(l.types).size !== l.types.length) throw new Error('Select unique unordered or ordered list types.');
    if (l.checkboxOnly !== undefined && typeof l.checkboxOnly !== 'boolean') throw new Error('List definition site checkboxOnly must be boolean.');
    lists = { enabled: l.enabled, types: l.types as ('unordered' | 'ordered')[], mode: 'start', ...(l.checkboxOnly ? { checkboxOnly: true } : {}) };
  }
  let paragraphs: IdDefinitionSites['paragraphs'];
  if (value.paragraphs !== undefined) {
    const p = object(value.paragraphs, ['enabled', 'mode'], 'ID definition site paragraphs');
    if (typeof p.enabled !== 'boolean' || p.mode !== 'start') throw new Error('Unknown paragraph definition site setting.');
    paragraphs = { enabled: p.enabled, mode: 'start' };
  }
  return { headings: { enabled: h.enabled, levels: [...h.levels].sort(), mode: h.mode as IdDefinitionSites['headings']['mode'], ...(h.mode === 'keyword' ? keyword : patternFields(h)) },
    tables: { enabled: t.enabled, column: t.column.trim(), mode: t.mode as IdDefinitionSites['tables']['mode'], ...patternFields(t) }, ...(lists ? { lists } : {}), ...(paragraphs ? { paragraphs } : {}) };
}
/** Compile/execute only inside the terminable analysis worker. */
export function compileDefinitionSite(mode: string, options: Pattern, matchIds: IdMatcher) {
  const regex = mode === 'regex' ? new RegExp(options.pattern!, options.ignoreCase ? 'dgiu' : 'dgu') : undefined;
  return (value: string): IdMatch | undefined => {
    if (value.length > 2 * 1024 * 1024) throw new Error('Definition site exceeds the 2 MB text-region limit.');
    if (!regex) {
      const matches = matchIds(value);
      if (mode === 'anywhere' && matches.length > 1) throw new Error(`Ambiguous definition site: ${matches.map(m => m.id).join(', ')}. Use an Advanced pattern to select one ID.`);
      const match = matches[0];
      // A leading ID ends at whitespace, a colon (also full-width, 91) or dash, or `.`/`)` before whitespace or the end, as in `1. Write` or `## R1. Title` (88).
      // A bracketed ID, `[CQ-H1] Title` or `[R1]: Title`, ends at its closing bracket (91).
      if (mode === 'start' && match?.index === 1 && value[0] === '[') return value[match.end] === ']' && /^(?:$|[\s\u2014:\uff1a\u2013.)-])/u.test(value.slice(match.end + 1, match.end + 2)) ? match : undefined;
      if (mode === 'start') return match?.index === 0 && /^(?:$|[\s\u2014:\uff1a\u2013]|[.)](?:$|\s))/u.test(value.slice(match.end, match.end + 2)) ? match : undefined;
      if (mode === 'exact') return matches.length === 1 && match.index === 0 && match.end === value.length ? match : undefined;
      return match;
    }
    regex.lastIndex = 0;
    let found: IdMatch | undefined;
    for (const result of value.matchAll(regex)) {
      const id = result.groups?.id, span = result.indices?.groups?.id;
      if (!result[0].length || !id || !span || span[0] === span[1]) throw new Error('Definition site pattern produced an empty or missing ID capture.');
      const matches = matchIds(id);
      if (matches.length !== 1 || matches[0].index !== 0 || matches[0].end !== id.length) throw new Error(`Captured ID ${JSON.stringify(id)} does not fully match an active ID recognition rule.`);
      if (found) throw new Error(`Ambiguous definition site: ${found.id}, ${id}. Narrow the pattern to one ID capture.`);
      found = { ...matches[0], index: span[0], end: span[1] };
    }
    return found;
  };
}
/** Map a capture to a contiguous literal span in a text/inline-code leaf, never a URL or markup. */
export function definitionSourceOffset(node: Nodes, source: string, match: Pick<IdMatch, 'id' | 'index' | 'end'>, allowedLeafTypes = ['text', 'inlineCode']): number | undefined {
  let renderedOffset = 0, result: number | undefined;
  const positions = (text: string, value: string) => {
    const found: number[] = []; let from = 0, at: number;
    while ((at = text.indexOf(value, from)) !== -1) { found.push(at); from = at + value.length; }
    return found;
  };
  const visit = (part: Nodes) => {
    if ('children' in part) { part.children.forEach(visit); return; }
    const value = toString(part), start = renderedOffset; renderedOffset += value.length;
    if (!allowedLeafTypes.includes(part.type) || match.index < start || match.end > renderedOffset || !part.position) return;
    const rawStart = part.position.start.offset!, raw = source.slice(rawStart, part.position.end.offset);
    const rendered = positions(value, match.id), literal = positions(raw, match.id), ordinal = rendered.indexOf(match.index - start);
    // Encodings/escapes that change occurrences cannot safely be mapped by ordinal.
    if (ordinal >= 0 && rendered.length === literal.length) result = rawStart + literal[ordinal];
  };
  visit(node); return result;
}
