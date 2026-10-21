const MIN_PANEL_WIDTH = 220;
const KEYBOARD_STEP = 0.05;

export class PanelSplit {
  private ratio = 0.5;
  private actualRatio = 0.5;
  private available = 0;
  private minimum = 0;
  private drag?: { id: number; offset: number; initialRatio: number };
  private readonly observer: ResizeObserver;

  constructor(private readonly container: HTMLElement, private readonly divider: HTMLElement,
    reset: HTMLButtonElement, private readonly resized: () => void) {
    divider.onpointerdown = event => {
      if (event.button !== 0 || !event.isPrimary || this.drag) return;
      // Keep editor and browser preview selections intact while capturing the drag.
      event.preventDefault();
      this.focusControl(divider);
      this.drag = { id: event.pointerId, offset: event.clientX - divider.getBoundingClientRect().left, initialRatio: this.ratio };
      divider.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing-panels');
    };
    divider.onpointermove = event => {
      if (!this.drag || event.pointerId !== this.drag.id || !this.available) return;
      event.preventDefault();
      this.setRatio((event.clientX - container.getBoundingClientRect().left - this.drag.offset) / this.available);
    };
    divider.onpointerup = event => { if (this.drag?.id === event.pointerId) this.finishDrag(); };
    divider.onpointercancel = event => { if (this.drag?.id === event.pointerId) this.finishDrag(true); };
    divider.onlostpointercapture = () => this.finishDrag();
    window.addEventListener('blur', () => this.finishDrag());
    document.addEventListener('keydown', event => {
      if (this.drag && event.key === 'Escape') { event.preventDefault(); this.finishDrag(true); }
    });
    divider.onkeydown = event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const step = event.shiftKey ? KEYBOARD_STEP / 5 : KEYBOARD_STEP;
      if (event.key === 'ArrowLeft') this.setRatio(this.actualRatio - step);
      else if (event.key === 'ArrowRight') this.setRatio(this.actualRatio + step);
      else if (event.key === 'Home') this.setRatio(0);
      else if (event.key === 'End') this.setRatio(1);
      else if (event.key === 'Enter') this.reset();
      else return;
      event.preventDefault();
    };
    divider.ondblclick = () => this.reset();
    reset.onmousedown = event => { event.preventDefault(); this.focusControl(reset); };
    reset.onclick = () => this.reset();
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(container);
    this.layout();
  }

  refresh() { this.finishDrag(); this.layout(); }

  private setRatio(ratio: number) {
    if (!this.available) return;
    this.ratio = Math.max(this.minimum, Math.min(1 - this.minimum, ratio));
    this.layout();
  }

  private reset() { this.ratio = 0.5; this.layout(); }

  private focusControl(control: HTMLElement) {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode, focus = selection?.focusNode;
    const anchorOffset = selection?.anchorOffset ?? 0, focusOffset = selection?.focusOffset ?? 0;
    // A still-focused CodeMirror may restore its own DOM selection during remeasurement.
    // Move focus to the layout control, retaining the current selection and its direction.
    control.focus({ preventScroll: true });
    if (anchor?.isConnected && focus?.isConnected) selection?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
  }

  private finishDrag(cancel = false) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;
    if (this.divider.hasPointerCapture(drag.id)) this.divider.releasePointerCapture(drag.id);
    document.body.classList.remove('resizing-panels');
    if (cancel) { this.ratio = drag.initialRatio; this.layout(); }
  }

  private layout() {
    if (this.divider.hidden) return;
    const width = this.container.getBoundingClientRect().width;
    if (!width) return; // Hidden workspace or no open document; keep the preferred ratio.
    this.available = Math.max(0, width - this.divider.getBoundingClientRect().width);
    if (!this.available) return;
    this.minimum = Math.min(0.5, MIN_PANEL_WIDTH / this.available);
    this.actualRatio = Math.max(this.minimum, Math.min(1 - this.minimum, this.ratio));
    this.container.style.setProperty('--source-width', `${this.available * this.actualRatio}px`);
    const percent = Math.round(this.actualRatio * 100);
    this.divider.setAttribute('aria-valuemin', String(Math.round(this.minimum * 100)));
    this.divider.setAttribute('aria-valuemax', String(Math.round((1 - this.minimum) * 100)));
    this.divider.setAttribute('aria-valuenow', String(percent));
    this.divider.setAttribute('aria-valuetext', `Source ${percent}%, preview ${100 - percent}%`);
    this.resized();
  }
}
