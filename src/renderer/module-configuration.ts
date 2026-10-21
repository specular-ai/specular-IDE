import { idLabel } from '../core/id-identity';
import { configurationEntry, rememberConfigurationEntries } from './configuration-entry';
import type { IdConfiguration } from '../core/id-configuration';
import type { ModuleFileRule, ModuleOverride, ProjectModule } from '../core/module-configuration';
import { editModuleFileRule, removeModuleFileRule, removeProjectModule, editModuleOverride, mergeModuleOverride, removeModuleOverride } from '../core/module-rule-editing';
type RuleView = { rule: ModuleFileRule };
type OverrideView = { rule: ModuleOverride };
/** Edits the containing configuration draft; the host owns preview and Apply. */
export class ModuleConfigurationEditor {
  readonly root = document.createElement('section');
  private views = new WeakMap<ModuleFileRule, Map<string, RuleView>>();
  private ruleControls: { view: RuleView; row: HTMLElement; hint: HTMLElement }[] = [];
  private overrideViews = new WeakMap<ModuleOverride, Map<string, OverrideView>>();
  private overrideControls: { view: OverrideView; module?: string; row: HTMLElement; hint: HTMLElement }[] = [];
  private overrideSections: { module?: string; empty: HTMLElement }[] = [];
  constructor(private draft: () => IdConfiguration, private changed: () => void) { this.root.id = 'config-modules'; }
  private input(labelText: string, value: string, change: (value: string) => void, maxLength = 128) {
    const label = document.createElement('label'); label.textContent = labelText;
    const input = document.createElement('input'); input.type = 'text'; input.value = value; input.maxLength = maxLength; input.setAttribute('aria-label', labelText);
    input.oninput = () => { change(input.value); this.changed(); }; label.append(input); return label;
  }
  private button(text: string, action: () => void) { const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = text; button.onclick = action; return button; }
  private unique(base: string, used: string[]) { if (!used.includes(base)) return base; let n = 2; while (used.includes(`${base}-${n}`)) n++; return `${base}-${n}`; }
  render() {
    rememberConfigurationEntries(this.root); this.ruleControls = []; this.overrideControls = []; this.overrideSections = [];
    const config = this.draft(), summary = document.createElement('h3'); summary.textContent = 'Application modules';
    const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'Modules such as GUI or backend are independent of category. File rules combine memberships from definition files. Exact-ID overrides replace them; an empty override means explicitly unassigned.';
    const names = document.createElement('section'); names.className = 'module-names';
    const add = this.button('Add module', () => {
      const module = { key: this.unique('module', (config.modules ?? []).map(m => m.key)), name: '' };
      (config.modules ??= []).push(module); this.render(); this.changed(); this.root.querySelector<HTMLInputElement>('.module-names > .config-entry:last-child > .module-row input')?.focus();
    }); add.disabled = (config.modules?.length ?? 0) >= 64;
    const header = document.createElement('div'); header.className = 'config-section-heading'; header.append(summary, add);
    for (const [i, module] of (config.modules ?? []).entries()) {
      const row = document.createElement('div'); row.className = 'module-row'; row.dataset.moduleIndex = String(i);
      row.append(this.input('Module name', module.name, value => { module.name = value; }),
        this.button('Remove module', () => { removeProjectModule(config, module.key); this.render(); this.changed(); }), this.moduleRules(module, i), this.moduleOverrides(module, i)); names.append(configurationEntry(module, row, () => `${config.modules!.indexOf(module) + 1}. ${module.name || 'New module'}`, !module.name));
    }
    this.root.replaceChildren(header, hint, names, this.moduleOverrides()); this.updateRuleControls(); this.updateOverrideControls();
  }
  private moduleRules(module: ProjectModule, moduleIndex: number) {
    const config = this.draft(), section = document.createElement('section'); section.className = 'module-rules';
    const generated = config.generatedFolders?.find(mapping => mapping.target === 'modules' && mapping.entry === module.key);
    if (generated) {
      const title = document.createElement('h4'); title.textContent = 'Generated folder mapping';
      const description = document.createElement('p'); description.className = 'config-hint';
      description.textContent = `Pattern ${generated.pattern}; folder ${generated.folder}/ and descendants. Excluded folders: ${generated.exclusions.join(', ') || 'None'}. Change generator settings and use Update modules to refresh this mapping.`;
      section.append(title, description); return section;
    }
    const heading = document.createElement('div'); heading.className = 'config-section-heading';
    const title = document.createElement('h4'); title.textContent = 'ID assignment rules';
    const add = this.button('Add file rule', () => {
      const rule: ModuleFileRule = { key: this.unique('files', (config.moduleRules ?? []).map(r => r.key)), path: '', scope: 'file', modules: [module.key] };
      (config.moduleRules ??= []).push(rule); this.render(); this.changed();
      this.root.querySelector<HTMLInputElement>(`[data-module-index="${moduleIndex}"] .module-rules > .config-entry:last-child input`)?.focus();
    }); add.classList.add('module-add-rule'); heading.append(title, add);
    const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'Assign IDs defined in a file or folder to this module. Editing or removing a rule here leaves other modules unchanged.';
    section.append(heading, hint);
    const rules = (config.moduleRules ?? []).filter(rule => rule.modules.includes(module.key));
    if (!rules.length) { const empty = document.createElement('p'); empty.className = 'config-hint module-rules-empty'; empty.textContent = 'No file or folder rules in this module.'; section.append(empty); }
    for (const [i, rule] of rules.entries()) {
      let owners = this.views.get(rule); if (!owners) { owners = new Map(); this.views.set(rule, owners); }
      let view = owners.get(module.key); if (!view) { view = { rule }; owners.set(module.key, view); }
      const model = view, row = document.createElement('div'); row.className = 'module-file-rule';
      const edit = (patch: Partial<Pick<ModuleFileRule, 'path' | 'scope'>>) => {
        model.rule = editModuleFileRule(config, model.rule, module.key, patch);
        let targets = this.views.get(model.rule); if (!targets) { targets = new Map(); this.views.set(model.rule, targets); }
        targets.set(module.key, model); this.updateRuleControls(); this.changed();
      };
      const scopeLabel = document.createElement('label'); scopeLabel.textContent = 'Match'; const scope = document.createElement('select'); scope.setAttribute('aria-label', 'Match');
      scope.add(new Option('File', 'file')); scope.add(new Option('Folder and descendants', 'folder')); scope.value = model.rule.scope; scope.onchange = () => edit({ scope: scope.value as ModuleFileRule['scope'] }); scopeLabel.append(scope);
      const limit = document.createElement('p'); limit.className = 'config-hint module-rule-limit';
      limit.textContent = 'This rule also assigns other modules. Remove a file rule before editing it independently: the project limit is 128 rules.';
      row.append(scopeLabel, this.input('Project-relative path', model.rule.path, path => edit({ path }), 4096), this.button('Remove file rule', () => {
        removeModuleFileRule(config, model.rule, module.key); this.render(); this.changed();
        this.root.querySelector<HTMLButtonElement>(`[data-module-index="${moduleIndex}"] .module-add-rule`)?.focus();
      }), limit);
      this.ruleControls.push({ view: model, row, hint: limit });
      section.append(configurationEntry(model, row, () => `${i + 1}. ${model.rule.path || 'New file rule'}`, !model.rule.path));
    }
    return section;
  }
  private updateRuleControls() {
    const full = (this.draft().moduleRules?.length ?? 0) >= 128;
    this.root.querySelectorAll<HTMLButtonElement>('.module-add-rule').forEach(button => { button.disabled = full; });
    for (const { view, row, hint } of this.ruleControls) {
      const blocked = full && view.rule.modules.length > 1; hint.hidden = !blocked;
      row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(input => { input.disabled = blocked; });
    }
  }
  private moduleOverrides(module?: ProjectModule, moduleIndex?: number) {
    const config = this.draft(), section = document.createElement('section'); section.className = 'module-overrides' + (module ? '' : ' module-unassigned');
    const heading = document.createElement('div'); heading.className = 'config-section-heading';
    const title = document.createElement('h4'); title.textContent = module ? 'ID overrides' : 'Unassigned IDs';
    const selector = module ? `[data-module-index="${moduleIndex}"] .module-overrides` : '.module-unassigned';
    const add = this.button(module ? 'Add ID override' : 'Add unassigned ID', () => {
      (config.moduleOverrides ??= []).push({ id: '', modules: module ? [module.key] : [] }); this.render(); this.changed();
      this.root.querySelector<HTMLInputElement>(`${selector} > .config-entry:last-child input`)?.focus();
    }); add.classList.add('module-add-override'); heading.append(title, add);
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = module ? 'Assign an exact ID to this module instead of its file/folder assignments. Adding an existing ID keeps its other explicit modules. Removing the last module leaves the ID unassigned.' : 'These IDs override file/folder assignments with no module. Restore file/folder assignments to remove an override.';
    const empty = document.createElement('p'); empty.className = 'config-hint module-overrides-empty'; empty.textContent = module ? 'No ID overrides in this module.' : 'No explicitly unassigned IDs.';
    section.append(heading, hint, empty); this.overrideSections.push({ module: module?.key, empty });
    const rules = (config.moduleOverrides ?? []).filter(rule => module ? rule.modules.includes(module.key) : !rule.modules.length);
    for (const [i, rule] of rules.entries()) {
      let targets = this.overrideViews.get(rule); if (!targets) { targets = new Map(); this.overrideViews.set(rule, targets); }
      const owner = module?.key ?? ''; let view = targets.get(owner); if (!view) { view = { rule }; targets.set(owner, view); }
      const model = view, row = document.createElement('div'); row.className = 'module-id-override';
      const remember = (next: ModuleOverride) => {
        model.rule = next; let owners = this.overrideViews.get(next); if (!owners) { owners = new Map(); this.overrideViews.set(next, owners); } owners.set(owner, model);
      };
      const field = this.input('Exact ID', rule.id, value => {
        if (module) remember(editModuleOverride(config, model.rule, module.key, value)); else model.rule.id = value;
        this.updateOverrideControls();
      }, 512);
      // Finish merging on blur, so partially typed IDs never absorb other overrides.
      field.querySelector('input')!.onblur = () => {
        if (!module) return; const merged = mergeModuleOverride(config, model.rule); if (merged === model.rule) return;
        remember(merged);
        // Keep this mounted input and action buttons alive through the click causing blur.
        this.overrideControls = this.overrideControls.filter(control => {
          const obsolete = control.row !== row && control.view.rule === merged && (control.module === module.key || control.module === undefined);
          if (obsolete) control.row.closest('.config-entry')?.remove(); return !obsolete;
        });
        this.updateOverrideControls(); this.changed();
      };
      const limit = document.createElement('p'); limit.className = 'config-hint module-rule-limit'; limit.textContent = 'Remove an ID override before editing this shared override independently: the project limit is 256 overrides.';
      const scopeField = this.input('ID scope (empty for project)', rule.scope ?? '', value => {
        if (module) remember(editModuleOverride(config, model.rule, module.key, model.rule.id, value));
        else if (value) model.rule.scope = value; else delete model.rule.scope;
        this.updateOverrideControls();
      }, 4096);
      scopeField.querySelector('input')!.onblur = field.querySelector('input')!.onblur;
      row.append(field, scopeField, this.button(module ? 'Remove ID override' : 'Restore file/folder assignments', () => {
        if (module) removeModuleOverride(config, model.rule, module.key); else config.moduleOverrides!.splice(config.moduleOverrides!.indexOf(model.rule), 1);
        this.render(); this.changed(); this.root.querySelector<HTMLButtonElement>(`${selector} .module-add-override`)?.focus();
      }), limit);
      this.overrideControls.push({ view: model, module: module?.key, row, hint: limit });
      section.append(configurationEntry(model, row, () => `${i + 1}. ${model.rule.id ? idLabel(model.rule) : 'New ID override'}`, !model.rule.id));
    }
    return section;
  }
  private updateOverrideControls() {
    const rules = this.draft().moduleOverrides ?? [], full = rules.length >= 256;
    this.root.querySelectorAll<HTMLButtonElement>('.module-add-override').forEach(button => { button.disabled = full; });
    for (const { view, row, hint, module } of this.overrideControls) {
      const blocked = module !== undefined && full && view.rule.modules.length > 1; hint.hidden = !blocked;
      row.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = blocked; });
    }
    for (const { module, empty } of this.overrideSections) empty.hidden = rules.some(rule => module === undefined ? !rule.modules.length : rule.modules.includes(module));
  }
}
