import type { EditorView } from '@codemirror/view';

const selector = '[data-source-start][data-source-end]';
function range(element: HTMLElement) {
  return { start: Number(element.dataset.sourceStart), end: Number(element.dataset.sourceEnd) };
}
function blocks(target: HTMLElement) {
  return [...target.querySelectorAll<HTMLElement>(selector)].filter(element => {
    const { start, end } = range(element);
    return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start;
  });
}
function size(element: HTMLElement) { const { start, end } = range(element); return end - start; }

/** Prefer the most specific rendered block, then the nearest block for blank/unrendered source. */
export function blockAtSource(target: HTMLElement, position: number): HTMLElement | undefined {
  const all = blocks(target);
  const containing = all.filter(element => { const { start, end } = range(element); return start <= position && position < end; });
  if (containing.length) return containing.sort((a, b) => size(a) - size(b))[0];
  const distance = (element: HTMLElement) => { const { start, end } = range(element); return Math.min(Math.abs(start - position), Math.abs(end - position)); };
  return all.sort((a, b) => distance(a) - distance(b) || size(a) - size(b))[0];
}

/** Keep an offscreen caret from pulling the preview away from the source being read. */
export function visibleSourcePosition(editor: EditorView): number {
  const viewport = editor.scrollDOM.getBoundingClientRect();
  const head = editor.state.selection.main.head, caret = editor.coordsAtPos(head);
  if (caret && caret.bottom > viewport.top && caret.top < viewport.bottom) return head;
  return editor.lineBlockAtHeight(Math.max(0, viewport.top - editor.documentTop + 8)).from;
}

export function visiblePreviewBlock(target: HTMLElement): HTMLElement | undefined {
  const viewport = target.getBoundingClientRect();
  const visible = (element: HTMLElement) => { const rect = element.getBoundingClientRect(); return rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom; };
  const selection = window.getSelection();
  if (selection?.rangeCount && selection.focusNode && target.contains(selection.anchorNode) && target.contains(selection.focusNode)) {
    const node = selection.focusNode.nodeType === Node.ELEMENT_NODE ? selection.focusNode as Element : selection.focusNode.parentElement;
    const element = node?.closest<HTMLElement>(selector);
    // A selection in a large block may itself be offscreen; inspect the selected range too.
    const selectedVisible = [...selection.getRangeAt(0).getClientRects()].some(rect => rect.bottom > viewport.top && rect.top < viewport.bottom);
    if (element && visible(element) && selectedVisible) return element;
  }
  const all = blocks(target).filter(visible), top = viewport.top + 8;
  const crossing = all.filter(element => { const rect = element.getBoundingClientRect(); return rect.top <= top && rect.bottom > top; });
  return crossing.sort((a, b) => size(a) - size(b))[0]
    ?? all.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || size(a) - size(b))[0];
}

export function blockSourcePosition(block: HTMLElement): number { return range(block).start; }

/** Scroll only the preview container, leaving the document and the other pane's selection intact. */
export function revealPreviewBlock(target: HTMLElement, block: HTMLElement) {
  target.scrollTop += block.getBoundingClientRect().top - target.getBoundingClientRect().top - 12;
}
