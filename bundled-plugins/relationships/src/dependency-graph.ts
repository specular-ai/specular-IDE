import { identityFromKey, keyLabel } from './id-identity.js';
import type { DependencyEdge, DependencyNode } from './dependencies.js';
const NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attributes: Record<string, string | number> = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
/** Every node and edge is rendered; the camera changes visibility, never graph membership. */
export class DependencyGraphView {
  private stage = document.createElement('div');
  private drawing = svg('svg');
  private world = svg('g');
  private scale = 1;
  private x = 0;
  private y = 0;
  private width = 1;
  private height = 1;
  private needsFit = true;
  private zoomLabel = document.createElement('span');
  private observer: ResizeObserver;
  private events = new AbortController();
  private frame?: number;
  constructor(private choose: (id: string) => void, private inspect: (edge: DependencyEdge) => void) {
    this.stage.className = 'dependency-graph-stage'; this.stage.tabIndex = 0;
    this.stage.setAttribute('aria-label', 'Dependency graph. Drag the background to pan. Use arrow keys to pan and plus or minus to zoom.');
    this.drawing.setAttribute('aria-label', 'All ID nodes and directed connections');
    this.stage.append(this.drawing);
    this.observer = new ResizeObserver(() => { if (this.needsFit) this.fit(); }); this.observer.observe(this.stage);
    let drag: { x: number; y: number; originalX: number; originalY: number } | undefined;
    this.stage.onpointerdown = event => {
      if (event.button !== 0 || (event.target as Element).closest('[role="button"]')) return;
      drag = { x: event.clientX, y: event.clientY, originalX: this.x, originalY: this.y };
      this.stage.setPointerCapture(event.pointerId); this.stage.focus();
    };
    this.stage.onpointermove = event => { if (drag) { this.x = drag.originalX + event.clientX - drag.x; this.y = drag.originalY + event.clientY - drag.y; this.transform(); } };
    this.stage.onpointerup = this.stage.onpointercancel = () => { drag = undefined; };
    this.stage.addEventListener('wheel', event => { event.preventDefault(); const box = this.stage.getBoundingClientRect(); this.zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - box.left, event.clientY - box.top); }, { passive: false, signal: this.events.signal });
    this.stage.onkeydown = event => {
      if (event.target !== this.stage) return;
      if (event.key === '+' || event.key === '=') this.zoom(1.25);
      else if (event.key === '-') this.zoom(0.8);
      else if (event.key === 'Home') this.fit();
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        this.x += event.key === 'ArrowLeft' ? 60 : event.key === 'ArrowRight' ? -60 : 0;
        this.y += event.key === 'ArrowUp' ? 60 : event.key === 'ArrowDown' ? -60 : 0; this.transform();
      } else return;
      event.preventDefault();
    };
  }
  reset() { this.needsFit = true; }
  getState() { return { scale: this.scale, x: this.x, y: this.y, needsFit: this.needsFit }; }
  restoreState(state: any) {
    if (!state || ![state.scale, state.x, state.y].every(Number.isFinite)) return;
    this.scale = Math.min(4, Math.max(0.005, state.scale)); this.x = state.x; this.y = state.y;
    this.needsFit = state.needsFit !== false;
  }
  dispose() {
    this.observer.disconnect(); this.events.abort();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.stage.onpointerdown = this.stage.onpointermove = this.stage.onpointerup = this.stage.onpointercancel = null;
    this.stage.onkeydown = null; this.drawing.replaceChildren(); this.stage.remove();
  }
  private transform() {
    this.world.setAttribute('transform', `translate(${this.x} ${this.y}) scale(${this.scale})`);
    this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
  }
  private zoom(factor: number, cx = this.stage.clientWidth / 2, cy = this.stage.clientHeight / 2) {
    const next = Math.min(4, Math.max(0.005, this.scale * factor));
    this.x = cx - (cx - this.x) * next / this.scale; this.y = cy - (cy - this.y) * next / this.scale;
    this.scale = next; this.needsFit = false; this.transform();
  }
  private fit() {
    if (!this.stage.clientWidth) { this.needsFit = true; return; }
    const bounds = (this.world as SVGGraphicsElement).getBBox();
    const width = bounds.width || this.width, height = bounds.height || this.height;
    this.scale = Math.min(1.4, (this.stage.clientWidth - 24) / width, (this.stage.clientHeight - 24) / height);
    this.x = (this.stage.clientWidth - width * this.scale) / 2 - bounds.x * this.scale; this.y = (this.stage.clientHeight - height * this.scale) / 2 - bounds.y * this.scale;
    this.needsFit = false; this.transform();
  }
  render(nodes: DependencyNode[], edges: DependencyEdge[], selectedId: string, selectedEdge: string) {
    const root = document.createElement('section'); root.className = 'dependency-graph-view';
    const controls = document.createElement('div'); controls.className = 'dependency-graph-controls';
    for (const [label, callback] of [['Zoom in', () => this.zoom(1.25)], ['Zoom out', () => this.zoom(0.8)], ['Fit all', () => this.fit()], ['100%', () => this.zoom(1 / this.scale)]] as const) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = label; button.onclick = callback; controls.append(button);
    }
    controls.append(this.zoomLabel); root.append(controls, this.stage);
    const groups = new Map<string, DependencyNode[]>();
    for (const node of nodes) {
      const file = node.definitions.length === 0 ? 'Missing definitions' : node.definitions.length > 1 ? 'Ambiguous IDs' : node.definitions[0].file;
      const group = groups.get(file) ?? []; group.push(node); groups.set(file, group);
    }
    this.drawing.replaceChildren(); this.world = svg('g');
    const defs = svg('defs'), marker = svg('marker', { id: 'dependency-graph-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto', markerUnits: 'userSpaceOnUse' });
    marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--accent, #83d8c5)' })); defs.append(marker); this.drawing.append(defs, this.world);
    const positions = new Map<string, { x: number; y: number }>();
    const shelves = Math.max(650, Math.sqrt(nodes.length * 180 * 85) * 1.3);
    let x = 16, y = 16, rowHeight = 0, maxWidth = 0;
    for (const [file, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      group.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      const columns = Math.max(1, Math.ceil(Math.sqrt(group.length * 0.65)));
      const width = columns * 174 + 24, height = Math.ceil(group.length / columns) * 78 + 54;
      if (x > 16 && x + width > shelves) { x = 16; y += rowHeight + 30; rowHeight = 0; }
      const box = svg('rect', { x, y, width, height, rx: 12, class: 'dependency-graph-cluster' });
      const title = svg('text', { x: x + 14, y: y + 26, class: 'dependency-graph-file' }); title.textContent = file;
      this.world.append(box, title);
      group.forEach((node, i) => positions.set(node.id, { x: x + 20 + i % columns * 174, y: y + 44 + Math.floor(i / columns) * 78 }));
      maxWidth = Math.max(maxWidth, x + width); x += width + 30; rowHeight = Math.max(rowHeight, height);
    }
    this.width = Math.max(250, maxWidth + 16); this.height = Math.max(150, y + rowHeight + 16);
    const connections = svg('g'), vertices = svg('g'); this.world.append(connections, vertices);
    for (const edge of edges) {
      const from = positions.get(edge.from), to = positions.get(edge.to); if (!from || !to) continue;
      const sx = from.x + 140, sy = from.y + 23, tx = to.x, ty = to.y + 23;
      const d = edge.from === edge.to ? `M ${sx - 22} ${from.y} C ${sx + 45} ${from.y - 45}, ${sx + 55} ${sy + 55}, ${sx} ${sy}` :
        `M ${sx} ${sy} C ${sx + Math.max(45, Math.abs(tx - sx) / 3)} ${sy}, ${tx - Math.max(45, Math.abs(tx - sx) / 3)} ${ty}, ${tx} ${ty}`;
      const active = selectedEdge ? edge.key === selectedEdge : edge.from === selectedId || edge.to === selectedId;
      const connection = svg('g', { role: 'button', tabindex: 0, 'aria-label': `Inspect connection ${keyLabel(edge.from)} to ${keyLabel(edge.to)}`, 'aria-pressed': String(edge.key === selectedEdge), class: `dependency-graph-edge${active ? ' selected' : ''}${(selectedId || selectedEdge) && !active ? ' muted' : ''}`, 'data-graph-edge': edge.key });
      const title = svg('title'); title.textContent = `${keyLabel(edge.from)} references ${keyLabel(edge.to)}: ${edge.evidence.length} source mentions`;
      connection.append(title, svg('path', { d, class: 'dependency-graph-line', 'marker-end': 'url(#dependency-graph-arrow)' }), svg('path', { d, class: 'dependency-graph-hit' }));
      this.activate(connection, () => this.inspect(edge)); connections.append(connection);
    }
    for (const node of nodes) {
      const position = positions.get(node.id)!;
      const group = svg('g', { transform: `translate(${position.x} ${position.y})`, role: 'button', tabindex: 0, 'aria-label': `Inspect ${keyLabel(node.id)}`, 'aria-pressed': String(node.id === selectedId), class: `dependency-graph-node${node.id === selectedId ? ' selected' : ''}${node.definitions.length !== 1 ? ' unresolved' : ''}`, 'data-graph-id': node.id });
      const title = svg('title'); title.textContent = `${keyLabel(node.id)}: ${node.definitions.length === 1 ? node.definitions[0].label + '\n' + node.definitions[0].file : node.definitions.length ? 'Ambiguous definitions' : 'Missing definition'}`;
      const identity = identityFromKey(node.id);
      const label = svg('text', { x: 12, y: identity.scope ? 19 : 28 }); label.textContent = identity.id;
      group.append(title, svg('rect', { width: 140, height: 46, rx: 7 }), label);
      if (identity.scope) {
        const scope = svg('text', { x: 12, y: 35, class: 'dependency-scope' });
        scope.textContent = identity.scope.length > 21 ? identity.scope.slice(0, 20) + '…' : identity.scope;
        group.append(scope);
      }
      this.activate(group, () => this.choose(node.id)); vertices.append(group);
    }
    this.transform(); if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    if (this.needsFit) this.frame = requestAnimationFrame(() => { this.frame = undefined; this.fit(); });
    return root;
  }
  private activate(node: Element, callback: () => void) {
    node.addEventListener('focus', () => {
      if (!node.classList.contains('dependency-graph-node')) return;
      const box = node.getBoundingClientRect(), stage = this.stage.getBoundingClientRect();
      if (box.left < stage.left || box.right > stage.right || box.top < stage.top || box.bottom > stage.bottom) {
        this.x += stage.left + stage.width / 2 - box.left - box.width / 2;
        this.y += stage.top + stage.height / 2 - box.top - box.height / 2; this.transform();
      }
    });
    node.addEventListener('click', callback);
    node.addEventListener('keydown', event => { const key = (event as KeyboardEvent).key; if (key === 'Enter' || key === ' ') { event.preventDefault(); callback(); } });
  }
}
