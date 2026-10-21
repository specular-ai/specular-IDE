import { configurationEntry } from './configuration-entry';
import { statusKey, type StatusPalette } from '../core/statuses';
import type { IdConfiguration } from '../core/id-configuration';
import type { Occurrence, SourceLocation } from '../shared/types';
import { categoryPalette, validCategoryColor } from '../shared/category-colors';
import { styleCategoryCard } from './category-colors';
import { moduleBadges } from './module-card';
import { statusSiteGroups } from './status-sites';
import { DEFAULT_STATUS_SITES } from '../core/status-sites';

export function statusBadge(value: string, palettes: StatusPalette[], conflict = false) {
  const badge = document.createElement('span'); badge.className = 'status-badge'; badge.textContent = conflict ? 'Status conflict' : value;
  const entry = conflict ? undefined : palettes.find(p => statusKey(p.name) === statusKey(value));
  badge.title = conflict ? 'Conflicting authored statuses; inspect the source evidence.' : 'Authored status; not verified implementation.';
  for (const mode of ['light', 'dark'] as const) {
    const palette = categoryPalette({ key: 'status', name: value, colors: entry?.colors }, mode);
    for (const [key, color] of Object.entries(palette)) badge.style.setProperty(`--status-${mode}-${key}`, color);
  }
  return badge;
}
export function statusEvidence(item: Occurrence, palettes: StatusPalette[], navigate: (source: SourceLocation) => void) {
  const details = document.createElement('details'); details.className = 'status-evidence';
  const summary = document.createElement('summary'); summary.textContent = 'Status'; details.append(summary);
  for (const evidence of item.authoredStatus!.evidence) {
    const row = document.createElement('p'); const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button';
    button.textContent = `${evidence.source.file}:${evidence.source.line}`; button.onclick = () => navigate(evidence.source);
    row.append((evidence.site ? evidence.site + ': ' : '') + evidence.value + ' -> ', statusBadge(evidence.display ?? evidence.value, palettes), button); details.append(row);
  }
  return details;
}
export class StatusEditor {
  readonly root = document.createElement('section');
  private automatic = new WeakSet<StatusPalette>();
  private found = document.createElement('div');
  private foundDetails = document.createElement('details');
  private foundTitle = document.createElement('summary');
  private foundCount = 0;
  private message = document.createElement('p');
  constructor(private draft: () => IdConfiguration, private changed: () => void, private scan: () => void) {
    this.root.id = 'config-statuses';
    this.foundDetails.className = 'status-found'; this.foundDetails.append(this.foundTitle, this.found);
    this.foundDetails.ontoggle = () => this.updateFoundTitle(); this.updateFoundTitle();
  }
  private updateFoundTitle() { this.foundTitle.textContent = `${this.foundDetails.open ? 'Hide' : 'Show'} found authored texts (${this.foundCount})`; }
  reset() { this.message.textContent = ''; this.found.replaceChildren(); this.foundCount = 0; this.foundDetails.open = false; this.updateFoundTitle(); }
  discovered(items: Occurrence[]) {
    const config = this.draft(); const values = new Map<string, string>();
    for (const item of items) for (const e of item.authoredStatus?.evidence ?? []) values.set(statusKey(e.value), e.value);
    const known = new Set(config.statuses?.map(s => statusKey(s.name)));
    for (const item of items) for (const e of item.authoredStatus?.evidence ?? []) if (e.display && known.has(statusKey(e.display))) known.add(statusKey(e.value));
    this.found.replaceChildren(...[...values.values()].map(value => { const p = document.createElement('p'); p.textContent = value; return p; }));
    this.foundCount = values.size;
    if (!values.size) this.found.textContent = 'No authored status texts found.';
    this.updateFoundTitle();
    const additions = [...values].filter(([key]) => !known.has(key)).map(([, value]) => {
      const base = value.slice(0, 118); let name = base, suffix = 2;
      while (known.has(statusKey(name))) name = base + ' (' + suffix++ + ')';
      known.add(statusKey(name)); return { name, rules: [{ mode: 'exact' as const, value }] };
    });
    if ((config.statuses?.length ?? 0) + additions.length > 128) throw new Error('Scan found more than 128 statuses. Narrow the project before configuring the palette.');
    config.statuses = [...(config.statuses ?? []), ...additions];
    this.message.textContent = `Found ${values.size} authored status values; added ${additions.length}. Existing colors are preserved. Preview before Apply.`;
    this.render(); this.changed();
  }
  private extractionSites(entry: StatusPalette) {
    const section = document.createElement('details'); section.className = 'config-status-local-sites';
    const summary = document.createElement('summary'); summary.textContent = 'Authored-status extraction';
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = 'Inherit the applicable category/project sites or replace them for values uniquely matching this status. A new override copies the current project settings.';
    const label = document.createElement('label'); label.textContent = 'Status-specific extraction sites';
    const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Status-specific extraction sites');
    mode.add(new Option('Inherit applicable settings', 'inherit')); mode.add(new Option('Override for this status', 'override'));
    mode.value = entry.statusSites ? 'override' : 'inherit'; label.append(mode);
    const settings = entry.statusSites ?? structuredClone(this.draft().statusSites ?? DEFAULT_STATUS_SITES);
    const controls = document.createElement('div'); controls.className = 'config-status-local-site-controls'; controls.hidden = !entry.statusSites;
    const renderControls = () => controls.replaceChildren(...statusSiteGroups(settings, () => { entry.statusSites = structuredClone(settings); this.changed(); }));
    renderControls();
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'quiet-button'; reset.textContent = 'Restore inheritance';
    reset.onclick = () => { delete entry.statusSites; mode.value = 'inherit'; controls.hidden = true; this.changed(); };
    mode.onchange = () => {
      if (mode.value === 'override') {
        const inherited = structuredClone(this.draft().statusSites ?? DEFAULT_STATUS_SITES);
        settings.paragraphs = inherited.paragraphs; settings.tables = inherited.tables; settings.headings = inherited.headings;
        entry.statusSites = structuredClone(settings); renderControls(); controls.hidden = false;
      } else { delete entry.statusSites; controls.hidden = true; }
      this.changed();
    };
    section.append(summary, hint, label, controls, reset); return section;
  }  render() {
    const config = this.draft();
    const summary = document.createElement('h3'); summary.textContent = 'Authored statuses';
    const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'Scan authored values using Definition and status sites. Add future values and choose their colors. Labels describe authored statements, not verified implementation.';
    const button = (name: string, action: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'quiet-button'; b.textContent = name; b.onclick = action; return b; };
    const list = document.createElement('div'); list.className = 'status-list';
    for (const entry of config.statuses ?? []) {
      entry.rules ??= [{ mode: 'exact', value: entry.name }];
      const row = document.createElement('section'); row.className = 'status-row';
      const label = document.createElement('label'); label.textContent = 'Display status name'; const name = document.createElement('input'); name.setAttribute('aria-label', 'Status name'); name.maxLength = 128; name.value = entry.name; label.append(name);
      const previews = document.createElement('div'); previews.className = 'config-color-columns';
      const update = () => {
        for (const mode of ['light', 'dark'] as const) {
          const card = previews.querySelector<HTMLElement>(`[data-status-mode="${mode}"]`)!;
          card.replaceChildren(); const category = config.categories[0];
          if (category) { styleCategoryCard(card, category); card.append(category.name + ' - Example ID '); }
          if (config.modules?.length) card.append(moduleBadges({ state: 'assigned', modules: [config.modules[0]], evidence: [] }));
          card.append(statusBadge(entry.name || 'Unnamed status', [entry]));
        }
      };
      name.oninput = () => { entry.rules ??= [{ mode: 'exact', value: entry.name }]; entry.name = name.value; if (this.automatic.has(entry) && entry.rules?.[0]) { entry.rules[0].value = name.value; const input = row.querySelector<HTMLInputElement>('[aria-label="Status matching text"]'); if (input) input.value = name.value; } update(); this.changed(); };
      row.append(label, button('Remove status', () => { config.statuses!.splice(config.statuses!.indexOf(entry), 1); this.render(); this.changed(); }));
      for (const mode of ['light', 'dark'] as const) {
        const group = document.createElement('div'); group.dataset.previewTheme = mode;
        const hex = document.createElement('input'); hex.setAttribute('aria-label', `${mode} status hex`); hex.maxLength = 7;
        const picker = document.createElement('input'); picker.type = 'color'; picker.setAttribute('aria-label', `${mode} status color`);
        const defaultColor = () => categoryPalette({ key: 'status', name: entry.name }, mode).accent;
        hex.value = picker.value = entry.colors?.[mode] ?? defaultColor();
        const change = (value: string) => { entry.colors = { ...entry.colors, [mode]: value }; if (validCategoryColor(value)) picker.value = value; update(); this.changed(); };
        hex.oninput = () => change(hex.value); picker.oninput = () => { hex.value = picker.value; change(picker.value); };
        const card = document.createElement('div'); card.className = 'lens-card status-example'; card.dataset.statusMode = mode;
        group.append(mode === 'light' ? 'Light mode' : 'Dark mode', picker, hex, button(`Reset ${mode} status color`, () => { if (entry.colors) { delete entry.colors[mode]; if (!Object.keys(entry.colors).length) delete entry.colors; } hex.value = picker.value = defaultColor(); update(); this.changed(); }), card); previews.append(group);
      }
      const matching = document.createElement('div'); matching.className = 'status-matching';
      const renderRules = () => {
        matching.replaceChildren();
        for (const rule of entry.rules ?? [{ mode: 'exact' as const, value: entry.name }]) {
          const ruleRow = document.createElement('div'); ruleRow.className = 'status-rule';
          const select = document.createElement('select'); select.setAttribute('aria-label', 'Status matching mode');
          for (const [value, label] of [['exact', 'Exact text'], ['startsWith', 'Starts with'], ['regex', 'Advanced regex']]) select.add(new Option(label, value)); select.value = rule.mode;
          const text = document.createElement('input'); text.setAttribute('aria-label', 'Status matching text'); text.maxLength = 4096; text.value = rule.value;
          const ensure = () => { entry.rules ??= [rule]; };
          select.onchange = () => {
            this.automatic.delete(entry); ensure();
            if (select.value === 'regex' && rule.mode !== 'regex') {
              const escaped = rule.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              rule.value = '^' + escaped + (rule.mode === 'startsWith' ? '.*$' : '$'); text.value = rule.value;
            }
            rule.mode = select.value as typeof rule.mode; this.changed();
          };
          text.oninput = () => { this.automatic.delete(entry); ensure(); rule.value = text.value; this.changed(); };
          const modeLabel = document.createElement('label'); modeLabel.textContent = 'Match type'; modeLabel.append(select);
          const textLabel = document.createElement('label'); textLabel.textContent = 'Text or regular expression'; textLabel.append(text);
          ruleRow.append(modeLabel, textLabel, button('Remove matching rule', () => { ensure(); entry.rules!.splice(entry.rules!.indexOf(rule), 1); renderRules(); this.changed(); })); matching.append(ruleRow);
        }
        matching.append(button('Add matching rule', () => { entry.rules ??= [{ mode: 'exact', value: entry.name }]; if (entry.rules.length < 64) entry.rules.push({ mode: 'exact', value: '' }); renderRules(); this.changed(); }));
      };
      renderRules(); row.append(matching, this.extractionSites(entry), previews); list.append(configurationEntry(entry, row, () => `${config.statuses!.indexOf(entry) + 1}. ${entry.name || 'New status'}`, !entry.name)); update();
    }
    const add = button('Add status', () => { const entry: StatusPalette = { name: '' }; this.automatic.add(entry); (config.statuses ??= []).push(entry); this.render(); this.changed(); this.root.querySelector<HTMLInputElement>('.config-entry:last-child .status-row input')?.focus(); }); add.disabled = (config.statuses?.length ?? 0) >= 128;
    const removeAll = button('Delete all statuses', () => {
      config.statuses = [];
      this.message.textContent = 'All configured statuses removed. Preview and Apply to save, or Cancel to keep the current configuration.';
      this.render(); this.changed();
      this.root.querySelector<HTMLButtonElement>('#config-add-status')?.focus();
    });
    removeAll.disabled = !config.statuses?.length;
    add.id = 'config-add-status';
    const removalHint = document.createElement('p'); removalHint.id = 'config-status-removal-hint'; removalHint.className = 'config-hint';
    removalHint.textContent = 'Delete all statuses removes configured names, matching rules, and colors. Authored Markdown stays unchanged; unconfigured values use neutral badges.';
    removeAll.setAttribute('aria-describedby', removalHint.id);
    if (!config.statuses?.length) list.textContent = 'No statuses configured. Add a status or Rescan statuses to discover authored values.';
    this.root.replaceChildren(summary, hint, button('Rescan statuses', this.scan), add, removeAll, removalHint, this.message, this.foundDetails, list);
  }
}
