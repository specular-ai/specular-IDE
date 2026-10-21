import type { CustomPluginModule, CustomViewContext, PhysicalModel, ProjectModel, RenderRequest } from '@specular/plugin-api';

/** Increment 25: events come from the project model (recorded entries and dated statuses); the plugin no longer parses Markdown.
 * Collection, filtering, and counting stay pure so they can be exercised without a DOM. */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A visible ceiling: a capped collection is reported, never silently trimmed. */
export const EVENT_LIMIT = 20000;
export const PAGE = 50;

/** `entry`: a dated list entry; `status`: a status written with a date; `milestone`/`snapshot`: dated headings and labelled fields (increment 80). */
export type EventKind = 'entry' | 'status' | 'milestone' | 'snapshot';
const KINDS: readonly EventKind[] = ['entry', 'status', 'milestone', 'snapshot'];
export const KIND_LABELS: Readonly<Record<EventKind, string>> = { entry: 'Recorded entries', status: 'Statuses', milestone: 'Milestones', snapshot: 'Last updated' };
export interface TimelineEvent {
  readonly id: string;
  readonly kind: EventKind;
  /** Real ISO calendar day, with no time-of-day or same-day ordering claim. */
  readonly date: string;
  readonly text: string;
  /** ID keys: mentions for entries, the owning ID for statuses. */
  readonly ids: readonly string[];
  readonly file: string;
  readonly line: number;
  /** Evidence range: the whole entry, or the matched status date. */
  readonly start: number;
  readonly end: number;
  readonly status?: { readonly key: string; readonly name: string };
  /** Field label (`Created`) or heading text without its date, and where the date was written. */
  readonly label?: string;
  readonly site?: 'list-entry' | 'heading' | 'field';
}
export interface TimelineFilters { readonly file: string; readonly id: string; readonly from: string; readonly to: string; readonly kind: '' | EventKind; readonly status: string }
export const NO_FILTERS: TimelineFilters = { file: '', id: '', from: '', to: '', kind: '', status: '' };
export type TimelineModels = { readonly project: Pick<ProjectModel, 'events' | 'ids' | 'occurrences'>; readonly physical: Pick<PhysicalModel, 'documents'> };

export function validDate(value: string): boolean {
  const parts = DATE.exec(value); if (!parts) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.getUTCFullYear() === Number(parts[1]) && parsed.getUTCMonth() + 1 === Number(parts[2]) && parsed.getUTCDate() === Number(parts[3]);
}
/** Readable label for an opaque ID key; folder-scoped keys become `FR-001 · specs/x`. */
export function keyLabel(key: string): string {
  if (!key.startsWith('@')) return key;
  try { const [scope, id] = JSON.parse(key.slice(1)); if (typeof scope === 'string' && typeof id === 'string') return scope ? `${id} · ${scope}` : id; } catch { /* Not a scoped key. */ }
  return key;
}
/** Project scope: recorded entries and dated statuses from the project model; lines come from physical-model text. */
export function collectEvents(models: TimelineModels, limit = EVENT_LIMIT): { events: TimelineEvent[]; capped: boolean } {
  const texts = new Map(models.physical.documents.map(document => [document.file, document.text]));
  const line = (file: string, offset: number) => (texts.get(file) ?? '').slice(0, offset).split('\n').length;
  const labels = new Map<string, string>();
  for (const o of models.project.occurrences) if (o.kind === 'definition' && !labels.has(o.key ?? o.id)) labels.set(o.key ?? o.id, o.label);
  // Events from typed date rules keep their kind; models from before increment 80 have none and are recorded entries.
  const entries: TimelineEvent[] = models.project.events.map(event => ({ id: `${event.source.file}:${event.source.start}`, kind: event.kind ?? 'entry', date: event.date.value, text: event.text,
    ids: event.mentionedIds, file: event.source.file, line: line(event.source.file, event.source.start), start: event.source.start, end: event.source.end,
    ...(event.label ? { label: event.label } : {}), ...(event.site ? { site: event.site } : {}) }));
  const statuses: TimelineEvent[] = models.project.ids.flatMap(element => (element.status?.occurrences ?? []).flatMap(occurrence => {
    if (!occurrence.date) return [];
    const label = labels.get(element.key) ?? '', source = occurrence.date.source;
    return [{ id: `status:${source.file}:${source.start}`, kind: 'status' as const, date: occurrence.date.value,
      text: !label || label.startsWith(element.id) ? (label || keyLabel(element.key)) : `${keyLabel(element.key)} · ${label}`,
      ids: [element.key], file: source.file, line: line(source.file, source.start), start: source.start, end: source.end, status: { key: element.key, name: occurrence.name } }];
  }));
  // Cap in deterministic path/position order, then show ascending days; equal days keep that order and claim no time of day.
  const all = [...entries, ...statuses].sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start);
  const events = all.slice(0, limit);
  events.sort((a, b) => a.date.localeCompare(b.date) || a.file.localeCompare(b.file) || a.start - b.start);
  return { events, capped: all.length > limit };
}
export function invalidRange(filters: TimelineFilters): boolean { return !!filters.from && !!filters.to && filters.from > filters.to; }
export function filtered(events: readonly TimelineEvent[], filters: TimelineFilters): TimelineEvent[] {
  if (invalidRange(filters)) return [];
  return events.filter(event => (!filters.file || event.file === filters.file) && (!filters.id || event.ids.includes(filters.id)) &&
    (!filters.from || event.date >= filters.from) && (!filters.to || event.date <= filters.to) &&
    (!filters.kind || event.kind === filters.kind) && (!filters.status || event.status?.name === filters.status));
}
export function counts(events: readonly TimelineEvent[], matching: readonly TimelineEvent[]) {
  return { matching: matching.length, total: events.length, files: new Set(matching.map(event => event.file)).size, totalFiles: new Set(events.map(event => event.file)).size };
}
export function days(events: readonly TimelineEvent[]): Array<{ date: string; events: TimelineEvent[] }> {
  const groups: Array<{ date: string; events: TimelineEvent[] }> = [];
  for (const event of events) {
    if (groups[groups.length - 1]?.date !== event.date) groups.push({ date: event.date, events: [] });
    groups[groups.length - 1].events.push(event);
  }
  return groups;
}
export function sourceFiles(events: readonly TimelineEvent[]): string[] { return [...new Set(events.map(event => event.file))].sort((a, b) => a.localeCompare(b)); }
export function mentionedIds(events: readonly TimelineEvent[]): string[] { return [...new Set(events.flatMap(event => event.ids))].sort((a, b) => keyLabel(a).localeCompare(keyLabel(b))); }
/** Every configured status in configured order, then any unconfigured names that dated statuses use. */
export function statusNames(events: readonly TimelineEvent[], configured: readonly { readonly name: string }[]): string[] {
  const names = configured.map(status => status.name);
  return [...names, ...[...new Set(events.flatMap(event => event.status ? [event.status.name] : []))].filter(name => !names.includes(name)).sort((a, b) => a.localeCompare(b))];
}
/** Restored state is plugin data: validate it and re-derive evidence from the new models. */
export function readState(text: string | undefined): { filters: TimelineFilters; page: number } {
  const fallback = { filters: NO_FILTERS, page: 0 };
  if (!text) return fallback;
  try {
    const state = JSON.parse(text);
    if (!state || typeof state !== 'object') return fallback;
    const value = (key: string) => (typeof state[key] === 'string' && state[key].length <= 4096 ? state[key] as string : '');
    const day = (key: string) => (validDate(value(key)) ? value(key) : '');
    const kind = KINDS.includes(value('kind') as EventKind) ? value('kind') as EventKind : '';
    return { filters: { file: value('file'), id: value('id'), from: day('from'), to: day('to'), kind, status: value('status') },
      page: Number.isSafeInteger(state.page) && state.page >= 0 ? state.page as number : 0 };
  } catch { return fallback; }
}

/** Increment 75 histogram: whole-range buckets, stacked by the files with most entries. */
export type BucketUnit = 'day' | 'week' | 'month';
export const SERIES = 5;
const DAY = 86400000;
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
export function addDays(date: string, days: number): string { return iso(time(date) + days * DAY); }
/** Days up to 92, Monday-start weeks up to 104, calendar months beyond. */
export function bucketUnit(first: string, last: string): BucketUnit {
  if ((time(last) - time(first)) / DAY + 1 <= 92) return 'day';
  return (time(bucketStart(last, 'week')) - time(bucketStart(first, 'week'))) / (7 * DAY) + 1 <= 104 ? 'week' : 'month';
}
export function bucketStart(date: string, unit: BucketUnit): string {
  if (unit === 'day') return date;
  if (unit === 'month') return `${date.slice(0, 7)}-01`;
  return addDays(date, -((new Date(time(date)).getUTCDay() + 6) % 7));
}
/** Inclusive last day of the bucket beginning at start. */
export function bucketEnd(start: string, unit: BucketUnit): string {
  if (unit === 'day') return start;
  if (unit === 'week') return addDays(start, 6);
  const year = Number(start.slice(0, 4)), month = Number(start.slice(5, 7));
  const next = month === 12 ? `${String(year + 1).padStart(4, '0')}-01-01` : `${start.slice(0, 5)}${String(month + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}
export interface HistogramBucket {
  readonly start: string;
  readonly end: string;
  readonly total: number;
  readonly matching: number;
  /** One per series in order, then Other files when present; segments sum to the bucket total. */
  readonly segments: readonly { readonly total: number; readonly matching: number }[];
}
export interface Histogram {
  readonly unit: BucketUnit;
  readonly series: readonly { readonly file: string; readonly count: number }[];
  readonly other: { readonly files: number; readonly count: number };
  readonly buckets: readonly HistogramBucket[];
}
/** Counts every collected event; matching marks the subset drawn solidly (file/ID filters, not dates). */
export function histogram(events: readonly TimelineEvent[], matching: readonly TimelineEvent[], seriesLimit = SERIES): Histogram {
  if (!events.length) return { unit: 'day', series: [], other: { files: 0, count: 0 }, buckets: [] };
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.file, (counts.get(event.file) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const series = ranked.slice(0, seriesLimit).map(([file, count]) => ({ file, count }));
  const other = { files: ranked.length - series.length, count: ranked.slice(seriesLimit).reduce((sum, [, count]) => sum + count, 0) };
  const dates = events.map(event => event.date).sort();
  const first = dates[0], last = dates[dates.length - 1], unit = bucketUnit(first, last);
  const slots = series.length + (other.files ? 1 : 0), index = new Map<string, number>();
  const buckets: Array<{ start: string; end: string; total: number; matching: number; segments: Array<{ total: number; matching: number }> }> = [];
  for (let start = bucketStart(first, unit); start <= last; start = addDays(bucketEnd(start, unit), 1)) {
    index.set(start, buckets.length);
    buckets.push({ start, end: bucketEnd(start, unit), total: 0, matching: 0, segments: Array.from({ length: slots }, () => ({ total: 0, matching: 0 })) });
  }
  const slot = new Map(series.map((item, position) => [item.file, position])), matched = new Set(matching.map(event => event.id));
  for (const event of events) {
    const bucket = buckets[index.get(bucketStart(event.date, unit))!], segment = bucket.segments[slot.get(event.file) ?? series.length];
    bucket.total++; segment.total++;
    if (matched.has(event.id)) { bucket.matching++; segment.matching++; }
  }
  return { unit, series, other, buckets };
}
/** Index of the bucket holding today, or -1 when today is outside the charted range. */
export function todayBucket(model: Histogram, today: string): number {
  return model.buckets.findIndex(bucket => bucket.start <= today && today <= bucket.end);
}
export function localToday(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const STYLE = `
:root[data-theme="light"] {
  color-scheme: light;
  --surface-base: var(--specular-surface, #ffffff); --surface-raised: var(--specular-background, #f4f7fa); --surface-selected: var(--specular-selection, #c9e7e2);
  --border-strong: var(--specular-border, #a8b8c5); --text-primary: var(--specular-text, #243442); --text-muted: var(--specular-muted, #526575);
  --text-accent: var(--specular-accent, #176c63); --text-warning: var(--specular-warning, #80520c);
  --series-0: #1f6fbf; --series-1: #c0611a; --series-2: #2e8550; --series-3: #9a4fa0; --series-4: #8a6d00; --series-other: #7a8793;
}
:root { --series-0: #6cb6ff; --series-1: #f0a05a; --series-2: #7fd39a; --series-3: #d99ad9; --series-4: #e6d36b; --series-other: #8a99a6; }
:root { color-scheme: dark; font-family: "Segoe UI", system-ui, sans-serif; font-size: 13px; color: var(--text-primary, #d7e0e6); background: var(--surface-base, #101318); }
* { box-sizing: border-box; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--text-accent, #8bd5cc); outline-offset: -2px; }
.project-timeline { min-height: 100vh; padding: 18px; background: var(--surface-raised, #171d24); }
.project-timeline h2 { margin: 0 0 8px; font-size: 20px; color: var(--text-accent, #def0ec); }
.project-timeline h3 { margin: 18px 0 8px; font-size: 13px; color: var(--text-accent, #a8eadc); }
.timeline-intro, .timeline-summary, .timeline-scope p, .timeline-pager span { font-size: 12px; line-height: 1.6; color: var(--text-muted, #a1b0bc); }
.timeline-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px 12px; align-items: end; margin: 16px 0 10px; }
.timeline-controls label { display: block; font-size: 11px; margin-bottom: 4px; }
.timeline-controls input, .timeline-controls select { width: 100%; min-width: 0; padding: 7px; background: var(--surface-base, #11161c); border: 1px solid var(--border-strong, #40505e); border-radius: 4px; }
.timeline-summary { margin: 0 0 10px; }
.timeline-scope { margin: 0 0 14px; }
.timeline-scope summary { font-size: 12px; cursor: pointer; color: var(--text-muted, #a1b0bc); }
.timeline-event { margin: 0 0 8px; padding: 11px 12px; background: var(--surface-base, #11161c); border: 1px solid var(--surface-selected, #29313a); border-radius: 6px; }
.timeline-event p { margin: 0 0 6px; white-space: pre-wrap; }
.timeline-event small { display: block; font-size: 11px; color: var(--text-muted, #91a0ad); }
.timeline-evidence { margin-top: 7px; }
.button { min-height: 32px; padding: 6px 11px; border: 1px solid var(--surface-selected, #39464f); border-radius: 6px; background: var(--surface-raised, #202933); }
.button:hover:not(:disabled) { background: var(--surface-selected, #2a3741); border-color: var(--text-muted, #607581); }
.quiet-button { padding: 5px 7px; font-size: 11px; background: none; border: none; color: var(--text-muted, #91a0ad); }
.quiet-button:hover { color: var(--text-accent, #8bd5cc); }
.timeline-pager { display: flex; gap: 10px; align-items: center; margin: 12px 0 0; }
.coral { color: var(--text-warning, #e3ba78); }
.timeline-label { display: inline-block; margin: 0 6px 6px 0; padding: 1px 6px; font-size: 11px; border: 1px solid var(--surface-selected, #29313a); border-radius: 4px; color: var(--text-accent, #a8eadc); }
.timeline-status { display: inline-block; margin: 0 0 6px; padding: 1px 6px; font-size: 11px; border-left: 4px solid var(--text-muted, #91a0ad); background: var(--surface-raised, #171d24); }
.timeline-chart { margin: 14px 0 6px; }
.timeline-chart > summary { font-size: 12px; cursor: pointer; color: var(--text-muted, #a1b0bc); }
.chart-body svg { display: block; margin-top: 8px; touch-action: none; user-select: none; }
.chart-axis { stroke: var(--border-strong, #40505e); }
.chart-grid { stroke: var(--surface-selected, #29313a); stroke-dasharray: 2 3; }
.chart-label { font-size: 10px; fill: var(--text-muted, #a1b0bc); }
.chart-range { fill: var(--text-accent, #8bd5cc); opacity: .13; }
.chart-preview { fill: var(--text-accent, #8bd5cc); opacity: .22; }
.chart-today { stroke: var(--text-warning, #e3ba78); stroke-dasharray: 4 3; }
.chart-today-label { font-size: 10px; fill: var(--text-warning, #e3ba78); }
.chart-faint, .chart-solid { fill: var(--c); }
.chart-faint { opacity: .3; }
.chart-hit { fill: transparent; cursor: pointer; }
.chart-hit:focus { outline: none; }
.chart-hit:focus-visible { stroke: var(--text-accent, #8bd5cc); stroke-width: 2; }
.s0 { --c: var(--series-0); } .s1 { --c: var(--series-1); } .s2 { --c: var(--series-2); } .s3 { --c: var(--series-3); } .s4 { --c: var(--series-4); } .so { --c: var(--series-other); }
.chart-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin: 6px 0; font-size: 11px; }
.chart-key { padding: 3px 6px; font-size: 11px; background: none; border: 1px solid transparent; border-radius: 4px; color: var(--text-primary, #d7e0e6); }
.chart-key[aria-pressed="true"] { border-color: var(--text-accent, #8bd5cc); }
.chart-key::before { content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 2px; background: var(--c); vertical-align: -1px; }
.chart-readout { min-height: 1.6em; margin: 4px 0; font-size: 12px; color: var(--text-muted, #a1b0bc); }
.chart-table summary { font-size: 11px; cursor: pointer; color: var(--text-muted, #a1b0bc); }
.chart-table table { margin-top: 6px; border-collapse: collapse; font-size: 11px; }
.chart-table th, .chart-table td { padding: 3px 10px 3px 0; text-align: left; vertical-align: top; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function shape<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
function action(text: string, onClick: () => void, className = 'quiet-button') {
  const node = el('button', text, className); node.type = 'button'; node.onclick = onClick; return node;
}
function control<K extends 'select' | 'input'>(tag: K, id: string, label: string, parent: HTMLElement) {
  const field = el('div'), caption = el('label', label), node = el(tag);
  node.id = id; caption.htmlFor = id; field.append(caption, node); parent.append(field); return node;
}
/** Keep a chosen value selectable after a refresh drops it, instead of silently widening the filter. */
function options(node: HTMLSelectElement, values: string[], all: string, selected: string, label: (value: string) => string = value => value) {
  node.replaceChildren();
  for (const value of ['', ...values]) { const item = el('option', value ? label(value) : all); item.value = value; node.append(item); }
  if (selected && !values.includes(selected)) { const item = el('option', `${label(selected)} (no longer present)`); item.value = selected; node.append(item); }
  node.value = selected;
}

export function activate(context: CustomViewContext) {
  const root = context.root as unknown as HTMLElement;
  let request = context.request;
  const restored = readState(request.customState);
  let filters = restored.filters, page = restored.page;
  // Before the first ready index there is nothing to show; afterwards, edits keep the last events but disable their links.
  let collected: { events: TimelineEvent[]; capped: boolean } = { events: [], capped: false };
  let contentKey = '', everReady = false, stale = false;

  const surface = el('section', '', 'project-timeline'); surface.id = 'project-timeline';
  const css = el('style'); css.textContent = STYLE;
  root.replaceChildren(css, surface);
  surface.append(el('h2', 'Project timeline'),
    el('p', 'Dated entries and dated statuses from the project model, across every Markdown file in this project, whichever document is open.', 'timeline-intro'));
  const warnings = el('p', '', 'coral'); warnings.hidden = true; surface.append(warnings);
  // The histogram band is a navigator over the cards: it reads and writes the same filters.
  const chart = el('details', '', 'timeline-chart'); chart.id = 'timeline-chart'; chart.open = true;
  const chartBody = el('div', '', 'chart-body');
  chart.append(el('summary', 'Entries over time'), chartBody); surface.append(chart);

  const controls = el('div', '', 'timeline-controls'); surface.append(controls);
  const file = control('select', 'timeline-file', 'Source file', controls);
  const mentioned = control('select', 'timeline-id', 'Mentioned ID', controls);
  const from = control('input', 'timeline-from', 'From (inclusive)', controls); from.type = 'date';
  const to = control('input', 'timeline-to', 'To (inclusive)', controls); to.type = 'date';
  const kind = control('select', 'timeline-kind', 'Event type', controls);
  options(kind, [...KINDS], 'All event types', filters.kind, value => KIND_LABELS[value as EventKind]);
  const statusFilter = control('select', 'timeline-status', 'Status', controls);
  const resetField = el('div');
  resetField.append(action('Show all events', () => {
    filters = NO_FILTERS; page = 0; file.value = ''; mentioned.value = ''; from.value = ''; to.value = ''; kind.value = ''; statusFilter.value = ''; changed();
  }, 'button'));
  controls.append(resetField);

  const summary = el('p', '', 'timeline-summary'); summary.id = 'timeline-summary'; summary.setAttribute('role', 'status'); surface.append(summary);
  const scope = el('details', '', 'timeline-scope');
  scope.append(el('summary', 'Recognized format and scope'),
    el('p', 'Recorded entries: Markdown list entries whose content begins with a real ISO calendar date, such as "- 2026-09-15: Recorded event", together with their indented continuation lines.'),
    el('p', 'Milestones and last-updated dates: headings containing a date, such as "## [1.2.0] - 2026-05-22", and labelled fields such as "**Created**: 2025-12-12", as configured in the project\u2019s date rules; last-updated dates are hidden unless their rule is enabled.'),
    el('p', 'Statuses: authored statuses of IDs whose value contains a date, such as "Status: Implemented on 2026-10-13", shown with the configured status name and colour. Both rules are configured in the project configuration; undated statuses are not shown.'),
    el('p', 'Ignored: quoted and fenced examples, invalid calendar dates, undated entries, document-level "Last updated" dates, dated headings and tables, and statuses outside an ID\u2019s section. Their absence is not evidence that no event occurred.'),
    el('p', 'Equal days keep a deterministic file-path and source-position order and claim no time-of-day ordering. Identical text and conflicting dates in different files stay separate accounts; nothing is merged or reconciled.'),
    el('p', 'Mentioned IDs follow the configured ID categories and are recorded text, not verified or causal links. A status records what the specification states, not verified delivery. Filters and pages change only the display.'));
  surface.append(scope);
  const content = el('div'); surface.append(content);

  const save = () => context.saveState?.(JSON.stringify({ ...filters, page }));
  function changed() { save(); render(); }
  file.onchange = () => { filters = { ...filters, file: file.value }; page = 0; changed(); };
  mentioned.onchange = () => { filters = { ...filters, id: mentioned.value }; page = 0; changed(); };
  from.onchange = () => { filters = { ...filters, from: from.value }; page = 0; changed(); };
  to.onchange = () => { filters = { ...filters, to: to.value }; page = 0; changed(); };
  kind.onchange = () => { filters = { ...filters, kind: kind.value as TimelineFilters['kind'] }; page = 0; changed(); };
  statusFilter.onchange = () => { filters = { ...filters, status: statusFilter.value }; page = 0; changed(); };

  function navigate(event: TimelineEvent) {
    save();
    context.openSource({ projectId: request.context.projectId, revision: request.context.revision, file: event.file, start: event.start, end: event.end });
  }
  function pager(parent: HTMLElement, count: number) {
    const row = el('div', '', 'timeline-pager');
    const previous = action('Previous events', () => { page -= 1; changed(); }); previous.disabled = page === 0;
    const next = action('Next events', () => { page += 1; changed(); }); next.disabled = (page + 1) * PAGE >= count;
    row.append(previous, el('span', `Showing ${count ? page * PAGE + 1 : 0}-${Math.min((page + 1) * PAGE, count)} of ${count} matching event(s)`), next);
    parent.append(row);
  }
  let focused = 0, refocus = false, chartWidth = 0;
  let drag: { anchor: number; current: number } | undefined;
  function select(from: string, to: string, keyboard = false) {
    filters = { ...filters, from, to }; page = 0; refocus = keyboard; changed();
    content.querySelector('h3')?.scrollIntoView({ block: 'nearest' });
  }
  function renderChart() {
    const { events } = collected;
    drag = undefined; chartBody.replaceChildren();
    if (!events.length) { chartBody.append(el('p', 'No dated entries to chart.', 'timeline-intro')); return; }
    const model = histogram(events, filtered(events, { ...filters, from: '', to: '' }));
    const { buckets, series, unit } = model, count = buckets.length;
    focused = Math.min(focused, count - 1);
    const range = (bucket: HistogramBucket) => (bucket.start === bucket.end ? bucket.start : `${bucket.start} to ${bucket.end}`);
    const name = (segment: number) => (segment < series.length ? series[segment].file : 'Other files');
    const describe = (bucket: HistogramBucket) => `${range(bucket)}: ${plural(bucket.total, 'entry', 'entries')}, ${bucket.matching} matching the file and ID filters`
      + bucket.segments.map((segment, index) => (segment.total ? `; ${name(index)} ${segment.total}` : '')).join('') + '.';
    chartBody.append(el('p', `Dated entries per ${unit}, ${buckets[0].start} to ${buckets[count - 1].end}. Faint bars count every entry; solid bars match the file and ID filters. Select a bar, or drag across bars, to filter the cards by date.`, 'timeline-intro'));

    const width = chartWidth = Math.max(320, Math.floor(chartBody.clientWidth || 640)), height = 170;
    const left = 34, right = 8, top = 12, bottom = 22, plotW = width - left - right, plotH = height - top - bottom;
    const slot = plotW / count, bar = Math.max(1, Math.min(slot * 0.8, 48)), max = Math.max(1, ...buckets.map(bucket => bucket.total));
    const y = (value: number) => top + plotH - (value / max) * plotH, x = (index: number) => left + index * slot;
    const graphic = shape('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': `Histogram of dated entries per ${unit}` });
    for (const value of new Set([0, Math.round(max / 2), max])) {
      const label = shape('text', { x: left - 6, y: y(value) + 3, 'text-anchor': 'end', class: 'chart-label' }); label.textContent = String(value);
      graphic.append(shape('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), class: value ? 'chart-grid' : 'chart-axis' }), label);
    }
    const every = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotW / 80))));
    for (let index = 0; index < count; index += every) {
      const label = shape('text', { x: x(index) + slot / 2, y: height - 6, 'text-anchor': 'middle', class: 'chart-label' });
      label.textContent = unit === 'month' ? buckets[index].start.slice(0, 7) : buckets[index].start; graphic.append(label);
    }
    // The active date range is highlighted, never zoomed, so the whole project stays in view.
    if ((filters.from || filters.to) && !invalidRange(filters)) {
      const low = buckets.findIndex(bucket => bucket.end >= (filters.from || '0000-01-01'));
      let high = count - 1; while (high >= 0 && buckets[high].start > (filters.to || '9999-12-31')) high--;
      if (low >= 0 && high >= low) graphic.append(shape('rect', { x: x(low), y: top, width: (high - low + 1) * slot, height: plotH, class: 'chart-range' }));
    }
    buckets.forEach((bucket, index) => {
      let base = 0;
      bucket.segments.forEach((segment, position) => {
        if (!segment.total) return;
        const tone = position < series.length ? `s${position}` : 'so', offset = x(index) + (slot - bar) / 2;
        graphic.append(shape('rect', { x: offset, y: y(base + segment.total), width: bar, height: y(base) - y(base + segment.total), class: `chart-faint ${tone}` }));
        if (segment.matching) graphic.append(shape('rect', { x: offset, y: y(base + segment.matching), width: bar, height: y(base) - y(base + segment.matching), class: `chart-solid ${tone}` }));
        base += segment.total;
      });
    });
    const today = todayBucket(model, localToday());
    if (today >= 0) {
      const center = x(today) + slot / 2, label = shape('text', { x: center + 3, y: top + 8, class: 'chart-today-label' }); label.textContent = 'today';
      graphic.append(shape('line', { x1: center, x2: center, y1: top, y2: top + plotH, class: 'chart-today' }), label);
    }
    const preview = shape('rect', { x: 0, y: top, width: 0, height: plotH, class: 'chart-preview' }); graphic.append(preview);
    const hits = buckets.map((bucket, index) => {
      const hit = shape('rect', { x: x(index), y: top, width: slot, height: plotH, class: 'chart-hit', role: 'button', tabindex: index === focused ? 0 : -1, 'aria-label': describe(bucket), 'data-index': index });
      const title = shape('title'); title.textContent = describe(bucket); hit.append(title); graphic.append(hit); return hit;
    });
    const readout = el('p', 'Hover over or focus a bar to read its counts.', 'chart-readout'); readout.setAttribute('aria-live', 'polite');
    const show = (index: number) => { readout.textContent = describe(buckets[index]); };
    const at = (event: PointerEvent) => Math.min(count - 1, Math.max(0, Math.floor((event.clientX - graphic.getBoundingClientRect().left - left) / slot)));
    const stretch = (a: number, b: number) => { preview.setAttribute('x', String(x(Math.min(a, b)))); preview.setAttribute('width', String((Math.abs(a - b) + 1) * slot)); };
    graphic.onpointerdown = event => { const index = at(event); drag = { anchor: index, current: index }; stretch(index, index); graphic.setPointerCapture(event.pointerId); };
    graphic.onpointermove = event => {
      const index = at(event); show(index);
      if (drag && index !== drag.current) { drag.current = index; stretch(drag.anchor, index); }
    };
    graphic.onpointerup = () => {
      if (!drag) return;
      const low = Math.min(drag.anchor, drag.current), high = Math.max(drag.anchor, drag.current);
      focused = drag.current; drag = undefined; select(buckets[low].start, buckets[high].end);
    };
    graphic.onpointercancel = () => { drag = undefined; preview.setAttribute('width', '0'); };
    graphic.addEventListener('focusin', event => { const raw = (event.target as Element).getAttribute('data-index'); if (raw !== null) { focused = Number(raw); show(focused); } });
    graphic.onkeydown = event => {
      const moves: Record<string, number> = { ArrowLeft: focused - 1, ArrowRight: focused + 1, Home: 0, End: count - 1 };
      if (event.key in moves) {
        event.preventDefault(); hits[focused].setAttribute('tabindex', '-1');
        focused = Math.min(count - 1, Math.max(0, moves[event.key])); hits[focused].setAttribute('tabindex', '0'); hits[focused].focus();
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(buckets[focused].start, buckets[focused].end, true); }
    };

    const legend = el('div', '', 'chart-legend');
    series.forEach((item, index) => {
      const key = action(`${item.file} (${item.count})`, () => { filters = { ...filters, file: filters.file === item.file ? '' : item.file }; page = 0; changed(); }, `chart-key s${index}`);
      key.setAttribute('aria-pressed', String(filters.file === item.file)); key.title = `Show only ${item.file}`; legend.append(key);
    });
    if (model.other.files) legend.append(el('span', `Other files: ${plural(model.other.files, 'file', 'files')}, ${plural(model.other.count, 'entry', 'entries')}`, 'chart-key so'));

    const table = el('details', '', 'chart-table'), rows = el('table'), head = el('tr');
    for (const label of ['Dates', 'Entries', 'Matching', 'By file']) head.append(el('th', label));
    rows.append(head);
    for (const bucket of buckets) {
      if (!bucket.total) continue;
      const row = el('tr');
      row.append(el('td', range(bucket)), el('td', String(bucket.total)), el('td', String(bucket.matching)),
        el('td', bucket.segments.map((segment, index) => (segment.total ? `${name(index)} ${segment.total}` : '')).filter(Boolean).join('; ')));
      rows.append(row);
    }
    table.append(el('summary', `Entries per ${unit} as a table`), rows);
    chartBody.append(graphic, legend, readout, table);
    if (refocus) { refocus = false; hits[focused].focus(); }
  }
  // Re-lay out only when the available width changes; content changes already re-render.
  const resize = new ResizeObserver(() => { if (chart.open && Math.max(320, Math.floor(chartBody.clientWidth || 640)) !== chartWidth) renderChart(); });
  resize.observe(chartBody);
  function render() {
    const { events, capped } = collected;
    renderChart();
    options(file, sourceFiles(events), 'All files', filters.file);
    options(mentioned, mentionedIds(events), 'All mentioned IDs', filters.id, keyLabel);
    const project = request.models.project!;
    options(statusFilter, statusNames(events, project.configuration.statuses), 'All statuses', filters.status);
    kind.value = filters.kind;
    from.value = filters.from; to.value = filters.to;
    warnings.hidden = !request.models.physical!.warnings.length;
    warnings.textContent = request.models.physical!.warnings.join(' ');
    const matching = filtered(events, filters), total = counts(events, matching);
    page = Math.min(page, Math.max(0, Math.ceil(matching.length / PAGE) - 1));
    summary.textContent = (stale ? 'Updating to the latest edits; source links return when indexing finishes. ' : '') + `${total.matching} of ${total.total} event(s) from ${total.files} of ${total.totalFiles} contributing file(s); ${request.models.physical!.documents.length} Markdown file(s) in scope.`
      + (capped ? ` Collection stopped at the first ${EVENT_LIMIT} events in project path order, so these totals are incomplete.` : '');
    content.replaceChildren();
    if (invalidRange(filters)) {
      content.append(el('p', `The range ends before it starts: ${filters.from} is later than ${filters.to}. Correct a date or choose Show all events.`, 'coral'));
      pager(content, 0); return;
    }
    if (!everReady) { content.append(el('p', 'Waiting for the project index...', 'timeline-intro')); return; }
    if (!matching.length) {
      content.append(el('p', events.length
        ? 'No events match these filters. Change a filter or choose Show all events.'
        : request.models.physical!.documents.length
          ? 'No dated entries or dated statuses in this project’s Markdown. Open Recognized format and scope for the extracted formats.'
          : 'This project has no Markdown files to collect from.', 'timeline-intro'));
      pager(content, 0); return;
    }
    for (const group of days(matching.slice(page * PAGE, (page + 1) * PAGE))) {
      content.append(el('h3', group.date));
      for (const event of group.events) {
        const article = el('article', '', 'timeline-event'); article.dataset.file = event.file; article.dataset.kind = event.kind;
        if (event.status) {
          // Status cards: owning ID and label, then the configured status name in its colour for the current theme.
          const badge = el('span', `Status: ${event.status.name}`, 'timeline-status');
          const color = project.configuration.statuses.find(entry => entry.name === event.status!.name)?.colors?.[request.appearance?.mode ?? 'dark'];
          if (color) badge.style.borderLeftColor = color;
          article.append(el('p', event.text), badge);
        } else if (event.site === 'field') {
          // Labelled fields: the label (Created, Last Updated) as a badge, then the document title.
          article.append(el('span', event.kind === 'snapshot' ? `${event.label} (last touched)` : event.label ?? '', 'timeline-label'), el('p', event.text));
        } else if (event.site === 'heading') {
          article.append(el('span', 'Heading', 'timeline-label'), el('p', event.label ?? event.text));
          if (event.ids.length) article.append(el('small', `Mentioned IDs: ${event.ids.map(keyLabel).join(', ')}`));
        } else {
          article.append(el('p', event.text));
          if (event.ids.length) article.append(el('small', `Mentioned IDs: ${event.ids.map(keyLabel).join(', ')}`));
        }
        article.append(el('small', event.file));
        const evidence = el('div', '', 'timeline-evidence');
        const open = action(`Open ${event.file}:${event.line}`, () => navigate(event), 'button'); open.disabled = stale;
        evidence.append(open);
        article.append(evidence); content.append(article);
      }
    }
    pager(content, matching.length);
  }
  function update(next: RenderRequest) {
    // Only a project/content or readiness change alters the events; theme and active-file updates keep the view as it is.
    const project = next.models.project!;
    const key = `${next.context.projectId}:${next.context.revision}:${project.ready}`;
    const unchanged = key === contentKey;
    request = next; contentKey = key;
    if (unchanged) return;
    if (project.ready) { collected = collectEvents({ project, physical: next.models.physical! }); everReady = true; stale = false; }
    else stale = everReady;
    render();
  }
  update(request);
  return { update, dispose() { resize.disconnect(); file.onchange = null; mentioned.onchange = null; from.onchange = null; to.onchange = null; kind.onchange = null; statusFilter.onchange = null; root.replaceChildren(); } };
}

const plugin = { activate } satisfies CustomPluginModule;
export default plugin;
