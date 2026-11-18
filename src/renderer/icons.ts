/** Inline SVG icons shared by the explorer and the workspace tabs; static markup, colored through currentColor. */
const svg = (size: number, body: string) => `<svg viewBox="0 0 16 16" width="${size}" height="${size}">${body}</svg>`;

export const folderIcon = (open: boolean) => svg(15, open
  ? '<path d="M1.5 12V4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.1a1 1 0 0 1 1 1V7" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M1.5 13l2.1-5.6a.6.6 0 0 1 .56-.4H14.6a.5.5 0 0 1 .47.67L13.1 13z" fill="currentColor" fill-opacity=".38" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'
  : '<path d="M1.5 4a1 1 0 0 1 1-1h3.4l1.5 1.6h6.1a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity=".28" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>');

export const documentIcon = (size = 14) => svg(size,
  '<path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M5.5 8h5 M5.5 10.5h5" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity=".7"/>');

export const codeIcon = (size = 14) => svg(size,
  '<path d="M5 4.5 1.5 8 5 11.5 M11 4.5 14.5 8 11 11.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.3 3 6.7 13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".75"/>');

export const newFileIcon = (size = 15) => svg(size,
  '<path d="M9.5 1.5h-6v13h5 M9.5 1.5l3 3v4 M9.5 1.5v3h3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M12.5 10.5v5 M10 13h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>');

export const searchIcon = (size = 15) => svg(size,
  '<circle cx="6.8" cy="6.8" r="4.3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10 10l4.2 4.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>');

export const viewIcon = (size = 13) => svg(size,
  '<path d="M4 4.5 12 4.5 M4.6 5.6 7.4 10.6 M11.4 5.6 8.6 10.6" stroke="currentColor" stroke-width="1.1"/><circle cx="3.5" cy="4.5" r="2" fill="currentColor"/><circle cx="12.5" cy="4.5" r="2" fill="currentColor"/><circle cx="8" cy="12" r="2" fill="currentColor"/>');
