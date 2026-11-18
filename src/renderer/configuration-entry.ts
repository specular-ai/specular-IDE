/** Disclosure state belongs to a draft object, not its editable name or list position. */
const expanded = new WeakMap<object, boolean>();
const entryModels = new WeakMap<HTMLDetailsElement, object>();
/** Capture immediately before replacement: native toggle events may still be queued. */
export function rememberConfigurationEntries(root: HTMLElement) {
  root.querySelectorAll<HTMLDetailsElement>('.config-entry').forEach(details => {
    const model = entryModels.get(details); if (model) expanded.set(model, details.open);
  });
}
export function configurationEntry(model: object, content: HTMLElement, label: () => string, startOpen = false, action?: HTMLButtonElement | HTMLButtonElement[], leading?: HTMLElement) {
  const actions = action === undefined ? [] : Array.isArray(action) ? action : [action];
  const details = document.createElement('details'); details.className = 'config-entry';
  entryModels.set(details, model);
  details.open = expanded.get(model) ?? startOpen;
  const summary = document.createElement('summary');
  const title = actions.length || leading ? document.createElement('span') : summary;
  if (actions.length || leading) {
    // A leading control, such as an enable checkbox, sits between the disclosure marker and the title; clicking it does not toggle the entry.
    title.className = 'config-entry-title'; summary.classList.add('config-entry-actions'); summary.append(...(leading ? [leading] : []), title, ...actions);
    // The buttons act on the entry without toggling it.
    for (const button of actions) button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
  }
  const refresh = () => { title.textContent = label(); };
  refresh(); details.append(summary, content);
  details.ontoggle = () => { if (details.isConnected) expanded.set(model, details.open); };
  content.addEventListener('input', refresh); content.addEventListener('change', refresh); leading?.addEventListener('change', refresh);
  return details;
}
