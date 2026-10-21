import { unknownField } from './configuration-fields';
import { hasNamedCapture } from './definition-sites';

interface Pattern { pattern?: string; ignoreCase?: boolean }
/** Checkbox markers on ID-defining list items (increment 88, DD-055): each single-character marker maps to a status value. */
export interface CheckboxSite { enabled: boolean; markers: Record<string, string> }
export interface StatusSites {
  /** `listItems` (increment 91): a list item whose first paragraph starts with the label is a status paragraph. */
  paragraphs: Pattern & { enabled: boolean; mode: 'literal' | 'regex'; label: string; listItems?: boolean };
  tables: Pattern & { enabled: boolean; mode: 'full' | 'regex'; column: string };
  headings: Pattern & { enabled: boolean; mode: 'regex'; pattern: string };
  /** Optional; absent means disabled, so configurations without it keep their meaning. */
  checkboxes?: CheckboxSite;
}
export type StatusSite = keyof StatusSites;
/** Sites whose values are read from a Markdown region's text. */
export type TextStatusSite = Exclude<StatusSite, 'checkboxes'>;
export const DEFAULT_CHECKBOX_MARKERS: Record<string, string> = { x: 'Done', X: 'Done', ' ': 'Open', '-': 'In progress' };
export const DEFAULT_STATUS_SITES: StatusSites = {
  paragraphs: { enabled: true, mode: 'literal', label: 'Status:' },
  tables: { enabled: true, mode: 'full', column: 'Status' },
  headings: { enabled: false, mode: 'regex', pattern: '\\[(?<status>[^\\]]+)\\]$' },
  checkboxes: { enabled: false, markers: { ...DEFAULT_CHECKBOX_MARKERS } },
};
function validateCheckboxSite(input: unknown): CheckboxSite {
  const site = object(input, ['enabled', 'markers'], 'Status site checkboxes');
  if (typeof site.enabled !== 'boolean') throw new Error('Status site enable settings must be boolean.');
  if (!site.markers || typeof site.markers !== 'object' || Array.isArray(site.markers)) throw new Error('Checkbox markers must map single characters to status values.');
  const entries = Object.entries(site.markers as Record<string, unknown>);
  if (entries.length > 16) throw new Error('Provide at most 16 checkbox markers.');
  const markers: Record<string, string> = {};
  for (const [marker, value] of entries) {
    if ([...marker].length !== 1 || /[\]\r\n\u0000]/u.test(marker)) throw new Error(`Checkbox marker ${JSON.stringify(marker)} must be a single character other than "]".`);
    markers[marker] = label(value, `Status value for checkbox marker ${JSON.stringify(marker)}`);
  }
  return { enabled: site.enabled, markers };
}
/** `name` identifies the site in rejections, as in `Status site paragraphs must be an object.` (91). */
function object(value: unknown, allowed: string[], name: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown !== undefined) throw new Error(`Invalid ${name} fields. ${unknownField('status site', unknown, allowed)}`);
  return value as Record<string, unknown>;
}
function label(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\r\n\u0000]/.test(value)) throw new Error(name + ' must contain 1-128 characters on one line.');
  return value.trim();
}
export function validateStatusSites(input: unknown): StatusSites {
  const value = object(input, ['paragraphs', 'tables', 'headings', 'checkboxes'], 'Status sites');
  const result: Record<string, unknown> = {};
  if (value.checkboxes !== undefined) result.checkboxes = validateCheckboxSite(value.checkboxes);
  for (const kind of ['paragraphs', 'tables', 'headings'] as const) {
    const extra = kind === 'paragraphs' ? ['label', 'listItems'] : kind === 'tables' ? ['column'] : [];
    const site = object(value[kind], ['enabled', 'mode', 'pattern', 'ignoreCase', ...extra], `Status site ${kind}`);
    if (typeof site.enabled !== 'boolean') throw new Error('Status site enable settings must be boolean.');
    const modes = kind === 'paragraphs' ? ['literal', 'regex'] : kind === 'tables' ? ['full', 'regex'] : ['regex'];
    if (typeof site.mode !== 'string' || !modes.includes(site.mode)) throw new Error('Unknown status site mode.');
    const options: Record<string, unknown> = { enabled: site.enabled, mode: site.mode };
    if (kind === 'paragraphs') {
      // A regex paragraph site does not read its label, so an omitted one is stored as `Status:` (91).
      options.label = site.mode === 'regex' && site.label === undefined ? 'Status:' : label(site.label, 'Paragraph field label');
      if (site.listItems !== undefined && typeof site.listItems !== 'boolean') throw new Error('Status site paragraphs listItems must be boolean.');
      if (site.listItems) options.listItems = true;
    }
    if (kind === 'tables') options.column = label(site.column, 'Status column name');
    if (site.mode === 'regex') {
      if (typeof site.pattern !== 'string' || !site.pattern || site.pattern.length > 512) throw new Error('Status site pattern must contain 1-512 characters.');
      if (site.ignoreCase !== undefined && typeof site.ignoreCase !== 'boolean') throw new Error('Status site ignoreCase must be boolean.');
      try { new RegExp(site.pattern, 'dgu'); } catch { throw new Error('Invalid status site Unicode regular expression.'); }
      if (!hasNamedCapture(site.pattern, 'status')) throw new Error('Status site pattern needs a named (?<status>...) capture.');
      options.pattern = site.pattern;
      if (site.ignoreCase !== undefined) options.ignoreCase = site.ignoreCase;
    } else if (site.pattern !== undefined || site.ignoreCase !== undefined) throw new Error('Status site patterns apply only to Advanced pattern mode.');
    result[kind] = options;
  }
  return result as unknown as StatusSites;
}
/** A list bullet followed by a bracketed single character, such as `- [x] ` or `1. [-] ` (increment 88). */
const CHECKBOX_MARKER = /(?:[-*+]|\d{1,9}[.)])[ \t]+\[([^\]\r\n])\](?=[ \t]|\r?\n|$)/uy;
/** The checkbox marker of the list item starting at `offset`, with the range of its brackets. */
export function checkboxMarker(source: string, offset: number): { marker: string; offset: number; end: number } | undefined {
  CHECKBOX_MARKER.lastIndex = offset;
  const match = CHECKBOX_MARKER.exec(source);
  if (!match) return undefined;
  const end = offset + match[0].length;
  return { marker: match[1], offset: end - match[1].length - 2, end };
}
export interface StatusCapture { value: string; index: number; end: number; exact: boolean }
/** Execute only inside the terminable analysis worker, on one parsed Markdown region. */
export function compileStatusSite(site: StatusSites[TextStatusSite]) {
  const regex = site.enabled && site.mode === 'regex' ? new RegExp(site.pattern!, site.ignoreCase ? 'dgiu' : 'dgu') : undefined;
  return (text: string): StatusCapture[] => {
    if (!site.enabled) return [];
    if (text.length > 2 * 1024 * 1024) throw new Error('Status site exceeds the 2 MB text-region limit.');
    if (regex) {
      regex.lastIndex = 0;
      const found: StatusCapture[] = [];
      for (const match of text.matchAll(regex)) {
        const raw = match.groups?.status, span = match.indices?.groups?.status;
        if (!match[0].length || !raw?.trim() || !span) throw new Error('Status site pattern produced an empty or missing status capture.');
        const value = raw.trim(), index = span[0] + raw.length - raw.trimStart().length;
        if (value.length > 4096 || /[\r\n\u0000]/.test(value)) throw new Error('Captured status must contain 1-4096 characters on one line.');
        if (found.length >= 256) throw new Error('Status site exceeds 256 captures.');
        found.push({ value, index, end: index + value.length, exact: true });
      }
      return found;
    }
    let raw = text, index = 0;
    if ('label' in site) {
      if (text.slice(0, site.label.length).toLowerCase() !== site.label.toLowerCase()) return [];
      // A status paragraph continued on the next line, as in `Status: Confirmed.` then `Related requirements: ...`, reads its first line (increment 87a).
      raw = text.slice(site.label.length).split(/\r?\n/)[0];
      if (!raw) return [];
      index = site.label.length;
    }
    const value = raw.trim();
    if (!value || value.length > 4096 || /[\r\n\u0000]/.test(value)) return [];
    index += raw.length - raw.trimStart().length;
    return [{ value, index, end: index + value.length, exact: false }];
  };
}
