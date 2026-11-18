import { effectiveLayers, MAX_LAYERS } from '../core/layers';
import type { IdConfiguration } from '../core/id-configuration';
import { explain } from './hover-hint';

/**
 * Increment 100b: the project's relationship layers. By default they follow the categories' roles; Customize copies them into
 * the draft, where layers can be renamed, reordered, added, and removed, and each category placed in one layer or none.
 */
export class LayersEditor {
  readonly root = document.createElement('section');
  constructor(private draft: () => IdConfiguration, private changed: () => void) { this.root.id = 'config-layers'; }

  render() {
    const draft = this.draft();
    const heading = document.createElement('h3'); heading.textContent = 'Relationship layers';
    const intro = document.createElement('p'); intro.className = 'config-hint';
    intro.textContent = 'Focus and the Relationships list connect IDs across these layers, one column per layer, in this order. Categories in no layer appear only in Overview.';
    explain(heading, intro.textContent!);
    const body: HTMLElement[] = [heading];
    if (!draft.layers) {
      const layers = effectiveLayers(draft);
      const summary = document.createElement('p'); summary.id = 'config-layers-summary';
      summary.textContent = layers.length
        ? `From the categories' roles: ${layers.map(layer => `${layer.name} (${layer.categories.map(key => this.name(key)).join(', ')})`).join('; ')}.`
        : 'No category has a requirement, design, or task role, so no layers are derived. Customize to place categories in layers.';
      body.push(summary, this.button('Customize layers', () => {
        const start = effectiveLayers(draft);
        draft.layers = start.length ? start : [{ name: 'Requirements', categories: [] }];
        this.update();
      }));
    } else {
      const layers = draft.layers;
      const list = document.createElement('div'); list.className = 'config-layer-list';
      layers.forEach((layer, index) => {
        const row = document.createElement('div'); row.className = 'config-layer';
        const name = document.createElement('input'); name.type = 'text'; name.maxLength = 64; name.value = layer.name;
        name.setAttribute('aria-label', `Layer ${index + 1} name`);
        name.oninput = () => { layer.name = name.value; this.renderPlacement(); this.changed(); };
        const up = this.button('Move up', () => { layers.splice(index - 1, 0, layers.splice(index, 1)[0]); this.update(); }); up.disabled = index === 0;
        const down = this.button('Move down', () => { layers.splice(index + 1, 0, layers.splice(index, 1)[0]); this.update(); }); down.disabled = index === layers.length - 1;
        const remove = this.button('Remove layer', () => { layers.splice(index, 1); if (!layers.length) delete draft.layers; this.update(); });
        for (const control of [up, down, remove]) control.setAttribute('aria-label', `${control.textContent} ${layer.name || `layer ${index + 1}`}`);
        const count = document.createElement('span'); count.className = 'config-hint';
        count.textContent = layer.categories.length ? `${layer.categories.length} ${layer.categories.length === 1 ? 'category' : 'categories'}` : 'No categories yet';
        row.append(name, count, up, down, remove); list.append(row);
      });
      const add = this.button('Add layer', () => { layers.push({ name: `Layer ${layers.length + 1}`, categories: [] }); this.update(); });
      add.disabled = layers.length >= MAX_LAYERS;
      const reset = this.button('Use roles', () => { delete draft.layers; this.update(); });
      const actions = document.createElement('div'); actions.className = 'config-layer-actions'; actions.append(add, reset);
      body.push(list, actions, this.placement);
      this.renderPlacement();
    }
    this.root.replaceChildren(...body);
  }

  private readonly placement = Object.assign(document.createElement('div'), { className: 'config-layer-placement' });

  /** One row per category with the layer it belongs to, or none. */
  private renderPlacement() {
    const draft = this.draft(), layers = draft.layers ?? [];
    const title = explain(document.createElement('h4'), 'Choose the layer of each category. A category belongs to at most one layer.'); title.textContent = 'Category layers';
    const rows = draft.categories.map(category => {
      const label = document.createElement('label'); label.className = 'config-layer-category'; label.textContent = category.name;
      const select = document.createElement('select'); select.setAttribute('aria-label', `Layer for ${category.name}`);
      select.append(new Option('No layer', ''), ...layers.map((layer, index) => new Option(layer.name || `Layer ${index + 1}`, String(index))));
      const current = layers.findIndex(layer => layer.categories.includes(category.key));
      select.value = current < 0 ? '' : String(current);
      select.onchange = () => {
        for (const layer of layers) layer.categories = layer.categories.filter(key => key !== category.key);
        if (select.value !== '') layers[Number(select.value)].categories.push(category.key);
        this.update();
      };
      label.append(select); return label;
    });
    const empty = layers.filter(layer => !layer.categories.length).map(layer => layer.name || 'an unnamed layer');
    const warning = document.createElement('p'); warning.className = 'config-hint amber'; warning.id = 'config-layers-warning';
    warning.textContent = empty.length ? `Give each layer at least one category, or remove it: ${empty.join(', ')}.` : '';
    warning.hidden = !empty.length;
    this.placement.replaceChildren(title, ...rows, warning);
  }

  private update() { this.render(); this.changed(); }
  private name(key: string) { return this.draft().categories.find(category => category.key === key)?.name ?? key; }
  private button(text: string, action: () => void) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = text; button.onclick = action; return button;
  }
}
