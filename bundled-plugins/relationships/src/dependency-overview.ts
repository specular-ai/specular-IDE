import { keyLabel } from './id-identity.js';
import { DependencyGraphView } from './dependency-graph.js';
import type { Occurrence, ProjectIndex } from './model.js';
import { buildDependencyGraph, dependencyPaths, filterDependencies, type DependencyEdge, type DependencyGraph, type DependencyNode, type DependencyDirection } from './dependencies.js';

const PAGE = 20;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function button(text: string, onClick: () => void, className = 'quiet-button') {
  const node = el('button', text, className); node.type = 'button'; node.onclick = onClick; return node;
}
function select(id: string, label: string, parent: HTMLElement, onChange: (value: string) => void) {
  const control = el('select'); control.id = id; const caption = el('label', label); caption.htmlFor = id;
  control.onchange = () => onChange(control.value); parent.append(caption, control); return control;
}
function options(control: HTMLSelectElement, values: string[], all: string) {
  const selected = control.value; control.replaceChildren();
  for (const value of ['', ...values]) { const item = el('option', value || all); item.value = value; control.append(item); }
  if (selected && !values.includes(selected)) { const item = el('option', selected + ' (no longer indexed)'); item.value = selected; control.append(item); }
  control.value = selected;
}

/** File-grouped overview and evidence inspector; the complete graph never depends on UI filters. */
export class DependencyOverview {
  private graph: DependencyGraph = buildDependencyGraph({ definitions: [], references: [], findings: [], diagrams: [], links: [], linkOf: new Map(), unownedMentions: 0 });
  private revision = 0;
  private ready = false;
  private notice = '';
  private warnings: string[] = [];
  private documentCount = 0;
  private nodePage = 0;
  private edgePage = 0;
  private incomingPage = 0;
  private outgoingPage = 0;
  private pathPage = 0;
  private selectedId = '';
  private selectedEdge = '';
  private pathTarget = '';
  private direction: DependencyDirection = 'outgoing';
  private collapsed = new Set<string>();
  private search = el('input');
  private file: HTMLSelectElement;
  private kind: HTMLSelectElement;
  private graphView = new DependencyGraphView(id => this.choose(id), edge => this.inspect(edge));
  private content = el('div');
  constructor(private root: HTMLElement, private navigate: (source: Occurrence, revision: number) => void, private occurrences: (id: string) => void) {
    const controls = el('div', '', 'dependency-controls');
    this.search.id = 'dependency-search'; this.search.placeholder = 'Search IDs, labels, or files';
    const label = el('label', 'Search model'); label.htmlFor = this.search.id;
    this.search.oninput = () => this.filterChanged(); controls.append(label, this.search);
    this.file = select('dependency-file', 'Definition file', controls, () => this.filterChanged());
    this.kind = select('dependency-kind', 'ID category', controls, () => this.filterChanged());
    controls.append(button('Clear filters', () => { this.search.value = ''; this.file.value = ''; this.kind.value = ''; this.filterChanged(); }));
    root.append(el('h2', 'Project dependencies'), el('p', 'All IDs and directed connections. Pan and zoom the graph; click a node or link for details.', 'map-intro'), controls, this.content);
  }
  focus(id: string) { this.choose(id); }
  getState() {
    return { selectedId: this.selectedId, selectedEdge: this.selectedEdge, pathTarget: this.pathTarget, direction: this.direction,
      nodePage: this.nodePage, edgePage: this.edgePage, incomingPage: this.incomingPage, outgoingPage: this.outgoingPage, pathPage: this.pathPage,
      search: this.search.value, file: this.file.value, kind: this.kind.value, collapsed: [...this.collapsed], camera: this.graphView.getState() };
  }
  restoreState(state: any) {
    if (!state || typeof state !== 'object') return;
    for (const key of ['selectedId', 'selectedEdge', 'pathTarget'] as const) if (typeof state[key] === 'string') this[key] = state[key];
    for (const key of ['nodePage', 'edgePage', 'incomingPage', 'outgoingPage', 'pathPage'] as const) if (Number.isSafeInteger(state[key]) && state[key] >= 0) this[key] = state[key];
    if (state.direction === 'incoming' || state.direction === 'outgoing') this.direction = state.direction;
    for (const key of ['search', 'file', 'kind'] as const) if (typeof state[key] === 'string') {
      if (key !== 'search') options(this[key], [state[key]], 'All');
      this[key].value = state[key];
    }
    if (Array.isArray(state.collapsed) && state.collapsed.every((file: unknown) => typeof file === 'string')) this.collapsed = new Set(state.collapsed);
    this.graphView.restoreState(state.camera);
  }
  dispose() { this.graphView.dispose(); this.search.oninput = null; this.file.onchange = null; this.kind.onchange = null; this.root.replaceChildren(); }
  reset() {
    this.graphView.reset();
    this.search.value = ''; this.file.value = ''; this.kind.value = ''; this.nodePage = 0; this.edgePage = 0;
    this.selectedId = ''; this.selectedEdge = ''; this.pathTarget = ''; this.pathPage = 0; this.incomingPage = 0; this.outgoingPage = 0;
    this.direction = 'outgoing'; this.collapsed.clear(); this.content.replaceChildren();
  }
  update(index: ProjectIndex, revision: number, ready: boolean, notice: string, documentCount: number, warnings: string[]) {
    if (ready && (!this.ready || this.revision !== revision)) this.graph = buildDependencyGraph(index);
    this.revision = revision; this.ready = ready; this.notice = notice; this.documentCount = documentCount; this.warnings = warnings;
    if (ready) {
      options(this.file, [...new Set([...index.definitions, ...index.references].map(item => item.file))].sort(), 'All files');
      options(this.kind, [...new Set([...this.graph.nodes.values()].map(node => node.kind))].sort(), 'All categories');
      const names = new Map([...this.graph.nodes.values()].map(node => [node.kind, node.kindLabel ?? node.kind]));
      for (const option of this.kind.options) if (option.value) option.textContent = names.get(option.value) ?? option.value;
    }
    this.render();
  }
  private filterChanged() { this.graphView.reset(); this.nodePage = 0; this.edgePage = 0; this.render(); }
  private choose(id: string) {
    this.selectedId = id; this.selectedEdge = ''; this.pathTarget = ''; this.incomingPage = 0; this.outgoingPage = 0; this.pathPage = 0;
    this.render(); this.reveal('#dependency-inspector');
  }
  private reveal(selector: string) { this.root.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }); }
  private inspect(edge: DependencyEdge) {
    this.selectedEdge = edge.key; if (!this.graph.nodes.has(this.selectedId)) this.selectedId = edge.from;
    this.render(); this.reveal('#dependency-evidence');
  }
  private status(node: DependencyNode) { return node.definitions.length === 0 ? 'Missing definition' : node.definitions.length > 1 ? `${node.definitions.length} definitions; ambiguous` : ''; }
  private pager(parent: HTMLElement, label: string, count: number, page: number, change: (page: number) => void, size = PAGE) {
    const row = el('div', '', 'map-navigation');
    const previous = button(`Previous ${label}`, () => change(page - 1)); previous.disabled = page === 0;
    const next = button(`Next ${label}`, () => change(page + 1)); next.disabled = (page + 1) * size >= count;
    row.append(previous, el('span', `${count ? page * size + 1 : 0}-${Math.min((page + 1) * size, count)} of ${count}`, 'map-intro'), next); parent.append(row);
  }
  private clamp(page: number, count: number, size = PAGE) { return Math.min(page, Math.max(0, Math.ceil(count / size) - 1)); }
  private render() {
    const parent = this.content; parent.replaceChildren();
    if (!this.ready) { parent.append(el('p', this.notice, 'dependency-status')); return; }
    const graph = this.graph, filtered = filterDependencies(graph, { file: this.file.value, kind: this.kind.value, query: this.search.value });
    this.nodePage = this.clamp(this.nodePage, filtered.nodes.length); this.edgePage = this.clamp(this.edgePage, filtered.edges.length);
    const evidenceCount = [...graph.edges.values()].reduce((sum, edge) => sum + edge.evidence.length, 0);
    const summary = el('p', `${graph.nodes.size} IDs / ${graph.edges.size} directed connections / ${evidenceCount} source mentions across ${this.documentCount} indexed Markdown files. Filters match ${filtered.nodes.length} IDs and ${filtered.edges.length} incident connections.`, 'dependency-summary');
    parent.append(summary);
    const scope = el('details', '', 'dependency-scope'); scope.append(el('summary', 'Scope and indexing exclusions'));
    scope.append(el('p', 'Filters select IDs; connection lists retain cross-file and cross-kind endpoints touching those IDs. Missing IDs use reference files for file filtering. Grouping and pages only change the display. Every recorded node and edge remains in the model. Selected-ID details and paths always use the full model, independently of overview filters.'));
    scope.append(el('p', `${graph.unownedMentions} unowned mentions are available in All occurrences, without inferred edges. Only recognized IDs in indexed Markdown are included. Quoted examples, raw HTML, and ordinary code fences are excluded; Mermaid references require a defining owner. Directory links, private/build/dependency folders, unsupported files, and scan size limits follow project indexing rules. TASK IDs describe authored tasks, not verified executions.`));
    scope.append(el('p', 'A recorded reference does not establish execution order, implementation, or requirement satisfaction.'));
    for (const warning of this.warnings) scope.append(el('p', warning, 'coral'));
    if (this.warnings.length) parent.append(el('p', `${this.warnings.length} project indexing notices; open Scope and indexing exclusions for details.`, 'coral'));
    parent.append(scope);
    const visible = new Set(filtered.nodes.map(node => node.id));
    for (const edge of filtered.edges) { visible.add(edge.from); visible.add(edge.to); }
    const nodes = [...graph.nodes.values()].filter(node => visible.has(node.id));
    const display = el('div', '', `dependency-visual-layout${this.selectedId ? ' with-details' : ''}`);
    display.append(this.graphView.render(nodes, filtered.edges, this.selectedId, this.selectedEdge));
    this.inspector(display); parent.append(display);
    const fallback = el('details', '', 'dependency-list-fallback'); fallback.append(el('summary', 'Accessible ID and connection lists'));
    parent.append(fallback);
    const list = el('div'); fallback.append(list);
    list.append(el('h3', 'IDs by file'));
    const groups = new Map<string, DependencyNode[]>();
    const pageNodes = filtered.nodes.slice(this.nodePage * PAGE, (this.nodePage + 1) * PAGE);
    for (const node of pageNodes) {
      for (const file of new Set(node.definitions.map(item => item.file).length ? node.definitions.map(item => item.file) : ['Missing definitions'])) {
        const list = groups.get(file) ?? []; list.push(node); groups.set(file, list);
      }
    }
    const grid = el('div', '', 'dependency-files');
    for (const [file, nodes] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const group = el('details', '', 'dependency-file-group'); group.dataset.groupFile = file; group.open = !this.collapsed.has(file);
      group.ontoggle = () => { if (group.isConnected) { if (group.open) this.collapsed.delete(file); else this.collapsed.add(file); } };
      group.append(el('summary', `${file} (${nodes.length} IDs on this page)`));
      for (const node of nodes) {
        const card = button('', () => this.choose(node.id), 'dependency-node'); card.dataset.id = node.id; card.setAttribute('aria-label', `Inspect ${keyLabel(node.id)} in list`); card.setAttribute('aria-pressed', String(node.id === this.selectedId));
        card.append(el('strong', keyLabel(node.id)), el('span', node.definitions.length === 1 ? node.definitions[0].label : this.status(node)), el('small', `${graph.incoming.get(node.id)?.length ?? 0} incoming / ${graph.outgoing.get(node.id)?.length ?? 0} outgoing`)); group.append(card);
      }
      grid.append(group);
    }
    list.append(grid);
    if (!pageNodes.length) parent.append(el('p', graph.nodes.size ? 'No IDs match these filters.' : 'No recognized definitions or owned references in the indexed Markdown.', 'dependency-status'));
    this.pager(list, 'IDs', filtered.nodes.length, this.nodePage, page => { this.nodePage = page; this.render(); });
    list.append(el('h3', 'All connections touching filtered IDs'));
    for (const edge of filtered.edges.slice(this.edgePage * PAGE, (this.edgePage + 1) * PAGE)) list.append(this.edgeButton(edge));
    this.pager(list, 'model connections', filtered.edges.length, this.edgePage, page => { this.edgePage = page; this.render(); });

  }
  private edgeButton(edge: DependencyEdge) {
    const row = button(`${keyLabel(edge.from)} → ${keyLabel(edge.to)} (${edge.evidence.length} mentions)`, () => this.inspect(edge), 'dependency-edge'); row.dataset.edge = edge.key;
    row.setAttribute('aria-pressed', String(this.selectedEdge === edge.key)); return row;
  }
  private inspector(parent: HTMLElement) {
    const panel = el('section', '', 'dependency-inspector'); panel.id = 'dependency-inspector'; panel.tabIndex = -1; parent.append(panel);
    const node = this.graph.nodes.get(this.selectedId);
    if (!node) { panel.append(el('h3', this.selectedId ? 'The selected ID is no longer in the indexed model.' : 'Select an ID or connection to explore')); return; }
    const revision = this.revision;
    panel.append(el('h3', `${keyLabel(node.id)} - Full-model connections`), el('p', 'These details include all files and kinds, independently of the overview filters.', 'map-intro'));
    if (this.status(node)) panel.append(el('p', this.status(node), 'coral'));
    if (node.definitions.length === 1) panel.append(button(`Open ${keyLabel(node.id)} definition`, () => this.navigate(node.definitions[0], revision)));
    panel.append(button(`All occurrences of ${keyLabel(node.id)}`, () => this.occurrences(node.id)));
    const neighborhood = el('div', '', 'dependency-neighborhood'); panel.append(neighborhood);
    for (const direction of ['incoming', 'outgoing'] as const) {
      const section = el('section'); const edges = this.graph[direction].get(node.id) ?? [];
      const key = direction === 'incoming' ? 'incomingPage' : 'outgoingPage'; this[key] = this.clamp(this[key], edges.length, 6);
      section.append(el('h4', `${direction === 'incoming' ? 'Incoming' : 'Outgoing'} (${edges.length})`));
      for (const edge of edges.slice(this[key] * 6, (this[key] + 1) * 6)) {
        section.append(this.edgeButton(edge));
        const other = direction === 'incoming' ? edge.from : edge.to;
        section.append(button(`Explore ${keyLabel(other)}`, () => this.choose(other)));
      }
      if (!edges.length) section.append(el('p', 'No recorded connections.', 'map-intro'));
      this.pager(section, direction, edges.length, this[key], page => { this[key] = page; this.render(); }, 6); neighborhood.append(section);
    }
    this.paths(panel, node.id);
    const evidence = el('section', '', 'dependency-evidence'); evidence.id = 'dependency-evidence'; evidence.tabIndex = -1; panel.append(evidence);
    const edge = this.graph.edges.get(this.selectedEdge);
    evidence.append(el('h3', edge ? `${keyLabel(edge.from)} references ${keyLabel(edge.to)}` : 'Select a connection for source evidence'));
    if (!edge) return;
    for (const id of new Set([edge.from, edge.to])) {
      const target = this.graph.nodes.get(id)!;
      if (this.status(target)) evidence.append(el('p', `${keyLabel(id)}: ${this.status(target)}.`, 'coral'));
    }
    for (const source of edge.evidence) evidence.append(button(`${source.file}:${source.line}
${source.label}`, () => this.navigate(source, revision), 'dependency-evidence-source'));
  }
  private paths(panel: HTMLElement, id: string) {
    const section = el('section', '', 'dependency-paths'); section.id = 'dependency-paths'; section.tabIndex = -1; panel.append(section);
    section.append(el('h3', 'Trace recorded paths'));
    const control = select('dependency-direction', 'Traversal direction', section, value => { this.direction = value as DependencyDirection; this.pathPage = 0; this.pathTarget = ''; this.render(); });
    for (const direction of ['outgoing', 'incoming']) { const option = el('option', direction === 'outgoing' ? 'Follow outgoing references' : 'Follow incoming references'); option.value = direction; control.append(option); } control.value = this.direction;
    const paths = dependencyPaths(this.graph, id, this.direction);
    section.append(el('p', `${paths.ids.length} reachable IDs. One shortest path per ID; cycles are visited once. Traversal stops at missing or ambiguous definitions. Self-references remain in the direct connection lists.`, 'map-intro'));
    this.pathPage = this.clamp(this.pathPage, paths.ids.length, 10);
    for (const target of paths.ids.slice(this.pathPage * 10, (this.pathPage + 1) * 10)) section.append(button(`Trace to ${keyLabel(target)}`, () => { this.pathTarget = target; this.render(); this.reveal('#dependency-paths'); }, 'dependency-path-target'));
    this.pager(section, 'reachable IDs', paths.ids.length, this.pathPage, page => { this.pathPage = page; this.render(); }, 10);
    if (!this.pathTarget) return;
    const route = paths.pathTo(this.pathTarget);
    if (!route.length) { section.append(el('p', 'The selected path is no longer available.')); return; }
    const ordered = this.direction === 'incoming' ? [...route].reverse() : route;
    section.append(el('p', [ordered[0].from, ...ordered.map(edge => edge.to)].map(keyLabel).join(' → '), 'dependency-route'));
    for (const [i, edge] of ordered.entries()) {
      const row = this.edgeButton(edge); row.textContent = `Hop ${i + 1}: ${keyLabel(edge.from)} → ${keyLabel(edge.to)} - inspect evidence`; row.classList.add('dependency-hop'); section.append(row);
    }
  }
}
