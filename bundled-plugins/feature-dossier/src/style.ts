export const style = `
:root { color-scheme: dark; font-family: "Segoe UI", system-ui, sans-serif; font-size: 13px;
  --base: var(--specular-surface, #101318); --raised: var(--specular-background, #171d24); --selected: var(--specular-selection, #233b3d);
  --border: var(--specular-border, #40505e); --text: var(--specular-text, #d7e0e6); --muted: var(--specular-muted, #a1b0bc);
  --accent: var(--specular-accent, #8bd5cc); --warning: var(--specular-warning, #e3ba78); --error: var(--specular-error, #ef8d8d);
  color: var(--text); background: var(--raised); }
:root[data-theme="light"] { color-scheme: light; }
* { box-sizing: border-box; }
button, select { font: inherit; color: inherit; }
button { cursor: pointer; }
button:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
[hidden] { display: none !important; }
#feature-dossier { padding: 18px; max-width: 1100px; }
.dossier-picker { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.dossier-picker label { font-size: 12px; color: var(--muted); }
.dossier-picker select { min-width: 0; flex: 1; max-width: 420px; padding: 7px; background: var(--base); border: 1px solid var(--border); border-radius: 6px; }
.dossier-empty, .dossier-muted, .dossier-counts, .dossier-markers { color: var(--muted); font-size: 12px; line-height: 1.6; }
.dossier-empty { margin: 24px 0; }
.dossier-summary { padding: 14px; margin-bottom: 14px; background: var(--base); border: 1px solid var(--border); border-radius: 8px; }
.dossier-summary h2 { margin: 0 0 6px; font-size: 20px; color: var(--accent); overflow-wrap: anywhere; }
.dossier-summary p { margin: 6px 0; }
.dossier-status-bar { display: flex; height: 12px; margin: 10px 0 8px; border-radius: 6px; overflow: hidden; gap: 2px; }
.dossier-segment, .dossier-swatch { background: var(--accent); }
.dossier-segment.none, .dossier-swatch.none { background: var(--border); }
.dossier-segment.conflict, .dossier-swatch.conflict { background: var(--error); }
.dossier-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; list-style: none; padding: 0; margin: 0; font-size: 12px; }
.dossier-legend li { display: flex; align-items: center; gap: 6px; }
.dossier-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.dossier-section { margin: 10px 0; border: 1px solid var(--border); border-radius: 8px; background: var(--base); }
.dossier-section > summary { padding: 10px 12px; font-weight: 600; cursor: pointer; }
.dossier-id { border-top: 1px solid var(--border); }
.dossier-id > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 8px 12px; cursor: pointer; }
.dossier-id[open] > summary { background: var(--selected); }
.dossier-id-label { font-family: Consolas, monospace; color: var(--accent); font-weight: 600; }
.dossier-id-title { flex: 1; min-width: 120px; overflow-wrap: anywhere; }
.dossier-badges { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.dossier-badge { font-size: 11px; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--border); }
.dossier-badge.status { color: var(--accent); }
.dossier-badge.conflict { color: var(--error); border-color: var(--error); }
.dossier-badge.warning { color: var(--warning); border-color: var(--warning); }
.dossier-badge.muted { color: var(--muted); }
.dossier-id-body { padding: 4px 12px 12px 24px; }
.dossier-excerpt { margin: 8px 0; }
.dossier-excerpt pre { margin: 0; padding: 8px 10px; max-width: 100%; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 Consolas, monospace; background: var(--raised); border-left: 3px solid var(--accent); border-radius: 4px; }
.dossier-links h4 { margin: 10px 0 4px; font-size: 12px; color: var(--muted); font-weight: 600; }
.dossier-source, .dossier-link { display: block; max-width: 100%; text-align: left; background: none; border: 0; padding: 3px 0; color: var(--accent); font-size: 12px; overflow-wrap: anywhere; }
.dossier-source:hover, .dossier-link:hover { text-decoration: underline; }
span.dossier-link { color: var(--muted); }
.dossier-generated { margin: 0 0 14px; border: 1px dashed var(--border); border-radius: 8px; background: var(--base); }
.dossier-generated > summary { display: flex; align-items: baseline; gap: 10px; padding: 10px 14px; font-weight: 600; cursor: pointer; list-style: none; }
.dossier-generated > summary::-webkit-details-marker { display: none; }
.dossier-generated > summary::before { content: '▶'; font-size: 10px; margin-right: -4px; }
.dossier-generated[open] > summary::before { content: '▼'; }
.dossier-generated-hint { font-size: 11px; font-weight: 400; color: var(--muted); }
.dossier-generated-hint.stale { color: var(--warning); }
.dossier-generated-body { padding: 0 14px 12px; }
.dossier-summary-label, .dossier-summary-unknown { color: var(--muted); font-size: 11px; margin: 4px 0; }
.dossier-summary-stale { color: var(--warning); font-size: 12px; margin: 6px 0; }
.dossier-summary-error { color: var(--error); font-size: 12px; margin: 6px 0; }
.dossier-summary-text { line-height: 1.6; margin: 8px 0; overflow-wrap: anywhere; }
.dossier-citation { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; text-decoration: underline dotted; }
.dossier-summary-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
.dossier-summary-controls select, .dossier-summary-controls input { padding: 5px 7px; background: var(--raised); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font: inherit; }
.dossier-summary-controls input { width: 170px; }
.dossier-button { padding: 5px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--raised); }
.dossier-button.primary { background: var(--accent); color: var(--base); border-color: var(--accent); }
.dossier-dates, .dossier-files { margin: 14px 0; }
.dossier-dates h3, .dossier-files h3 { font-size: 13px; margin: 0 0 6px; }
.dossier-date, .dossier-file { padding: 5px 0; }
`;
