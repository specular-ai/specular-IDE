import type { BriefSource } from '../core/briefs';
import { identityFromKey } from '../core/id-identity';

// Read the live DOM selection only. Detached or cross-panel selections are not reusable.
export function capturePreviewSelection(target: HTMLElement, file: string, unsaved: boolean,
  diskConflict: boolean): BriefSource | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);
  if (!target.contains(range.startContainer) || !target.contains(range.endContainer)) return;
  const text = selection.toString();
  if (!text.trim()) return;
  const fragment = range.cloneContents();
  const authoredId = (node: HTMLElement) => identityFromKey(node.dataset.id!).id;
  const ids = [...fragment.querySelectorAll<HTMLElement>('[data-id]')]
    .filter(node => node.textContent === authoredId(node)).map(authoredId);
  // A range wholly inside an ID may omit its containing element from cloneContents.
  const parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
  const key = parent?.closest<HTMLElement>('[data-id]')?.dataset.id;
  const id = key && identityFromKey(key).id;
  if (id && text === id) ids.push(id);
  return { kind: 'preview', file, text, ids: [...new Set(ids)], unsaved, diskConflict };
}
