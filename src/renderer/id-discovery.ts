import { candidateProposal, DISCOVERY_COVERAGE, mergeProposal, validateProposal, type ConventionProposal, type ConventionSuggestion } from '../core/id-discovery';
import { IndexWorker, type IndexResponse } from '../core/index-worker';
import { ruleRegex, type IdConfiguration } from '../core/id-configuration';
import type { ConfigurationContext } from './project-configuration';
import type { SourceLocation } from '../shared/types';
import { categoryDefinitionSites } from './definition-sites';
import { configurationEntry } from './configuration-entry';
import type { DiscoveryCategoryDecision } from '../core/discovery-category-classification';
import { AgentDiscoveryPanel } from './agent-discovery';
interface DiscoveryHost {
  setupAgent(): void;
  agentPath(kind: 'codex' | 'claude'): string;
  context(): ConfigurationContext | undefined;
  draft(): IdConfiguration;
  reviewChanged(): void;
  stage(draft: IdConfiguration): void;
  source(location: SourceLocation, text: string, valid: () => boolean): void;
}
export class IdDiscoveryEditor {
  readonly root = document.createElement('section');
  private worker = new IndexWorker(() => new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' }), result => this.receive(result));
  private serial = 0;
  private pending?: number;
  private baseline?: { context: ConfigurationContext; draft: string };
  private proposal?: ConventionProposal;
  private decisions = new Map<string, DiscoveryCategoryDecision>();
  private classificationMessage = '';
  private stageAfterClassification = false;
  private scope = new Set<string>();
  private files: string[] = [];
  private message = document.createElement('p');
  private review = document.createElement('div');
  private remainingCount = document.createElement('span');
  private scopeList = document.createElement('div');
  private scopeSummary = document.createElement('span');
  private stageButton = this.button('Add suggestions to draft', () => this.stage());
  private deleteAllButton = this.button('Delete all suggestions', () => this.deleteSuggestions());
  private selectAllButton = this.button('Select all', () => this.setScope(this.files));
  private deselectAllButton = this.button('Deselect all', () => this.setScope([]));
  private scopeInputs = new Map<string, HTMLInputElement>();
  private scopeFolders: { input: HTMLInputElement; files: string[] }[] = [];
  private scanButton = this.button('Discover by patterns', () => this.scan());
  private importFile = document.createElement('input');
  private agent: AgentDiscoveryPanel;
  constructor(private host: DiscoveryHost) {
    this.agent = new AgentDiscoveryPanel(host);
    this.root.id = 'config-discovery'; this.message.id = 'discovery-status'; this.message.setAttribute('role', 'status'); this.review.id = 'discovery-review';
    const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'Each discovery action replaces the current suggestions. Delete unwanted suggestions, edit the remaining ones, then use Add suggestions to draft before Preview matches and Apply. Existing rules are retained.';
    const coverage = document.createElement('p'); coverage.className = 'config-hint'; coverage.textContent = DISCOVERY_COVERAGE;
    const scope = document.createElement('details'); const scopeTitle = document.createElement('summary'); scopeTitle.className = 'discovery-scope-heading'; const scopeLabel = document.createElement('span'); scopeLabel.textContent = 'Markdown scope'; scopeTitle.append(scopeLabel, this.scopeSummary); const scopeActions = document.createElement('div'); scopeActions.className = 'discovery-scope-actions'; scopeActions.append(this.selectAllButton, this.deselectAllButton);
    scope.id = 'discovery-markdown-scope'; scope.className = 'discovery-method';
    const scopeBody = document.createElement('div'); scopeBody.className = 'discovery-method-body';
    this.scopeList.id = 'discovery-scope-files'; scopeBody.append(scopeActions, this.scopeList); scope.append(scopeTitle, scopeBody);
    this.scopeSummary.className = 'config-hint'; this.scopeSummary.id = 'discovery-scope-summary'; this.scopeSummary.setAttribute('aria-live', 'polite');
    const imported = document.createElement('details'); const importTitle = document.createElement('summary'); importTitle.textContent = 'Import proposal JSON (optional)';
    imported.className = 'discovery-method';
    this.importFile.type = 'file'; this.importFile.accept = '.json,application/json'; this.importFile.setAttribute('aria-label', 'Convention proposal file');
    const importHelp = document.createElement('p'); importHelp.className = 'config-hint'; importHelp.textContent = 'Choose a prepared proposal file to review its names, patterns, and source examples. Discover by patterns returns suggestions directly, and Discover with an agent has its own review; no import is needed.';
    const importBody = document.createElement('div'); importBody.className = 'discovery-method-body';
    importBody.append(importHelp, this.importFile, this.button('Review imported proposal', () => { void this.importProposal(); }));
    imported.append(importTitle, importBody);
    this.stageButton.className = 'button primary'; this.scanButton.className = 'button secondary';
    const section = (id: string, title: string, ...content: HTMLElement[]) => {
      const details = document.createElement('details'); details.id = id; details.className = 'discovery-method';
      const summary = document.createElement('summary'); summary.textContent = title;
      const body = document.createElement('div'); body.className = 'discovery-method-body'; body.append(...content);
      details.append(summary, body); return details;
    };
    const cancel = () => this.button('Cancel discovery', () => { this.resetResults(); this.message.textContent = 'Discovery cancelled. No configuration was changed.'; });
    const patternHelp = document.createElement('p'); patternHelp.className = 'config-hint'; patternHelp.textContent = 'Discover by patterns uses fixed local heuristics and works offline. It uses the selected Markdown scope.';
    const patternActions = document.createElement('div'); patternActions.className = 'discovery-method-actions'; patternActions.append(this.scanButton, cancel());
    const patterns = section('discovery-patterns', 'Discover by patterns', patternHelp, coverage, patternActions);
    const actions = document.createElement('div'); actions.className = 'discovery-actions'; this.remainingCount.id = 'discovery-remaining'; this.remainingCount.textContent = '0 suggestions remaining';
    actions.append(this.stageButton, this.deleteAllButton, this.remainingCount);
    const candidates = document.createElement('section'); candidates.className = 'discovery-candidates'; candidates.setAttribute('aria-labelledby', 'discovery-candidates-title');
    const candidatesTitle = document.createElement('h3'); candidatesTitle.id = 'discovery-candidates-title'; candidatesTitle.textContent = 'Candidate suggestions';
    candidates.append(candidatesTitle, hint, this.message, actions, this.review);
    this.root.append(this.agent.root, scope, patterns, imported, candidates);
    this.stageButton.disabled = this.deleteAllButton.disabled = true;
  }
  private button(label: string, action: () => void) { const b = document.createElement('button'); b.type = 'button'; b.className = 'quiet-button'; b.textContent = label; b.onclick = action; return b; }
  private field(label: string, value: string, change: (value: string) => void, max = 128) {
    const wrapper = document.createElement('label'); wrapper.textContent = label; const input = document.createElement('input'); input.value = value; input.maxLength = max; input.setAttribute('aria-label', label); input.oninput = () => { change(input.value); this.host.reviewChanged(); }; wrapper.append(input); return wrapper;
  }
  reset() {
    this.resetResults(); this.importFile.value = ''; this.message.textContent = '';
    const files = Object.keys(this.host.context()?.documents ?? {}); this.files = files; this.scope = new Set(files);
    this.renderScopeTree();
    this.updateScopeSummary();
  }
  private renderScopeTree() {
    interface Folder { folders: Map<string, Folder>; files: string[]; descendants: string[] }
    const folder = (): Folder => ({ folders: new Map(), files: [], descendants: [] });
    const root = folder();
    for (const file of this.files) {
      let node = root; node.descendants.push(file);
      for (const part of file.split('/').slice(0, -1)) {
        if (!node.folders.has(part)) node.folders.set(part, folder());
        node = node.folders.get(part)!; node.descendants.push(file);
      }
      node.files.push(file);
    }
    this.scopeInputs.clear(); this.scopeFolders = [];
    const select = (files: string[], checked: boolean) => {
      const next = new Set(this.scope);
      for (const file of files) { if (checked) next.add(file); else next.delete(file); }
      this.setScope(next);
    };
    const render = (node: Folder, path = ''): HTMLElement => {
      const list = document.createElement('ul'); list.className = 'discovery-scope-tree';
      for (const [name, child] of [...node.folders].sort(([a], [b]) => a.localeCompare(b))) {
        const fullPath = path ? `${path}/${name}` : name;
        const item = document.createElement('li'), details = document.createElement('details'), summary = document.createElement('summary');
        details.dataset.folder = fullPath;
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.setAttribute('aria-label', `Folder ${fullPath}`);
        input.onclick = event => event.stopPropagation(); input.onchange = () => select(child.descendants, input.checked);
        this.scopeFolders.push({ input, files: child.descendants });
        const label = document.createElement('span'); label.textContent = name;
        summary.append(input, label); details.append(summary, render(child, fullPath)); item.append(details); list.append(item);
      }
      for (const file of [...node.files].sort((a, b) => a.localeCompare(b))) {
        const item = document.createElement('li'), label = document.createElement('label'); label.className = 'config-checkbox';
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.dataset.scopeFile = file; input.setAttribute('aria-label', file);
        this.scopeInputs.set(file, input); input.onchange = () => select([file], input.checked);
        label.append(input, file.split('/').at(-1)!); item.append(label); list.append(item);
      }
      return list;
    };
    this.scopeList.replaceChildren(render(root));
  }
  private setScope(files: Iterable<string>) {
    const next = new Set(files);
    if (next.size === this.scope.size && [...next].every(file => this.scope.has(file))) return;
    this.scope = next;
    for (const [file, input] of this.scopeInputs) input.checked = next.has(file);
    for (const { input, files } of this.scopeFolders) {
      const count = files.filter(file => next.has(file)).length;
      input.checked = count === files.length; input.indeterminate = count > 0 && count < files.length;
    }
    this.resetResults(); this.updateScopeSummary(); this.message.textContent = 'Scope changed. Scan or import again.';
  }
  private updateScopeSummary() {
    this.selectAllButton.disabled = this.scope.size === this.files.length; this.deselectAllButton.disabled = !this.scope.size;
    const documents = this.host.context()?.documents ?? {};
    const size = [...this.scope].reduce((n, file) => n + (documents[file]?.length ?? 0), 0);
    this.scopeSummary.textContent = `${this.scope.size} of ${this.files.length} Markdown files selected · ${size.toLocaleString()} characters.`;
  }
  dispose() { this.resetResults(); this.agent.dispose(); }
  private resetResults() { this.serial++; this.updateScopeSummary(); this.worker.dispose(); this.pending = undefined; this.baseline = undefined; this.proposal = undefined; this.decisions.clear(); this.classificationMessage = ''; this.stageAfterClassification = false; this.remainingCount.textContent = '0 suggestions remaining'; this.review.replaceChildren(); this.stageButton.disabled = this.deleteAllButton.disabled = true; this.scanButton.disabled = false; }
  private async importProposal() {
    const file = this.importFile.files?.[0]; this.resetResults(); const revision = this.serial;
    try {
      this.capture();
      if (!file) throw new Error('Choose a proposal JSON file.');
      if (file.size > 256 * 1024) throw new Error('Proposal exceeds 256 KB.');
      const text = await file.text();
      if (revision !== this.serial) return;
      if (!this.fresh()) { this.update(); return; }
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new Error('Proposal file contains invalid JSON.'); }
      this.proposal = validateProposal(value, this.documents());
      this.classifyProposal(`Imported ${this.proposal.suggestions.length} suggestions.`, false);
    } catch (error) { if (revision === this.serial) this.message.textContent = String(error); }
  }
  private capture() {
    const context = this.host.context(); if (!context) throw new Error('Open a project before discovery.');
    this.baseline = { context: structuredClone(context), draft: JSON.stringify(this.host.draft()) };
  }
  private documents() { return Object.fromEntries(Object.entries(this.baseline!.context.documents).filter(([file]) => this.scope.has(file))); }
  private fresh() {
    const current = this.host.context(), before = this.baseline;
    return !!current && !!before && current.projectId === before.context.projectId && current.state.diskVersion === before.context.state.diskVersion && JSON.stringify(this.host.draft()) === before.draft && Object.keys(current.documents).length === Object.keys(before.context.documents).length && Object.entries(current.documents).every(([file, text]) => before.context.documents[file] === text);
  }
  update() {
    this.updateScopeSummary(); this.agent.update();
    if (Object.keys(this.host.context()?.documents ?? {}).join('\0') !== this.files.join('\0')) {
      this.reset(); this.message.textContent = 'Markdown file list changed. Scope refreshed; scan or import again.'; return;
    }
    if (this.baseline && !this.fresh()) { this.resetResults(); this.message.textContent = 'Markdown, project, or configuration draft changed. Scan or import again before using suggestions.'; }
  }
  private scan() {
    this.resetResults();
    try {
      this.capture(); if (!this.scope.size) throw new Error('Select at least one Markdown file.');
      this.pending = ++this.serial; this.scanButton.disabled = true; this.message.textContent = `Scanning ${Object.keys(this.documents()).length} Markdown files...`;
      this.worker.run({ revision: this.pending, discover: true, documents: this.documents() });
    } catch (error) { this.message.textContent = String(error); this.pending = undefined; this.scanButton.disabled = false; }
  }
  private receive(result: IndexResponse) {
    if (result.revision !== this.pending) return;
    this.pending = undefined; this.scanButton.disabled = false;
    if (!this.fresh()) { this.update(); return; }
    if (result.classifications) {
      if (!this.proposal || result.classifications.length !== this.proposal.suggestions.length) {
        this.message.textContent = 'Discovery classification returned an incomplete result. Scan or import again.'; return;
      }
      const original = this.proposal.suggestions;
      const existing = result.classifications.filter(decision => decision.kind === 'existing').length;
      this.decisions = new Map(original.map((suggestion, index) => [suggestion.key, result.classifications![index]]));
      this.proposal.suggestions = original.filter((_, index) => result.classifications![index].kind !== 'existing');
      const ambiguous = this.proposal.suggestions.filter(suggestion => this.decisions.get(suggestion.key)?.kind === 'ambiguous').length;
      if (!this.proposal.suggestions.length) {
        this.message.textContent = original.length
          ? `No new categories found. Omitted ${existing} existing ${existing === 1 ? 'category' : 'categories'} from the current draft.`
          : 'No new categories found. The proposal contained no suggestions.';
        this.renderReview(); return;
      }
      this.message.textContent = this.classificationMessage
        + (existing ? ` Omitted ${existing} existing ${existing === 1 ? 'category' : 'categories'}.` : '')
        + (ambiguous ? ` ${ambiguous} ambiguous ${ambiguous === 1 ? 'suggestion remains' : 'suggestions remain'} for explicit review.` : '')
        + ' Review the new suggestions before adding them to the draft. Nothing is applied.';
      this.renderReview();
      if (this.stageAfterClassification) {
        if (this.proposal.suggestions.some(suggestion => {
          const decision = this.decisions.get(suggestion.key);
          return decision?.kind === 'ambiguous' && decision.reason === 'equivalent-rule-evidence-mismatch';
        })) {
          this.message.textContent = 'Cannot add suggestions: an edited rule duplicates an existing convention but does not match its own evidence. Correct or delete it; no draft changes were made.';
        } else this.commitStage();
      }
      return;
    }
    if (result.error || !result.inventory) { this.message.textContent = result.error ?? 'Discovery returned no inventory.'; return; }
    this.proposal = candidateProposal(result.inventory);
    // Avoid collisions with previous discovery drafts or project-defined keys.
    const used = new Set([...this.host.draft().categories, ...this.host.draft().rules].map(v => v.key));
    const renamed = new Map<string, string>();
    for (const suggestion of this.proposal.suggestions) {
      const base = suggestion.key; let key = base, n = 2; while (used.has(key)) key = `${base}-${n++}`; used.add(key);
      renamed.set(suggestion.category.key, key);
      suggestion.key = suggestion.category.key = key;
      if (suggestion.rule) suggestion.rule.key = suggestion.rule.category = key;
    }
    // Keyword suggestions (85c) refer to their parent and capability suggestions by key.
    for (const { category } of this.proposal.suggestions) {
      if (category.parent) category.parent = renamed.get(category.parent) ?? category.parent;
      if (category.changes?.capabilities) category.changes.capabilities = renamed.get(category.changes.capabilities) ?? category.changes.capabilities;
    }
    this.classifyProposal(`Found ${this.proposal.suggestions.length} candidate groups in ${result.inventory.files.length} files (${result.inventory.occurrences} occurrences).`, false);
  }
  private classifyProposal(message: string, stage: boolean) {
    if (!this.proposal) return;
    this.classificationMessage = message; this.stageAfterClassification = stage; this.decisions.clear();
    this.review.replaceChildren(); this.stageButton.disabled = this.deleteAllButton.disabled = true;
    this.pending = ++this.serial; this.message.textContent = message + ' Checking existing categories in the current draft...';
    this.worker.run({ revision: this.pending, classify: structuredClone(this.proposal), configuration: structuredClone(this.host.draft()), documents: this.documents() });
  }
  private renderReview() {
    this.proposal!.suggestions.sort((a, b) =>
      (a.evidence[0]?.id ?? a.category.name).localeCompare(b.evidence[0]?.id ?? b.category.name, undefined, { sensitivity: 'base', numeric: true }));
    this.review.replaceChildren(...this.proposal!.suggestions.map(suggestion => {
      const body = document.createElement('div'); body.className = 'discovery-suggestion'; body.dataset.suggestion = suggestion.key;
      const decision = this.decisions.get(suggestion.key);
      if (decision?.kind === 'ambiguous') {
        const warning = document.createElement('p'); warning.className = 'discovery-ambiguous';
        warning.textContent = this.ambiguityMessage(decision.reason); body.append(warning);
      }
      const reason = document.createElement('p'); reason.textContent = suggestion.uncertainty;
      const name = this.field('Category display name', suggestion.category.name, value => { suggestion.category.name = value; });
      const role = document.createElement('select'); role.setAttribute('aria-label', 'Suggested role'); for (const [value, label] of [['', 'Custom / no role'], ['requirement', 'Requirement'], ['design', 'Design'], ['task', 'Task']]) role.add(new Option(label, value)); role.value = suggestion.category.role ?? '';
      role.onchange = () => { if (role.value) suggestion.category.role = role.value as 'requirement' | 'design' | 'task'; else delete suggestion.category.role; this.host.reviewChanged(); };
      const roleLabel = document.createElement('label'); roleLabel.textContent = 'Role'; roleLabel.append(role);
      body.append(reason, name, roleLabel);
      const rule = suggestion.rule;
      if (rule) body.append(this.field('Suggested regex', rule.pattern ?? ruleRegex(rule).source, value => { delete rule.prefix; delete rule.separator; rule.pattern = value; }, 512));
      else body.append(this.conventionSummary(suggestion));
      body.append(categoryDefinitionSites(suggestion.category, () => this.host.draft(), () => this.host.reviewChanged()));
      const modules = document.createElement('p'); modules.textContent = suggestion.modules?.length ? `Proposed modules: ${suggestion.modules.map(m => m.name).join(', ')}. File rules: ${suggestion.moduleRules?.map(r => r.path).join(', ') || 'none'}. Edit these in Application modules after adding to the draft.` : 'Module not inferred. Assign modules in Application modules after adding to the draft.'; body.append(modules);
      for (const evidence of suggestion.evidence) body.append(this.button(`${evidence.id} - ${evidence.file} (${evidence.context})`, () => {
        if (!this.fresh()) { this.update(); return; }
        const text = this.baseline!.context.documents[evidence.file], head = text.slice(0, evidence.offset);
        this.host.source({ file: evidence.file, offset: evidence.offset, end: evidence.end, line: head.split('\n').length, column: evidence.offset - head.lastIndexOf('\n') }, text, () => this.fresh());
      }));
      return configurationEntry(suggestion, body, () => this.suggestionTitle(suggestion), false, this.button('Delete', () => this.deleteSuggestions(suggestion)));
    }));
    this.updateReviewActions();
  }
  private ambiguityMessage(reason: Extract<DiscoveryCategoryDecision, { kind: 'ambiguous' }>['reason']) {
    return ({
      'display-name-collision': 'Ambiguous: this display name is already used, but the recognition rule is different. Review it as a new category or delete it.',
      'partial-evidence-coverage': 'Ambiguous: only part of the evidence is recognized by the current draft. Review the proposed rule or delete it.',
      'multiple-existing-categories': 'Ambiguous: the evidence or equivalent rules belong to multiple existing categories. Review it without merging automatically.',
      'different-rule-for-existing-evidence': 'Ambiguous: the examples are recognized, but this proposed rule is different or wider. Review it as a new category or delete it.',
      'equivalent-rule-evidence-mismatch': 'Ambiguous: this rule duplicates an existing convention but does not match its own evidence. Correct or delete it; it cannot be staged.',
      'proposal-category-collision': 'Ambiguous: proposal entries reuse one category identity with conflicting metadata. Delete or correct the conflicting suggestions.',
    })[reason];
  }
  get remainingSuggestions() { return this.proposal?.suggestions.length ?? 0; }
  private suggestionTitle(suggestion: ConventionSuggestion) {
    return (this.proposal!.suggestions.indexOf(suggestion) + 1) + '. ' + (suggestion.evidence[0]?.id ?? suggestion.category.name) + ' - ' + suggestion.category.name;
  }
  private updateReviewActions() {
    this.remainingCount.textContent = this.remainingSuggestions + ' suggestions remaining';
    this.stageButton.disabled = this.deleteAllButton.disabled = !this.remainingSuggestions || !this.fresh();
  }
  /** 85c: what a keyword or derived suggestion defines, instead of a regex. */
  private conventionSummary(suggestion: ConventionSuggestion) {
    const { category } = suggestion, headings = category.idDefinitionSites?.headings, other = (key?: string) => this.proposal!.suggestions.find(item => item.category.key === key)?.category.name ?? key;
    const lines = [
      ...(headings?.mode === 'keyword' ? [`Keyword heading: "${headings.keyword}: <name>" at level ${headings.levels.join(', ')}.`] : []),
      ...(category.parent ? [`Identified within its ${other(category.parent)} heading.`] : []),
      ...(category.idScopes?.length ? [`Scopes: ${category.idScopes.map(scope => scope.pattern).join(', ')}.`] : []),
      ...(category.derive ? [`Derived from files matching ${category.derive.pattern}.`] : []),
      ...(category.changes ? [`Changes: Active, or Archived inside archive folders${category.changes.capabilities ? `; proposals declare ${other(category.changes.capabilities)} elements` : ''}.`] : []),
      ...(category.deltas ? ['Records ADDED/MODIFIED/REMOVED/RENAMED sections of changes.'] : []),
      ...(category.nameReferences ? ['Backticked names refer to these elements.'] : []),
    ];
    const summary = document.createElement('p'); summary.className = 'discovery-convention'; summary.textContent = lines.join(' ');
    return summary;
  }
  private deleteSuggestions(suggestion?: ConventionSuggestion) {
    if (!this.fresh()) { this.update(); return; }
    const suggestions = this.proposal!.suggestions;
    const index = suggestion ? suggestions.indexOf(suggestion) : 0;
    if (index < 0 || !suggestions.length) return;
    if (suggestion) {
      suggestions.splice(index, 1);
      this.review.children[index].remove();
      // 85c: children and changes no longer refer to a deleted suggestion.
      for (const { category } of suggestions) {
        if (category.parent === suggestion.category.key) delete category.parent;
        if (category.changes?.capabilities === suggestion.category.key) delete category.changes.capabilities;
      }
    } else { suggestions.length = 0; this.review.replaceChildren(); }
    // Keep surviving editors in place: names, roles, regexes and expansion stay intact.
    [...this.review.children].forEach((entry, i) => { entry.querySelector('.config-entry-title')!.textContent = this.suggestionTitle(suggestions[i]); });
    this.updateReviewActions(); this.host.reviewChanged();
    this.message.textContent = this.remainingSuggestions
      ? 'Deleted from this review only. Edit the remaining suggestions, then Add suggestions to draft.'
      : 'No suggestions remain. Scan or import again to start a new review. Configuration and Markdown are unchanged.';
    const next = this.review.children[Math.min(index, this.review.children.length - 1)];
    (next?.querySelector<HTMLElement>('summary') ?? (this.scanButton.closest('details')!.open ? this.scanButton : this.scanButton.closest('details')!.querySelector<HTMLElement>('summary')!)).focus();
  }
  private stage() {
    try {
      if (!this.fresh()) { this.update(); return; }
      this.proposal = validateProposal(this.proposal, this.documents());
      if (!this.proposal.suggestions.length) throw new Error('No suggestions remain to add.');
      // Reclassify edited names/rules immediately before staging so an edit cannot
      // recreate an equivalent category that the initial review omitted.
      this.classifyProposal('Rechecked edited suggestions.', true);
    } catch (error) { this.message.textContent = String(error); }
  }
  private commitStage() {
    try {
      if (!this.fresh()) { this.update(); return; }
      const proposal = validateProposal(this.proposal, this.documents());
      if (!proposal.suggestions.length) throw new Error('No new suggestions remain to add.');
      const base = this.host.draft(); const draft = mergeProposal(base, proposal);
      const categories = draft.categories.filter(c => !base.categories.some(old => old.key === c.key));
      const rules = draft.rules.filter(r => !base.rules.some(old => old.key === r.key));
      const added = `Added ${categories.length} categories: ${categories.map(c => c.name).join(', ')}; ${rules.length} ID recognition rules.`;
      this.resetResults(); this.host.stage(draft); this.message.textContent = added + ' Review each category and its recognition rules in Categories. Preview matches and Apply saves the draft. Nothing has been saved yet.';
    } catch (error) { this.message.textContent = String(error); }
  }

}
