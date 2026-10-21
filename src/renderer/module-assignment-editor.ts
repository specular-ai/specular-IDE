import { idKey, keyLabel, identityFromKey } from '../core/id-identity';
import { validateIdConfiguration, type IdConfiguration } from '../core/id-configuration';
import type { ModuleAssignment } from '../shared/types';
import { sameDocuments, type ConfigurationContext } from './project-configuration';

interface Host {
  context(): ConfigurationContext | undefined;
  hasConfigurationDraft(): boolean;
  configure(): void;
  refresh(): Promise<void>;
  save(root: string, configuration: IdConfiguration, diskVersion: string, documentVersions: Record<string, string>): Promise<{ ok: boolean; message?: string }>;
  notify(message: string): void;
  focus(id: string): void;
}

/** A card edit owns only one exact-ID override; the shared save path guards the whole file. */
export class ModuleAssignmentEditor {
  private dialog = document.createElement('dialog');
  private loaded?: ConfigurationContext;
  private id = '';
  private selected = new Set<string>();
  private inherit = false;
  private explicit = false;
  private saving = false;
  private reloading = false;
  private lastProblem?: string;
  constructor(private host: Host) {
    this.dialog.id = 'module-assignment-dialog';
    this.dialog.setAttribute('aria-labelledby', 'module-assignment-title');
    this.dialog.innerHTML = `<h2 id="module-assignment-title">Edit modules</h2>
      <p id="module-assignment-current"></p><p id="module-assignment-evidence"></p>
      <fieldset id="module-assignment-fields"><legend>Modules for this ID</legend><div id="module-assignment-options"></div>
      <button type="button" id="module-assignment-inherit" class="quiet-button">Use file/folder assignments</button>
      <button type="button" id="module-assignment-none" class="quiet-button">Unassign all modules</button></fieldset>
      <p id="module-assignment-summary" role="status"></p>
      <p id="module-assignment-error" class="coral" role="alert" hidden></p>
      <button type="button" id="module-assignment-configure" class="quiet-button">Open Project configuration</button>
      <button type="button" id="module-assignment-reload" class="quiet-button">Reload assignment (discard selection)</button>
      <footer class="dialog-actions"><button type="button" id="module-assignment-cancel" class="button secondary">Cancel</button>
      <button type="button" id="module-assignment-apply" class="button primary">Apply</button></footer>`;
    document.body.append(this.dialog);
    this.el<HTMLButtonElement>('#module-assignment-inherit').onclick = () => { this.inherit = true; this.explicit = true; this.update(); };
    this.el<HTMLButtonElement>('#module-assignment-none').onclick = () => { this.inherit = false; this.explicit = true; this.selected.clear(); this.checkboxes(); this.update(); };
    this.el<HTMLButtonElement>('#module-assignment-cancel').onclick = () => this.cancel();
    this.el<HTMLButtonElement>('#module-assignment-apply').onclick = () => { void this.apply(); };
    this.el<HTMLButtonElement>('#module-assignment-reload').onclick = () => { void this.reload(); };
    this.el<HTMLButtonElement>('#module-assignment-configure').onclick = () => { this.cancel(); this.host.configure(); };
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.cancel(); });
    this.dialog.addEventListener('close', () => { this.loaded = undefined; this.reloading = false; this.host.focus(this.id); });
  }
  private el<T extends HTMLElement = HTMLElement>(selector: string) { return this.dialog.querySelector<T>(selector)!; }
  private error(message = '') { this.el('#module-assignment-error').textContent = message; this.el('#module-assignment-error').hidden = !message; }
  private cancel() { if (!this.saving) this.dialog.close(); }
  private assignment(context: ConfigurationContext): ModuleAssignment | undefined { return context.baseline?.definitions.find(item => idKey(item) === this.id)?.moduleAssignment; }
  show(id: string) {
    if (this.saving || document.querySelector('dialog[open]')) return;
    const context = this.host.context();
    if (!context || context.busy || !context.baseline?.definitions.some(item => idKey(item) === id)) { this.host.notify('The index changed. Wait for refresh and reopen Edit modules.'); return; }
    this.id = id; this.initialize(context); this.dialog.showModal(); this.update();
  }
  private initialize(context: ConfigurationContext) {
    this.loaded = structuredClone(context); this.lastProblem = undefined; this.error(); this.inherit = false;
    const assignment = this.assignment(context);
    this.explicit = assignment?.state !== 'conflict';
    this.selected = new Set(assignment?.modules.map(module => module.key) ?? []);
    this.el('#module-assignment-title').textContent = `Edit modules for ${keyLabel(this.id)}`;
    const overridden = context.state.configuration.moduleOverrides?.some(item => idKey(item) === this.id);
    this.el('#module-assignment-current').textContent = `${overridden ? 'Exact-ID override' : 'File/folder assignments'}: ${assignment?.state === 'conflict' ? 'Module conflict: choose modules explicitly or use file/folder assignments.' : assignment?.modules.map(module => module.name).join(', ') || 'Unassigned'}`;
    this.el('#module-assignment-evidence').textContent = assignment?.evidence.map(e => `${e.source?.file ?? keyLabel(this.id)}: ${e.modules.map(m => m.name).join(', ') || 'Unassigned'}`).join('; ') ?? '';
    const options = this.el('#module-assignment-options'); options.replaceChildren();
    (context.state.configuration.modules ?? []).forEach((module, i) => {
      const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = module.key;
      input.checked = this.selected.has(module.key);
      input.onchange = () => { this.inherit = false; this.explicit = true; if (input.checked) this.selected.add(module.key); else this.selected.delete(module.key); this.update(); };
      label.append(input, `${i + 1}. ${module.name}`); options.append(label);
    });
    if (!options.childElementCount) options.textContent = 'No modules configured. Open Project configuration and choose Application modules to create one.';
  }
  private checkboxes() { this.dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => { input.checked = this.selected.has(input.value); }); }
  private problem(context = this.host.context()): string | undefined {
    if (!context || context.projectId !== this.loaded?.projectId) return 'The active project changed. Reopen Edit modules in the current project.';
    if (this.host.hasConfigurationDraft()) return 'Apply or cancel the existing Project configuration draft before editing modules here. Open Project configuration to resume it.';
    if (context.state.diskVersion !== this.loaded.state.diskVersion || context.state.revision !== this.loaded.state.revision) return 'Project configuration changed. Reload assignment to review the current settings.';
    if (context.state.warning) return 'Repair the project configuration in Application modules before saving a card assignment.';
    if (!sameDocuments(context.documents, this.loaded.documents)) return 'Markdown changed. Reload assignment to review current file/folder assignments.';
    if (!context.baseline?.definitions.some(item => idKey(item) === this.id)) return 'The index is refreshing or this ID is no longer defined. Reload assignment after refresh.';
    return undefined;
  }
  update() {
    if (!this.dialog.open || !this.loaded) return;
    const context = this.host.context();
    if (!context || context.projectId !== this.loaded.projectId) { this.dialog.close(); return; }
    if (this.reloading && !context.busy && context.baseline) {
      this.reloading = false;
      if (context.baseline.definitions.some(item => idKey(item) === this.id)) this.initialize(context);
      else this.error('This ID is no longer defined. Cancel and choose a current card.');
    }
    const problem = this.problem(context);
    if (!this.saving) {
      if (problem) this.error(problem);
      else if (this.el('#module-assignment-error').textContent === this.lastProblem) this.error();
      this.lastProblem = problem;
    }
    if (this.reloading && !context.busy && !context.baseline && context.baselineNotice !== 'Updating the Markdown index...') this.reloading = false;
    this.el<HTMLFieldSetElement>('#module-assignment-fields').disabled = this.saving || this.reloading;
    for (const action of ['cancel', 'reload', 'configure']) this.el<HTMLButtonElement>(`#module-assignment-${action}`).disabled = this.saving;
    this.el<HTMLButtonElement>('#module-assignment-apply').disabled = this.saving || this.reloading || context.busy || !!problem || !this.explicit;
    this.el('#module-assignment-summary').textContent = this.saving ? 'Saving module assignment...' : this.inherit ? 'Apply will remove the override and restore file/folder assignments, including any conflicts.' : !this.explicit ? 'Choose modules explicitly to resolve the conflict.' : this.selected.size ? 'Apply will save the selected modules for this ID. Markdown stays unchanged.' : 'Apply will explicitly unassign this ID, overriding file/folder assignments.';
  }
  private async reload() {
    if (this.saving) return;
    const loaded = this.loaded;
    try {
      this.reloading = true;
      await this.host.refresh(); const context = this.host.context();
      if (!this.dialog.open || !context || context.projectId !== loaded?.projectId) return;
      this.update();
    } catch (error) { this.reloading = false; this.error(String(error)); this.update(); }
  }
  private async apply() {
    const loaded = this.loaded;
    if (this.saving || this.reloading || !loaded || !this.explicit || this.host.context()?.busy || this.problem()) return;
    this.saving = true; this.error(); this.update();
    try {
      // The main-process save rechecks disk versions and active project before atomic persistence.
      if (!this.dialog.open || this.loaded !== loaded) return;
      const problem = this.problem(); if (problem) throw new Error(problem);
      const context = this.host.context()!;
      const configuration = structuredClone(loaded.state.configuration);
      configuration.moduleOverrides = (configuration.moduleOverrides ?? []).filter(item => idKey(item) !== this.id);
      if (!this.inherit) configuration.moduleOverrides.push({ ...identityFromKey(this.id), modules: [...this.selected] });
      const validated = validateIdConfiguration(configuration);
      const result = await this.host.save(context.root, validated, loaded.state.diskVersion, context.documentVersions);
      if (!result.ok) throw new Error(result.message ?? 'Could not save module assignment.');
      this.dialog.close();
      try { await this.host.refresh(); }
      catch { this.host.notify('Module assignment saved. Refresh the project to load its updated index.'); }
      this.host.focus(this.id);
    } catch (error) { if (this.dialog.open) this.error(error instanceof Error ? error.message : String(error)); }
    finally { this.saving = false; this.update(); }
  }
}
