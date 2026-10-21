import { configurationEntry, rememberConfigurationEntries } from './configuration-entry';
import { DEFAULT_DATE_PATTERN, DEFAULT_DATE_SETTINGS, DEFAULT_STATUS_DATE_PATTERN, excluded, validateDateSettings, type DateKind, type DateRule, type DateSettings, type DateSite } from '../core/dates';
import type { IdConfiguration } from '../core/id-configuration';
import type { ProjectIndex, SourceLocation } from '../shared/types';

const SITES: [DateSite, string][] = [['status', 'Status value'], ['list-entry', 'List entry'], ['heading', 'Heading'], ['field', 'Labelled field']];
const KINDS: [DateKind, string][] = [['entry', 'Recorded entry'], ['milestone', 'Milestone'], ['snapshot', 'Last updated (snapshot)']];
const siteName = (site: DateSite) => SITES.find(([value]) => value === site)![1];
const PREVIEW_FIRST = 5, PREVIEW_MORE = 20;
/** One found date in the draft preview, with a navigable location. */
interface FoundDate { value: string; text: string; location: SourceLocation }

/** Edits `dates` in the configuration draft (increment 81). Rule keys stay internal (REQ-182) and are generated on add. */
export class DateRulesEditor {
  readonly root = document.createElement('section');
  private list = document.createElement('div');
  private exclusions = document.createElement('div');
  private previewArea = document.createElement('div');
  private shown = new Map<string, number>();
  /** Expansion state follows the rule key, so materializing the defaults on first edit keeps entries open. */
  private models = new Map<string, object>();
  constructor(private draft: () => IdConfiguration, private changed: () => void, private folders: () => string[], private open: (location: SourceLocation) => void) {
    this.root.id = 'config-dates';
    const heading = document.createElement('div'); heading.className = 'config-section-heading';
    const title = document.createElement('h3'); title.textContent = 'Date rules';
    const restore = this.button('Restore default date rules', () => { delete this.draft().dates; this.shown.clear(); this.render(); this.changed(); });
    restore.id = 'config-dates-restore'; heading.append(title, restore);
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = 'Date rules find dates written in Markdown: inside status values, in dated list entries, in headings, and in labelled fields such as **Created**: 2025-12-12. Milestones mark something happening; Last updated snapshots are overwritten on every edit. Preview matches to see which dates each rule finds.';
    const add = document.createElement('div'); add.className = 'config-date-add';
    const site = document.createElement('select'); site.setAttribute('aria-label', 'New date rule site');
    for (const [value, text] of SITES) site.add(new Option(text, value));
    site.value = 'field';
    add.append(site, this.button('Add date rule', () => this.add(site.value as DateSite)));
    const exclusionTitle = document.createElement('h4'); exclusionTitle.textContent = 'Excluded from date rules';
    const exclusionHint = document.createElement('p'); exclusionHint.className = 'config-hint';
    exclusionHint.textContent = 'Folders or files whose dates are ignored, such as vendored upstream changelogs. Their IDs stay indexed.';
    const exclusionAdd = document.createElement('div'); exclusionAdd.className = 'config-date-add';
    const path = document.createElement('input'); path.type = 'text'; path.setAttribute('aria-label', 'Folder or file to exclude'); path.setAttribute('list', 'config-date-folders'); path.spellcheck = false; path.maxLength = 512;
    const folderList = document.createElement('datalist'); folderList.id = 'config-date-folders';
    path.onfocus = () => folderList.replaceChildren(...this.folders().map(folder => new Option(folder, folder)));
    exclusionAdd.append(path, folderList, this.button('Add exclusion', () => { if (!path.value.trim()) return; this.settings().exclude.push(path.value.trim()); path.value = ''; this.render(); this.changed(); }));
    this.list.className = 'config-list config-date-rules'; this.exclusions.className = 'config-date-exclusions'; this.previewArea.id = 'config-date-preview';
    this.root.append(heading, hint, add, this.list, exclusionTitle, exclusionHint, exclusionAdd, this.exclusions, this.previewArea);
  }
  private button(text: string, action: () => void, label = text) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = text; button.setAttribute('aria-label', label);
    button.onclick = action; return button;
  }
  /** The draft's settings, materializing the defaults on first edit. Absent settings mean the defaults. */
  private settings(): DateSettings {
    const config = this.draft();
    if (!config.dates) config.dates = structuredClone(DEFAULT_DATE_SETTINGS);
    return config.dates;
  }
  private view(): DateSettings { return this.draft().dates ?? DEFAULT_DATE_SETTINGS; }
  private add(site: DateSite) {
    const settings = this.settings(), used = new Set(settings.rules.map(rule => rule.key));
    let key: string = site, n = 2; while (used.has(key)) key = `${site}-${n++}`;
    const rule: DateRule = { key, site, enabled: true, ...(site === 'list-entry' ? {} : { pattern: site === 'status' ? DEFAULT_STATUS_DATE_PATTERN : DEFAULT_DATE_PATTERN }),
      ...(site === 'field' ? { label: '' } : {}), ...(site === 'status' ? {} : { kind: site === 'list-entry' ? 'entry' as const : 'milestone' as const }) };
    settings.rules.push(rule); this.render(); this.changed();
    this.list.querySelector<HTMLElement>('.config-entry:last-child')?.setAttribute('open', '');
    this.list.querySelector<HTMLInputElement>('.config-entry:last-child input[aria-label="Field label"]')?.focus();
  }
  /** Validates one rule in isolation so the row can explain its own problem before Preview. */
  private problem(rule: DateRule): string {
    try { validateDateSettings({ rules: [rule] }); return ''; } catch (error) { return (error instanceof Error ? error.message : String(error)).replace(/^Date rule [^:]+: /, ''); }
  }
  private title(rule: DateRule) { return `${siteName(rule.site)}${rule.site === 'field' ? `: ${rule.label || 'New label'}` : ''}${rule.enabled ? '' : ' (off)'}`; }
  render() {
    rememberConfigurationEntries(this.list);
    const view = this.view(), rules = view.rules;
    this.list.replaceChildren(...rules.map((rule, index) => {
      // Edits always target the materialized draft; the view may still be the shared defaults.
      const target = () => this.settings().rules[index];
      const row = document.createElement('div'); row.className = 'config-date-rule'; row.dataset.ruleIndex = String(index);
      const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = rule.enabled; enabled.setAttribute('aria-label', `Enable ${this.title({ ...rule, enabled: true })}`);
      // The entry title refreshes on change; re-rendering would replace the control being used.
      enabled.onchange = () => { target().enabled = enabled.checked; this.changed(); };
      const toggle = document.createElement('label'); toggle.className = 'config-checkbox'; toggle.append(enabled, 'Enabled');
      const site = document.createElement('select'); site.setAttribute('aria-label', 'Date site');
      for (const [value, text] of SITES) site.add(new Option(text, value));
      site.value = rule.site;
      site.onchange = () => {
        const next = site.value as DateSite, current = target();
        Object.assign(current, { site: next }); delete current.label; delete current.kind; delete current.pattern;
        if (next !== 'list-entry') current.pattern = next === 'status' ? DEFAULT_STATUS_DATE_PATTERN : DEFAULT_DATE_PATTERN;
        if (next === 'field') current.label = '';
        if (next !== 'status') current.kind = next === 'list-entry' ? 'entry' : 'milestone';
        this.render(); this.changed();
      };
      const field = (text: string, control: HTMLElement) => { const label = document.createElement('label'); label.append(text, control); return label; };
      row.append(toggle, field('Site', site));
      if (rule.site === 'field') {
        const label = document.createElement('input'); label.type = 'text'; label.maxLength = 128; label.spellcheck = false; label.value = rule.label ?? ''; label.setAttribute('aria-label', 'Field label');
        label.oninput = () => { target().label = label.value; this.changed(); this.mark(row, target()); };
        row.append(field('Field label', label));
      }
      if (rule.site !== 'status') {
        const kind = document.createElement('select'); kind.setAttribute('aria-label', 'Kind');
        for (const [value, text] of KINDS) kind.add(new Option(text, value));
        kind.value = rule.kind ?? 'milestone';
        kind.onchange = () => { target().kind = kind.value as DateKind; this.changed(); };
        row.append(field('Kind', kind));
      }
      if (rule.site !== 'list-entry') {
        // Patterns are an advanced setting; most rules only change labels and switches.
        const advanced = document.createElement('details'); advanced.className = 'config-date-advanced';
        const summary = document.createElement('summary'); summary.textContent = 'Advanced';
        const pattern = document.createElement('input'); pattern.type = 'text'; pattern.maxLength = 512; pattern.spellcheck = false; pattern.value = rule.pattern ?? ''; pattern.setAttribute('aria-label', 'Date pattern');
        pattern.oninput = () => { target().pattern = pattern.value; this.changed(); this.mark(row, target()); };
        const fallback = rule.site === 'status' ? DEFAULT_STATUS_DATE_PATTERN : DEFAULT_DATE_PATTERN;
        const reset = this.button('Restore default pattern', () => { target().pattern = fallback; this.render(); this.changed(); });
        const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'A regular expression with a named (?<date>...) capture for an ISO date; the first real calendar day wins.';
        advanced.append(summary, field('Date pattern', pattern), reset, hint); row.append(advanced);
      }
      const actions = document.createElement('div'); actions.className = 'config-date-actions';
      const up = this.button('Move up', () => { const list = this.settings().rules; [list[index - 1], list[index]] = [list[index], list[index - 1]]; this.render(); this.changed(); }, `Move ${this.title(rule)} up`); up.disabled = index === 0;
      const down = this.button('Move down', () => { const list = this.settings().rules; [list[index + 1], list[index]] = [list[index], list[index + 1]]; this.render(); this.changed(); }, `Move ${this.title(rule)} down`); down.disabled = index === rules.length - 1;
      actions.append(up, down, this.button('Remove', () => { this.settings().rules.splice(index, 1); this.render(); this.changed(); }, `Remove ${this.title(rule)}`));
      const message = document.createElement('p'); message.className = 'coral config-date-problem'; message.setAttribute('role', 'status');
      row.append(actions, message); this.mark(row, rule);
      const model = this.models.get(rule.key) ?? {}; this.models.set(rule.key, model);
      return configurationEntry(model, row, () => this.title(this.view().rules[index] ?? rule), !!this.problem(rule));
    }));
    if (!rules.length) { const empty = document.createElement('p'); empty.className = 'config-hint'; empty.textContent = 'No date rules: no dates are recorded. Add a rule or restore the defaults.'; this.list.append(empty); }
    this.exclusions.replaceChildren(...view.exclude.map((entry, index) => {
      const row = document.createElement('div'); row.className = 'config-date-exclusion';
      const input = document.createElement('input'); input.type = 'text'; input.value = entry; input.maxLength = 512; input.spellcheck = false; input.setAttribute('aria-label', 'Excluded path');
      const message = document.createElement('span'); message.className = 'coral';
      const check = () => { try { validateDateSettings({ exclude: [input.value] }); message.textContent = ''; } catch (error) { message.textContent = error instanceof Error ? error.message : String(error); } };
      input.oninput = () => { this.settings().exclude[index] = input.value; check(); this.changed(); };
      check(); row.append(input, this.button('Remove', () => { this.settings().exclude.splice(index, 1); this.render(); this.changed(); }, `Remove exclusion ${entry}`), message); return row;
    }));
  }
  private mark(row: HTMLElement, rule: DateRule) { row.querySelector('.config-date-problem')!.textContent = this.problem(rule); }
  clearPreview() { this.previewArea.replaceChildren(); this.shown.clear(); }
  /** Per-rule counts from the draft preview, the first few dates with navigation, and files skipped by exclusions. */
  renderPreview(index: ProjectIndex, documents: Record<string, string>, configuration: IdConfiguration) {
    const settings = configuration.dates ?? DEFAULT_DATE_SETTINGS;
    const location = (file: string, offset: number, end: number): SourceLocation => {
      const before = (documents[file] ?? '').slice(0, offset);
      return { file, offset, end, line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
    };
    const found = new Map<string, FoundDate[]>(), seen = new Set<string>();
    for (const event of index.events ?? []) found.set(event.ruleKey, [...(found.get(event.ruleKey) ?? []), { value: event.date.value, text: event.label ?? event.text.split('\n')[0], location: location(event.file, event.offset, event.end) }]);
    // Statuses are aggregated per ID across occurrences, so count each written date once.
    for (const item of index.definitions) for (const evidence of item.authoredStatus?.evidence ?? []) {
      const date = evidence.date; if (!date?.ruleKey) continue;
      const id = `${evidence.source.file}:${date.offset}`; if (seen.has(id)) continue; seen.add(id);
      found.set(date.ruleKey, [...(found.get(date.ruleKey) ?? []), { value: date.value, text: `${item.id}: ${evidence.display ?? evidence.value}`, location: location(evidence.source.file, date.offset, date.end) }]);
    }
    const heading = document.createElement('h4'); heading.textContent = 'Dates found by the draft rules';
    const skipped = Object.keys(documents).filter(file => excluded(file, settings.exclude)).length;
    const summary = document.createElement('p'); summary.className = 'config-hint'; summary.id = 'config-date-summary';
    summary.textContent = `${[...found.values()].reduce((sum, list) => sum + list.length, 0)} dates from ${settings.rules.filter(rule => rule.enabled).length} enabled rules; ${skipped} Markdown file${skipped === 1 ? '' : 's'} excluded.`;
    const groups = settings.rules.map(rule => {
      const dates = (found.get(rule.key) ?? []).sort((a, b) => a.value.localeCompare(b.value) || a.location.file.localeCompare(b.location.file) || a.location.offset - b.location.offset);
      const group = document.createElement('div'); group.className = 'config-date-found'; group.dataset.ruleKey = rule.key;
      const title = document.createElement('p'); title.className = 'config-date-found-title';
      title.textContent = `${this.title(rule)}: ${rule.enabled ? `${dates.length} date${dates.length === 1 ? '' : 's'}` : 'off'}`;
      if (rule.enabled && !dates.length) { title.classList.add('coral'); title.textContent += ' — check the label or pattern'; }
      group.append(title);
      const visible = this.shown.get(rule.key) ?? PREVIEW_FIRST;
      for (const date of dates.slice(0, visible)) {
        const item = this.button(`${date.value} · ${date.text} — ${date.location.file}:${date.location.line}`, () => this.open(date.location)); item.className = 'config-result'; group.append(item);
      }
      if (dates.length > visible) group.append(this.button(`Show more (${dates.length - visible} more)`, () => { this.shown.set(rule.key, visible + PREVIEW_MORE); this.renderPreview(index, documents, configuration); }, `Show more dates for ${this.title(rule)}`));
      return group;
    });
    this.previewArea.replaceChildren(heading, summary, ...groups);
  }
}
