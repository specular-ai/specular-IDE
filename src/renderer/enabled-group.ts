import { configurationEntry } from './configuration-entry';

/** Expansion state per section, kept across re-renders that rebuild the settings objects. */
const models = new Map<string, object>();

/**
 * An expandable settings section, like a date rule: its enable checkbox sits between the disclosure marker and the title,
 * the title says (off) while it is unchecked, and unchecking dims the section's options and disables their controls.
 * A section starts open when enabled; its checkbox never opens or closes it. `key` distinguishes the same section in different places
 * (the project, a category, a status); `after` runs after each sync, for controls with their own disabled rule.
 */
export function enabledGroup(toggle: HTMLLabelElement, options: { key?: string; after?: () => void } = {}) {
  const input = toggle.querySelector('input')!, text = toggle.textContent!.trim();
  input.setAttribute('aria-label', text);
  const id = `${options.key ?? 'project'}:${text}`;
  let model = models.get(id); if (!model) { model = {}; models.set(id, model); }
  const body = document.createElement('div'); body.className = 'definition-site-options';
  const group = configurationEntry(model, body, () => text + (input.checked ? '' : ' (off)'), input.checked, undefined, input);
  group.classList.add('definition-site-group');
  const sync = () => {
    const off = !input.checked; body.classList.toggle('definition-site-disabled', off);
    body.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | HTMLFieldSetElement>('fieldset, input, select, textarea, button').forEach(control => { control.disabled = off; });
    if (!off) options.after?.();
  };
  input.addEventListener('change', sync);
  return { group, body, sync, title: group.querySelector<HTMLElement>('.config-entry-title')! };
}
