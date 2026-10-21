export type ThemeMode = 'dark' | 'light';
export function validTheme(value: unknown): value is ThemeMode { return value === 'dark' || value === 'light'; }
export function parseTheme(value: unknown): ThemeMode { return validTheme(value) ? value : 'dark'; }

/** Fixed semantic palette; arbitrary CSS never crosses the plugin boundary. */
export function appearance(mode: ThemeMode) {
  return { mode, colors: mode === 'light' ? {
    background: '#f4f7fa', surface: '#ffffff', text: '#243442', muted: '#526575',
    border: '#a8b8c5', accent: '#176c63', selection: '#c9e7e2', warning: '#80520c', error: '#a33640',
  } : {
    background: '#101318', surface: '#1e2933', text: '#d7e0e6', muted: '#91a0ad',
    border: '#40505e', accent: '#8bd5cc', selection: '#27444e', warning: '#e3ba78', error: '#e59aa0',
  } };
}
