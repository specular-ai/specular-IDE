import { appearance, parseTheme, type ThemeMode } from '../shared/appearance';
let mode: ThemeMode = 'dark';
export const currentAppearance = () => appearance(mode);
export function applyTheme(value: unknown) {
  mode = parseTheme(value);
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
  const button = document.querySelector<HTMLButtonElement>('#theme-switch');
  if (button) {
    button.setAttribute('aria-checked', String(mode === 'dark'));
    button.title = `${mode === 'dark' ? 'Dark' : 'Light'} mode — switch to ${mode === 'dark' ? 'light' : 'dark'} mode`;
  }
  window.dispatchEvent(new Event('specular:appearance'));
}
