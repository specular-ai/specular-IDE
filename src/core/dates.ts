import { hasNamedCapture } from './definition-sites';
import { idKey } from './id-identity';
import type { Occurrence, ProjectIndex } from '../shared/types';

/** Dates stated in the specifications, found by typed rules inside the terminable index worker (increments 79-80). */
export type DateSite = 'status' | 'list-entry' | 'heading' | 'field';
/** `entry`: a recorded list entry; `milestone`: something happened; `snapshot`: a "last touched" date overwritten on every edit. */
export type DateKind = 'entry' | 'milestone' | 'snapshot';
export interface DateRule {
  key: string;
  site: DateSite;
  enabled: boolean;
  /** Unicode regex with a named `date` capture; first real calendar day wins. Not used by `list-entry`. */
  pattern?: string;
  /** Field label to match (`field` only), e.g. `Created`. */
  label?: string;
  /** Meaning of the dates the rule finds; status dates carry the status's meaning instead. */
  kind?: DateKind;
}
export interface DateSettings {
  rules: DateRule[];
  /** Project-relative folders or files whose dates are ignored, e.g. vendored upstream changelogs. IDs are unaffected. */
  exclude: string[];
}
export const DEFAULT_STATUS_DATE_PATTERN = '\\bon (?<date>\\d{4}-\\d{2}-\\d{2})\\b';
export const DEFAULT_DATE_PATTERN = '(?<date>\\d{4}-\\d{2}-\\d{2})';
const field = (key: string, label: string, kind: DateKind, enabled = true): DateRule => ({ key, site: 'field', enabled, pattern: DEFAULT_DATE_PATTERN, label, kind });
export const DEFAULT_DATE_RULES: DateRule[] = [
  { key: 'status-date', site: 'status', enabled: true, pattern: DEFAULT_STATUS_DATE_PATTERN },
  { key: 'list-entry', site: 'list-entry', enabled: true, kind: 'entry' },
  { key: 'heading', site: 'heading', enabled: true, pattern: DEFAULT_DATE_PATTERN, kind: 'milestone' },
  field('created', 'Created', 'milestone'), field('ratified', 'Ratified', 'milestone'), field('date', 'Date', 'milestone'),
  field('last-updated', 'Last Updated', 'snapshot', false), field('last-amended', 'Last Amended', 'snapshot', false),
];
export const DEFAULT_DATE_SETTINGS: DateSettings = { rules: DEFAULT_DATE_RULES, exclude: [] };
/** A date with day precision, the exact matched text, and its absolute UTF-16 range in the document. */
export interface DateMatch { value: string; text: string; offset: number; end: number; /** Key of the rule that found a status date. */ ruleKey?: string }
export interface IndexedEvent {
  date: DateMatch & { rule: 'event' };
  /** Entry text after the date (list entries), the heading text, or the document title (fields). */
  text: string;
  file: string; offset: number; end: number;
  site: Exclude<DateSite, 'status'>;
  kind: DateKind;
  /** Key of the rule that found it. */
  ruleKey: string;
  /** Field label, or the heading text without its date. */
  label?: string;
  /** Keys of IDs referenced inside the entry, heading, or field line, in order. */
  mentioned: string[];
  /** Key of the ID whose section contains the date; a heading that defines an ID owns its own date. */
  owner?: string;
}

function object(value: unknown, what = 'Date settings'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what} must be an object.`);
  return value as Record<string, unknown>;
}
function only(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown date setting.'); }
function pattern(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error(`${what} pattern must contain 1-512 characters.`);
  try { new RegExp(value, 'du'); } catch { throw new Error(`Invalid ${what.toLowerCase()} Unicode regular expression.`); }
  if (!hasNamedCapture(value, 'date')) throw new Error(`${what} pattern needs a named (?<date>...) capture.`);
  return value;
}
function excludePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value) ||
    value.replace(/\/+$/, '').split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Date exclusions must be project-relative folders or files.');
  return value.replace(/\/+$/, '');
}
/** Validates the typed rule list; increment 79's `statusDates`/`events` form is migrated into the default list. */
export function validateDateSettings(input: unknown): DateSettings {
  const value = object(input); only(value, ['rules', 'exclude', 'statusDates', 'events']);
  const legacy = value.statusDates !== undefined || value.events !== undefined;
  if (legacy && value.rules !== undefined) throw new Error('Use either date rules or the earlier statusDates/events settings, not both.');
  const exclude = value.exclude === undefined ? [] : Array.isArray(value.exclude) && value.exclude.length <= 64 ? value.exclude.map(excludePath) : (() => { throw new Error('Provide at most 64 date exclusions.'); })();
  if (legacy) {
    const status = value.statusDates === undefined ? {} : object(value.statusDates), events = value.events === undefined ? {} : object(value.events);
    only(status, ['enabled', 'pattern']); only(events, ['enabled']);
    for (const enabled of [status.enabled, events.enabled]) if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error('Date rule enable settings must be boolean.');
    const rules = DEFAULT_DATE_RULES.map(rule => rule.site === 'status' ? { ...rule, enabled: status.enabled !== false, pattern: status.pattern === undefined ? DEFAULT_STATUS_DATE_PATTERN : pattern(status.pattern, 'Status date') }
      : rule.site === 'list-entry' ? { ...rule, enabled: events.enabled !== false } : { ...rule });
    return { rules, exclude };
  }
  if (value.rules === undefined) return { rules: DEFAULT_DATE_RULES.map(rule => ({ ...rule })), exclude };
  if (!Array.isArray(value.rules) || value.rules.length > 64) throw new Error('Provide at most 64 date rules.');
  const rules = value.rules.map((entry, index): DateRule => {
    const item = object(entry, `Date rule ${index + 1}`); only(item, ['key', 'site', 'enabled', 'pattern', 'label', 'kind']);
    if (typeof item.key !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(item.key)) throw new Error(`Date rule ${index + 1} needs a lowercase key.`);
    const site = item.site as DateSite;
    if (!['status', 'list-entry', 'heading', 'field'].includes(site)) throw new Error(`Date rule ${item.key}: unknown site.`);
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') throw new Error(`Date rule ${item.key}: enabled must be boolean.`);
    if (site === 'list-entry' && item.pattern !== undefined) throw new Error(`Date rule ${item.key}: list entries use the fixed ISO list format.`);
    if (site !== 'field' && item.label !== undefined) throw new Error(`Date rule ${item.key}: only field rules have a label.`);
    if (site === 'field' && (typeof item.label !== 'string' || !item.label.trim() || item.label.length > 128 || /[\r\n:*_]/.test(item.label))) throw new Error(`Date rule ${item.key}: field rules need a one-line label of 1-128 characters without colons or emphasis marks.`);
    if (site === 'status' && item.kind !== undefined) throw new Error(`Date rule ${item.key}: status dates take their meaning from the status.`);
    if (item.kind !== undefined && !['entry', 'milestone', 'snapshot'].includes(item.kind as string)) throw new Error(`Date rule ${item.key}: kind must be entry, milestone, or snapshot.`);
    return { key: item.key, site, enabled: item.enabled !== false,
      ...(site === 'list-entry' ? {} : { pattern: item.pattern === undefined ? (site === 'status' ? DEFAULT_STATUS_DATE_PATTERN : DEFAULT_DATE_PATTERN) : pattern(item.pattern, `Date rule ${item.key}`) }),
      ...(site === 'field' ? { label: (item.label as string).trim() } : {}),
      ...(site === 'status' ? {} : { kind: (item.kind as DateKind | undefined) ?? (site === 'list-entry' ? 'entry' : 'milestone') }) };
  });
  if (new Set(rules.map(rule => rule.key)).size !== rules.length) throw new Error('Date rule keys must be unique.');
  return { rules, exclude };
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export function validDate(value: string): boolean {
  const parts = ISO.exec(value); if (!parts) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.getUTCFullYear() === Number(parts[1]) && parsed.getUTCMonth() + 1 === Number(parts[2]) && parsed.getUTCDate() === Number(parts[3]);
}
/** First match with a real calendar day; offsets are relative to `text`. */
export function findStatusDate(text: string, regex: RegExp): DateMatch | undefined {
  regex.lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    const date = match.groups?.date;
    if (match.index === undefined || !date || !validDate(date)) continue;
    return { value: date, text: match[0], offset: match.index, end: match.index + match[0].length };
  }
  return undefined;
}
export const findDate = findStatusDate;

const LIST = /^(\s*(?:[-+*]|\d+[.)])\s+)(\d{4}-\d{2}-\d{2})((?:\s*[:-]\s*|\s+))(.*)$/;
type Found = Omit<IndexedEvent, 'mentioned' | 'owner'>;
/** The increment 24 dated-list format: quotes, fences, and invalid dates are ignored. */
export function documentEvents(file: string, text: string, ruleKey = 'list-entry', kind: DateKind = 'entry'): Found[] {
  const raw = text.split('\n'), lines = raw.map(line => line.replace(/\r$/, '')), offsets: number[] = [];
  let offset = 0;
  for (const line of raw) { offsets.push(offset); offset += line.length + 1; }
  const found: Found[] = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced || /^\s*>/.test(line)) continue;
    const match = LIST.exec(line);
    if (!match || !validDate(match[2])) continue;
    let end = index + 1, body = match[4];
    while (end < lines.length && (/^\s{2,}\S/.test(lines[end]) || (!lines[end].trim() && /^\s{2,}\S/.test(lines[end + 1] ?? '')))) {
      body += `\n${lines[end].replace(/^\s{2,}/, '')}`; end++;
    }
    const dateStart = offsets[index] + match[1].length;
    found.push({ date: { value: match[2], text: match[2], offset: dateStart, end: dateStart + match[2].length, rule: 'event' }, text: body, file,
      offset: offsets[index], end: offsets[end - 1] + lines[end - 1].length, site: 'list-entry', kind, ruleKey });
    index = end - 1;
  }
  return found;
}
/** Lines outside fenced code with absolute offsets, without a CRLF line's `\r` (increment 87a); fence markers themselves count as fenced. */
function plainLines(text: string): { text: string; start: number }[] {
  const result: { text: string; start: number }[] = []; let offset = 0, fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) result.push({ text: line.replace(/\r$/, ''), start: offset });
    offset += line.length + 1;
  }
  return result;
}
const HEADING = /^( {0,3}#{1,6}[ \t]+)(.*?)(?:[ \t]+#+)?[ \t]*$/;
/** Heading line ranges outside fenced code, used for section ownership like authored statuses. */
function headings(text: string): { start: number; end: number }[] {
  return plainLines(text).filter(line => HEADING.test(line.text) || /^ {0,3}#{1,6}$/.test(line.text)).map(line => ({ start: line.start, end: line.start + line.text.length }));
}
/** The first level-one heading, used to name a document. */
export function documentTitle(text: string): string | undefined {
  for (const line of plainLines(text)) { const match = /^ {0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line.text); if (match?.[1].trim()) return match[1].trim(); }
  return undefined;
}
/** Heading text without its date and the separators around it: `[0.23.2] - 2026-05-22` -> `[0.23.2]`. */
export function headingLabel(content: string, dateText: string): string {
  return content.replace(dateText, ' ').replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\s+([:,.;])/g, '$1')
    .replace(/^[\s\-–—:|,]+|[\s\-–—:|,]+$/g, '').replace(/\s{2,}/g, ' ').trim();
}
export function headingEvents(file: string, text: string, rule: DateRule): Found[] {
  const regex = new RegExp(rule.pattern ?? DEFAULT_DATE_PATTERN, 'gu'), found: Found[] = [];
  for (const line of plainLines(text)) {
    const match = HEADING.exec(line.text); if (!match) continue;
    const content = match[2], date = findStatusDate(content, regex); if (!date) continue;
    const at = line.start + match[1].length + date.offset;
    found.push({ date: { value: date.value, text: date.text, offset: at, end: at + date.text.length, rule: 'event' }, text: content, file, offset: line.start, end: line.start + line.text.length,
      site: 'heading', kind: rule.kind ?? 'milestone', ruleKey: rule.key, label: headingLabel(content, date.text) || undefined });
  }
  return found;
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Labelled metadata lines such as `**Created**: 2025-12-12`, outside lists, quotes, and fences; the label is case-insensitive. */
export function fieldEvents(file: string, text: string, rules: DateRule[]): Found[] {
  const title = documentTitle(text) ?? file, found: Found[] = [];
  const compiled = rules.map(rule => ({ rule, head: new RegExp(`^ {0,3}[*_]{0,2}[ \\t]*${escape(rule.label!).replace(/ /g, '[ \\t]+')}[ \\t]*[*_]{0,2}[ \\t]*:[ \\t]*[*_]{0,2}[ \\t]*`, 'iu'), date: new RegExp(rule.pattern ?? DEFAULT_DATE_PATTERN, 'gu') }));
  for (const line of plainLines(text)) {
    if (/^\s*>/.test(line.text) || /^\s*(?:[-+*]|\d+[.)])\s/.test(line.text)) continue;
    for (const { rule, head, date: regex } of compiled) {
      const prefix = head.exec(line.text); if (!prefix) continue;
      const date = findStatusDate(line.text.slice(prefix[0].length), regex); if (!date) continue;
      const at = line.start + prefix[0].length + date.offset;
      found.push({ date: { value: date.value, text: date.text, offset: at, end: at + date.text.length, rule: 'event' }, text: title, file, offset: line.start, end: line.start + line.text.length,
        site: 'field', kind: rule.kind ?? 'milestone', ruleKey: rule.key, label: rule.label });
      break;
    }
  }
  return found;
}

export function excluded(file: string, exclude: readonly string[]): boolean { return exclude.some(path => file === path || file.startsWith(`${path}/`)); }
/** Adds status dates and dated events to an index whose statuses are already mapped. Run only in the index worker. */
export function annotateDates(index: ProjectIndex, documents: Record<string, string>, settings: DateSettings = DEFAULT_DATE_SETTINGS): ProjectIndex {
  const enabled = settings.rules.filter(rule => rule.enabled);
  const statusRules = enabled.filter(rule => rule.site === 'status').map(rule => ({ key: rule.key, regex: new RegExp(rule.pattern ?? DEFAULT_STATUS_DATE_PATTERN, 'gu') }));
  // Status values come from rendered text; locate the matched text in the source range to report exact offsets. The first rule that finds a date wins.
  const dated = (o: Occurrence): Occurrence => {
    if (!statusRules.length || !o.authoredStatus) return o;
    return { ...o, authoredStatus: { ...o.authoredStatus, evidence: o.authoredStatus.evidence.map(e => {
      if (excluded(e.source.file, settings.exclude)) return e;
      let found: DateMatch | undefined, ruleKey = '';
      for (const rule of statusRules) if ((found = findStatusDate(e.value, rule.regex))) { ruleKey = rule.key; break; }
      if (!found) return e;
      const region = documents[e.source.file]?.slice(e.source.offset, e.source.end) ?? '', at = region.indexOf(found.text);
      const offset = at < 0 ? e.source.offset : e.source.offset + at, end = at < 0 ? e.source.end : offset + found.text.length;
      return { ...e, date: { value: found.value, text: found.text, offset, end, ruleKey } };
    }) } };
  };
  const listRules = enabled.filter(rule => rule.site === 'list-entry'), headingRules = enabled.filter(rule => rule.site === 'heading'), fieldRules = enabled.filter(rule => rule.site === 'field');
  const events: IndexedEvent[] = [];
  for (const [file, text] of Object.entries(documents)) {
    if (excluded(file, settings.exclude)) continue;
    const entries = [...listRules.flatMap(rule => documentEvents(file, text, rule.key, rule.kind)), ...headingRules.flatMap(rule => headingEvents(file, text, rule)), ...(fieldRules.length ? fieldEvents(file, text, fieldRules) : [])];
    if (!entries.length) continue;
    entries.sort((a, b) => a.offset - b.offset);
    const sections = headings(text), definitions = index.definitions.filter(d => d.file === file), references = index.references.filter(r => r.file === file);
    for (const entry of entries) {
      // A heading that defines an ID owns its own date; other dates belong to the ID defined by the nearest preceding heading, ending at the next heading.
      const heading = entry.site === 'heading' ? sections.find(h => h.start === entry.offset) : sections.filter(h => h.start < entry.offset).at(-1);
      const owner = heading && definitions.find(d => d.offset >= heading.start && d.offset < heading.end);
      const mentioned = [...new Set(references.filter(r => r.offset >= entry.offset && r.offset < entry.end).map(r => idKey(r)))];
      events.push({ ...entry, mentioned, ...(owner ? { owner: idKey(owner) } : {}) });
    }
  }
  return { ...index, definitions: index.definitions.map(dated), references: index.references.map(dated), events };
}
