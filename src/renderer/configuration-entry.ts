/** Disclosure state belongs to a draft object, not its editable name or list position. */
const expanded = new WeakMap<object, boolean>();
const entryModels = new WeakMap<HTMLDetailsElement, object>();
/** Capture immediately before replacement: native toggle events may still be queued. */
export function rememberConfigurationEntries(root: HTMLElement) {
  root.querySelectorAll<HTMLDetailsElement>('.config-entry').forEach(details => {
    const model = entryModels.get(details); if (model) expanded.set(model, details.open);
  });
}
export function configurationEntry(model: object, content: HTMLElement, label: () => string, startOpen = false, action?: HTMLButtonElement) {
  const details = document.createElement('details'); details.className = 'config-entry';
  entryModels.set(details, model);
  details.open = expanded.get(model) ?? startOpen;
  const summary = document.createElement('summary');
  const title = action ? document.createElement('span') : summary;
  if (action) { title.className = 'config-entry-title'; summary.classList.add('config-entry-actions'); summary.append(title, action); action.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); }); }
  const refresh = () => { title.textContent = label(); };
  refresh(); details.append(summary, content);
  details.ontoggle = () => { if (details.isConnected) expanded.set(model, details.open); };
  content.addEventListener('input', refresh); content.addEventListener('change', refresh);
  return details;
}
