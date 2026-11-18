/** Explanatory text shown on hover over a section title or field label instead of below it, keeping the configuration dialog uncluttered. */
export function explain<T extends HTMLElement>(element: T, text: string): T {
  element.title = text; element.classList.add('has-hint'); return element;
}
