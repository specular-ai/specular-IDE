import type { Occurrence, ProjectIndex } from '../shared/types';
import type { IdConfiguration } from '../core/id-configuration';

/** Internal view contracts. External plugins will use a separate versioned message API. */
export interface WorkspaceViewSnapshot {
  readonly projectId: string;
  readonly currentFile?: string;
  readonly revision: number;
  readonly ready: boolean;
  readonly notice: string;
  readonly documents: Readonly<Record<string, string>>;
  /** Scanned project structure for the physical model. */
  readonly folders: readonly string[];
  readonly files: readonly { readonly path: string; readonly markdown: boolean }[];
  /** Effective project configuration the index was built with (legacy defaults when none is saved). */
  readonly configuration: IdConfiguration;
  readonly index: Readonly<ProjectIndex>;
  readonly warnings: readonly string[];
}
export interface ViewTarget { elementId?: string }
export interface SourceEvidence { projectId: string; revision: number; source: Occurrence }
export interface ViewContext {
  getSnapshot(): WorkspaceViewSnapshot;
  onSnapshotChanged(listener: (snapshot: WorkspaceViewSnapshot) => void): () => void;
  openSource(evidence: SourceEvidence): Promise<void>;
  showOccurrences(elementId: string): void;
  openView(viewId: string, target?: ViewTarget): void;
}
export interface AbstractionView {
  activate(target?: ViewTarget): void;
  deactivate(): void;
  reset(): void;
  dispose(): void;
}
export interface AbstractionViewDefinition {
  id: string;
  title: string;
  group: string;
  containerId?: string;
  create(container: HTMLElement, context: ViewContext): AbstractionView;
}
export interface ViewGroup { id: string; title: string; containerId: string }
export class ViewRegistry {
  private groups = new Map<string, ViewGroup>();
  private views = new Map<string, AbstractionViewDefinition>();
  registerGroup(group: ViewGroup) {
    if (this.groups.has(group.id)) throw new Error(`Duplicate view group: ${group.id}`);
    this.groups.set(group.id, group);
  }
  register(view: AbstractionViewDefinition) {
    if (!this.groups.has(view.group)) throw new Error(`Unknown view group: ${view.group}`);
    if (this.views.has(view.id)) throw new Error(`Duplicate view: ${view.id}`);
    this.views.set(view.id, view);
  }
  definition(id: string) { const view = this.views.get(id); if (!view) throw new Error(`Unknown view: ${id}`); return view; }
  group(id: string) { const group = this.groups.get(id); if (!group) throw new Error(`Unknown view group: ${id}`); return group; }
  members(group: string) { return [...this.views.values()].filter(view => view.group === group); }
  unregisterGroup(id: string) {
    if (!this.groups.has(id)) return;
    for (const [viewId, view] of this.views) if (view.group === id) this.views.delete(viewId);
    this.groups.delete(id);
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
/** Immutable copies prevent a view from modifying the editor's live index or documents. */
export class ViewWorkspace {
  private snapshot: WorkspaceViewSnapshot;
  private listeners = new Set<(snapshot: WorkspaceViewSnapshot) => void>();
  constructor(snapshot: WorkspaceViewSnapshot, private source: (evidence: SourceEvidence) => Promise<void>,
    private occurrences: (id: string) => void, private report: (error: unknown) => void) {
    this.snapshot = freeze(structuredClone(snapshot));
  }
  getSnapshot() { return this.snapshot; }
  publish(snapshot: WorkspaceViewSnapshot) {
    this.snapshot = freeze(structuredClone(snapshot));
    for (const listener of [...this.listeners]) { try { listener(this.snapshot); } catch (error) { this.report(error); } }
  }
  scope(openView: ViewContext['openView']) {
    let live = true;
    const subscriptions = new Set<(snapshot: WorkspaceViewSnapshot) => void>();
    const context: ViewContext = {
      getSnapshot: () => this.snapshot,
      onSnapshotChanged: listener => {
        if (!live) return () => {};
        const scoped = (snapshot: WorkspaceViewSnapshot) => { if (live && subscriptions.has(scoped)) listener(snapshot); };
        subscriptions.add(scoped); this.listeners.add(scoped);
        return () => { subscriptions.delete(scoped); this.listeners.delete(scoped); };
      },
      openSource: async evidence => {
        if (!live || !this.snapshot.ready || evidence.projectId !== this.snapshot.projectId || evidence.revision !== this.snapshot.revision) {
          this.report(new Error('The index changed. Choose the updated result again.')); return;
        }
        try { await this.source(evidence); } catch (error) { this.report(error); }
      },
      showOccurrences: id => { if (live) this.occurrences(id); },
      openView: (id, target) => { if (live) openView(id, target); },
    };
    return { context, dispose: () => { live = false; for (const listener of subscriptions) this.listeners.delete(listener); subscriptions.clear(); } };
  }
}

export interface ViewSurface {
  container(viewId: string): HTMLElement;
  show(viewId?: string): void;
  dispose(): void;
}
export type SurfaceFactory = (group: ViewGroup, definitions: AbstractionViewDefinition[], open: (id: string) => void) => ViewSurface;
interface GroupInstance {
  group: ViewGroup;
  surface: ViewSurface;
  views: Map<string, { view: AbstractionView; revoke: () => void }>;
  selected: string;
  open: boolean;
}
/** Owns derived tabs independently of document buffers and concrete view implementations. */
export class AbstractionViewHost {
  private instances = new Map<string, GroupInstance>();
  private active?: string;
  constructor(private registry: ViewRegistry, private workspace: ViewWorkspace,
    private surface: SurfaceFactory, private changed: () => void, private beforeOpen: () => void = () => {}) {}
  get activeGroup() { return this.active; }
  get tabs() { return [...this.instances.values()].filter(item => item.open).map(item => item.group); }
  isOpen(group: string) { return this.instances.get(group)?.open ?? false; }
  openView(id: string, target?: ViewTarget) {
    const definition = this.registry.definition(id);
    this.beforeOpen();
    let instance = this.instances.get(definition.group);
    if (!instance) {
      const group = this.registry.group(definition.group), definitions = this.registry.members(group.id);
      const surface = this.surface(group, definitions, id => this.openView(id));
      instance = { group, surface, views: new Map(), selected: id, open: false };
      try {
        for (const entry of definitions) {
          const scope = this.workspace.scope((id, target) => this.openView(id, target));
          try { instance.views.set(entry.id, { view: entry.create(surface.container(entry.id), scope.context), revoke: scope.dispose }); }
          catch (error) { scope.dispose(); throw error; }
        }
      } catch (error) {
        for (const entry of instance.views.values()) { entry.revoke(); entry.view.dispose(); }
        surface.dispose(); throw error;
      }
      this.instances.set(group.id, instance);
    }
    if (this.active) {
      const previous = this.instances.get(this.active)!;
      if (previous !== instance || previous.selected !== id) previous.views.get(previous.selected)!.view.deactivate();
      previous.surface.show();
    }
    this.active = definition.group; instance.open = true; instance.selected = id;
    instance.surface.show(id); instance.views.get(id)!.view.activate(target); this.changed();
  }
  openGroup(group: string) {
    this.openView(this.instances.get(group)?.selected ?? this.registry.members(group)[0]?.id ?? '');
  }
  showDocument() {
    if (!this.active) return;
    const instance = this.instances.get(this.active)!;
    instance.views.get(instance.selected)!.view.deactivate(); instance.surface.show();
    this.active = undefined; this.changed();
  }
  close(group: string) {
    const instance = this.instances.get(group); if (!instance) return;
    if (this.active === group) this.showDocument();
    instance.open = false; this.changed();
  }
  remove(group: string) {
    const instance = this.instances.get(group); if (!instance) return;
    if (this.active === group) this.showDocument();
    for (const entry of instance.views.values()) { entry.revoke(); entry.view.dispose(); }
    instance.surface.dispose(); this.instances.delete(group); this.changed();
  }
  reset() {
    this.showDocument();
    for (const instance of this.instances.values()) {
      for (const entry of instance.views.values()) { entry.revoke(); entry.view.reset(); entry.view.dispose(); }
      instance.surface.dispose();
    }
    this.instances.clear(); this.changed();
  }
  dispose() { this.reset(); }
}
