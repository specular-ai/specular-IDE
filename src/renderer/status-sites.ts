import { DEFAULT_STATUS_SITES, type StatusSites, type TextStatusSite } from '../core/status-sites';
import type { IdConfiguration } from '../core/id-configuration';

export function statusSiteGroups(settings: StatusSites, stage: () => void): HTMLElement[] {
  const checkbox = (text: string, checked: boolean, update: (value: boolean) => void) => {
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
    input.onchange = () => { update(input.checked); stage(); }; label.append(input, text); return label;
  };
  const inputField = (text: string, value: string, max: number, update: (value: string) => void) => {
    const label = document.createElement('label'); label.textContent = text; const input = document.createElement('input');
    input.value = value; input.maxLength = max; input.spellcheck = false; input.oninput = () => { update(input.value); stage(); }; label.append(input); return label;
  };
  const names = { paragraphs: 'paragraph', tables: 'table', headings: 'heading' };
  const groups = (['paragraphs', 'tables', 'headings'] as TextStatusSite[]).map(kind => {
    const site = settings[kind], name = names[kind], group = document.createElement('section'); group.className = 'definition-site-group';
    const heading = document.createElement('h4'); heading.textContent = 'Statuses in ' + kind; group.append(heading);
    group.append(checkbox('Enable ' + name + ' statuses', site.enabled, value => { site.enabled = value; }));
    let literal: HTMLLabelElement | undefined;
    if (kind === 'paragraphs') {
      literal = inputField('Paragraph field label', settings.paragraphs.label, 128, value => { settings.paragraphs.label = value; });
      literal.hidden = site.mode === 'regex'; group.append(literal);
      // Increment 91: `- **Status**: DONE` under a definition, as in milestone PROGRESS.md files.
      group.append(checkbox('Also read list items', settings.paragraphs.listItems ?? false, value => { if (value) settings.paragraphs.listItems = true; else delete settings.paragraphs.listItems; }));
    }
    if (kind === 'tables') group.append(inputField('Status column name', settings.tables.column, 128, value => { settings.tables.column = value; }));
    const advanced = document.createElement('div'); advanced.hidden = site.mode !== 'regex';
    const defaultPattern = kind === 'headings' ? DEFAULT_STATUS_SITES.headings.pattern : kind === 'paragraphs' ? '^Status:[ \t]*(?<status>[^\r\n]+)$' : '^(?<status>.+)$';
    const pattern = inputField(name[0].toUpperCase() + name.slice(1) + ' status pattern', site.pattern ?? defaultPattern, 512, value => { site.pattern = value; });
    const ignore = checkbox('Ignore case in ' + name + ' status pattern', site.ignoreCase ?? false, value => { site.ignoreCase = value; });
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = 'Use a nonempty named (?<status>...) capture in this Markdown region. Each value retains exact source evidence. Multiple values are checked for agreement; no site takes precedence.';
    advanced.append(pattern, ignore, hint);
    if (kind !== 'headings') {
      const label = document.createElement('label'); label.textContent = kind === 'paragraphs' ? 'Paragraph status format' : 'Status cell content';
      const select = document.createElement('select'); select.setAttribute('aria-label', label.textContent);
      select.add(new Option(kind === 'paragraphs' ? 'Literal field label' : 'Full cell value', kind === 'paragraphs' ? 'literal' : 'full'));
      select.add(new Option('Advanced pattern', 'regex')); select.value = site.mode; label.append(select); group.append(label);
      select.onchange = () => {
        site.mode = select.value as typeof site.mode; advanced.hidden = site.mode !== 'regex';
        if (literal) literal.hidden = site.mode === 'regex';
        if (site.mode === 'regex') { site.pattern = pattern.querySelector('input')!.value; site.ignoreCase = ignore.querySelector('input')!.checked; }
        else { delete site.pattern; delete site.ignoreCase; }
        stage();
      };
    }
    group.append(advanced); return group;
  });
  return [...groups, checkboxGroup(settings, stage, checkbox)];
}

/** Task checkbox markers (increment 88): enable the site and edit the marker-to-value mappings. */
function checkboxGroup(settings: StatusSites, stage: () => void, checkbox: (text: string, checked: boolean, update: (value: boolean) => void) => HTMLLabelElement) {
  // Rendering must not change the draft: the site is attached only when the user edits it.
  const site = settings.checkboxes ?? structuredClone(DEFAULT_STATUS_SITES.checkboxes!);
  const changed = () => { settings.checkboxes = site; stage(); };
  const group = document.createElement('section'); group.className = 'definition-site-group checkbox-status-site';
  const heading = document.createElement('h4'); heading.textContent = 'Statuses in task checkboxes';
  const hint = document.createElement('p'); hint.className = 'config-hint';
  hint.textContent = 'For a list item that defines an ID, the character in its checkbox, such as [x] or Kiro\'s [-], becomes the status value below. Type a space for [ ]. Unchecked items with an ID are then Open tasks instead of pending work. Unmapped markers give no status.';
  const rows = Object.entries(site.markers).map(([marker, value]) => ({ marker, value }));
  const list = document.createElement('div'); list.className = 'checkbox-markers';
  const note = document.createElement('p'); note.className = 'config-hint checkbox-markers-note';
  const write = () => {
    const markers = rows.map(row => row.marker), duplicate = markers.find((marker, index) => markers.indexOf(marker) !== index);
    note.textContent = duplicate === undefined ? '' : `Marker ${JSON.stringify(duplicate)} is mapped twice; the last mapping is used.`;
    site.markers = Object.fromEntries(rows.map(row => [row.marker, row.value]));
    add.disabled = rows.length >= 16; changed();
  };
  const render = () => list.replaceChildren(...rows.map((row, index) => {
    const line = document.createElement('div'); line.className = 'checkbox-marker';
    const marker = document.createElement('input'); marker.value = row.marker; marker.maxLength = 2; marker.spellcheck = false; marker.className = 'checkbox-marker-char';
    marker.setAttribute('aria-label', `Checkbox marker ${index + 1}`); marker.placeholder = 'x';
    marker.oninput = () => { row.marker = marker.value; write(); };
    const value = document.createElement('input'); value.value = row.value; value.maxLength = 128; value.spellcheck = false;
    value.setAttribute('aria-label', `Status value for checkbox marker ${index + 1}`);
    value.oninput = () => { row.value = value.value; write(); };
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet-button'; remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove checkbox marker ${index + 1}`);
    remove.onclick = () => { rows.splice(index, 1); render(); write(); };
    const brackets = document.createElement('span'); brackets.className = 'checkbox-marker-label'; brackets.textContent = `[${row.marker === ' ' ? '␣' : row.marker}] →`;
    marker.addEventListener('input', () => { brackets.textContent = `[${marker.value === ' ' ? '␣' : marker.value}] →`; });
    line.append(marker, brackets, value, remove); return line;
  }));
  const add = document.createElement('button'); add.type = 'button'; add.className = 'quiet-button'; add.textContent = 'Add marker';
  add.onclick = () => { rows.push({ marker: '', value: '' }); render(); write(); (list.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus(); };
  add.disabled = rows.length >= 16;
  render();
  // `checkbox` stages after the update, so attach the site first.
  group.append(heading, checkbox('Enable checkbox statuses', site.enabled, value => { site.enabled = value; settings.checkboxes = site; }), hint, list, note, add);
  return group;
}

export class StatusSitesEditor {
  readonly root = document.createElement('section');
  constructor(private draft: () => IdConfiguration, private changed: () => void) { this.root.id = 'config-status-sites'; }
  render() {
    const settings = structuredClone(this.draft().statusSites ?? DEFAULT_STATUS_SITES);
    const stage = () => { this.draft().statusSites = structuredClone(settings); this.changed(); };
    const title = document.createElement('h3'); title.textContent = 'Authored-status extraction';
    const intro = document.createElement('p'); intro.className = 'config-hint';
    intro.textContent = 'Choose where statuses are read for all IDs. Paragraphs belong directly to an ID heading and stop at the next heading. Tables use the owning ID row; heading statuses require a recognized ID definition. Status names and colors are configured in Authored statuses.';
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'quiet-button'; reset.textContent = 'Restore status site defaults';
    reset.onclick = () => { delete this.draft().statusSites; this.render(); this.changed(); };
    this.root.replaceChildren(title, intro, ...statusSiteGroups(settings, stage), reset);
  }
}