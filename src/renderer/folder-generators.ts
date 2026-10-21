import type { FolderPreview, GeneratorTarget } from '../core/folder-generators';
import type { IdConfiguration } from '../core/id-configuration';

/** Generator settings share the configuration draft; Update stages mappings, Apply persists them. */
export class FolderGeneratorEditor {
  readonly root = document.createElement('section');
  constructor(readonly target: GeneratorTarget, private draft: () => IdConfiguration, private changed: () => void, private preview: () => void, private update: () => void) {
    this.root.id = `config-folder-${target}`; this.root.className = 'folder-generators'; this.render();
  }
  private get rules() { return (this.draft().folderGenerators ?? []).filter(rule => rule.target === this.target); }
  settings() { return structuredClone(this.rules); }
  reset() { this.render(); }
  private button(text: string, action: () => void) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = text; button.onclick = action; return button;
  }
  render() {
    const title = document.createElement('h3'); title.textContent = `Folder-derived ${this.target}`;
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = 'One entry per immediate child folder, including IDs defined in descendant Markdown. Update stages entries and mappings in this draft. Preview matches and Apply save the reviewed changes. New folders require another Update.';
    const add = this.button('Add folder pattern', () => {
      const config = this.draft(), used = new Set([...(config.folderGenerators ?? []).map(rule => rule.key), ...(config.generatedFolders ?? []).map(mapping => mapping.generator)]);
      let n = 1; while (used.has(`generator${n}`)) n++;
      (config.folderGenerators ??= []).push({ key: `generator${n}`, target: this.target, pattern: 'specs/*', exclusions: [] }); this.render(); this.changed();
      this.root.querySelector<HTMLInputElement>('.folder-generator-row:last-of-type input')?.focus();
    }); add.disabled = this.rules.length >= 32;
    this.root.replaceChildren(title, hint, add);
    for (const rule of this.rules) {
      const row = document.createElement('div'); row.className = 'folder-generator-row';
      const label = document.createElement('label'); label.textContent = 'Folder pattern';
      const input = document.createElement('input'); input.type = 'text'; input.value = rule.pattern; input.maxLength = 4098; input.setAttribute('aria-label', 'Folder pattern');
      input.oninput = () => { rule.pattern = input.value; this.changed(); }; label.append(input);
      const excluded = document.createElement('label'); excluded.textContent = 'Excluded folders (one per line)';
      const textarea = document.createElement('textarea'); textarea.rows = 2; textarea.maxLength = 65536; textarea.value = rule.exclusions.join('\n'); textarea.setAttribute('aria-label', 'Excluded folders (one per line)');
      textarea.oninput = () => { rule.exclusions = textarea.value.split('\n').map(path => path.trim()).filter(Boolean); this.changed(); }; excluded.append(textarea);
      row.append(label, excluded, this.button('Remove folder pattern', () => { this.draft().folderGenerators = this.draft().folderGenerators!.filter(item => item !== rule); this.render(); this.changed(); this.root.querySelector<HTMLButtonElement>('button')?.focus(); })); this.root.append(row);
    }
    const available = this.rules.length || this.draft().generatedFolders?.some(mapping => mapping.target === this.target);
    const preview = this.button(`Preview folder ${this.target}`, this.preview); preview.classList.add('folder-generator-preview'); preview.disabled = !available;
    const update = this.button(`Update ${this.target}`, this.update); update.classList.add('folder-generator-update'); update.disabled = !available; this.root.append(preview, update);
  }
  renderPreview(result: FolderPreview, root: HTMLElement) {
    this.render();
    const note = document.createElement('p'); note.className = 'config-hint';
    note.textContent = 'Changes compare with generated entries in the configuration draft. Manual entries and exact-ID overrides are preserved. Missing or excluded folders retain their saved mappings; remove unwanted entries explicitly. Renames are never inferred.';
    root.replaceChildren(note);
    for (const notice of result.notices) { const p = document.createElement('p'); p.textContent = notice; root.append(p); }
    for (const entry of result.entries) {
      const section = document.createElement('section'); section.className = 'folder-preview-entry';
      const heading = document.createElement('h4'); heading.textContent = `${entry.name} — ${entry.change === 'retained' ? 'Removal / possible rename: retained' : entry.change}`;
      const mapping = document.createElement('p'); mapping.textContent = `${entry.pattern} → ${entry.provenance.folder}/ and descendants · ${entry.files} Markdown files · ${entry.members.filter(member => member.state === 'assigned').length} assigned IDs`;
      if (entry.change === 'retained') mapping.textContent = `${entry.pattern} → ${entry.provenance.folder}/ and descendants. Saved mapping retained unchanged; Preview matches shows its current assignments.`;
      section.append(heading, mapping);
      for (const issue of entry.issues) { const p = document.createElement('p'); p.className = 'config-warning'; p.textContent = issue; section.append(p); }
      if (entry.members.length) {
        const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = `Affected IDs (${entry.members.length})`; details.append(summary);
        const list = document.createElement('ul'), controls = document.createElement('div'); let page = 0;
        const render = () => {
          list.replaceChildren(...entry.members.slice(page * 50, (page + 1) * 50).map(member => {
            const item = document.createElement('li'); item.textContent = `${member.label} — ${member.state === 'override' ? 'Exact override preserved; generated membership skipped' : member.state === 'conflict' ? 'Conflicting definitions; no generated membership' : 'Assigned'} · ${member.sources.join(', ')}`; return item;
          }));
          const previous = this.button('Previous IDs', () => { page--; render(); }), next = this.button('Next IDs', () => { page++; render(); });
          previous.disabled = page === 0; next.disabled = (page + 1) * 50 >= entry.members.length;
          controls.replaceChildren(previous, document.createTextNode(` ${page * 50 + 1}–${Math.min((page + 1) * 50, entry.members.length)} of ${entry.members.length} `), next); controls.hidden = entry.members.length <= 50;
        };
        render(); details.append(list, controls); section.append(details);
      }
      root.append(section);
    }
  }
}
