import { keyLabel, setIdentities } from './id-identity.js';
import type { CustomViewContext, RenderRequest } from '@specular/plugin-api';
import { RelationshipMap } from './relationship-map.js';
import { DependencyOverview } from './dependency-overview.js';
import { projectIndex, type Occurrence } from './model.js';
import { style } from './style.js';

export function activate(context: CustomViewContext) {
  const root = context.root as unknown as HTMLElement;
  let request = context.request;
  const css = document.createElement('style'); css.textContent = style;
  const surface = document.createElement('section'); surface.className = 'relationship-map';
  surface.id = request.viewId === 'overview' ? 'dependency-overview' : 'relationship-focus';
  root.replaceChildren(css, surface);
  const save = () => context.saveState?.(JSON.stringify(view!.getState()));
  const navigate = (source: Occurrence, revision: number) => {
    if (!request.models.project!.ready || revision !== request.context.revision) return;
    save(); context.openSource({ projectId: request.context.projectId, revision, file: source.file, start: source.offset, end: source.end });
  };
  const occurrences = (id: string) => {
    let panel = root.querySelector<HTMLElement>('#all-occurrences');
    if (!panel) { panel = document.createElement('section'); panel.id = 'all-occurrences'; root.append(panel); }
    panel.replaceChildren();
    const title = document.createElement('h3'); title.textContent = `All occurrences of ${keyLabel(id)}`; panel.append(title);
    const index = projectIndex(request.models), revision = request.context.revision;
    for (const source of [...index.definitions, ...index.references].filter(o => o.id === id)) {
      const button = document.createElement('button'); button.className = 'map-evidence-source';
      button.textContent = `${source.kind}: ${source.file}:${source.line}\n${source.label}`;
      button.onclick = () => navigate(source, revision); panel.append(button);
    }
    panel.scrollIntoView();
  };
  const view = request.viewId === 'focus' ? new RelationshipMap(surface, navigate, occurrences) : request.viewId === 'overview' ? new DependencyOverview(surface, navigate, occurrences) : undefined;
  if (!view) throw new Error('Unknown Relationships view.');
  setIdentities(request.models.project!.occurrences);
  if (request.customState) { try { view.restoreState(JSON.parse(request.customState)); } catch {} }
  let target: string | undefined;
  const update = (next: RenderRequest) => {
    const sameContent = next.context.revision === request.context.revision && next.context.projectId === request.context.projectId && next.context.currentFile === request.context.currentFile && next.models.project!.ready === request.models.project!.ready && next.targetId === request.targetId;
    const themeOnly = sameContent && next.appearance?.mode !== request.appearance?.mode;
    request = next;
    if (themeOnly) return;
    root.querySelector('#all-occurrences')?.remove();
    view.update(projectIndex(next.models), next.context.revision, next.models.project!.ready, 'Waiting for the project index...', next.models.physical!.documents.length, [...next.models.physical!.warnings]);
    if (next.targetId !== undefined && next.targetId !== target) { target = next.targetId; view.focus(target); save(); }
  };
  update(request);
  // Persist after event handlers have updated selection, filters, pages, and camera.
  let stateTimer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => { clearTimeout(stateTimer); stateTimer = setTimeout(save, 0); };
  const events = ['click', 'input', 'change', 'keydown', 'pointerup', 'wheel', 'toggle'];
  for (const event of events) root.addEventListener(event, changed, true);
  return { update, dispose() { clearTimeout(stateTimer); for (const event of events) root.removeEventListener(event, changed, true); view.dispose(); } };
}
