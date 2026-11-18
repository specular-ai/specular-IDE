export const style = `
:root { color-scheme: dark; font-family: "Segoe UI", system-ui, sans-serif; font-size: 13px;
  --base: var(--specular-surface, #101318); --raised: var(--specular-background, #171d24); --selected: var(--specular-selection, #233b3d);
  --border: var(--specular-border, #40505e); --text: var(--specular-text, #d7e0e6); --muted: var(--specular-muted, #a1b0bc);
  --accent: var(--specular-accent, #8bd5cc); --warning: var(--specular-warning, #e3ba78); --error: var(--specular-error, #ef8d8d);
  color: var(--text); background: var(--raised); }
:root[data-theme="light"] { color-scheme: light; }
* { box-sizing: border-box; }
button, select, input { font: inherit; color: inherit; }
button { cursor: pointer; }
button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
#agent-activity { padding: 18px; max-width: 1200px; }
.activity-header h2 { margin: 0 0 6px; font-size: 20px; color: var(--accent); }
.activity-header p { margin: 4px 0; }
.activity-empty, .activity-muted, .activity-note, .activity-counts { color: var(--muted); font-size: 12px; line-height: 1.6; }
.activity-empty { margin: 24px 0; max-width: 640px; }
.activity-counts { font-size: 13px; color: var(--text); }
.activity-warning { color: var(--warning); font-size: 12px; }
.activity-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 14px; margin: 14px 0; }
.activity-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.activity-field label { font-size: 11px; color: var(--muted); }
.activity-field select, .activity-field input { padding: 5px 7px; background: var(--base); border: 1px solid var(--border); border-radius: 6px; max-width: 100%; }
/* The session list takes the rest of the row and shrinks with it, so it stays beside Agent, From, and To; long names truncate inside it. */
.activity-field:has(#activity-session) { flex: 1 1 200px; }
#activity-session { width: 100%; text-overflow: ellipsis; }
.activity-button { padding: 5px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--base); }
.activity-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.activity-tab { padding: 7px 14px; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--muted); }
.activity-tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
.activity-session, .activity-group { margin: 6px 0; border: 1px solid var(--border); border-radius: 8px; background: var(--base); }
.activity-group.repeated { border-color: var(--warning); }
.activity-session > summary, .activity-group > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 8px 12px; cursor: pointer; }
.activity-session[open] > summary, .activity-group[open] > summary { background: var(--selected); }
.activity-title { flex: 1; min-width: 160px; overflow-wrap: anywhere; font-weight: 600; }
.activity-agent { font-size: 11px; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--accent); color: var(--accent); white-space: nowrap; }
.activity-agent.codex { border-color: var(--muted); color: var(--text); }
.activity-session-body { padding: 4px 12px 10px 22px; }
.activity-turn > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 4px 0; cursor: pointer; }
.activity-calls { list-style: none; margin: 4px 0 8px; padding: 0; }
.activity-call { display: grid; grid-template-columns: auto auto auto minmax(0, 1fr) auto auto; gap: 10px; align-items: baseline; padding: 3px 6px; border-left: 3px solid transparent; font-size: 12px; }
.activity-group .activity-call { grid-template-columns: auto auto minmax(0, 1fr) auto; margin: 0 12px; }
.activity-group .activity-agent { min-width: 92px; text-align: center; }
.activity-call.failed { border-left-color: var(--error); background: color-mix(in srgb, var(--error) 8%, transparent); }
.activity-time { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.activity-tool { font-family: Consolas, monospace; }
.activity-kind { color: var(--muted); font-size: 11px; }
.activity-kind.write { color: var(--accent); }
.activity-target { font-family: Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-outcome { font-size: 11px; color: var(--muted); white-space: nowrap; }
.activity-outcome.error, .activity-outcome.denied { color: var(--error); }
.activity-badge { font-size: 11px; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--border); color: var(--muted); white-space: nowrap; }
.activity-badge.failed { color: var(--error); border-color: var(--error); }
.activity-badge.repeated { color: var(--warning); border-color: var(--warning); }
.activity-badge.spec { color: var(--accent); border-color: var(--accent); margin-left: 8px; }
.activity-group-name { font-family: Consolas, monospace; font-weight: 600; flex: 1; min-width: 120px; overflow-wrap: anywhere; }
.activity-last { font-size: 12px; color: var(--muted); }
.activity-check { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 8px; font-size: 12px; }
.activity-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.activity-table th { text-align: left; color: var(--muted); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.activity-table td { padding: 4px 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
.activity-path { overflow-wrap: anywhere; font-family: Consolas, monospace; }
.activity-number { text-align: right; font-variant-numeric: tabular-nums; }
.activity-table td:last-child { white-space: nowrap; }
.activity-file { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; text-align: left; }
.activity-file:hover { text-decoration: underline; }
`;
