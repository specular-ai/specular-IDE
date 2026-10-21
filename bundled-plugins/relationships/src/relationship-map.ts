import { keyLabel } from './id-identity.js';
import { IdPicker } from './id-picker.js';
import type { Occurrence, ProjectIndex } from './model.js';
import { relationshipsFor, supportsRelationships, relationshipRole, categoryFor, relatedThroughDecisions, type RelationshipGroup } from './relationships.js';

const PAGE_SIZE = 6;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const item = document.createElement(tag); item.textContent = text; item.className = className; return item;
}
function action(text: string, callback: () => void, className = 'quiet-button') {
  const item = element('button', text, className); item.type = 'button'; item.onclick = callback; return item;
}

/** A session-only projection of the same owned-reference index used by the evidence list. */
export class RelationshipMap {
  private index: ProjectIndex = { definitions: [], references: [], findings: [], diagrams: [], links: [], linkOf: new Map(), unownedMentions: 0 };
  private revision = 0;
  private ready = false;
  private notice = '';
  private id = '';
  private file = '';
  private page = 0;
  private throughPage = 0;
  private selected = '';
  private history: string[] = [];
  private idPicker = new IdPicker(id => this.focus(id));
  private picker = this.idPicker.input;
  private files = element('select');
  private content = element('div', '', 'map-content');
  constructor(private root: HTMLElement, private navigate: (source: Occurrence, revision: number) => void, private occurrences: (id: string) => void) {
    root.innerHTML = '<h2>Requirements, design &amp; tasks</h2><p class="map-intro">Explore explicit requirement/design and design/task references. Select a connection to inspect its source evidence.</p>';
    const form = element('form', '', 'map-controls');
    const label = element('label', 'Focus ID'); label.htmlFor = this.picker.id;
    const go = element('button', 'Explore', 'button secondary'); go.type = 'button';
    go.onclick = () => this.focus(this.idPicker.value);
    form.onsubmit = event => { event.preventDefault(); this.focus(this.idPicker.value); };
    const fileLabel = element('label', 'Connection evidence file'); this.files.id = 'map-file'; fileLabel.htmlFor = this.files.id;
    this.files.onchange = () => { this.file = this.files.value; this.page = 0; this.throughPage = 0; this.selected = ''; this.render(); };
    form.append(label, this.idPicker.root, go, fileLabel, this.files);
    root.append(form, this.content);
  }
  reset() { this.id = ''; this.file = ''; this.page = 0; this.throughPage = 0; this.selected = ''; this.history = []; this.idPicker.value = ''; this.content.replaceChildren(); }
  getState() { return { id: this.id, file: this.file, page: this.page, throughPage: this.throughPage, selected: this.selected, history: this.history.slice(-100) }; }
  restoreState(state: any) {
    if (!state || typeof state !== 'object') return;
    for (const key of ['id', 'file', 'selected'] as const) if (typeof state[key] === 'string') this[key] = state[key];
    for (const key of ['page', 'throughPage'] as const) if (Number.isSafeInteger(state[key]) && state[key] >= 0) this[key] = state[key];
    if (Array.isArray(state.history) && state.history.every((id: unknown) => typeof id === 'string')) this.history = state.history.slice(-100);
    this.idPicker.value = this.id;
  }
  dispose() { this.idPicker.dispose(); this.root.replaceChildren(); this.files.onchange = null; }
  focus(id: string) {
    if (id !== this.id) { if (this.id) this.history.push(this.id); this.id = id; this.page = 0; this.throughPage = 0; this.selected = ''; }
    this.idPicker.close(); this.idPicker.value = id; this.render();
  }
  update(index: ProjectIndex, revision: number, ready: boolean, notice: string, documentCount = 0, warnings: string[] = []) {
    this.index = index; this.revision = revision; this.ready = ready; this.notice = notice;
    const labels = new Map(index.definitions.map(item => [item.id, item.label]));
    this.idPicker.update([...new Set([...index.definitions, ...index.references].map(item => item.id).filter(id => supportsRelationships(id, index)))].sort().map(id => ({ id, label: labels.get(id) ?? 'Missing definition' })));
    const paths = [...new Set(index.references.filter(item => { const link = index.linkOf.get(item); return !!link && supportsRelationships(link.to, index) && supportsRelationships(link.from, index); }).map(item => item.file))].sort();
    if (this.file && !paths.includes(this.file)) paths.push(this.file);
    this.files.replaceChildren();
    for (const file of ['', ...paths]) { const option = element('option', file || 'All project files'); option.value = file; this.files.append(option); }
    this.files.value = this.file; this.render();
  }
  private render() {
    const parent = this.content; parent.replaceChildren();
    if (!this.ready) { parent.append(element('p', this.notice, 'map-status')); return; }
    if (this.id && ![...this.index.definitions, ...this.index.references].some(item => item.id === this.id)) {
      parent.append(element('p', `Missing definition: ${keyLabel(this.id)}. No indexed occurrences found.`, 'coral'), element('p', 'No owned requirement/design or design/task references found for this ID.', 'map-status')); return;
    }
    if (!supportsRelationships(this.id, this.index)) { parent.append(element('p', 'Choose an ID with a requirement, design or task role to explore its connections.', 'map-status')); return; }
    const revision = this.revision, result = relationshipsFor(this.index, this.id);
    const groups = result.groups.map(group => ({ ...group, evidence: group.evidence.filter(item => !this.file || item.reference.file === this.file) })).filter(group => group.evidence.length);
    this.page = Math.min(this.page, Math.max(0, Math.ceil(groups.length / PAGE_SIZE) - 1));
    const direct = groups.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
    const through = relatedThroughDecisions(this.index, this.id, direct, this.file);
    this.throughPage = Math.min(this.throughPage, Math.max(0, Math.ceil(through.length / PAGE_SIZE) - 1));
    const shown = [
      ...direct.map(group => ({ ...group, anchor: this.id, key: group.id })),
      ...through.slice(this.throughPage * PAGE_SIZE, (this.throughPage + 1) * PAGE_SIZE),
    ];
    const toolbar = element('div', '', 'map-navigation');
    const back = action('Back to previous focus', () => { const id = this.history.pop(); if (id) { this.id = id; this.idPicker.value = id; this.page = 0; this.throughPage = 0; this.selected = ''; this.render(); } });
    back.disabled = !this.history.length;
    toolbar.append(back, action(`All occurrences of ${keyLabel(this.id)}`, () => this.occurrences(this.id)));
    parent.append(toolbar, element('p', `${keyLabel(this.id)} \u00b7 Direct requirement/design and design/task connections \u00b7 ${groups.length} of ${result.groups.length} connections match the file filter. Showing ${direct.length} on page ${this.page + 1} of ${Math.max(1, Math.ceil(groups.length / PAGE_SIZE))}.`, 'map-scope'));
    parent.append(element('p', 'Only indexed Markdown and owned references are included. A reference does not prove coverage or implementation.', 'map-intro'));
    if (result.definitionCount !== 1) parent.append(element('p', result.definitionCount ? `${keyLabel(this.id)} has ${result.definitionCount} definitions; no target chosen.` : `Missing definition: ${keyLabel(this.id)}.`, 'coral'));
    if (!groups.length) parent.append(element('p', result.groups.length ? 'No connections match this file filter.' : 'No owned requirement/design or design/task references found. Other mentions are available under All occurrences.', 'map-status'));
    const headings = element('div', '', 'map-headings'); headings.append(element('strong', 'Requirements'), element('strong', 'Design decisions'), element('strong', 'Implementation tasks')); parent.append(headings);
    const graph = element('div', '', 'map-graph'); graph.setAttribute('aria-label', `Requirement, design and task connections for ${keyLabel(this.id)}`);
    const definitions = this.index.definitions.filter(item => item.id === this.id);
    const nodes = new Map<string, { id: string; definition?: Occurrence; definitionCount: number }>();
    nodes.set(this.id, { id: this.id, definition: definitions.length === 1 ? definitions[0] : undefined, definitionCount: definitions.length });
    for (const group of shown) nodes.set(group.id, group);
    const column = (id: string) => relationshipRole(id, this.index) === 'requirement' ? 0 : relationshipRole(id, this.index) === 'design' ? 1 : 2;
    const columns = [0, 1, 2].map(col => [...nodes.values()].filter(node => column(node.id) === col));
    const height = Math.max(1, ...columns.map(items => items.length)) * 100; graph.style.height = `${height}px`;
    const positions = new Map<string, { x: number; y: number }>();
    for (const [col, items] of columns.entries()) for (const [i, item] of items.entries())
      positions.set(item.id, { x: col * 360, y: (i + 0.5) * height / items.length });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 1000 ${height}`); svg.setAttribute('preserveAspectRatio', 'none');
    const defs = document.createElementNS(svg.namespaceURI, 'defs');
    for (const [id, direction] of [['map-arrow-end', 'auto'], ['map-arrow-start', 'auto-start-reverse']]) {
      const marker = document.createElementNS(svg.namespaceURI, 'marker');
      for (const [key, value] of Object.entries({ id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '8', markerHeight: '8', orient: direction, markerUnits: 'userSpaceOnUse' })) marker.setAttribute(key, value);
      const tip = document.createElementNS(svg.namespaceURI, 'path'); tip.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); tip.setAttribute('fill', '#83d8c5'); marker.append(tip); defs.append(marker);
    }
    svg.append(defs);
    const node = (id: string, definition: Occurrence | undefined, count: number) => {
      const focused = id === this.id, position = positions.get(id)!;
      const card = element('div', '', `map-node${focused ? ' focused' : ''}`); card.dataset.id = id;
      card.style.left = `${position.x / 10}%`; card.style.top = `${position.y - 42}px`;
      const open = action(keyLabel(id), () => { if (definition) this.navigate(definition, revision); }, 'map-definition');
      open.setAttribute('aria-label', `Open ${keyLabel(id)} definition`); open.disabled = !definition;
      const detail = element('small', definition ? `${definition.file}:${definition.line} \u00b7 ${definition.label}` : count ? `${count} definitions; no target chosen` : 'Missing definition'); detail.title = detail.textContent!;
      card.append(open, detail);
      const category = categoryFor(this.index, id);
      if (category) { detail.textContent = `${category.name} \u00b7 ${detail.textContent}`; detail.title = detail.textContent; }
      if (!focused) card.append(action(`Focus ${keyLabel(id)}`, () => this.focus(id)));
      graph.append(card);
    };
    graph.append(svg);
    for (const item of nodes.values()) node(item.id, item.definition, item.definitionCount);
    for (const group of shown) {
      const a = positions.get(group.anchor)!, b = positions.get(group.id)!;
      const [left, right] = a.x < b.x ? [a, b] : [b, a];
      const leftId = a.x < b.x ? group.anchor : group.id;
      const midX = (left.x + 280 + right.x) / 2;
      const line = document.createElementNS(svg.namespaceURI, 'path');
      line.setAttribute('d', `M ${left.x + 280} ${left.y} C ${midX} ${left.y}, ${midX} ${right.y}, ${right.x} ${right.y}`);
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      if (group.evidence.some(item => item.from === leftId)) line.setAttribute('marker-end', 'url(#map-arrow-end)');
      if (group.evidence.some(item => item.to === leftId)) line.setAttribute('marker-start', 'url(#map-arrow-start)');
      line.setAttribute('class', `map-edge${this.selected === group.key ? ' selected' : ''}`);
      const connection = document.createElementNS(svg.namespaceURI, 'g');
      connection.setAttribute('role', 'button'); connection.setAttribute('tabindex', '0'); connection.setAttribute('aria-label', `Inspect connection ${keyLabel(group.anchor)} and ${keyLabel(group.id)}`); connection.setAttribute('aria-pressed', String(this.selected === group.key));
      const hit = document.createElementNS(svg.namespaceURI, 'rect');
      hit.setAttribute('x', String(midX - 20)); hit.setAttribute('y', String((left.y + right.y) / 2 - 12)); hit.setAttribute('width', '40'); hit.setAttribute('height', '24'); hit.setAttribute('fill', 'transparent'); hit.setAttribute('cursor', 'pointer');
      connection.append(line, hit);
      connection.addEventListener('click', () => this.select(group.key));
      connection.addEventListener('keydown', event => { const key = (event as KeyboardEvent).key; if (key === 'Enter' || key === ' ') { event.preventDefault(); this.select(group.key); } });
      svg.append(connection);
    }
    parent.append(graph);
    const paging = element('div', '', 'map-navigation');
    const previous = action('Previous connections', () => { this.page--; this.throughPage = 0; this.selected = ''; this.render(); }); previous.disabled = this.page === 0;
    const next = action('Next connections', () => { this.page++; this.throughPage = 0; this.selected = ''; this.render(); }); next.disabled = (this.page + 1) * PAGE_SIZE >= groups.length;
    paging.append(previous, next); parent.append(paging);
    if (relationshipRole(this.id, this.index) !== 'design') {
      parent.append(element('p', `Through the decisions on this page: ${through.length} second-hop connections match the evidence file filter. Page ${this.throughPage + 1} of ${Math.max(1, Math.ceil(through.length / PAGE_SIZE))}. Missing or duplicate decisions are not expanded. Direct task/requirement and task/task links are available in Overview.`, 'map-through-scope'));
      const throughPaging = element('div', '', 'map-navigation');
      const previousThrough = action('Previous second-hop connections', () => { this.throughPage--; this.selected = ''; this.render(); }); previousThrough.disabled = this.throughPage === 0;
      const nextThrough = action('Next second-hop connections', () => { this.throughPage++; this.selected = ''; this.render(); }); nextThrough.disabled = (this.throughPage + 1) * PAGE_SIZE >= through.length;
      throughPaging.append(previousThrough, nextThrough); parent.append(throughPaging);
    }
    parent.append(element('h3', 'Connection list'));
    for (const group of shown) {
      const directions = [...new Set(group.evidence.map(item => `${keyLabel(item.from)} references ${keyLabel(item.to)}`))].join('; ');
      const select = action(`${directions} \u00b7 ${group.evidence.length} mention${group.evidence.length === 1 ? '' : 's'}`, () => this.select(group.key), 'map-connection');
      select.dataset.id = group.id; select.setAttribute('aria-pressed', String(this.selected === group.key)); parent.append(select);
    }
    const evidence = element('section', '', 'map-evidence'); evidence.id = 'map-evidence'; evidence.tabIndex = -1;
    const selected = shown.find(group => group.key === this.selected);
    evidence.append(element('h3', selected ? `Evidence: ${keyLabel(selected.anchor)} / ${keyLabel(selected.id)}` : 'Select a connection to inspect evidence'));
    if (selected) this.evidence(evidence, selected, revision);
    parent.append(evidence);
  }
  private select(id: string) { this.selected = id; this.render(); this.root.querySelector<HTMLElement>('#map-evidence')?.focus({ preventScroll: false }); }
  private evidence(parent: HTMLElement, group: RelationshipGroup, revision: number) {
    if (group.definitionCount !== 1) parent.append(element('p', group.definitionCount ? `${keyLabel(group.id)} has ${group.definitionCount} definitions; no target chosen.` : `Missing definition: ${keyLabel(group.id)}.`, 'coral'));
    for (const item of group.evidence) parent.append(action(`${keyLabel(item.from)} references ${keyLabel(item.to)}\n${item.reference.file}:${item.reference.line}\n${item.reference.label}`, () => this.navigate(item.reference, revision), 'map-evidence-source'));
  }
}
