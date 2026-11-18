import { currentAppearance } from './appearance';
import type { ActivityModel, PluginManifest, RenderRequest, RenderResult, SourceReference, ViewKind } from '../../packages/plugin-api/src/index';
import { API_VERSION } from '../../packages/plugin-api/src/index';
import { parseResult, validSource } from '../shared/plugin-runtime';
import { excludedFromAnalysis } from '../core/id-configuration';
import type { Occurrence } from '../shared/types';
import { DependencyGraphView } from './dependency-graph';
import { modelsFor } from './plugin-models';
import type { ViewContext, ViewRegistry, WorkspaceViewSnapshot } from './abstraction-views';

function requestFor(snapshot: WorkspaceViewSnapshot, projectId: string, viewId: string, extra: Partial<RenderRequest> = {}, activity?: ActivityModel): RenderRequest {
  return { appearance: currentAppearance(), apiVersion: API_VERSION, requestId: crypto.randomUUID(), viewId,
    context: { projectId, revision: snapshot.revision, ...(snapshot.currentFile && snapshot.currentFile in snapshot.documents && !excludedFromAnalysis(snapshot.currentFile, snapshot.configuration) ? { currentFile: snapshot.currentFile } : {}) },
    models: { ...modelsFor(snapshot), ...(activity ? { activity } : {}) }, ...extra };
}
/**
 * Increment 95: a view whose plugin declares `activity@1` gets the activity model with each request, and is updated
 * when the logs change (polled every 10 s while the view is open) or the project's reading switch changes.
 */
function activityFeed(manifest: PluginManifest, changed: () => void) {
  const declared = manifest.models.includes('activity@1');
  let revision: number | undefined, poll: ReturnType<typeof setInterval> | undefined;
  const switched = () => { revision = undefined; changed(); };
  return {
    async model(): Promise<ActivityModel | undefined> {
      if (!declared) return;
      try { const model = await window.specular.activityModel(); revision = model.revision; return model; } catch { return; }
    },
    start() {
      if (!declared || poll) return;
      window.addEventListener('specular:activity', switched);
      poll = setInterval(() => { void window.specular.activityModel().then(m => { if (revision !== undefined && m.revision !== revision) changed(); }).catch(() => {}); }, 10_000);
    },
    stop() { clearInterval(poll); poll = undefined; window.removeEventListener('specular:activity', switched); },
  };
}
export function registerPluginViews(registry: ViewRegistry, manifest: PluginManifest) {
  const group = `plugin:${manifest.id}`;
  registry.registerGroup({ id: group, title: manifest.title ?? manifest.views[0].title, containerId: group });
  for (const contribution of manifest.views) registry.register({
    id: `${group}:${contribution.id}`, title: contribution.title, group,
    create(root, context) { return createPluginView(root, context, manifest, contribution.id, contribution.kind); },
  });
  return `${group}:${manifest.views[0].id}`;
}
function sourceEvidence(context: ViewContext, source: SourceReference, request: RenderRequest, originalProject: string) {
  const current = context.getSnapshot();
  if (!current.ready || current.projectId !== originalProject || current.revision !== source.revision || !validSource(source, request)) return false;
  const text = current.documents[source.file];
  if (text !== request.models.physical!.documents.find(d => d.file === source.file)?.text) return false;
  const before = text.slice(0, source.start); const line = before.split('\n').length, column = source.start - before.lastIndexOf('\n');
  void context.openSource({ projectId: originalProject, revision: source.revision, source: { file: source.file, offset: source.start, end: source.end, line, column, id: '', kind: 'reference', label: 'Plugin source evidence' } });
  return true;
}
function boundsFor(root: HTMLElement) {
  const bounds = root.getBoundingClientRect();
  let { left, top, right, bottom } = bounds;
  // The native view paints above the page, so clip it to ancestors that clip their content (e.g. above the terminal).
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    if (getComputedStyle(parent).overflow === 'visible') continue;
    const clip = parent.getBoundingClientRect();
    left = Math.max(left, clip.left); top = Math.max(top, clip.top); right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
function createCustomPluginView(root: HTMLElement, context: ViewContext, manifest: PluginManifest, viewId: string) {
  let active = false, disposed = false, running = false, generation = 0, failed = false;
  let projectId = crypto.randomUUID(), internalProject = context.getSnapshot().projectId;
  let targetId: string | undefined, request: RenderRequest | undefined;
  let customState: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  root.classList.add('plugin-view', 'plugin-custom-host');
  const status = document.createElement('p'); status.setAttribute('role', 'status'); root.append(status);
  const layout = () => { if (active && request && root.getBoundingClientRect().width > 0) void window.specular.layoutCustomPlugin(manifest.id, boundsFor(root)).catch(() => {}); };
  const resize = new ResizeObserver(layout); resize.observe(root); window.addEventListener('resize', layout);
  async function render() {
    if (!active || disposed || running || failed) return;
    const version = generation, snapshot = context.getSnapshot();
    if (!snapshot.projectId) { status.textContent = 'Open a project first.'; return; }
    if (snapshot.projectId !== internalProject) { internalProject = snapshot.projectId; projectId = crypto.randomUUID(); customState = undefined; }
    running = true;
    const activity = await feed.model();
    if (!active || disposed || generation !== version) { running = false; if (active && !disposed) schedule(); return; }
    request = requestFor(snapshot, projectId, viewId, { ...(targetId === undefined ? {} : { targetId }), ...(customState === undefined ? {} : { customState }) }, activity);
    running = true; status.textContent = 'Opening isolated plugin interface...';
    try {
      await window.specular.renderCustomPlugin(manifest.id, JSON.stringify(request), boundsFor(root));
      if (!active || disposed || generation !== version) return;
      status.textContent = `${manifest.id} - isolated read-only interface`;
    } catch (error) {
      if (!active || disposed || generation !== version) return;
      failed = true; status.textContent = error instanceof Error ? error.message : 'Plugin failed. Close and reopen its tab to retry.';
    } finally { running = false; if (active && !disposed && version !== generation) schedule(); }
  }
  function schedule() { clearTimeout(timer); if (active) timer = setTimeout(() => void render(), 100); }
  const unwatchFailure = window.specular.onPluginFailure(event => { if (event.id === manifest.id && active && !disposed) { generation++; failed = true; status.textContent = event.message; } });
  const unwatchState = window.specular.onCustomPluginState(event => {
    if (active && !disposed && request && event.id === manifest.id && event.viewId === viewId && event.requestId === request.requestId && manifest.customApi !== undefined) customState = event.state;
  });
  const unwatchNavigate = window.specular.onCustomPluginNavigate(event => {
    if (!active || disposed || !request || event.id !== manifest.id || event.viewId !== viewId || event.requestId !== request.requestId) return;
    if (!sourceEvidence(context, event.source, request, internalProject)) { status.textContent = 'The source changed. Choose updated evidence.'; return; }
    stop();
  });
  const appearanceChanged = () => { generation++; schedule(); };
  window.addEventListener('specular:appearance', appearanceChanged);
  const unsubscribe = context.onSnapshotChanged(() => { generation++; schedule(); });
  const feed = activityFeed(manifest, () => { generation++; schedule(); });
  function stop() { active = false; generation++; clearTimeout(timer); feed.stop(); request = undefined; void window.specular.stopPlugin(manifest.id).catch(() => {}); }
  return {
    activate(target?: { elementId?: string }) { targetId = target?.elementId; active = true; failed = false; generation++; feed.start(); schedule(); },
    deactivate: stop,
    reset: stop,
    dispose() { if (disposed) return; stop(); disposed = true; resize.disconnect(); window.removeEventListener('specular:appearance', appearanceChanged); window.removeEventListener('resize', layout); unsubscribe(); unwatchFailure(); unwatchNavigate(); unwatchState(); },
  };
}
function createPluginView(root: HTMLElement, context: ViewContext, manifest: PluginManifest, viewId: string, kind: ViewKind) {
  if (kind === 'custom') return createCustomPluginView(root, context, manifest, viewId);
  let active = false, disposed = false, running = false, generation = 0, failed = false;
  let projectId = crypto.randomUUID();
  let internalProject = context.getSnapshot().projectId;
  let graph: DependencyGraphView | undefined;
  let targetId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  root.classList.add('plugin-view');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const content = document.createElement('div'); content.className = 'plugin-view-content';
  root.append(status, content);
  function clear() { graph?.dispose(); graph = undefined; content.replaceChildren(); }
  function show(result: RenderResult, request: RenderRequest, originalProject: string) {
    clear();
    // Only a plugin that reads the project model waits for the ID index.
    const waiting = manifest.models.includes('project@1') && !request.models.project!.ready;
    const evidence = (sources: readonly SourceReference[] = []) => {
      const list = document.createElement('div'); list.className = 'plugin-evidence';
      for (const source of sources) {
        const sourceText = request.models.physical!.documents.find(d => d.file === source.file)!.text;
        const sourceLine = sourceText.slice(0, source.start).split('\n').length;
        const button = document.createElement('button'); button.className = 'quiet-button'; button.textContent = `Open ${source.file}:${sourceLine}`;
        button.onclick = () => {
          if (!active || disposed || !sourceEvidence(context, source, request, originalProject)) { status.textContent = 'The source changed. Choose updated evidence.'; return; }
        };
        list.append(button);
      }
      return list;
    };
    if (result.model.kind === 'list') {
      for (const item of result.model.items) {
        const row = document.createElement('article'); row.className = 'plugin-list-item';
        const title = document.createElement('strong'); title.textContent = item.title;
        const description = document.createElement('p'); description.textContent = item.description ?? '';
        row.append(title, description, evidence(item.sources)); content.append(row);
      }
      if (!result.model.items.length) content.textContent = !waiting ? 'No results for this snapshot.' : 'Waiting for the project index...';
    } else if (result.model.kind === 'timeline') {
      const timeline = document.createElement('div'); timeline.className = 'plugin-timeline';
      let day = '';
      for (const item of result.model.items) {
        if (item.date !== day) { day = item.date; const heading = document.createElement('h3'); heading.textContent = day; timeline.append(heading); }
        const event = document.createElement('article'); event.className = 'plugin-timeline-event';
        const text = document.createElement('p'); text.textContent = item.text;
        event.append(text);
        if (item.ids?.length) { const mentions = document.createElement('small'); mentions.textContent = `Mentioned IDs: ${item.ids.join(', ')}`; event.append(mentions); }
        event.append(evidence(item.sources)); timeline.append(event);
      }
      content.append(timeline);
      if (!result.model.items.length) content.textContent = !waiting ? 'No timeline events for this snapshot.' : 'Waiting for the project index...';
    } else {
      const model = result.model;
      const inspector = document.createElement('section'); inspector.className = 'plugin-inspector';
      function inspect(label: string, description: string, sources?: readonly SourceReference[]) {
        const heading = document.createElement('h3'); heading.textContent = label;
        const detail = document.createElement('p'); detail.textContent = description;
        inspector.replaceChildren(heading, detail, evidence(sources));
      }
      graph = new DependencyGraphView(id => { const n = model.nodes.find(n => n.id === id)!; inspect(n.label, n.description ?? '', n.sources); }, edge => {
        const e = model.edges.find(e => e.id === edge.key)!; inspect(e.label ?? `${e.from} -> ${e.to}`, '', e.sources);
      });
      content.append(graph.render(model.nodes.map(n => ({ id: n.id, kind: 'ID', definitions: [{ id: n.id, kind: 'definition' as const, label: n.label, file: n.sources?.[0]?.file ?? 'Plugin nodes', offset: 0, end: 0, line: 1, column: 1 }] })), model.edges.map(e => ({ key: e.id, from: e.from, to: e.to, evidence: [] })), '', ''), inspector);
    }
  }
  async function render() {
    if (!active || disposed || running || failed) return;
    const version = generation, snapshot = context.getSnapshot();
    if (!snapshot.projectId) { status.textContent = 'Open a project first.'; return; }
    if (snapshot.projectId !== internalProject) { internalProject = snapshot.projectId; projectId = crypto.randomUUID(); }
    running = true;
    const activity = await feed.model();
    if (!active || disposed || generation !== version) { running = false; if (active && !disposed) schedule(); return; }
    const request = requestFor(snapshot, projectId, viewId, targetId === undefined ? {} : { targetId }, activity);
    running = true; status.textContent = 'Updating plugin view...';
    try {
      const raw = await window.specular.renderPlugin(manifest.id, JSON.stringify(request));
      if (!active || disposed || generation !== version) return;
      const result = parseResult(JSON.stringify(raw), request, manifest);
      show(result, request, snapshot.projectId); status.textContent = `${manifest.id} - read-only`;
    } catch (error) {
      if (!active || disposed || generation !== version) return;
      failed = true; clear(); status.textContent = error instanceof Error ? error.message : 'Plugin failed. Close and reopen its tab to retry.';
    } finally { running = false; if (active && !disposed && version !== generation) schedule(); }
  }
  function schedule() { clearTimeout(timer); if (active) timer = setTimeout(() => void render(), 100); }
  const unwatch = window.specular.onPluginFailure(event => { if (event.id === manifest.id && active && !disposed) { generation++; failed = true; clear(); status.textContent = event.message; } });
  const unsubscribe = context.onSnapshotChanged(() => { generation++; clear(); schedule(); });
  const feed = activityFeed(manifest, () => { generation++; schedule(); });
  function stop() { active = false; generation++; clearTimeout(timer); feed.stop(); clear(); void window.specular.stopPlugin(manifest.id).catch(() => {}); }
  return {
    activate(target?: { elementId?: string }) { targetId = target?.elementId; active = true; failed = false; generation++; feed.start(); schedule(); },
    deactivate: stop,
    reset: stop,
    dispose() { if (disposed) return; stop(); disposed = true; unsubscribe(); unwatch(); },
  };
}
