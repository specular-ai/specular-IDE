import { FeatureConfigurationEditor } from './feature-configuration';
import { FolderGeneratorEditor } from './folder-generators';
import { generatedFolderHistory, validateFolderGenerators, type GeneratorTarget } from '../core/folder-generators';
import { idKey, idLabel } from '../core/id-identity';
import { DefinitionSitesEditor, categoryDefinitionSites, fileCoverage } from './definition-sites';
import { fileInScopes, validateIdScopes } from '../core/id-scopes';
import { IdDiscoveryEditor } from './id-discovery';
import { configurationEntry, rememberConfigurationEntries } from './configuration-entry';
import { StatusEditor, statusBadge, statusEvidence } from './statuses';
import { statusSiteGroups } from './status-sites';
import { ModuleConfigurationEditor } from './module-configuration';
import { DateRulesEditor } from './date-rules';
import { categoryAccent, validCategoryColor } from '../shared/category-colors';
import { styleCategoryCard } from './category-colors';
import { DEFAULT_LIST_ITEM, LEGACY_ID_CONFIGURATION, validateIdConfiguration, ruleRegex, type IdCategory, type IdRule, type IdConfiguration, type IdConfigurationState } from '../core/id-configuration';
import { DEFAULT_STATUS_SITES } from '../core/status-sites';
import { IndexWorker, type IndexResponse } from '../core/index-worker';
import type { Finding, Occurrence, ProjectIndex, SourceLocation } from '../shared/types';

export interface ConfigurationContext {
  projectId: string; root: string; documents: Record<string, string>; documentVersions: Record<string, string>;
  state: IdConfigurationState; warnings: string[]; busy: boolean;
  baseline?: ProjectIndex; baselineNotice?: string;
}
interface ConfigurationHost {
  setupAgent(onClose: () => void): void;
  agentPath(kind: 'codex' | 'claude'): string;
  context(): ConfigurationContext | undefined;
  refresh(): Promise<void>;
  save(root: string, configuration: IdConfiguration, diskVersion: string, documentVersions: Record<string, string>): Promise<{ ok: boolean; message?: string }>;
  source(location: SourceLocation, text: string, valid: () => boolean): Promise<void>;
  notify(message: string): void;
}
interface Preview { context: ConfigurationContext; configuration: IdConfiguration; index: ProjectIndex; baseline?: ProjectIndex; baselineError?: string }
export function sameDocuments(a: Record<string, string>, b: Record<string, string>) {
  return Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([file, text]) => b[file] === text);
}
const copy = <T>(value: T): T => structuredClone(value);
const CONFIGURATION_TABS = [
  ['discovery', 'Discover IDs'], ['categories', 'Categories'],
  ['definition-sites', 'Definition and status sites'], ['modules', 'Application modules'], ['features', 'Application features'], ['statuses', 'Authored statuses'], ['dates', 'Dates'],
] as const;
type ConfigurationTab = typeof CONFIGURATION_TABS[number][0];

export class ProjectConfigurationDialog {
  private dialog = document.createElement('dialog');
  private loaded?: ConfigurationContext;
  private draft: IdConfiguration = copy(LEGACY_ID_CONFIGURATION);
  private scanStatuses = false;
  private queuedPreview?: { scan: boolean; target?: GeneratorTarget; updateFolders?: boolean };
  private folderReview?: ConfigurationContext;
  private folderStages = new Map<GeneratorTarget, { documents: Record<string, string>; settings: string }>();
  private folderEditors = {
    features: new FolderGeneratorEditor('features', () => this.draft, () => this.changed(), () => this.runPreview(false, 'features'), () => this.runPreview(false, 'features', true)),
    modules: new FolderGeneratorEditor('modules', () => this.draft, () => this.changed(), () => this.runPreview(false, 'modules'), () => this.runPreview(false, 'modules', true)),
  };
  private discovery = new IdDiscoveryEditor({
    setupAgent: () => {
      this.suspended = true; this.dialog.close();
      this.host.setupAgent(() => { if (this.suspended && this.loaded?.projectId === this.host.context()?.projectId) this.show(); });
    },
    agentPath: kind => this.host.agentPath(kind),
    context: () => this.current(), draft: () => this.draft,
    reviewChanged: () => this.changed(),
    stage: draft => { this.draft = draft; this.renderFields(); this.changed(); },
    source: (location, text, valid) => { this.suspended = true; this.dialog.close(); void this.host.source(location, text, valid).catch(error => { this.show(); this.error(String(error)); }); },
  });
  private definitionSitesEditor = new DefinitionSitesEditor(() => this.draft, () => this.changed());
  private statusEditor = new StatusEditor(() => this.draft, () => this.changed(), () => { this.runPreview(true); });
  private featureEditor = new FeatureConfigurationEditor(() => this.draft, () => this.changed());
  private moduleEditor = new ModuleConfigurationEditor(() => this.draft, () => this.changed());
  private dateEditor = new DateRulesEditor(() => this.draft, () => this.changed(), () => this.projectFolders(), location => this.openPreviewSource(location));
  private preview?: Preview;
  private queuedApply?: Preview;
  private pending?: { revision: number; context: ConfigurationContext; configuration: IdConfiguration; removeCategoryKeys?: string[]; generatorTarget?: GeneratorTarget; updateFolders?: boolean };
  private serial = 0;
  private saving = false;
  private simpleFormats = new WeakMap<IdRule, { prefix: string; separator?: IdRule['separator'] }>();
  private advancedPatterns = new WeakMap<IdRule, string>();
  private advancedTemplates = new WeakMap<IdRule, string>();
  private listFormats = new WeakMap<IdRule, NonNullable<IdRule['list']>>();
  private categorySections = new WeakMap<IdCategory, Record<string, boolean>>();
  private sectionModels = new WeakMap<HTMLDetailsElement, IdCategory>();
  private suspended = false;
  private page = 0;
  private worker = new IndexWorker(() => new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' }), result => this.receive(result));
  constructor(private host: ConfigurationHost) {
    this.dialog.id = 'project-configuration-dialog'; this.dialog.setAttribute('aria-labelledby', 'project-configuration-title');
    this.dialog.innerHTML = `
      <header><h2 id="project-configuration-title">Project configuration</h2><p id="config-project"></p></header>
      <div class="config-tabs" role="tablist" aria-label="Project configuration">
        ${CONFIGURATION_TABS.map(([id, label]) => `<button type="button" id="config-tab-${id}" role="tab" aria-controls="config-panel-${id}" aria-selected="false" tabindex="-1">${label}</button>`).join('')}
      </div>
      <div class="config-body">
      <p class="config-intro">Define named categories and the ID formats that belong to them. Changes stay in this draft until you preview and apply them.</p>
      <p id="config-warning" class="config-warning" hidden></p>
      <fieldset id="config-fields"><div id="config-panel-discovery"></div>
        <section id="config-panel-categories"><div class="config-section-heading config-category-heading"><h3>Categories</h3><div class="config-category-actions"><button type="button" id="config-add-category" class="quiet-button">Add category</button><button type="button" id="config-delete-categories" class="quiet-button">Delete all categories</button></div></div>
          <p id="config-categories-empty" class="config-hint" hidden>No categories defined. Add a category to configure ID recognition.</p>
          <div id="config-categories" class="config-list"></div></section>
      <div id="config-panel-definition-sites"></div><div id="config-panel-modules"></div><div id="config-panel-features"></div><div id="config-panel-statuses"></div><div id="config-panel-dates"></div></fieldset>
      <section class="config-preview" aria-labelledby="config-preview-title"><div class="config-section-heading"><h3 id="config-preview-title">Recognition preview</h3></div>
        <p id="config-status" role="status" aria-live="polite">Preview the draft to see its effect on project Markdown.</p>
        <p id="config-error" class="coral" role="alert" hidden></p>
        <p id="config-summary"></p><p id="config-module-summary"></p><p id="config-changes"></p>
        <div id="config-result-controls" hidden><label>Show <select id="config-filter"><option value="all">All matches</option><option value="definitions">Definitions</option><option value="references">References</option><option value="issues">ID issues</option><option value="removed">Removed IDs</option><option value="transitions">Definition/reference changes</option><option value="statuses">Status assignments</option></select></label><span id="config-result-count"></span><button type="button" id="config-previous" class="quiet-button">Previous</button><button type="button" id="config-next" class="quiet-button">Next</button></div>
        <div id="config-results" class="config-results"></div>
      </section>
      </div>
      <footer class="dialog-actions"><button type="button" id="config-reset" class="quiet-button">Reset draft to legacy defaults</button><button type="button" id="config-reload" class="quiet-button">Reload configuration (discard draft)</button><span class="config-spacer"></span><button type="button" id="config-cancel" class="button secondary">Cancel</button><button type="button" id="config-preview" class="button secondary">Preview matches</button><button type="button" id="config-apply" class="button primary" disabled>Apply</button></footer>`;
    document.body.append(this.dialog); this.el('#config-panel-features').append(this.featureEditor.root); this.el('#config-panel-discovery').append(this.discovery.root); this.el('#config-panel-definition-sites').append(this.definitionSitesEditor.root); this.el('#config-panel-modules').append(this.moduleEditor.root); this.el('#config-panel-statuses').append(this.statusEditor.root); this.el('#config-panel-dates').append(this.dateEditor.root);
    for (const target of ['features', 'modules'] as const) this.el(`#config-panel-${target}`).append(this.folderEditors[target].root);
    for (const [index, [id]] of CONFIGURATION_TABS.entries()) {
      const tab = this.el<HTMLButtonElement>(`#config-tab-${id}`), panel = this.el(`#config-panel-${id}`);
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.tabIndex = 0;
      tab.onclick = () => this.selectTab(id);
      tab.onkeydown = event => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? CONFIGURATION_TABS.length - 1
          : event.key === 'ArrowRight' ? (index + 1) % CONFIGURATION_TABS.length
          : event.key === 'ArrowLeft' ? (index + CONFIGURATION_TABS.length - 1) % CONFIGURATION_TABS.length : undefined;
        if (next === undefined) return;
        event.preventDefault(); this.selectTab(CONFIGURATION_TABS[next][0], true);
      };
    }
    this.selectTab('discovery');
    this.el<HTMLButtonElement>('#config-add-category').onclick = () => {
      const key = this.unique('category', this.draft.categories.map(item => item.key));
      const category = { key, name: '' }; this.draft.categories.push(category); this.renderFields(); this.changed();
      this.dialog.querySelector<HTMLInputElement>('#config-categories > .config-entry:last-child > .config-category input[aria-label="Name"]')?.focus();
    };
    this.el<HTMLButtonElement>('#config-delete-categories').onclick = () => {
      this.removeCategories(new Set(this.draft.categories.map(category => category.key)));
    };
    this.el<HTMLButtonElement>('#config-preview').onclick = () => this.runPreview();
    this.el<HTMLButtonElement>('#config-apply').onclick = () => { void this.apply(); };
    this.el<HTMLButtonElement>('#config-cancel').onclick = () => this.cancel();
    this.el<HTMLButtonElement>('#config-reset').onclick = () => { this.draft = copy(LEGACY_ID_CONFIGURATION); this.folderStages.clear(); for (const editor of Object.values(this.folderEditors)) editor.reset(); this.renderFields(); this.changed(); };
    this.el<HTMLButtonElement>('#config-reload').onclick = () => { void this.reload(); };
    this.el<HTMLSelectElement>('#config-filter').onchange = () => { this.page = 0; this.renderResults(); };
    this.el<HTMLButtonElement>('#config-previous').onclick = () => { this.page--; this.renderResults(); };
    this.el<HTMLButtonElement>('#config-next').onclick = () => { this.page++; this.renderResults(); };
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.cancel(); });
    this.dialog.addEventListener('close', () => { this.queuedApply = undefined; if (!this.suspended) { this.loaded = undefined; this.preview = undefined; this.pending = undefined; this.worker.dispose(); this.discovery.dispose(); } });
    window.addEventListener('beforeunload', () => { this.worker.dispose(); this.discovery.dispose(); });
  }
  private el<T extends HTMLElement = HTMLElement>(selector: string) { return this.dialog.querySelector<T>(selector)!; }
  private selectTab(selected: ConfigurationTab, focus = false) {
    this.el('.config-intro').hidden = selected === 'discovery';
    const subject = selected === 'features' ? 'application features' : selected === 'modules' ? 'application modules' : 'categories';
    this.el('.config-intro').textContent = selected === 'dates' ? 'Define where dates are written in Markdown and what they mean. Changes stay in this draft until you preview and apply them.'
      : `Define named ${subject} and the ID formats that belong to them. Changes stay in this draft until you preview and apply them.`;
    for (const [id] of CONFIGURATION_TABS) {
      const active = id === selected, tab = this.el<HTMLButtonElement>(`#config-tab-${id}`);
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      this.el(`#config-panel-${id}`).hidden = !active;
      if (active && focus) tab.focus();
    }
    this.el('.config-body').scrollTop = 0;
  }
  /** Folders of the current project's Markdown, offered when adding a date exclusion. */
  private projectFolders() {
    const folders = new Set<string>();
    for (const file of Object.keys(this.current()?.documents ?? {})) { const parts = file.split('/'); for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/')); }
    return [...folders].sort((a, b) => a.localeCompare(b));
  }
  /** Opens a previewed date's source while the preview still matches the project. */
  private openPreviewSource(location: SourceLocation) {
    const preview = this.preview;
    if (!preview || !this.fresh(preview)) { this.update(); return; }
    const valid = () => this.host.context()?.projectId === preview.context.projectId && sameDocuments(this.host.context()!.documents, preview.context.documents);
    this.suspended = true; this.dialog.close();
    void this.host.source(location, preview.context.documents[location.file], valid).catch(error => { this.show(); this.error(String(error)); });
  }
  private unique(prefix: string, used: string[]) { let n = 1; while (used.includes(prefix + n)) n++; return prefix + n; }
  private error(message = '') { const node = this.el('#config-error'); node.textContent = message; node.hidden = !message; }
  private status(message: string) { this.el('#config-status').textContent = message; }
  private current() { const context = this.host.context(); return context?.projectId === this.loaded?.projectId ? context : undefined; }
  private conflict() { return this.current()?.state.diskVersion !== this.loaded?.state.diskVersion; }
  private staleFolderStage() {
    const context = this.current();
    return [...this.folderStages].find(([target, stage]) => !context || !sameDocuments(context.documents, stage.documents) || JSON.stringify(this.folderEditors[target].settings()) !== stage.settings)?.[0];
  }
  private fresh(preview = this.preview) { const context = this.current(); return !!preview && !!context && !this.conflict() && sameDocuments(context.documents, preview.context.documents); }
  private controls() {
    this.el<HTMLFieldSetElement>('#config-fields').disabled = this.saving || !!this.pending?.removeCategoryKeys;
    this.el<HTMLButtonElement>('#config-apply').disabled = this.saving || !this.fresh() || !!this.staleFolderStage() || !!this.pending || !!this.queuedApply;
    this.el<HTMLButtonElement>('#config-preview').disabled = this.saving || !this.current() || this.conflict() || !!this.pending?.removeCategoryKeys;
    for (const editor of Object.values(this.folderEditors)) editor.root.querySelectorAll<HTMLButtonElement>('.folder-generator-preview, .folder-generator-update').forEach(button => {
      button.disabled = this.saving || !this.current() || this.conflict() || (!editor.settings().length && !this.draft.generatedFolders?.some(mapping => mapping.target === editor.target) && !this.folderStages.has(editor.target));
    });
    for (const id of ['cancel', 'reset', 'reload']) this.el<HTMLButtonElement>('#config-' + id).disabled = this.saving;
    this.el<HTMLButtonElement>('#config-add-category').disabled = this.draft.categories.length >= 64;
    this.el<HTMLButtonElement>('#config-delete-categories').disabled = !this.draft.categories.length;
    this.dialog.querySelectorAll<HTMLButtonElement>('.config-add-rule').forEach(button => { button.disabled = this.draft.rules.length >= 64; });
  }
  hasDraft() { return !!this.loaded && (this.dialog.open || this.suspended); }
  show() {
    const context = this.host.context(); if (!context || context.busy) return;
    if (!this.suspended || this.loaded?.projectId !== context.projectId) this.initialize(context);
    this.suspended = false; this.selectTab('discovery'); this.dialog.showModal(); this.selectTab('discovery', true); this.update();
  }
  private initialize(context: ConfigurationContext) {
    this.folderStages.clear();
    for (const editor of Object.values(this.folderEditors)) editor.reset();
    this.queuedPreview = undefined; this.statusEditor.reset(); this.loaded = copy(context); this.draft = copy(context.state.configuration); this.pending = undefined; this.preview = undefined; this.worker.dispose();
    this.discovery.reset(); this.el('#config-project').textContent = context.root;
    this.renderFields(); this.changed();
  }
  private cancel() { if (this.saving) return; this.queuedApply = undefined; this.queuedPreview = undefined; this.suspended = false; this.dialog.close(); }
  update() {
    if (!this.loaded) return;
    const context = this.current();
    if (!context) { this.suspended = false; this.dialog.close(); this.loaded = undefined; this.worker.dispose(); this.discovery.dispose(); return; }
    const warning = this.el('#config-warning'); warning.textContent = context.warnings.join('\n'); warning.hidden = !context.warnings.length;
    if (this.conflict() && !this.saving) {
      this.pending = undefined; this.preview = undefined; this.worker.cancel(); this.clearResults();
      this.error('Project configuration changed on disk. Your draft is preserved. Reload configuration to review the new file before applying.');
    } else if (!this.saving && ((this.preview && !this.fresh()) || (this.folderReview && !sameDocuments(context.documents, this.folderReview.documents)) || (this.pending && !sameDocuments(context.documents, this.pending.context.documents)))) {
      this.pending = undefined; this.preview = undefined; this.worker.cancel(); this.clearResults();
      this.status('Markdown changed. Preview again before applying. Your draft is preserved.');
    }
    if (this.queuedApply && (!this.fresh(this.queuedApply) || this.preview !== this.queuedApply)) this.queuedApply = undefined;
    this.discovery.update(); this.controls();
    if (this.queuedPreview !== undefined && !context.busy && !this.saving && !this.conflict()) {
      const queued = this.queuedPreview; this.queuedPreview = undefined; this.runPreview(queued.scan, queued.target, queued.updateFolders);
    }
    if (this.queuedApply && !context.busy && !this.saving) { this.queuedApply = undefined; void this.apply(); }
  }
  private field(labelText: string, value: string, change: (value: string) => void, options?: [string, string][], maxLength = 128) {
    const label = document.createElement('label'); label.append(labelText);
    const input = options ? document.createElement('select') : document.createElement('input');
    if (input instanceof HTMLInputElement) { input.type = 'text'; input.maxLength = maxLength; input.spellcheck = false; }
    else for (const [value, text] of options!) input.add(new Option(text, value));
    input.value = value; input.setAttribute('aria-label', labelText);
    input.addEventListener(options ? 'change' : 'input', () => { change(input.value); this.changed(); });
    label.append(input); return label;
  }
  private remove(label: string, action: () => void, text = 'Remove') {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = text; button.setAttribute('aria-label', label);
    button.onclick = action; return button;
  }
  private removeCategories(keys: ReadonlySet<string>) {
    const context = this.current(); if (!context || this.saving || this.conflict()) return;
    this.queuedPreview = undefined; this.changed();
    if (!this.draft.moduleOverrides?.length && !this.draft.featureOverrides?.length) { this.finishCategoryRemoval(keys, []); return; }
    const revision = ++this.serial, removeCategoryKeys = [...keys];
    this.pending = { revision, context: copy(context), configuration: copy(this.draft), removeCategoryKeys };
    this.status('Checking exact-ID overrides before removing categories…');
    this.worker.run({ revision, documents: {}, configuration: this.pending.configuration, removeCategoryKeys });
    this.controls();
  }
  private finishCategoryRemoval(keys: ReadonlySet<string>, overrideIds: string[]) {
    if (this.draft.featureOverrides) this.draft.featureOverrides = this.draft.featureOverrides.filter(override => !overrideIds.includes(idKey(override)));
    this.draft.categories = this.draft.categories.filter(category => !keys.has(category.key));
    this.draft.rules = this.draft.rules.filter(rule => !keys.has(rule.category));
    if (this.draft.moduleOverrides) {
      const removed = new Set(overrideIds);
      this.draft.moduleOverrides = this.draft.moduleOverrides.filter(override => !removed.has(idKey(override)));
    }
    this.renderFields(); this.changed();
  }
  private categorySection(category: IdCategory, name: string, title: string) {
    const section = document.createElement('details'); section.className = `config-category-${name} config-category-section`; section.dataset.section = name;
    this.sectionModels.set(section, category);
    section.open = this.categorySections.get(category)?.[name] ?? false;
    const summary = document.createElement('summary');
    const label = document.createElement('span'); label.textContent = title; summary.append(label); section.append(summary);
    return section;
  }
  private categoryScopes(category: IdCategory) {
    const section = this.categorySection(category, 'scopes', 'Scope patterns');
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = 'Use a pattern such as specs/* when this category restarts its IDs in each specification folder: each immediate child and its descendants share a scope. A pattern ending in a Markdown file, such as plans/*.md, gives each file its own scope, and a {name} capture, such as openspec/specs/{capability}/spec.md, joins files that capture the same name. When several patterns match, the most specific wins. IDs outside matching folders remain project-wide.';
    const list = document.createElement('div'); list.className = 'config-scope-list';
    const add = document.createElement('button'); add.type = 'button'; add.className = 'quiet-button config-add-scope'; add.textContent = 'Add scope pattern';
    const render = () => {
      list.replaceChildren(...(category.idScopes ?? []).map((rule, i) => {
        const row = document.createElement('div'); row.className = 'config-scope';
        const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = rule.enabled !== false;
        enabled.setAttribute('aria-label', 'Enable folder scope ' + (i + 1));
        enabled.onchange = () => { rule.enabled = enabled.checked; this.changed(); };
        const toggle = document.createElement('label'); toggle.className = 'config-checkbox'; toggle.append(enabled, 'Enabled');
        row.append(this.field('Scope pattern', rule.pattern, value => { rule.pattern = value; }, undefined, 4098), toggle,
          this.remove('Remove folder scope ' + (i + 1), () => { category.idScopes!.splice(i, 1); render(); this.changed(); }, 'Remove scope pattern'));
        return row;
      }));
      add.disabled = (category.idScopes?.length ?? 0) >= 64;
    };
    add.onclick = event => { event.preventDefault(); event.stopPropagation(); section.open = true; (category.idScopes ??= []).push({ pattern: 'specs/*' }); render(); this.changed(); list.querySelector<HTMLInputElement>('.config-scope:last-child input')?.focus(); };
    section.querySelector('summary')!.append(add);
    // Increment 90: the category's rules run only in files its enabled scope patterns match.
    const only = document.createElement('input'); only.type = 'checkbox'; only.checked = !!category.onlyInScopes;
    only.onchange = () => { if (only.checked) category.onlyInScopes = true; else delete category.onlyInScopes; count(); this.changed(); };
    const onlyLabel = document.createElement('label'); onlyLabel.className = 'config-checkbox config-only-in-scopes'; onlyLabel.append(only, 'Recognize only inside these scopes');
    const coverage = document.createElement('p'); coverage.className = 'config-hint config-scope-coverage';
    const count = () => { coverage.textContent = category.onlyInScopes ? fileCoverage(Object.keys(this.current()?.documents ?? {}), file => fileInScopes(file, validateIdScopes(category.idScopes ?? []))) : 'Rules match in every file; files outside the patterns are project-wide.'; };
    section.addEventListener('input', count); section.addEventListener('change', count);
    render(); count(); section.append(hint, list, onlyLabel, coverage); return section;
  }
  private renderFields() {
    this.dialog.querySelectorAll<HTMLDetailsElement>('.config-category-section').forEach(section => {
      const category = this.sectionModels.get(section);
      if (category) this.categorySections.set(category, { ...this.categorySections.get(category), [section.dataset.section!]: section.open });
    });
    rememberConfigurationEntries(this.el('#config-categories'));
    this.definitionSitesEditor.render(); this.moduleEditor.render(); this.featureEditor.render(); this.statusEditor.render(); this.dateEditor.render();
    for (const editor of Object.values(this.folderEditors)) editor.render();
    this.el('#config-categories-empty').hidden = !!this.draft.categories.length;
    this.el('#config-categories').replaceChildren(...this.draft.categories.map((category, i) => {
      const row = document.createElement('div'); row.className = 'config-category'; row.dataset.categoryIndex = String(i);
      row.append(this.field('Name', category.name, value => { category.name = value; }),
        this.field('Role (optional)', category.role ?? '', value => { if (value) category.role = value as typeof category.role; else delete category.role; }, [['', 'Custom / no role'], ['requirement', 'Requirement'], ['design', 'Design'], ['task', 'Task']]),
        // Increment 85a: nested elements and elements derived from file paths.
        this.field('Parent category (optional)', category.parent ?? '', value => { if (value) category.parent = value; else delete category.parent; },
          [['', 'None'], ...this.draft.categories.filter(other => other.key !== category.key).map((other, n) => [other.key, other.name || `Category ${n + 1}`] as [string, string])]),
        this.field('Derive elements from files (optional)', category.derive?.pattern ?? '', value => { if (value.trim()) category.derive = { pattern: value.trim() }; else delete category.derive; }, undefined, 4096),
        this.changeControls(category),
        this.remove(`Remove category ${i + 1}`, () => this.removeCategories(new Set([category.key])), 'Remove category'), this.categoryRules(category, i), this.categoryScopes(category), categoryDefinitionSites(category, () => this.draft, () => this.changed(), () => Object.keys(this.current()?.documents ?? {})), this.categoryStatusSites(category), this.colorControls(category));
      return configurationEntry(category, row, () => `${i + 1}. ${category.name || 'New category'}`, !category.name);
    }));
  }
  /** Increment 85b: OpenSpec change records, backticked name references, and change elements. */
  private changeControls(category: IdCategory) {
    const section = document.createElement('details'); section.className = 'config-category-changes';
    const summary = document.createElement('summary'); summary.textContent = 'Changes and name references';
    const toggle = (text: string, checked: boolean, change: (checked: boolean) => void) => {
      const label = document.createElement('label'); label.className = 'config-checkbox';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
      input.onchange = () => { change(input.checked); this.changed(); }; label.append(input, text); return label;
    };
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = 'Change records: keyword headings under ADDED, MODIFIED, REMOVED, or RENAMED sections record the change instead of defining an element; ADDED elements of an active change are proposed until the specifications define them. Name references: backticked text equal to an element name refers to it. Changes: elements derived from change folders are Active, or Archived inside the archive folder, and their proposals declare capabilities of the chosen category.';
    const archive = this.field('Archive folder name', category.changes?.archive ?? 'archive', value => {
      if (!category.changes) return;
      if (value.trim() && value.trim() !== 'archive') category.changes.archive = value.trim(); else delete category.changes.archive;
    });
    const capabilities = this.field('Capability category of declarations', category.changes?.capabilities ?? '', value => {
      if (!category.changes) return;
      if (value) category.changes.capabilities = value; else delete category.changes.capabilities;
    }, [['', 'None'], ...this.draft.categories.filter(other => other.key !== category.key).map((other, n) => [other.key, other.name || `Category ${n + 1}`] as [string, string])]);
    const changeOptions = document.createElement('div'); changeOptions.className = 'config-category-change-options'; changeOptions.hidden = !category.changes; changeOptions.append(archive, capabilities);
    section.append(summary, hint,
      toggle('Record change deltas', !!category.deltas, checked => { if (checked) category.deltas = true; else delete category.deltas; }),
      toggle('Link backticked names', !!category.nameReferences, checked => { if (checked) category.nameReferences = true; else delete category.nameReferences; }),
      toggle('Derived elements are changes', !!category.changes, checked => { if (checked) category.changes ??= {}; else delete category.changes; changeOptions.hidden = !checked; }),
      changeOptions);
    section.open = !!(category.deltas || category.nameReferences || category.changes);
    return section;
  }
  private categoryRules(category: IdCategory, categoryIndex: number) {
    const section = this.categorySection(category, 'rules', 'ID recognition rules');
    const add = document.createElement('button'); add.type = 'button'; add.className = 'quiet-button config-add-rule'; add.textContent = 'Add rule';
    add.onclick = event => {
      event.preventDefault(); event.stopPropagation(); section.open = true;
      const rule: IdRule = { key: this.unique('rule', this.draft.rules.map(item => item.key)), category: category.key, prefix: '' };
      this.draft.rules.push(rule); this.renderFields(); this.changed();
      this.dialog.querySelector<HTMLInputElement>(`[data-rule-index="${this.draft.rules.indexOf(rule)}"] input`)?.focus();
    };
    section.querySelector('summary')!.append(add);
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = 'These rules recognize IDs for this category. Use a prefix such as REF or an advanced regex without slash delimiters, or a labelled list for numbers cited after a label. Rule numbers match the shared preview diagnostics.';
    const list = document.createElement('div'); list.className = 'config-category-rule-list';
    this.draft.rules.forEach((rule, i) => { if (rule.category === category.key) list.append(this.ruleEntry(rule, i, categoryIndex)); });
    const empty = document.createElement('p'); empty.className = 'config-hint config-category-rules-empty'; empty.textContent = 'No ID recognition rules in this category. Add a rule to recognize its IDs.'; empty.hidden = !!list.childElementCount;
    section.append(hint, empty, list); return section;
  }
  private ruleEntry(rule: IdRule, i: number, categoryIndex: number) {
    const format = rule.list ? 'list' : rule.prefix !== undefined ? 'prefix' : 'pattern';
    const row = document.createElement('div'); row.className = format === 'prefix' ? 'config-rule config-rule-prefix' : format === 'list' ? 'config-rule config-rule-list' : 'config-rule'; row.dataset.ruleIndex = String(i);
    row.append(this.field('Format', format, value => {
        // Keep each format's last values so switching back restores them.
        if (rule.list) this.listFormats.set(rule, rule.list);
        else if (rule.prefix !== undefined) this.simpleFormats.set(rule, { prefix: rule.prefix || 'ID', ...(rule.separator === undefined ? {} : { separator: rule.separator }) });
        else { this.advancedPatterns.set(rule, rule.pattern ?? ''); if (rule.id !== undefined) this.advancedTemplates.set(rule, rule.id); }
        const previous = { prefix: rule.prefix || 'ID', separator: rule.separator };
        delete rule.prefix; delete rule.separator; delete rule.pattern; delete rule.id; delete rule.list;
        if (value === 'pattern') {
          rule.pattern = this.advancedPatterns.get(rule) ?? ruleRegex(this.simpleFormats.get(rule) ? { ...rule, ...this.simpleFormats.get(rule)! } : { ...rule, ...previous }).source;
          if (this.advancedTemplates.has(rule)) rule.id = this.advancedTemplates.get(rule);
        } else if (value === 'list') {
          const name = this.draft.categories.find(category => category.key === rule.category)?.name || 'ID';
          rule.list = this.listFormats.get(rule) ?? { label: '', item: DEFAULT_LIST_ITEM, id: `${name} {number}` };
        } else {
          const simple = this.simpleFormats.get(rule) ?? { prefix: 'ID' };
          rule.prefix = simple.prefix;
          if (simple.separator !== undefined) rule.separator = simple.separator;
        }
        this.renderFields();
        this.dialog.querySelector<HTMLSelectElement>(`[data-rule-index="${i}"] select[aria-label="Format"]`)?.focus();
      }, [['prefix', 'Prefix + digits'], ['pattern', 'Advanced regex'], ['list', 'Labelled list']]));
    if (rule.list) {
      // Increment 82: numbers after a label, such as `Requirements: 1.1, 2.3`, become references to the templated ID.
      const list = rule.list;
      row.append(this.field('List label', list.label, value => { list.label = value; }, undefined, 512),
        this.field('ID template', list.id, value => { list.id = value; }, undefined, 128));
      const advanced = document.createElement('details'); advanced.className = 'config-rule-list-advanced';
      const summary = document.createElement('summary'); summary.textContent = 'Advanced';
      const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'quiet-button'; restore.textContent = 'Restore default item pattern';
      const item = this.field('Item pattern', list.item, value => { list.item = value; }, undefined, 512);
      restore.onclick = () => { list.item = DEFAULT_LIST_ITEM; item.querySelector('input')!.value = DEFAULT_LIST_ITEM; this.changed(); };
      const hint = document.createElement('p'); hint.className = 'config-hint';
      hint.textContent = 'Each listed item after the label refers to an ID built from the template: {number} is the item\'s number capture, so 1.1 refers to Requirement 1. Lists only add references; definitions still come from the category\'s other rules.';
      advanced.append(summary, item, restore); row.append(hint, advanced);
    } else row.append(this.field(rule.prefix !== undefined ? 'Prefix' : 'Regex pattern', rule.prefix ?? rule.pattern ?? '', value => { if (rule.prefix !== undefined) { rule.prefix = value; this.advancedPatterns.delete(rule); } else rule.pattern = value; }, undefined, rule.prefix !== undefined ? 64 : 512));
    if (rule.pattern !== undefined) {
      // Increment 89: an alias such as US1 refers to the templated ID, such as User Story 1, defined by another rule.
      row.append(this.field('ID template (optional)', rule.id ?? '', value => { if (value) rule.id = value; else delete rule.id; this.advancedTemplates.delete(rule); }, undefined, 128));
      const hint = document.createElement('p'); hint.className = 'config-hint';
      hint.textContent = 'Leave empty when the match is the ID. With a template such as User Story {n}, each match refers to the ID built from the pattern\'s named captures, so (?<n>\\d+) in US1 refers to User Story 1. {n:int} drops leading zeros; {n:03} pads to 3 digits. Templated matches only add references; definitions come from the category\'s other rules.';
      row.append(hint);
    }
    if (rule.prefix !== undefined) row.append(this.field('Separator', rule.separator ?? '-', value => { rule.separator = value as IdRule['separator']; this.advancedPatterns.delete(rule); }, [['-', 'Hyphen (-)'], ['_', 'Underscore (_)'], ['', 'None']]));
    const label = document.createElement('label'); label.className = 'config-checkbox'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !!rule.ignoreCase;
    checkbox.onchange = () => { rule.ignoreCase = checkbox.checked; this.changed(); }; label.append(checkbox, 'Ignore case');
    row.append(label, this.remove(`Remove rule ${i + 1}`, () => {
      this.draft.rules.splice(i, 1); this.renderFields(); this.changed();
      this.dialog.querySelector<HTMLButtonElement>(`[data-category-index="${categoryIndex}"] .config-add-rule`)?.focus();
    }, 'Remove rule'));
    const title = () => `${i + 1}. ${rule.list ? (rule.list.label ? `List after ${rule.list.label} → ${rule.list.id}` : 'New labelled list') : rule.prefix ? rule.prefix + (rule.separator ?? '-') + 'digits' : rule.pattern ? rule.pattern + (rule.id ? ` → ${rule.id}` : '') : 'New rule'}`;
    return configurationEntry(rule, row, title, !rule.prefix && !rule.pattern && !rule.list?.label);
  }
  private categoryStatusSites(category: IdCategory) {
    const section = document.createElement('details'); section.className = 'config-category-status-sites';
    const summary = document.createElement('summary'); summary.textContent = 'Authored-status extraction';
    const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'Inherit the project status sites or replace the complete paragraphs, tables, and headings block for this category.';
    const label = document.createElement('label'); label.textContent = 'Category status sites';
    const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Category status sites');
    mode.add(new Option('Inherit project settings', 'inherit')); mode.add(new Option('Override for this category', 'override'));
    mode.value = category.statusSites ? 'override' : 'inherit'; label.append(mode);
    const settings = category.statusSites ?? structuredClone(this.draft.statusSites ?? DEFAULT_STATUS_SITES);
    const controls = document.createElement('div'); controls.className = 'config-category-status-site-controls'; controls.hidden = !category.statusSites;
    const renderControls = () => controls.replaceChildren(...statusSiteGroups(settings, () => { category.statusSites = structuredClone(settings); this.changed(); }));
    renderControls();
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'quiet-button'; reset.textContent = 'Restore inheritance';
    reset.onclick = () => { delete category.statusSites; mode.value = 'inherit'; controls.hidden = true; this.changed(); };
    mode.onchange = () => {
      if (mode.value === 'override') {
        const inherited = structuredClone(this.draft.statusSites ?? DEFAULT_STATUS_SITES);
        settings.paragraphs = inherited.paragraphs; settings.tables = inherited.tables; settings.headings = inherited.headings;
        category.statusSites = structuredClone(settings); renderControls(); controls.hidden = false;
      } else { delete category.statusSites; controls.hidden = true; }
      this.changed();
    };
    section.append(summary, hint, label, controls, reset); return section;
  }  private colorControls(category: IdCategory) {
    const section = document.createElement('details'); section.className = 'config-colors';
    const summary = document.createElement('summary'); summary.textContent = 'Card colors';
    const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'Choose an accent for each theme. Cards use a tint of that color and contrasting text. These previews update immediately; Apply saves the colors.';
    const previews = document.createElement('div'); previews.className = 'config-color-columns';
    for (const mode of ['light', 'dark'] as const) {
      const group = document.createElement('div'); const title = document.createElement('strong'); title.textContent = mode === 'light' ? 'Light mode' : 'Dark mode';
      const controls = document.createElement('div'); controls.className = 'config-color-inputs';
      const pickerLabel = document.createElement('label'); pickerLabel.textContent = 'Color';
      const picker = document.createElement('input'); picker.type = 'color'; picker.setAttribute('aria-label', `${title.textContent} color`); picker.value = categoryAccent(category, mode); pickerLabel.append(picker);
      const setColor = (value: string) => { category.colors = { ...category.colors, [mode]: value }; };
      const hex = this.field(`${title.textContent} hex`, category.colors?.[mode] ?? categoryAccent(category, mode), value => { if (validCategoryColor(value)) picker.value = value; setColor(value); }, undefined, 7);
      picker.oninput = () => { hex.querySelector('input')!.value = picker.value; setColor(picker.value); this.changed(); };
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'quiet-button'; reset.textContent = `Reset ${mode} color`;
      reset.onclick = () => {
        if (category.colors) { delete category.colors[mode]; if (!Object.keys(category.colors).length) delete category.colors; }
        picker.value = categoryAccent(category, mode); hex.querySelector('input')!.value = picker.value; this.changed();
      };
      controls.append(pickerLabel, hex, reset);
      const card = document.createElement('div'); card.className = 'lens-card config-color-example'; card.dataset.colorMode = mode;
      const row = document.createElement('div'); row.className = 'lens-row';
      const name = document.createElement('span'); name.className = 'lens-category';
      const id = document.createElement('strong'); const label = document.createElement('span'); label.textContent = 'Example project card';
      const source = document.createElement('small'); source.textContent = 'example.md:1'; row.append(name, id, label, source); card.append(row);
      styleCategoryCard(card, category); group.append(title, controls, card); previews.append(group);
    }
    section.append(summary, hint, previews); return section;
  }
  private refreshColorPreviews() {
    this.dialog.querySelectorAll<HTMLElement>('.config-category').forEach(row => {
      const category = this.draft.categories[Number(row.dataset.categoryIndex)]; if (!category) return;
      for (const mode of ['light', 'dark'] as const) if (category.colors?.[mode] === undefined) {
        const title = mode === 'light' ? 'Light mode' : 'Dark mode';
        for (const field of ['color', 'hex']) row.querySelector<HTMLInputElement>(`input[aria-label="${title} ${field}"]`)!.value = categoryAccent(category, mode);
      }
      const rule = this.draft.rules.find(rule => rule.category === category.key && rule.prefix);
      for (const card of row.querySelectorAll<HTMLElement>('.config-color-example')) {
        styleCategoryCard(card, category);
        card.querySelector('.lens-category')!.textContent = category.name || 'Unnamed category';
        card.querySelector('strong')!.textContent = rule ? `${rule.prefix}${rule.separator ?? '-'}01` : 'Example ID';
      }
    });
  }
  private clearResults() {
    this.folderReview = undefined;
    this.el('#config-preview-title').textContent = 'Recognition preview';
    for (const id of ['config-summary', 'config-module-summary', 'config-changes', 'config-results', 'config-result-count']) this.el('#' + id).replaceChildren();
    this.el('#config-result-controls').hidden = true;
  }
  private changed() {
    this.queuedPreview = undefined; this.queuedApply = undefined; this.scanStatuses = false;
    this.refreshColorPreviews();
    this.serial++; this.pending = undefined; this.preview = undefined; this.worker.cancel(); this.clearResults(); this.dateEditor.clearPreview(); this.error();
    this.status('Preview the draft to see its effect on project Markdown. Removing rules can remove IDs from the index; source text is never removed.');
    try { validateIdConfiguration(this.draft); } catch (error) { this.error(String(error)); }
    this.update(); this.controls();
  }
  private runPreview(scan = false, target?: GeneratorTarget, updateFolders = false) {
    const context = this.current(); if (!context || this.conflict()) return;
    // A refresh may begin between pointer-down and click. Preserve that preview request.
    if (context.busy || this.saving) { this.queuedPreview = { scan, target, updateFolders }; this.status('Waiting for the current project refresh before previewing...'); return; }
    this.changed();
    try {
      const stale = this.staleFolderStage();
      if (!target && stale) throw new Error(`Sources or generator settings changed after staging. Use Update ${stale} again before Preview matches and Apply.`);
      const configuration = validateIdConfiguration(this.draft), revision = ++this.serial;
      const folderGenerators = target ? validateFolderGenerators(this.folderEditors[target].settings()) : undefined;
      this.scanStatuses = scan;
      this.pending = { revision, context: copy(context), configuration: copy(configuration), generatorTarget: target, updateFolders };
      this.status('Checking draft rules against current Markdown, including unsaved edits…');
      this.worker.run({ revision, documents: context.documents, configuration, configurationRevision: String(revision),
        ...(target ? { folderGenerators, previousFolders: generatedFolderHistory(configuration, target), ...(updateFolders ? { updateFolders: target } : {}) } : {}) });
    } catch (error) { this.pending = undefined; this.error(String(error)); }
    this.controls();
  }
  private receive(result: IndexResponse) {
    const pending = this.pending; if (!pending || result.revision !== pending.revision) return;
    this.pending = undefined;
    if (!this.current() || this.conflict() || !sameDocuments(pending.context.documents, this.current()!.documents)) { this.update(); this.status('The project changed. Preview matches again.'); return; }
    if (pending.removeCategoryKeys) {
      if (result.error || !result.removedOverrideIds) {
        this.error(result.error ?? 'Could not check exact-ID overrides.');
        this.status('Nothing was deleted. Repair the category rules or review the ID overrides, then retry.'); this.controls();
      } else this.finishCategoryRemoval(new Set(pending.removeCategoryKeys), result.removedOverrideIds);
      return;
    }
    if (pending.generatorTarget) {
      if (result.error || !result.folderPreview) { this.error(result.error ?? 'Folder preview failed.'); this.status('No generated entries were applied. Adjust the patterns and preview again.'); }
      else {
        if (pending.updateFolders && result.folderConfiguration) {
          this.draft = validateIdConfiguration(result.folderConfiguration);
          this.folderStages.set(pending.generatorTarget, { documents: copy(pending.context.documents), settings: JSON.stringify(this.folderEditors[pending.generatorTarget].settings()) });
          this.renderFields(); this.changed();
        }
        this.folderReview = pending.context;
        this.el('#config-preview-title').textContent = `Folder ${pending.generatorTarget} preview`;
        this.folderEditors[pending.generatorTarget].renderPreview(result.folderPreview, this.el('#config-results'));
        this.status(pending.updateFolders ? result.folderConfiguration ? 'Folder updates staged in the draft. Review Preview matches, then Apply to save.' : 'Folder update blocked. Resolve the highlighted collisions, then update again. Nothing was staged.' : 'Folder preview ready. No configuration or active assignments changed.');
        this.el('.config-preview').scrollIntoView({ block: 'start' });
        const next = pending.updateFolders && result.folderConfiguration ? this.el<HTMLButtonElement>('#config-preview')
          : this.folderEditors[pending.generatorTarget].root.querySelector<HTMLButtonElement>(pending.updateFolders ? '.folder-generator-update' : '.folder-generator-preview');
        next?.focus({ preventScroll: true });
      }
      this.controls(); return;
    }
    if (result.error || !result.index) { this.error(result.error ?? 'Preview failed.'); this.status('No configuration was applied. Adjust the rules and preview again.'); this.controls(); return; }
    if (this.scanStatuses) { this.scanStatuses = false; try { this.statusEditor.discovered(result.index.definitions); } catch (error) { this.error(String(error)); } return; }
    this.preview = { ...pending, index: result.index, baseline: pending.context.baseline, baselineError: pending.context.baselineNotice };
    this.dateEditor.renderPreview(result.index, pending.context.documents, pending.configuration);
    this.status('Preview ready. Review the matches and changes, then Apply.' + (this.discovery.remainingSuggestions ? ' ' + this.discovery.remainingSuggestions + ' discovery suggestions are outside this draft. Use Add suggestions to draft to include them.' : '')); this.page = 0; this.renderResults(); this.controls();
    this.el('.config-preview').scrollIntoView({ block: 'start' });
  }
  private renderResults() {
    const preview = this.preview; if (!preview) return;
    const index = preview.index, all = [...index.definitions, ...index.references];
    const after = new Set(all.map(idKey));
    const beforeItems = preview.baseline ? [...preview.baseline.definitions, ...preview.baseline.references] : [];
    const before = new Set(beforeItems.map(idKey));
    const lost = [...before].filter(id => !after.has(id));
    const added = [...after].filter(id => !before.has(id));
    const issues = index.findings.filter(item => item.kind !== 'pending');
    this.el('#config-summary').textContent = `${index.definitions.length} definitions · ${index.references.length} references · ${issues.filter(item => item.kind === 'unresolved').length} unresolved references · ${issues.filter(item => item.kind === 'duplicate').length} duplicate definitions${issues.some(item => item.kind === 'consistency') ? ` · ${issues.filter(item => item.kind === 'consistency').length} consistency findings` : ''}`;
    this.el('#config-module-summary').textContent = `${index.definitions.filter(item => item.moduleAssignment?.state === 'assigned').length} definitions assigned to modules ? ${new Set(index.definitions.filter(item => item.moduleAssignment?.state === 'conflict').map(idKey)).size} module conflicts. Inspect ID issues for conflicting definitions.`;
    this.el('#config-changes').textContent = preview.baseline ? `${added.length} new IDs · ${lost.length} removed IDs. Removing recognition never removes Markdown text.` : 'Previous rules could not be analyzed; new/removed counts are unavailable. ' + (preview.baselineError ?? '');
    const identities = new Map(beforeItems.map(item => [JSON.stringify([item.file, item.offset, item.id]), idKey(item)]));
    const scopeChanges = all.filter(item => { const key = JSON.stringify([item.file, item.offset, item.id]); return identities.has(key) && identities.get(key) !== idKey(item); });
    if (preview.baseline && scopeChanges.length) this.el('#config-changes').append(' ' + scopeChanges.length + ' occurrences change ID scope.');
    const previous = new Map(beforeItems.map(item => [`${item.file}:${item.offset}:${item.id}`, item.kind]));
    const transitions = all.filter(item => previous.has(`${item.file}:${item.offset}:${item.id}`) && previous.get(`${item.file}:${item.offset}:${item.id}`) !== item.kind);
    if (preview.baseline) this.el('#config-changes').append(` ${transitions.filter(item => item.kind === 'definition').length} references become definitions; ${transitions.filter(item => item.kind === 'reference').length} definitions become references.`);
    const oldStatuses = new Map(preview.baseline?.definitions.map(item => [idKey(item), item]));
    const newStatuses = new Map(index.definitions.map(item => [idKey(item), item]));
    const statusItems = new Map([...oldStatuses, ...newStatuses]);
    const statusChanged = (id: string) => JSON.stringify(oldStatuses.get(id)?.authoredStatus) !== JSON.stringify(newStatuses.get(id)?.authoredStatus);
    if (preview.baseline) this.el('#config-changes').append(' ' + [...statusItems.keys()].filter(statusChanged).length + ' IDs with changed status assignments.');
    this.el('#config-changes').append(' ' + [...newStatuses.values()].filter(item => item.authoredStatus?.state === 'conflict').length + ' status conflicts.');
    const filter = this.el<HTMLSelectElement>('#config-filter').value;
    let items: (Occurrence | Finding)[] = filter === 'statuses' ? [...statusItems.values()] : filter === 'transitions' ? transitions : filter === 'definitions' ? index.definitions : filter === 'references' ? index.references : filter === 'issues' ? issues : filter === 'removed' ? lost.map(id => beforeItems.find(item => idKey(item) === id)!) : all;
    items = [...items].sort((a, b) => a.file.localeCompare(b.file) || a.offset - b.offset);
    this.page = Math.max(0, Math.min(this.page, Math.ceil(items.length / 50) - 1));
    this.el('#config-result-controls').hidden = false;
    this.el('#config-result-count').textContent = items.length ? `${this.page * 50 + 1}–${Math.min(items.length, (this.page + 1) * 50)} of ${items.length}` : 'No matches in this view';
    this.el<HTMLButtonElement>('#config-previous').disabled = this.page === 0;
    this.el<HTMLButtonElement>('#config-next').disabled = (this.page + 1) * 50 >= items.length;
    this.el('#config-results').replaceChildren(...items.slice(this.page * 50, (this.page + 1) * 50).map(item => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'config-result';
      // Templated and listed references show their source text next to the ID they refer to (US1 → User Story 1).
      const source = 'id' in item && item.kind === 'reference' && !item.named ? preview.context.documents[item.file]?.slice(item.offset, item.end) : undefined;
      button.textContent = `${'message' in item ? item.message : (source && source !== item.id ? source + ' → ' : '') + idLabel(item) + ' · ' + item.kind} — ${item.file}:${item.line}:${item.column}`;
      button.title = 'message' in item ? item.message : item.label;
      if ('featureAssignment' in item && item.featureAssignment) button.textContent += ' - Features: ' + (item.featureAssignment.state === 'conflict' ? 'Feature conflict' : item.featureAssignment.features.map(feature => feature.name).join(', ') || 'Unassigned');
      if ('moduleAssignment' in item && item.moduleAssignment) {
        const assignment = item.moduleAssignment; button.textContent += ' - Modules: ' + (assignment.state === 'assigned' ? assignment.modules.map(m => m.name).join(', ') : assignment.state);
        button.title += '\n' + assignment.evidence.map(e => `${e.kind}: ${e.id ?? ''} ${e.path ?? ''} -> ${e.modules.map(m => m.name).join(', ') || 'Unassigned'}`).join('\n');
      }
      const currentStatus = 'id' in item ? (filter === 'statuses' ? newStatuses.get(idKey(item))?.authoredStatus : item.authoredStatus) : undefined;
      if (currentStatus) {
        button.append(' | Found: ');
        for (const [i, evidence] of currentStatus.evidence.entries()) {
          if (i) button.append(' / ');
          button.append((evidence.site ? evidence.site + ': ' : '') + evidence.value + ' -> ');
          button.append(statusBadge(evidence.display ?? evidence.value, preview.configuration.statuses ?? []));
        }
        if (currentStatus.state === 'conflict') button.append(' ', statusBadge('', [], true));
      } else if (filter === 'statuses') button.append(' | No authored status');

      button.onclick = () => {
        if (!this.fresh(preview)) { this.update(); return; }
        const valid = () => this.host.context()?.projectId === preview.context.projectId && sameDocuments(this.host.context()!.documents, preview.context.documents);
        this.suspended = true; this.dialog.close();
        void this.host.source(item, preview.context.documents[item.file], valid).catch(error => { this.show(); this.error(String(error)); });
      };
      if (filter === 'statuses' && 'id' in item) {
        const row = document.createElement('div'); row.className = 'config-status-result'; row.append(button);
        if (preview.baseline && statusChanged(idKey(item))) {
          const before = document.createElement('p'); before.className = 'config-hint';
          before.textContent = 'Changed - Previously: ' + (oldStatuses.get(idKey(item))?.authoredStatus?.evidence.map(e => (e.site ? e.site + ': ' : '') + e.value + ' -> ' + (e.display ?? e.value)).join(' / ') ?? 'No authored status');
          row.append(before);
        }
        if (currentStatus) row.append(statusEvidence({ ...item, authoredStatus: currentStatus }, preview.configuration.statuses ?? [], source => {
          if (!this.fresh(preview)) { this.update(); return; }
          const valid = () => this.host.context()?.projectId === preview.context.projectId && sameDocuments(this.host.context()!.documents, preview.context.documents);
          this.suspended = true; this.dialog.close();
          void this.host.source(source, preview.context.documents[source.file], valid).catch(error => { this.show(); this.error(String(error)); });
        }));
        return row;
      }
      return button;
    }));
  }
  private async reload() {
    if (this.saving) return;
    try { await this.host.refresh(); const context = this.current(); if (context) { this.initialize(context); this.update(); } }
    catch (error) { this.error(String(error)); }
  }
  private async apply() {
    const preview = this.preview; if (this.saving || !preview || !this.fresh() || this.staleFolderStage()) return;
    if (this.current()?.busy) { this.queuedApply = preview; this.status('Waiting for the current project refresh before applying...'); this.controls(); return; }
    this.saving = true; this.controls(); this.error(); this.status('Checking current files before saving…');
    try {
      await this.host.refresh();
      const context = this.current();
      if (!context || !this.fresh(preview)) throw new Error('Markdown or project configuration changed. Your draft is preserved; reload configuration if needed and preview again.');
      const result = await this.host.save(context.root, preview.configuration, preview.context.state.diskVersion, context.documentVersions);
      if (!result.ok) throw new Error(result.message ?? 'Could not save project configuration.');
      this.suspended = false; this.dialog.close();
      try { await this.host.refresh(); }
      catch { this.host.notify('Project configuration was saved. Refresh the project to load its updated index.'); }
    } catch (error) { this.preview = undefined; this.clearResults(); this.error(error instanceof Error ? error.message : String(error)); this.status('Not applied. Your draft is preserved.'); }
    finally { this.saving = false; this.controls(); }
  }
}
