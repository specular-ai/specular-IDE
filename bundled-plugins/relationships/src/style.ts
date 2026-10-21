export const style = `
:root[data-theme="light"] {
  color-scheme: light;
  --surface-base: var(--specular-surface, #ffffff); --surface-raised: var(--specular-background, #f4f7fa); --surface-selected: var(--specular-selection, #c9e7e2);
  --border-strong: var(--specular-border, #a8b8c5); --text-primary: var(--specular-text, #243442); --text-muted: var(--specular-muted, #526575);
  --text-accent: var(--specular-accent, #176c63); --text-warning: var(--specular-warning, #80520c); --text-error: var(--specular-error, #a33640);
  --border: var(--specular-border, #a8b8c5);
}

:root { color-scheme: dark; font-family: "Segoe UI", system-ui, sans-serif; color: var(--text-primary, #d7e0e6); background: var(--surface-base, #101318); font-size: 13px; --border: var(--surface-selected, #29313a); --muted: var(--text-muted, #91a0ad); --accent: var(--text-accent, #8bd5cc); --amber: var(--text-warning, #e3ba78); }
* { box-sizing: border-box; }
button, input { font: inherit; }
button { color: inherit; cursor: pointer; }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
button { -webkit-app-region: no-drag; }
[hidden] { display: none !important; }
::selection { background: var(--surface-selected, #31525a); color: var(--text-primary, #fff); }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: var(--surface-selected, #36424c); border: 2px solid var(--surface-base, #15191f); border-radius: 8px; }
::-webkit-scrollbar-track { background: transparent; }
.button { min-height: 34px; border-radius: 6px; padding: 7px 12px; border: 1px solid var(--surface-selected, #39464f); background: var(--surface-raised, #202933); display: inline-flex; align-items: center; justify-content: center; gap: 14px; font-weight: 500; }
.button:hover:not(:disabled) { background: var(--surface-selected, #2a3741); border-color: var(--text-muted, #607581); }
.button.primary { background: var(--text-accent, #a3ded3); color: var(--surface-raised, #152927); border-color: var(--text-accent, #a3ded3); }
.button.primary:hover { background: var(--text-accent, #bcf0e5); }
.button.secondary { background: var(--surface-raised, #1b222a); }
kbd { color: var(--muted); font: 10px Consolas, monospace; border: 1px solid var(--surface-selected, #3a4651); border-radius: 3px; padding: 2px 4px; white-space: nowrap; }
.quiet-button { background: none; border: none; font-size: 11px; color: var(--muted); padding: 5px 7px; }
.quiet-button:hover { color: var(--accent); }
.icon-button { background: none; border: 0; padding: 2px 5px; color: var(--muted); font-size: 19px; line-height: 1; }
.coral { color: var(--text-warning, #edaa95); }
.relationship-map { flex: 1; min-height: 0; overflow: auto; padding: 18px; background: var(--surface-raised, #171d24); }
.relationship-map h2 { margin: 0 0 8px; font-size: 20px; color: var(--text-accent, #def0ec); }
.relationship-map h3 { font-size: 13px; margin: 16px 0 8px; }
.map-intro, .map-scope, .map-through-scope, .map-status { font-size: 12px; line-height: 1.6; color: var(--text-muted, #a1b0bc); }
.map-controls { display: grid; grid-template-columns: auto minmax(100px, 1fr) auto; align-items: center; gap: 8px; margin: 16px 0; }
.map-controls label { font-size: 11px; }
.map-controls input, .map-controls select { min-width: 0; width: 100%; padding: 7px; color: var(--text-accent, #def0ec); background: var(--surface-base, #11161c); border: 1px solid var(--border-strong, #40505e); border-radius: 4px; }
.map-controls select { grid-column: 2 / 4; }
#relationship-focus { min-height: 100vh; }
.map-id-picker { position: relative; min-width: 0; display: flex; }
.map-id-picker input { padding-right: 32px; }
.map-id-picker > button { position: absolute; right: 1px; top: 1px; bottom: 1px; width: 30px; border: 0; background: transparent; color: var(--text-accent, #def0ec); }
.map-id-picker [role=listbox] { position: absolute; z-index: 10; top: 100%; left: 0; right: 0; max-height: min(240px, 40vh); overflow: auto; background: var(--surface-base, #11161c); border: 1px solid var(--border-strong, #40505e); box-shadow: 0 4px 12px #0005; }
.map-id-picker [role=option] { padding: 8px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.map-id-picker [role=option]:hover, .map-id-picker [aria-selected=true] { background: var(--surface-selected, #233b3d); }
.map-picker-notice { position: absolute; z-index: 11; top: 100%; left: 0; right: 0; padding: 8px; background: var(--surface-base, #11161c); color: var(--text-muted, #a1b0bc); pointer-events: none; }
.map-id-picker:has(.map-picker-notice:not([hidden])) [role=listbox] { padding-top: 40px; }
.map-navigation { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.map-headings { display: grid; grid-template-columns: 28% 28% 28%; column-gap: 8%; font-size: 12px; color: var(--text-muted, #a1b0bc); padding: 10px 0; }
.map-graph { position: relative; margin: 8px 0; }
.map-graph svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.map-edge { fill: none; stroke: var(--text-muted, #738d9b); stroke-width: 3; cursor: pointer; }
.map-edge:hover, .map-graph g:focus .map-edge, .map-edge.selected { stroke: var(--text-accent, #83d8c5); outline: none; }
.map-node { position: absolute; width: 28%; height: 84px; padding: 6px; display: flex; flex-direction: column; align-items: start; border: 1px solid var(--border-strong, #40505e); border-radius: 6px; background: var(--surface-raised, #1e2933); overflow: hidden; }
.map-node.focused { border-color: var(--text-accent, #83d8c5); background: var(--surface-selected, #233b3d); }
.map-definition { background: none; border: 0; padding: 0; color: var(--text-accent, #c4eee5); font-weight: 600; font-size: 12px; }
.map-node small { font-size: 10px; color: var(--text-muted, #a1b0bc); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; width: 100%; margin: 5px 0; }
.map-node .quiet-button { font-size: 10px; padding: 2px 0; }
.map-connection, .map-evidence-source { display: block; width: 100%; text-align: left; background: var(--surface-raised, #1e2933); color: var(--text-primary, #c9d7e0); border: 1px solid var(--border-strong, #40505e); border-radius: 4px; padding: 10px; margin: 6px 0; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.map-connection[aria-pressed="true"] { border-color: var(--text-accent, #83d8c5); }
.map-evidence-source { white-space: pre-wrap; }
.map-evidence:focus { outline: 1px solid var(--text-accent, #83d8c5); outline-offset: 3px; }
.dependency-controls { display: grid; grid-template-columns: auto minmax(100px, 1fr); align-items: center; gap: 8px; margin: 14px 0; }
.dependency-controls label, .dependency-paths label { font-size: 12px; }
.dependency-controls input, .dependency-controls select, .dependency-paths select { min-width: 0; padding: 7px; color: var(--text-accent, #def0ec); background: var(--surface-base, #11161c); border: 1px solid var(--border-strong, #40505e); border-radius: 4px; }
.dependency-summary { font-size: 13px; line-height: 1.6; color: var(--text-accent, #c4eee5); }
.dependency-scope { color: var(--text-muted, #a1b0bc); font-size: 12px; line-height: 1.5; margin-bottom: 16px; }
.dependency-scope summary, .dependency-file-group summary { cursor: pointer; }
.dependency-files { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; align-items: start; }
.dependency-file-group { border: 1px solid var(--border-strong, #40505e); border-radius: 6px; padding: 10px; min-width: 0; }
.dependency-file-group summary { font-size: 12px; color: var(--text-accent, #c4eee5); overflow-wrap: anywhere; }
.dependency-node, .dependency-edge, .dependency-evidence-source { display: block; width: 100%; text-align: left; background: var(--surface-raised, #1e2933); color: var(--text-primary, #c9d7e0); border: 1px solid var(--border-strong, #40505e); border-radius: 4px; padding: 9px; margin-top: 8px; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.dependency-node span, .dependency-node small { display: block; color: var(--text-muted, #a1b0bc); }
.dependency-node span { max-height: 3em; overflow: hidden; }
.dependency-node[aria-pressed="true"], .dependency-edge[aria-pressed="true"] { border-color: var(--text-accent, #83d8c5); }
.dependency-neighborhood { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.dependency-neighborhood h4 { color: var(--text-accent, #c4eee5); }
.dependency-inspector { border-top: 1px solid var(--border-strong, #40505e); margin-top: 20px; }
.dependency-inspector:focus, .dependency-evidence:focus, .dependency-paths:focus { outline: 1px solid var(--text-accent, #83d8c5); outline-offset: 3px; }
.dependency-inspector > button { margin: 0 10px 10px 0; }
.dependency-path-target { display: inline-block; margin: 5px; border: 1px solid var(--border-strong, #40505e); padding: 6px; border-radius: 4px; }
.dependency-route { color: var(--text-accent, #c4eee5); padding: 10px; border-left: 3px solid var(--text-accent, #83d8c5); overflow-wrap: anywhere; }
.dependency-evidence-source { white-space: pre-wrap; }

.dependency-visual-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.dependency-visual-layout.with-details { grid-template-columns: minmax(240px, 1fr) 260px; }
.dependency-visual-layout > .dependency-inspector { margin: 0; padding: 0 10px; max-height: 540px; overflow: auto; border: 1px solid var(--border-strong, #40505e); border-radius: 6px; }
.dependency-visual-layout:not(.with-details) > .dependency-inspector { display: none; }
.dependency-visual-layout .dependency-neighborhood { grid-template-columns: 1fr; }
.dependency-graph-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
.dependency-graph-controls span { color: var(--text-muted, #a1b0bc); font-size: 11px; }
.dependency-graph-stage { height: 490px; min-width: 0; overflow: hidden; border: 1px solid var(--border-strong, #40505e); border-radius: 8px; background: var(--surface-base, #111820); touch-action: none; cursor: grab; }
.dependency-graph-stage:active { cursor: grabbing; }
.dependency-graph-stage > svg { width: 100%; height: 100%; display: block; }
.dependency-graph-cluster { fill: var(--surface-raised, #1a242e); stroke: var(--surface-selected, #344653); }
.dependency-graph-file { fill: var(--text-muted, #a1b0bc); font: 13px Consolas, monospace; }
.dependency-graph-node { cursor: pointer; }
.dependency-graph-node rect { fill: var(--surface-selected, #263b48); stroke: var(--text-muted, #69939d); stroke-width: 1.5px; }
.dependency-graph-node text { fill: var(--text-accent, #e0f4ef); font: 600 15px Consolas, monospace; pointer-events: none; }
.dependency-graph-node .dependency-scope { font-size: 9px; }
.dependency-graph-node.selected rect, .dependency-graph-node:focus rect { fill: var(--surface-selected, #31584e); stroke: var(--text-accent, #96f4cf); stroke-width: 3px; }
.dependency-graph-node.unresolved rect { stroke: var(--text-warning, #e8b875); stroke-dasharray: 5 3; }
.dependency-graph-edge { cursor: pointer; }
.dependency-graph-line { fill: none; stroke: var(--text-accent, #70969e); stroke-width: 1.5px; }
.dependency-graph-hit { fill: none; stroke: transparent; stroke-width: 14px; }
.dependency-graph-edge.selected .dependency-graph-line, .dependency-graph-edge:focus .dependency-graph-line { stroke: var(--text-accent, #a3ffcf); stroke-width: 3px; }
.dependency-graph-edge.muted { opacity: .22; }
.dependency-list-fallback { margin-top: 16px; color: var(--text-muted, #a1b0bc); font-size: 12px; }
.dependency-list-fallback > summary { cursor: pointer; padding: 8px 0; }
@media (max-width: 1200px) { .dependency-visual-layout.with-details { grid-template-columns: minmax(0, 1fr); } .dependency-visual-layout > .dependency-inspector { max-height: 300px; } }

#dependency-overview .dependency-controls { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px 10px; }
#dependency-overview .dependency-controls label { grid-row: 1; }
#dependency-overview .dependency-controls input, #dependency-overview .dependency-controls select { grid-row: 2; width: 100%; }
#dependency-overview .dependency-controls > button { grid-row: 3; grid-column: 3; justify-self: end; }
#dependency-overview .dependency-summary { font-size: 11px; }
.dependency-graph-stage { height: clamp(280px, 48vh, 490px); }
`;
