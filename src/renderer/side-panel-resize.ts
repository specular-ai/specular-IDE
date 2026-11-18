// Horizontal resizing of the Explorer and Project Lens columns of the workspace grid.
// Finished changes are reported for saving; restore() applies a saved width.

import { MIN_SIDE_PANEL_WIDTH as MIN_SIDE_WIDTH } from '../shared/panel-layout';

const MIN_CENTER_WIDTH = 430;
const KEYBOARD_STEP = 20;

export type SidePanel = 'explorer' | 'lens';

export class SidePanelResize {
  private preferred?: number; // undefined: the stylesheet default
  private drag?: { id: number; startX: number; startWidth: number; initial?: number };
  private pending?: number; // width requested by the latest pointer move, applied once per frame
  private frame = 0;
  private readonly property: string;

  constructor(private readonly workspace: HTMLElement, private readonly panel: HTMLElement,
    private readonly handle: HTMLElement, private readonly side: SidePanel,
    private readonly other: HTMLElement, private readonly resized: () => void,
    private readonly changed: (width: number | undefined) => void = () => {}) {
    this.property = side === 'explorer' ? '--explorer-width' : '--lens-width';
    const direction = side === 'explorer' ? 1 : -1; // dragging right widens the Explorer, narrows the Lens
    handle.onpointerdown = event => {
      if (event.button !== 0 || !event.isPrimary || this.drag) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      this.drag = { id: event.pointerId, startX: event.clientX, startWidth: this.width(), initial: this.preferred };
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing-panels');
    };
    handle.onpointermove = event => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      event.preventDefault();
      // Pointer moves can outpace frames; lay out once per frame with the latest position.
      this.pending = this.drag.startWidth + direction * (event.clientX - this.drag.startX);
      this.frame ||= requestAnimationFrame(() => this.applyPending());
    };
    handle.onpointerup = event => { if (this.drag?.id === event.pointerId) this.finishDrag(); };
    handle.onpointercancel = event => { if (this.drag?.id === event.pointerId) this.finishDrag(true); };
    handle.onlostpointercapture = () => this.finishDrag();
    window.addEventListener('blur', () => this.finishDrag());
    document.addEventListener('keydown', event => {
      if (this.drag && event.key === 'Escape') { event.preventDefault(); this.finishDrag(true); }
    });
    handle.onkeydown = event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const step = event.shiftKey ? KEYBOARD_STEP / 4 : KEYBOARD_STEP;
      if (event.key === 'ArrowLeft') this.setWidth(this.width() - direction * step);
      else if (event.key === 'ArrowRight') this.setWidth(this.width() + direction * step);
      else if (event.key === 'Home') this.setWidth(MIN_SIDE_WIDTH);
      else if (event.key === 'End') this.setWidth(Number.POSITIVE_INFINITY);
      else if (event.key === 'Enter') this.reset();
      else return;
      event.preventDefault();
      this.changed(this.preferred);
    };
    handle.ondblclick = () => { this.reset(); this.changed(undefined); };
    new ResizeObserver(() => this.layout()).observe(workspace);
    this.layout();
  }

  /** Apply a saved preference (undefined: the default) without reporting it as a change. */
  restore(width: number | undefined) {
    if (this.drag) return;
    this.preferred = width;
    this.layout();
  }

  /** The panel's rendered width in pixels. */
  width() { return this.panel.getBoundingClientRect().width; }

  private maximum() {
    const total = this.workspace.getBoundingClientRect().width;
    return Math.max(MIN_SIDE_WIDTH, total - this.other.getBoundingClientRect().width - MIN_CENTER_WIDTH);
  }

  private setWidth(width: number) {
    if (!this.workspace.getBoundingClientRect().width) return;
    this.preferred = Math.round(Math.max(MIN_SIDE_WIDTH, Math.min(this.maximum(), width)));
    this.layout();
  }

  private applyPending() {
    this.frame = 0;
    if (this.pending === undefined) return;
    const width = this.pending;
    this.pending = undefined;
    this.setWidth(width);
  }

  private reset() { this.preferred = undefined; this.layout(); }

  private finishDrag(cancel = false) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    if (!cancel) this.applyPending();
    this.pending = undefined;
    if (this.handle.hasPointerCapture(drag.id)) this.handle.releasePointerCapture(drag.id);
    document.body.classList.remove('resizing-panels');
    if (cancel) { this.preferred = drag.initial; this.layout(); }
    else if (this.preferred !== drag.initial) this.changed(this.preferred);
  }

  layout() {
    // Read all geometry first, then write, so a pointer move costs one layout rather than a forced extra one.
    const total = this.workspace.getBoundingClientRect().width;
    if (!total) return; // Hidden workspace; keep the preference.
    const maximum = this.maximum();
    let width: number;
    if (this.preferred === undefined) {
      this.workspace.style.removeProperty(this.property);
      width = this.width(); // The stylesheet default; only read on reset and window resizes.
    } else {
      // Keep the document area usable when the window narrows; the preference is restored when it widens.
      width = Math.max(MIN_SIDE_WIDTH, Math.min(maximum, this.preferred));
      this.workspace.style.setProperty(this.property, `${width}px`);
    }
    width = Math.round(width);
    this.handle.setAttribute('aria-valuemin', String(MIN_SIDE_WIDTH));
    this.handle.setAttribute('aria-valuemax', String(Math.round(maximum)));
    this.handle.setAttribute('aria-valuenow', String(width));
    this.handle.setAttribute('aria-valuetext', `${this.side === 'explorer' ? 'Explorer' : 'Project Lens'} ${width} pixels`);
    this.resized();
  }
}
