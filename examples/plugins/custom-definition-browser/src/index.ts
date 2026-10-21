import type { CustomPluginModule, CustomViewContext, RenderRequest } from '@specular/plugin-api';

export function activate({ root, request, openSource }: CustomViewContext) {
  const style = document.createElement('style');
  style.textContent = `
:root[data-theme="light"] {
  color-scheme: light;
  --surface-base: var(--specular-surface, #ffffff); --surface-raised: var(--specular-background, #f4f7fa); --surface-selected: var(--specular-selection, #c9e7e2);
  --border-strong: var(--specular-border, #a8b8c5); --text-primary: var(--specular-text, #243442); --text-muted: var(--specular-muted, #526575);
  --text-accent: var(--specular-accent, #176c63); --text-warning: var(--specular-warning, #80520c); --text-error: var(--specular-error, #a33640);
}

    main { padding: 24px; max-width: 850px; margin: auto; }
    h1 { color: var(--text-accent, #a8eadc); font-size: 22px; }
    input { box-sizing: border-box; width: 100%; padding: 9px; color: inherit; background: var(--surface-raised, #17232c); border: 1px solid var(--border-strong, #49616e); border-radius: 5px; }
    article { margin-top: 10px; padding: 12px; background: var(--surface-raised, #17232c); border: 1px solid var(--surface-selected, #334853); border-radius: 6px; }
    article p { color: var(--text-accent, #9fb1bb); }
    .status { display: block; margin: -6px 0 10px; padding-left: 6px; color: var(--text-muted, #9fb1bb); }
    button { padding: 6px 9px; color: var(--text-accent, #a8eadc); background: transparent; border: 1px solid var(--border-strong, #49616e); border-radius: 4px; cursor: pointer; }
  `;
  const main = document.createElement('main'), heading = document.createElement('h1');
  heading.textContent = 'Definitions in this project';
  const filter = document.createElement('input'); filter.placeholder = 'Filter definitions'; filter.setAttribute('aria-label', 'Filter definitions');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const results = document.createElement('section');
  main.append(heading, filter, status, results); root.append(style, main);
  let current = request;
  function render() {
    const query = filter.value.trim().toLowerCase();
    const project = current.models.project!;
    const definitions = project.ready ? project.occurrences.filter(item => item.kind === 'definition' && (!query || `${item.id} ${item.label} ${item.source.file}`.toLowerCase().includes(query))) : [];
    status.textContent = project.ready ? `${definitions.length} matching definition(s)` : 'Waiting for the project index...';
    // Statuses are aggregated per ID in the project model; colours come from the configured status list.
    const elements = new Map(project.ids.map(element => [element.key, element]));
    const palette = new Map(project.configuration.statuses.map(entry => [entry.name, entry.colors?.[current.appearance?.mode ?? 'dark']]));
    results.replaceChildren(...definitions.map(item => {
      const row = document.createElement('article'), title = document.createElement('strong'), detail = document.createElement('p'), button = document.createElement('button');
      title.textContent = item.label.startsWith(item.id) ? item.label : `${item.id}: ${item.label}`;
      detail.textContent = item.source.file; button.textContent = `Open ${item.id}`;
      const authored = elements.get(item.key ?? item.id)?.status, names = [...new Set(authored?.occurrences.map(entry => entry.name) ?? [])];
      const state = document.createElement('small'); state.className = 'status';
      state.textContent = !authored ? 'No status' : authored.state === 'conflict' ? `Status conflict: ${names.join(', ')}` : `Status: ${names[0]}`;
      const color = authored?.state === 'authored' ? palette.get(names[0]) : undefined;
      if (color) state.style.borderLeft = `4px solid ${color}`;
      button.onclick = () => openSource({ ...item.source, projectId: current.context.projectId, revision: current.context.revision });
      row.append(title, detail, state, button); return row;
    }));
  }
  filter.oninput = render; render();
  return { update(next: RenderRequest) { const themeOnly = next.appearance?.mode !== current.appearance?.mode && JSON.stringify([next.context, next.models]) === JSON.stringify([current.context, current.models]); current = next; if (!themeOnly) render(); }, dispose() { filter.oninput = null; } };
}

const plugin = { activate } satisfies CustomPluginModule;
export default plugin;
