import type { IdConfiguration } from '../core/id-configuration';
import { editFeatureFileRule, removeFeatureFileRule, type FeatureFileRule, removeProjectFeature, editFeatureOverride, mergeFeatureOverride, type FeatureOverride, type ProjectFeature } from '../core/features';
import { configurationEntry, rememberConfigurationEntries } from './configuration-entry';
import { idLabel } from '../core/id-identity';

/** Feature definitions and exact memberships share the host's guarded draft save. */
export class FeatureConfigurationEditor {
  readonly root = document.createElement('section');
  private fileViews = new WeakMap<FeatureFileRule, Map<string, { rule: FeatureFileRule }>>();
  private fileControls: { model: { rule: FeatureFileRule }; row: HTMLElement; hint: HTMLElement }[] = [];
  private views = new WeakMap<FeatureOverride, Map<string, { rule: FeatureOverride }>>();
  private controls: { model: { rule: FeatureOverride }; row: HTMLElement; feature?: string }[] = [];
  constructor(private draft: () => IdConfiguration, private changed: () => void) { this.root.id = 'config-features'; }
  private button(label: string, action: () => void, focus?: string) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = label;
    button.onclick = () => {
      const index = [...this.root.querySelectorAll('button')].filter(item => item.textContent === label).indexOf(button);
      action(); this.render(); this.changed();
      const choices = [...this.root.querySelectorAll<HTMLButtonElement>('button')].filter(item => item.textContent === label);
      (focus ? this.root.querySelector<HTMLElement>(focus) : choices[Math.min(index, choices.length - 1)] ?? this.root.querySelector<HTMLElement>('button'))?.focus();
    }; return button;
  }
  private input(name: string, value: string, update: (value: string) => void, limit = 128) {
    const label = document.createElement('label'); label.textContent = name;
    const input = document.createElement('input'); input.type = 'text'; input.value = value; input.maxLength = limit; input.setAttribute('aria-label', name);
    input.oninput = () => { update(input.value); this.changed(); }; label.append(input); return label;
  }
  render() {
    rememberConfigurationEntries(this.root); this.controls = []; this.fileControls = [];
    const config = this.draft(), title = document.createElement('h3'); title.textContent = 'Application features';
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = 'Features are independent of modules and categories. File rules combine memberships from definition files. Exact-ID overrides replace them; an empty override means explicitly unassigned.';
    const names = document.createElement('section'); names.className = 'feature-names';
    const add = this.button('Add feature', () => {
      let n = 1; while (config.features?.some(feature => feature.key === `feature${n}`)) n++;
      (config.features ??= []).push({ key: `feature${n}`, name: '' });
    }, '.feature-names > .config-entry:last-child input'); add.disabled = (config.features?.length ?? 0) >= 64; const header = document.createElement('div'); header.className = 'config-section-heading'; header.append(title, add);
    for (const [i, feature] of (config.features ?? []).entries()) {
      const row = document.createElement('div'); row.className = 'feature-row'; row.dataset.featureIndex = String(i);
      row.append(this.input('Feature name', feature.name, value => { feature.name = value; }),
        this.button('Remove feature', () => removeProjectFeature(config, feature.key)), this.rules(feature, i), this.assignments(feature, i));
      names.append(configurationEntry(feature, row, () => feature.name || 'New feature', !feature.name));
    }
    this.root.replaceChildren(header, hint, names, this.assignments()); this.updateControls();
  }
  private rules(feature: ProjectFeature, index: number) {
    const config = this.draft(), section = document.createElement('section'); section.className = 'feature-rules';
    const generated = config.generatedFolders?.find(mapping => mapping.target === 'features' && mapping.entry === feature.key);
    if (generated) {
      const title = document.createElement('h4'); title.textContent = 'Generated folder mapping';
      const description = document.createElement('p'); description.className = 'config-hint';
      description.textContent = `Pattern ${generated.pattern}; folder ${generated.folder}/ and descendants. Excluded folders: ${generated.exclusions.join(', ') || 'None'}. Change generator settings and use Update features to refresh this mapping.`;
      section.append(title, description); return section;
    }
    const selector = `[data-feature-index="${index}"] .feature-rules`;
    const heading = document.createElement('div'); heading.className = 'config-section-heading';
    const title = document.createElement('h4'); title.textContent = 'ID assignment rules';
    const add = this.button('Add file rule', () => {
      let n = 1; while (config.featureRules?.some(rule => rule.key === `files${n}`)) n++;
      (config.featureRules ??= []).push({ key: `files${n}`, path: '', scope: 'file', features: [feature.key] });
    }, `${selector} > .config-entry:last-child input`); add.classList.add('feature-add-rule'); heading.append(title, add);
    const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'Assign IDs defined in a file or folder to this feature. Editing or removing a rule here leaves other features unchanged.'; section.append(heading, hint);
    const rules = (config.featureRules ?? []).filter(rule => rule.features.includes(feature.key));
    if (!rules.length) { const empty = document.createElement('p'); empty.className = 'config-hint'; empty.textContent = 'No file or folder rules in this feature.'; section.append(empty); }
    for (const rule of rules) {
      let owners = this.fileViews.get(rule); if (!owners) { owners = new Map(); this.fileViews.set(rule, owners); }
      let view = owners.get(feature.key); if (!view) { view = { rule }; owners.set(feature.key, view); }
      const model = view, row = document.createElement('div'); row.className = 'feature-file-rule';
      const edit = (patch: Partial<Pick<FeatureFileRule, 'path' | 'scope'>>) => {
        model.rule = editFeatureFileRule(config, model.rule, feature.key, patch);
        let targets = this.fileViews.get(model.rule); if (!targets) { targets = new Map(); this.fileViews.set(model.rule, targets); } targets.set(feature.key, model);
        this.updateControls(); this.changed();
      };
      const label = document.createElement('label'); label.textContent = 'Match'; const scope = document.createElement('select'); scope.setAttribute('aria-label', 'Match');
      scope.add(new Option('File', 'file')); scope.add(new Option('Folder and descendants', 'folder')); scope.value = model.rule.scope; scope.onchange = () => edit({ scope: scope.value as FeatureFileRule['scope'] }); label.append(scope);
      const limit = document.createElement('p'); limit.className = 'config-hint feature-rule-limit'; limit.textContent = 'This rule also assigns other features. Remove a file rule before editing it independently: the project limit is 128 rules.';
      row.append(label, this.input('Project-relative path', model.rule.path, path => edit({ path }), 4096),
        this.button('Remove file rule', () => removeFeatureFileRule(config, model.rule, feature.key), `${selector} .feature-add-rule`), limit);
      this.fileControls.push({ model, row, hint: limit }); section.append(configurationEntry(model, row, () => model.rule.path || 'New file rule', !model.rule.path));
    }
    return section;
  }
  private assignments(feature?: ProjectFeature, index?: number) {
    const config = this.draft(), section = document.createElement('section');
    section.className = feature ? 'feature-overrides' : 'feature-overrides feature-unassigned';
    const selector = feature ? `[data-feature-index="${index}"] .feature-overrides` : '.feature-unassigned';
    const heading = document.createElement('div'); heading.className = 'config-section-heading';
    const title = document.createElement('h4'); title.textContent = feature ? 'ID overrides' : 'Unassigned IDs';
    const add = this.button(feature ? 'Add ID override' : 'Add unassigned ID', () => {
      (config.featureOverrides ??= []).push({ id: '', features: feature ? [feature.key] : [] });
    }, `${selector} > .config-entry:last-child input`);
    add.className += ' feature-add-assignment'; heading.append(title, add);
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = feature ? 'Assign an exact ID to this feature instead of its file/folder assignments. Adding an existing ID keeps its other explicit features. Removing the last feature leaves the ID unassigned.' : 'These IDs override file/folder assignments with no feature. Restore file/folder assignments to remove an override.';
    section.append(heading, hint);
    for (const rule of (config.featureOverrides ?? []).filter(rule => feature ? rule.features.includes(feature.key) : !rule.features.length)) {
      const owner = feature?.key ?? '';
      let owners = this.views.get(rule); if (!owners) { owners = new Map(); this.views.set(rule, owners); }
      let model = owners.get(owner); if (!model) { model = { rule }; owners.set(owner, model); }
      const view = model, row = document.createElement('div'); row.className = 'feature-id-override';
      const remember = (next: FeatureOverride) => {
        view.rule = next; let targets = this.views.get(next); if (!targets) { targets = new Map(); this.views.set(next, targets); } targets.set(owner, view);
      };
      const edit = (id: string, scope?: string) => {
        if (feature) remember(editFeatureOverride(config, view.rule, feature.key, id, scope));
        else { view.rule.id = id; if (scope) view.rule.scope = scope; else delete view.rule.scope; }
        this.updateControls();
      };
      row.append(this.input('Exact ID', rule.id, value => edit(value, view.rule.scope), 512),
        this.input('ID scope (optional)', rule.scope ?? '', value => edit(view.rule.id, value), 4096),
        this.button(feature ? 'Remove ID override' : 'Restore file/folder assignments', () => {
          if (feature) {
            view.rule.features = view.rule.features.filter(key => key !== feature.key);
            if (!view.rule.features.length && !view.rule.id.trim()) config.featureOverrides = config.featureOverrides!.filter(item => item !== view.rule);
          }
          else config.featureOverrides = config.featureOverrides!.filter(item => item !== view.rule);
        }, `${selector} .feature-add-assignment`));
      // Commit a complete ID/scope pair only when focus leaves this assignment.
      // Keep mounted controls alive so a Preview or Remove click still reaches its target.
      row.addEventListener('focusout', event => {
        if (!feature || row.contains(event.relatedTarget as Node | null)) return;
        const merged = mergeFeatureOverride(config, view.rule); if (merged === view.rule) return;
        remember(merged);
        this.controls = this.controls.filter(control => {
          const obsolete = control.row !== row && control.model.rule === merged && (control.feature === feature.key || control.feature === undefined);
          if (obsolete) control.row.closest('.config-entry')?.remove(); return !obsolete;
        });
        this.updateControls(); this.changed();
      });
      this.controls.push({ model: view, row, feature: feature?.key });
      section.append(configurationEntry(view, row, () => view.rule.id ? idLabel(view.rule) : 'New ID override', !rule.id));
    }
    return section;
  }
  private updateControls() {
    const rulesFull = (this.draft().featureRules?.length ?? 0) >= 128;
    this.root.querySelectorAll<HTMLButtonElement>('.feature-add-rule').forEach(button => { button.disabled = rulesFull; });
    for (const { model, row, hint } of this.fileControls) {
      const blocked = rulesFull && model.rule.features.length > 1; hint.hidden = !blocked;
      row.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(input => { input.disabled = blocked; });
    }
    const full = (this.draft().featureOverrides?.length ?? 0) >= 256;
    this.root.querySelectorAll<HTMLButtonElement>('.feature-add-assignment').forEach(button => { button.disabled = full; });
    for (const { model, row, feature } of this.controls) {
      const blocked = full && feature !== undefined && model.rule.features.length > 1;
      row.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = blocked; input.title = blocked ? 'Remove an assignment before editing a shared assignment: the project limit is 256.' : ''; });
    }
  }
}
