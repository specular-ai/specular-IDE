import { keyLabel } from './id-identity.js';
/** Searchable ID picker with an explicit list that can reopen after an exact selection. */
export class IdPicker {
  readonly root = document.createElement('div');
  readonly input = document.createElement('input');
  private toggle = document.createElement('button');
  private list = document.createElement('div');
  private notice = document.createElement('small');
  private choices: { id: string; label: string }[] = [];
  private visible: { id: string; label: string }[] = [];
  private active = -1;
  private query = '';
  private selected?: string;
  get value() { return this.selected !== undefined && this.input.value === keyLabel(this.selected) ? this.selected : this.input.value.trim(); }
  set value(id: string) { this.selected = id; this.input.value = keyLabel(id); }
  private outside = (event: PointerEvent) => { if (!this.root.contains(event.target as Node)) this.close(); };
  constructor(private explore: (id: string) => void) {
    this.root.className = 'map-id-picker'; this.input.id = 'map-focus';
    this.input.placeholder = 'Search or enter an ID'; this.input.autocomplete = 'off';
    this.input.setAttribute('role', 'combobox'); this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-controls', 'map-ids'); this.input.setAttribute('aria-expanded', 'false');
    this.toggle.type = 'button'; this.toggle.textContent = '\u25be'; this.toggle.setAttribute('aria-label', 'Show IDs');
    this.toggle.setAttribute('aria-controls', 'map-ids'); this.toggle.setAttribute('aria-expanded', 'false');
    this.list.id = 'map-ids'; this.list.setAttribute('role', 'listbox'); this.list.setAttribute('aria-label', 'Focus IDs'); this.list.hidden = true;
    this.notice.className = 'map-picker-notice'; this.notice.setAttribute('role', 'status'); this.notice.hidden = true;
    this.root.append(this.input, this.toggle, this.list, this.notice);
    this.toggle.onclick = () => { if (this.list.hidden) { this.input.focus(); this.open(''); } else this.close(); };
    this.input.onclick = () => this.open('');
    this.input.oninput = () => { this.selected = undefined; this.open(this.input.value); };
    this.input.onkeydown = event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); if (this.list.hidden) this.open('');
        if (!this.visible.length) return;
        this.active = this.active < 0 ? (event.key === 'ArrowDown' ? 0 : this.visible.length - 1) : (this.active + (event.key === 'ArrowDown' ? 1 : -1) + this.visible.length) % this.visible.length;
        this.highlight();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (!this.list.hidden && this.active >= 0) this.choose(this.visible[this.active].id);
        else { this.close(); this.explore(this.value); }
      } else if (event.key === 'Escape') { if (!this.list.hidden) { event.preventDefault(); event.stopPropagation(); this.close(); } }
      else if (event.key === 'Tab') this.close();
    };
    this.root.addEventListener('focusout', event => { if (!this.root.contains(event.relatedTarget as Node)) this.close(); });
    document.addEventListener('pointerdown', this.outside);
  }
  update(choices: { id: string; label: string }[]) { this.choices = choices; if (!this.list.hidden) this.open(this.query); }
  close() {
    this.list.hidden = true; this.notice.hidden = true; this.active = -1;
    this.input.setAttribute('aria-expanded', 'false'); this.toggle.setAttribute('aria-expanded', 'false'); this.input.removeAttribute('aria-activedescendant');
  }
  dispose() { document.removeEventListener('pointerdown', this.outside); this.root.remove(); }
  private choose(id: string) { this.value = id; this.close(); this.input.focus(); }
  private open(query: string) {
    this.query = query; this.active = -1; this.input.removeAttribute('aria-activedescendant');
    const matches = this.choices.filter(item => `${keyLabel(item.id)} ${item.label}`.toLowerCase().includes(query.trim().toLowerCase()));
    this.visible = matches.slice(0, 200);
    this.list.replaceChildren(...this.visible.map((item, i) => {
      const option = document.createElement('div'); option.id = `map-id-option-${i}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
      option.textContent = `${keyLabel(item.id)} \u00b7 ${item.label}`; option.title = option.textContent;
      option.onpointerdown = event => event.preventDefault(); option.onclick = () => this.choose(item.id); return option;
    }));
    this.notice.textContent = matches.length > 200 ? 'Showing the first 200 IDs. Type to narrow the list.' : matches.length ? '' : 'No matching IDs. You can still enter an ID and Explore.';
    this.notice.hidden = !this.notice.textContent; this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true'); this.toggle.setAttribute('aria-expanded', 'true');
  }
  private highlight() {
    [...this.list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === this.active)));
    const option = this.list.children[this.active] as HTMLElement;
    this.input.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' });
  }
}
