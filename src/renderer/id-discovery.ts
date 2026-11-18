import { discoveryProviders, type DiscoveryPluginInfo } from '../core/discovery-profiles';
import { candidateProposal, existingCategoryTags, mergeProposal, pluginProposal, validateProposal, type CandidateEvidence, type ProviderGap, type ConventionProposal, type ConventionSuggestion, type ExclusionSuggestion, type FolderSuggestion, type TagSuggestion } from '../core/id-discovery';
import { addFolderGenerators, folderRootTaken, patternRoot } from '../core/folder-generators';
import { updateFolderTargets } from './folder-generators';
import { IndexWorker, type IndexResponse } from '../core/index-worker';
import { analyzedDocuments, ruleRegex, type IdConfiguration, type SectionTag } from '../core/id-configuration';
import type { ConfigurationContext } from './project-configuration';
import type { SourceLocation } from '../shared/types';
import { categoryDefinitionSites } from './definition-sites';
import { configurationEntry } from './configuration-entry';
import type { DiscoveryCategoryDecision } from '../core/discovery-category-classification';
import { AgentDiscoveryPanel } from './agent-discovery';
import { explain } from './hover-hint';
interface DiscoveryHost {
  setupAgent(): void;
  agentPath(kind: 'codex' | 'claude'): string;
  context(): ConfigurationContext | undefined;
  draft(): IdConfiguration;
  reviewChanged(): void;
  stage(draft: IdConfiguration): void;
  source(location: SourceLocation, text: string, valid: () => boolean): void;
}
type ReviewItem = ConventionSuggestion | FolderSuggestion | TagSuggestion | ExclusionSuggestion;
const isTagSuggestion = (item: ReviewItem): item is TagSuggestion => 'sectionTags' in item;
const isExclusion = (item: ReviewItem): item is ExclusionSuggestion => 'paths' in item;
/** Whether a proposal has nothing left to review or add. */
const emptyProposal = (p: ConventionProposal) => !p.suggestions.length && !p.folders?.length && !p.tags?.length && !p.exclusions?.length;
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
  private scanButton = this.button('Run heuristic discovery', () => this.scan());
  private providerList = document.createElement('ul');
  /** The providers of the last scan (97b). */
  private providers?: ReturnType<typeof discoveryProviders>;
  /** Increment 97c: the installed discovery plugins, their tools, and the gaps of the last scan. */
  private discoveryPlugins: DiscoveryPluginInfo[] = [];
  private pluginTools = new Set<string>();
  private gaps: ProviderGap[] = [];
  private gapList = document.createElement('section');
  private agent: AgentDiscoveryPanel;
  constructor(private host: DiscoveryHost) {
    this.agent = new AgentDiscoveryPanel(host);
    this.root.id = 'config-discovery'; this.message.id = 'discovery-status'; this.message.setAttribute('role', 'status'); this.review.id = 'discovery-review';
    const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'Each discovery action replaces the current suggestions. Delete unwanted suggestions, edit the remaining ones, then use Add suggestions to draft before Preview matches and Apply. Existing rules are retained.';
    const scope = document.createElement('details'); const scopeTitle = document.createElement('summary'); scopeTitle.className = 'discovery-scope-heading'; const scopeLabel = document.createElement('span'); scopeLabel.textContent = 'Markdown scope'; scopeTitle.append(scopeLabel, this.scopeSummary); const scopeActions = document.createElement('div'); scopeActions.className = 'discovery-scope-actions'; scopeActions.append(this.selectAllButton, this.deselectAllButton);
    scope.id = 'discovery-markdown-scope'; scope.className = 'discovery-method';
    const scopeBody = document.createElement('div'); scopeBody.className = 'discovery-method-body';
    this.scopeList.id = 'discovery-scope-files'; scopeBody.append(scopeActions, this.scopeList); scope.append(scopeTitle, scopeBody);
    this.scopeSummary.className = 'config-hint'; this.scopeSummary.id = 'discovery-scope-summary'; this.scopeSummary.setAttribute('aria-live', 'polite');
    this.stageButton.className = 'button primary'; this.scanButton.className = 'button secondary';
    const section = (id: string, title: string, ...content: HTMLElement[]) => {
      const details = document.createElement('details'); details.id = id; details.className = 'discovery-method';
      const summary = document.createElement('summary'); summary.textContent = title;
      const body = document.createElement('div'); body.className = 'discovery-method-body'; body.append(...content);
      details.append(summary, body); return details;
    };
    const cancel = () => this.button('Cancel discovery', () => { this.resetResults(); this.message.textContent = 'Discovery cancelled. No configuration was changed.'; });
    const patternHelp = document.createElement('p'); patternHelp.className = 'config-hint'; patternHelp.textContent = 'Discover with heuristics uses fixed local rules and works offline. It scans only the files selected in Markdown scope.';
    // The profiles the heuristics use, on their own line below the description.
    const profilesHelp = document.createElement('span'); profilesHelp.className = 'discovery-profiles-hint'; profilesHelp.textContent = 'It considers: conventions of bundled SDD tools, profiles in .specular/profiles/*.json, profiles installed with Project > "Install profile folder".'; patternHelp.append(profilesHelp);
    const patternActions = document.createElement('div'); patternActions.className = 'discovery-method-actions'; patternActions.append(this.scanButton, cancel());
    // 97b: the providers organized by tool, each with a switch saved in the project configuration.
    const providers = document.createElement('details'); providers.id = 'discovery-providers'; providers.className = 'discovery-method';
    const providersTitle = document.createElement('summary'); providersTitle.textContent = 'Providers by tool';
    const providersBody = document.createElement('div'); providersBody.className = 'discovery-method-body';
    providersBody.append(this.providerList); providers.append(providersTitle, providersBody);
    const patterns = section('discovery-patterns', 'Discover with heuristics', providers, scope, patternActions);
    explain(patterns.querySelector('summary')!, `${patternHelp.firstChild!.textContent} ${profilesHelp.textContent}`);
    explain(providersTitle, 'The tools whose conventions the heuristics recognize. Turn a tool off to skip its suggestions; the choice is saved in the project configuration.');
    explain(scopeTitle, 'The Markdown files the heuristics scan.');
    const actions = document.createElement('div'); actions.className = 'discovery-actions'; this.remainingCount.id = 'discovery-remaining'; this.remainingCount.textContent = '0 suggestions remaining';
    actions.append(this.stageButton, this.deleteAllButton, this.remainingCount);
    const candidates = document.createElement('section'); candidates.className = 'discovery-candidates'; candidates.setAttribute('aria-labelledby', 'discovery-candidates-title');
    const candidatesTitle = document.createElement('h3'); candidatesTitle.id = 'discovery-candidates-title'; candidatesTitle.textContent = 'Candidate suggestions';
    this.gapList.id = 'discovery-gaps'; this.gapList.hidden = true;
    explain(candidatesTitle, hint.textContent!);
    candidates.append(candidatesTitle, this.message, actions, this.review, this.gapList);
    this.root.append(this.agent.root, patterns, candidates);
    this.stageButton.disabled = this.deleteAllButton.disabled = true;
  }
  private button(label: string, action: () => void) { const b = document.createElement('button'); b.type = 'button'; b.className = 'quiet-button'; b.textContent = label; b.onclick = action; return b; }
  private field(label: string, value: string, change: (value: string) => void, max = 128) {
    const wrapper = document.createElement('label'); wrapper.textContent = label; const input = document.createElement('input'); input.value = value; input.maxLength = max; input.setAttribute('aria-label', label); input.oninput = () => { change(input.value); this.host.reviewChanged(); }; wrapper.append(input); return wrapper;
  }
  reset() {
    this.resetResults(); this.message.textContent = ''; this.renderProviders(); void this.loadPlugins();
    const files = Object.keys(this.host.context()?.documents ?? {}); this.files = files; this.scope = new Set(files);
    this.renderScopeTree();
    // Every expandable section of Discover starts collapsed when the configuration opens.
    for (const details of this.root.querySelectorAll('details')) details.open = false;
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
    this.resetResults(); this.updateScopeSummary(); this.message.textContent = 'Scope changed. Scan again.';
  }
  private updateScopeSummary() {
    this.selectAllButton.disabled = this.scope.size === this.files.length; this.deselectAllButton.disabled = !this.scope.size;
    const documents = this.host.context()?.documents ?? {};
    const size = [...this.scope].reduce((n, file) => n + (documents[file]?.length ?? 0), 0);
    this.scopeSummary.textContent = `${this.scope.size} of ${this.files.length} Markdown files selected · ${size.toLocaleString()} characters.`;
  }
  dispose() { this.resetResults(); this.agent.dispose(); }
  private providerSetup() { const context = this.host.context(); return discoveryProviders(context?.state.profiles, this.host.draft().discoveryProviders, this.discoveryPlugins, Object.keys(context?.documents ?? {})); }
  /** 97c: enabled plugins with a discovery contribution (installed profiles), as the plugin manager lists them. */
  private async loadPlugins() {
    try {
      const plugins = (await window.specular.pluginList()).filter(plugin => plugin.enabled && plugin.status === 'ready' && plugin.manifest.discovery);
      const next = plugins.map(({ manifest }) => ({ id: manifest.id, tool: manifest.discovery!.tool, versions: manifest.discovery!.versions, ...(manifest.discovery!.description ? { description: manifest.discovery!.description } : {}), ...(manifest.discovery!.applies ? { applies: manifest.discovery!.applies } : {}) }));
      if (JSON.stringify(next) !== JSON.stringify(this.discoveryPlugins)) { this.discoveryPlugins = next; this.renderProviders(); }
    } catch { /* the list stays as it was */ }
  }
  /** 97b: one switch per provider; a change stages the draft, so current suggestions are dropped and the next scan uses it. 97d: a provider is on where it applies; only a choice that differs from that is stored. */
  private renderProviders() {
    this.providerList.id = 'discovery-provider-list'; this.providerList.className = 'discovery-provider-list';
    const { providers, errors } = this.providerSetup();
    this.providerList.replaceChildren(...providers.map(provider => {
      const item = document.createElement('li'), label = document.createElement('label'); label.className = 'config-checkbox';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = provider.enabled; input.setAttribute('aria-label', `Use the ${provider.tool} provider`);
      input.onchange = () => {
        const draft = structuredClone(this.host.draft()), disabled = new Set(draft.discoveryProviders?.disabled ?? []), enabled = new Set(draft.discoveryProviders?.enabled ?? []);
        disabled.delete(provider.id); enabled.delete(provider.id);
        if (input.checked !== provider.applies) (input.checked ? enabled : disabled).add(provider.id);
        if (disabled.size || enabled.size) draft.discoveryProviders = { ...(disabled.size ? { disabled: [...disabled].sort() } : {}), ...(enabled.size ? { enabled: [...enabled].sort() } : {}) }; else delete draft.discoveryProviders;
        this.host.stage(draft);
        this.message.textContent = `${provider.tool} provider ${input.checked ? 'on' : 'off'}. Discover again to use the change.`;
      };
      const hint = document.createElement('span'); hint.className = 'config-hint'; hint.textContent = `${provider.source === 'project' ? provider.file : provider.source === 'plugin' ? `installed ${provider.id}` : 'bundled'} · ${provider.versions}`;
      // 97d: whether the provider applies here, from its declared condition over the Markdown paths.
      const applies = document.createElement('span'); applies.className = 'discovery-provider-applies config-hint';
      applies.textContent = !provider.declared ? ' · applies to every project' : provider.applies ? ` · detected: ${provider.files} ${provider.files === 1 ? 'file' : 'files'}${provider.example ? `, such as ${provider.example}` : ''}` : ' · not detected';
      label.append(input, provider.tool); item.append(label, hint, applies); return item;
    }), ...errors.map(error => { const item = document.createElement('li'); item.className = 'discovery-provider-error'; item.textContent = `Skipped: ${error}`; return item; }));
  }
  private resetResults() { this.gaps = []; this.renderGaps(); this.serial++; this.updateScopeSummary(); this.worker.dispose(); this.pending = undefined; this.baseline = undefined; this.proposal = undefined; this.decisions.clear(); this.classificationMessage = ''; this.stageAfterClassification = false; this.remainingCount.textContent = '0 suggestions remaining'; this.review.replaceChildren(); this.stageButton.disabled = this.deleteAllButton.disabled = true; this.scanButton.disabled = false; }
  private capture() {
    const context = this.host.context(); if (!context) throw new Error('Open a project before discovery.');
    this.baseline = { context: structuredClone(context), draft: JSON.stringify(this.host.draft()) };
  }
  // 99a: excluded paths take no part in discovery; provider applicability still sees every path (a tool's folders show it is in use).
  private documents() { return analyzedDocuments(Object.fromEntries(Object.entries(this.baseline!.context.documents).filter(([file]) => this.scope.has(file))), this.host.draft()); }
  private fresh() {
    const current = this.host.context(), before = this.baseline;
    return !!current && !!before && current.projectId === before.context.projectId && current.state.diskVersion === before.context.state.diskVersion && JSON.stringify(this.host.draft()) === before.draft && Object.keys(current.documents).length === Object.keys(before.context.documents).length && Object.entries(current.documents).every(([file, text]) => before.context.documents[file] === text);
  }
  update() {
    this.updateScopeSummary(); this.agent.update(); this.renderProviders();
    if (Object.keys(this.host.context()?.documents ?? {}).join('\0') !== this.files.join('\0')) {
      this.reset(); this.message.textContent = 'Markdown file list changed. Scope refreshed; scan again.'; return;
    }
    if (this.baseline && !this.fresh()) { this.resetResults(); this.message.textContent = 'Markdown, project, or configuration draft changed. Scan again before using suggestions.'; }
  }
  private async scan() {
    this.resetResults();
    try {
      this.capture(); if (!this.scope.size) throw new Error('Select at least one Markdown file.');
      this.pending = ++this.serial; this.scanButton.disabled = true; this.message.textContent = `Scanning ${Object.keys(this.documents()).length} Markdown files...`;
      // 97c: plugins installed or switched in the plugin manager since the tab opened.
      const serial = this.serial; await this.loadPlugins(); if (serial !== this.serial) return;
      this.providers = this.providerSetup();
      this.worker.run({ revision: this.pending, discover: true, profiles: structuredClone(this.providers.profiles), configuration: structuredClone(this.host.draft()), documents: this.documents() });
    } catch (error) { this.message.textContent = String(error); this.pending = undefined; this.scanButton.disabled = false; }
  }
  private receive(result: IndexResponse) {
    if (result.revision !== this.pending) return;
    this.pending = undefined; this.scanButton.disabled = false;
    if (!this.fresh()) { this.update(); return; }
    if (result.classifications) {
      if (!this.proposal || result.classifications.length !== this.proposal.suggestions.length) {
        this.message.textContent = 'Discovery classification returned an incomplete result. Scan again.'; return;
      }
      const original = this.proposal.suggestions;
      const existing = result.classifications.filter(decision => decision.kind === 'existing').length;
      this.decisions = new Map(original.map((suggestion, index) => [suggestion.key, result.classifications![index]]));
      this.proposal.suggestions = original.filter((_, index) => result.classifications![index].kind !== 'existing');
      // 96d: criteria of a requirement category that already exists number and cite that category.
      const existingKeys = new Map(original.flatMap((suggestion, index) => { const decision = result.classifications![index]; return decision.kind === 'existing' ? [[suggestion.category.key, decision.category] as const] : []; }));
      for (const suggestion of this.proposal.suggestions) {
        const items = suggestion.category.numberedItems;
        if (items) items.parent = existingKeys.get(items.parent) ?? items.parent;
        for (const rule of suggestion.references ?? []) rule.category = existingKeys.get(rule.category) ?? rule.category;
      }
      // 96h: tags of suggestions an existing category already recognizes are offered for it; restaging keeps the reviewed ones.
      if (!this.stageAfterClassification) {
        const tags = existingCategoryTags(this.host.draft(), original, result.classifications.map(decision => decision.kind === 'existing' || decision.reason === 'different-rule-for-existing-evidence' ? decision.category : undefined));
        if (tags.length) this.proposal.tags = tags; else delete this.proposal.tags;
      }
      const ambiguous = this.proposal.suggestions.filter(suggestion => this.decisions.get(suggestion.key)?.kind === 'ambiguous').length, tagged = this.proposal.tags?.filter(tags => tags.sectionTags.length).length ?? 0;
      const listed = this.proposal.tags?.filter(tags => !tags.sectionTags.length).length ?? 0;
      if (!this.proposal.suggestions.length && !this.proposal.folders?.length && !tagged && !listed && !this.proposal.exclusions?.length) {
        this.message.textContent = original.length
          ? `No new categories found. Omitted ${existing} existing ${existing === 1 ? 'category' : 'categories'} from the current draft.`
          : 'No new categories found. The proposal contained no suggestions.';
        this.renderReview(); return;
      }
      this.message.textContent = this.classificationMessage
        + (existing ? ` Omitted ${existing} existing ${existing === 1 ? 'category' : 'categories'}.` : '')
        + (ambiguous ? ` ${ambiguous} ambiguous ${ambiguous === 1 ? 'suggestion remains' : 'suggestions remain'} for explicit review.` : '')
        + (tagged ? ` ${tagged} ${tagged === 1 ? 'suggestion adds' : 'suggestions add'} section tags to existing categories.` : '')
        + (listed ? ` ${listed} ${listed === 1 ? 'suggestion turns' : 'suggestions turn'} on list definitions of existing categories.` : '')
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
    this.proposal = candidateProposal(result.inventory, this.providers?.profiles ?? []);
    const skipped = [...this.providers?.errors ?? [], ...result.inventory.providerErrors ?? []], inventory = result.inventory;
    // Avoid collisions with previous discovery drafts or project-defined keys.
    const used = new Set([...this.host.draft().categories, ...this.host.draft().rules].map(v => v.key));
    const renamed = new Map<string, string>();
    for (const suggestion of this.proposal.suggestions) {
      const base = suggestion.key; let key = base, n = 2; while (used.has(key)) key = `${base}-${n++}`; used.add(key);
      renamed.set(suggestion.category.key, key);
      suggestion.key = suggestion.category.key = key;
      if (suggestion.rule) suggestion.rule.key = suggestion.rule.category = key;
      for (const rule of suggestion.references ?? []) { let ruleKey = rule.key, n = 2; while (used.has(ruleKey)) ruleKey = `${rule.key}-${n++}`; used.add(ruleKey); rule.key = ruleKey; }
    }
    // Keyword suggestions (85c) refer to their parent and capability suggestions by key.
    for (const rule of this.proposal.suggestions.flatMap(suggestion => suggestion.references ?? [])) rule.category = renamed.get(rule.category) ?? rule.category;
    for (const { category } of this.proposal.suggestions) {
      if (category.parent) category.parent = renamed.get(category.parent) ?? category.parent;
      if (category.changes?.capabilities) category.changes.capabilities = renamed.get(category.changes.capabilities) ?? category.changes.capabilities;
      if (category.numberedItems) category.numberedItems.parent = renamed.get(category.numberedItems.parent) ?? category.numberedItems.parent;
    }
    const plugins = this.providers?.plugins ?? [];
    if (!plugins.length) { this.finishScan(inventory, skipped); return; }
    // 97c: discovery plugins run in their own sandboxes after the profiles; their suggestions follow, labelled with their tools.
    const serial = this.serial; this.pending = serial; this.scanButton.disabled = true;
    this.message.textContent = `Running ${plugins.length === 1 ? 'an installed profile' : `${plugins.length} installed profiles`}...`;
    const documents = this.documents(), context = this.baseline!.context;
    window.specular.discoverWithPlugins(JSON.stringify({ projectId: context.projectId, revision: serial, documents }), plugins.map(plugin => plugin.id)).then(found => {
      if (serial !== this.serial || !this.proposal) return;
      this.pending = undefined; this.scanButton.disabled = false;
      if (!this.fresh()) { this.update(); return; }
      const taken = new Set([...this.host.draft().categories, ...this.host.draft().rules, ...this.proposal.suggestions].map(item => item.key));
      for (const plugin of found.results) {
        try {
          const { suggestions, gaps } = pluginProposal(plugin.tool, plugin, documents, taken);
          this.proposal.suggestions.push(...suggestions); this.gaps.push(...gaps); this.pluginTools.add(plugin.tool);
          for (const suggestion of suggestions) { taken.add(suggestion.key); if (suggestion.rule) taken.add(suggestion.rule.key); for (const rule of suggestion.references ?? []) taken.add(rule.key); }
        } catch (error) { skipped.push(`${plugin.tool} (${plugin.id}): ${error instanceof Error ? error.message : String(error)}`); }
      }
      this.finishScan(inventory, [...skipped, ...found.errors]);
    }, error => {
      if (serial !== this.serial) return;
      this.pending = undefined; this.scanButton.disabled = false;
      this.finishScan(inventory, [...skipped, `Installed profiles: ${error instanceof Error ? error.message : String(error)}`]);
    });
  }
  private finishScan(inventory: NonNullable<IndexResponse['inventory']>, skipped: string[]) {
    if (!this.proposal) return;
    // Increment 96: folder patterns whose root the draft already derives are omitted.
    const folders = this.proposal.folders ?? [], kept = folders.filter(folder => !folderRootTaken(this.host.draft(), folder.target, folder.pattern));
    if (kept.length) this.proposal.folders = kept; else delete this.proposal.folders;
    const omitted = folders.length - kept.length;
    this.classifyProposal(`Found ${this.proposal.suggestions.length} candidate groups in ${inventory.files.length} files (${inventory.occurrences} occurrences).`
      + (kept.length ? ` Found ${kept.length} folder-derived feature ${kept.length === 1 ? 'suggestion' : 'suggestions'}.` : '')
      + (omitted ? ` Omitted ${omitted} folder ${omitted === 1 ? 'pattern' : 'patterns'} already in the draft.` : '')
      // 99a: tool folders that could be left out of analysis.
      + (this.proposal.exclusions?.length ? ` Found ${this.proposal.exclusions[0].paths.length} tool ${this.proposal.exclusions[0].paths.length === 1 ? 'folder' : 'folders'} to exclude from analysis.` : '')
      // 97a: a provider that cannot run is reported; the others still propose.
      + (skipped.length ? ` Skipped ${skipped.length === 1 ? 'a discovery provider' : `${skipped.length} discovery providers`}: ${skipped.join(' ')}` : ''), false);
  }
  private classifyProposal(message: string, stage: boolean) {
    if (!this.proposal) return;
    this.classificationMessage = message; this.stageAfterClassification = stage; this.decisions.clear();
    this.review.replaceChildren(); this.stageButton.disabled = this.deleteAllButton.disabled = true;
    this.pending = ++this.serial; this.message.textContent = message + ' Checking existing categories in the current draft...';
    this.worker.run({ revision: this.pending, classify: structuredClone(this.proposal), configuration: structuredClone(this.host.draft()), documents: this.documents() });
  }
  private renderReview() {
    // 97a: Specular's own suggestions first, then each provider's together.
    this.proposal!.suggestions.sort((a, b) => (a.provider ?? '').localeCompare(b.provider ?? '')
      || this.exampleId(a).localeCompare(this.exampleId(b), undefined, { sensitivity: 'base', numeric: true }));
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
      if (suggestion.provider) { const provider = document.createElement('p'); provider.className = 'discovery-provider config-hint'; provider.textContent = `Proposed by the ${suggestion.provider} ${this.pluginTools.has(suggestion.provider) ? 'installed ' : ''}profile.`; body.append(provider); }
      body.append(reason, name, roleLabel);
      const rule = suggestion.rule;
      // A defining templated rule (96e) is explained by example rather than edited as a regex here.
      if (rule && !rule.defines) body.append(this.field('Suggested regex', rule.pattern ?? ruleRegex(rule).source, value => { delete rule.prefix; delete rule.separator; rule.pattern = value; }, 512));
      else body.append(this.conventionSummary(suggestion));
      // 96f-96g: tags from enclosing section headings, for rule and summary suggestions alike.
      if (suggestion.category.sectionTags?.length) body.append(this.tagsLine(suggestion.category.sectionTags));
      if (suggestion.category.idScopes?.length) body.append(...this.scopeControls(suggestion, !rule || !!rule.defines));
      body.append(categoryDefinitionSites(suggestion.category, () => this.host.draft(), () => this.host.reviewChanged()));
      for (const evidence of suggestion.evidence) body.append(this.evidenceButton(evidence));
      return configurationEntry(suggestion, body, () => this.suggestionTitle(suggestion), false, this.button('Delete', () => this.deleteSuggestions(suggestion)));
    }), ...(this.proposal!.folders ?? []).map(folder => this.folderEntry(folder)), ...(this.proposal!.tags ?? []).map(tags => this.tagEntry(tags)),
      ...(this.proposal!.exclusions ?? []).map(exclusion => this.exclusionEntry(exclusion)));
    this.renderGaps(); this.updateReviewActions();
  }
  /** Increment 97c: gaps reported by installed profiles, as notes like the agent's (87). */
  private renderGaps() {
    this.gapList.hidden = !this.gaps.length;
    if (!this.gaps.length) { this.gapList.replaceChildren(); return; }
    const heading = document.createElement('h4'); heading.textContent = 'Gaps (reported by installed profiles, not applied)';
    const note = document.createElement('p'); note.className = 'config-hint'; note.textContent = 'Conventions the profiles found that the configuration cannot express. They are notes only.';
    const list = document.createElement('ul');
    for (const gap of this.gaps) {
      const item = document.createElement('li'); item.textContent = `${gap.tool}: ${gap.text}`;
      for (const evidence of gap.evidence) item.append(this.evidenceButton(evidence));
      list.append(item);
    }
    explain(heading, note.textContent!);
    this.gapList.replaceChildren(heading, list);
  }
  /** 96f-96g: tags from enclosing section headings. */
  private tagsLine(entries: readonly SectionTag[]) {
    const tags = document.createElement('p'); tags.className = 'discovery-tags';
    tags.textContent = `Tagged by section: ${entries.map(entry => entry.pattern !== undefined ? `headings matching ${entry.pattern} as ${entry.tag}` : `"${entry.heading}" as ${entry.tag}`).join(', ')}.`;
    return tags;
  }
  /** Increment 96h: section tags for a category the draft already has, added without the suggestion's rule. */
  private tagEntry(tags: TagSuggestion) {
    const body = document.createElement('div'); body.className = 'discovery-suggestion discovery-tag-suggestion'; body.dataset.suggestion = tags.key;
    const reason = document.createElement('p'); reason.textContent = tags.uncertainty;
    const note = document.createElement('p'); note.className = 'config-hint';
    note.textContent = tags.sectionTags.length
      ? `Existing entries of ${this.categoryName(tags.category)} stay. ${tags.lists ? 'Its list definitions are off, so list items will define its IDs. ' : tags.checkboxLists ? 'Its list definitions are off, so checkbox list items will define its IDs. ' : ''}Preview counts the IDs per tag.`
      : `Only the list definitions of ${this.categoryName(tags.category)} change; its other definition sites stay. Preview counts its definitions.`;
    body.append(reason, ...(tags.sectionTags.length ? [this.tagsLine(tags.sectionTags)] : []), note, ...tags.evidence.map(evidence => this.evidenceButton(evidence)));
    return configurationEntry(tags, body, () => this.suggestionTitle(tags), false, this.button('Delete', () => this.deleteSuggestions(tags)));
  }
  private categoryName(key: string) { return this.host.draft().categories.find(category => category.key === key)?.name ?? key; }
  private evidenceButton(evidence: CandidateEvidence) {
    return this.button(`${evidence.id} - ${evidence.file} (${evidence.context})`, () => {
      if (!this.fresh()) { this.update(); return; }
      const text = this.baseline!.context.documents[evidence.file], head = text.slice(0, evidence.offset);
      this.host.source({ file: evidence.file, offset: evidence.offset, end: evidence.end, line: head.split('\n').length, column: evidence.offset - head.lastIndexOf('\n') }, text, () => this.fresh());
    });
  }
  /** Increment 99a: tool folders to leave out of analysis, each with its files, definitions, and pending items. */
  private exclusionEntry(exclusion: ExclusionSuggestion) {
    const body = document.createElement('div'); body.className = 'discovery-suggestion discovery-exclusion-suggestion'; body.dataset.suggestion = exclusion.key;
    const reason = document.createElement('p'); reason.textContent = exclusion.uncertainty;
    const list = document.createElement('ul'); list.className = 'discovery-convention discovery-exclusion-paths';
    exclusion.paths.forEach((path, i) => {
      const item = document.createElement('li');
      item.textContent = `${path}: ${exclusion.files[i]} ${exclusion.files[i] === 1 ? 'file' : 'files'}, ${exclusion.definitions[i]} ${exclusion.definitions[i] === 1 ? 'definition' : 'definitions'}, ${exclusion.pending[i]} pending`;
      list.append(item);
    });
    body.append(reason, list);
    return configurationEntry(exclusion, body, () => this.suggestionTitle(exclusion), false, this.button('Delete', () => this.deleteSuggestions(exclusion)));
  }
  /** Increment 96: a folder-derived features suggestion with its folders and the IDs each would receive. */
  private folderEntry(folder: FolderSuggestion) {
    const body = document.createElement('div'); body.className = 'discovery-suggestion discovery-folder-suggestion'; body.dataset.suggestion = folder.key;
    const reason = document.createElement('p'); reason.textContent = folder.uncertainty;
    // 96a: the folders Update derives, with those that hold no specification file marked.
    const root = patternRoot(folder.pattern);
    const shown = folder.folders.slice(0, 8).map((path, i) => `${path.slice(root.length + 1)}${folder.ids ? ` (${folder.ids[i]} IDs${folder.withoutSpec?.includes(path) ? ', no specification file' : ''})` : folder.withoutSpec?.includes(path) ? ' (no specification file)' : ''}`);
    const list = document.createElement('p'); list.className = 'discovery-convention';
    list.textContent = `Pattern: ${folder.pattern}. ${folder.folders.length} folders: ${shown.join(', ')}${folder.folders.length > 8 ? `, and ${folder.folders.length - 8} more` : ''}.`;
    const ids = document.createElement('p'); ids.className = 'config-hint';
    ids.textContent = folder.ids ? `${folder.ids.reduce((n, count) => n + count, 0)} defined IDs would be assigned under the current draft; IDs of categories added together are counted by Update.` : 'ID counts are unavailable; Update reports them.';
    body.append(reason, list, ids, ...folder.evidence.map(evidence => this.evidenceButton(evidence)));
    return configurationEntry(folder, body, () => this.suggestionTitle(folder), false, this.button('Delete', () => this.deleteSuggestions(folder)));
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
  get remainingSuggestions() { return this.items().length; }
  /** Review order: category suggestions, then folder suggestions (96), section tags for existing categories (96h), and excluded tool folders (99a). */
  private items(): ReviewItem[] { return [...this.proposal?.suggestions ?? [], ...this.proposal?.folders ?? [], ...this.proposal?.tags ?? [], ...this.proposal?.exclusions ?? []]; }
  /** The ID a suggestion's title and order show: its first example, or for numbered list items (96d) the first ID they define, since their example is the item's text. */
  private exampleId(suggestion: ConventionSuggestion) {
    const items = suggestion.category.numberedItems;
    const template = items?.id ?? (suggestion.rule?.defines ? suggestion.rule.id : undefined);
    return template ? template.replace(/\{[^{}]*\}/gu, '1') : suggestion.evidence[0]?.id ?? suggestion.category.name;
  }
  private suggestionTitle(suggestion: ReviewItem) {
    const number = this.items().indexOf(suggestion) + 1;
    if (isTagSuggestion(suggestion)) return suggestion.sectionTags.length ? `${number}. Add section tags to ${this.categoryName(suggestion.category)}` : `${number}. Define ${this.categoryName(suggestion.category)} IDs in list items`;
    if (isExclusion(suggestion)) return `${number}. Exclude tool folders from analysis (${suggestion.paths.length})`;
    return 'category' in suggestion ? number + '. ' + this.exampleId(suggestion) + ' - ' + suggestion.category.name + (suggestion.provider ? ` · ${suggestion.provider}` : '') : `${number}. Folder-derived features: ${suggestion.pattern}`;
  }
  private updateReviewActions() {
    this.remainingCount.textContent = this.remainingSuggestions + ' suggestions remaining';
    this.stageButton.disabled = this.deleteAllButton.disabled = !this.remainingSuggestions || !this.fresh();
  }
  /** Increment 96b: a suggestion's scopes and whether it is recognized only inside them. */
  private scopeControls(suggestion: ConventionSuggestion, summarized: boolean) {
    const { category } = suggestion, controls: HTMLElement[] = [];
    if (!summarized) { const scopes = document.createElement('p'); scopes.className = 'discovery-convention discovery-scopes'; scopes.textContent = `Scopes: ${category.idScopes!.map(scope => scope.pattern).join(', ')}.`; controls.push(scopes); }
    const label = document.createElement('label'); label.className = 'config-checkbox';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!category.onlyInScopes; input.setAttribute('aria-label', 'Recognize only inside its scopes');
    input.onchange = () => { if (input.checked) category.onlyInScopes = true; else delete category.onlyInScopes; this.host.reviewChanged(); };
    label.append(input, 'Recognize only inside its scopes (files elsewhere read these IDs as prose)'); controls.push(label);
    return controls;
  }
  /** 85c: what a keyword or derived suggestion defines, instead of a regex. */
  private conventionSummary(suggestion: ConventionSuggestion) {
    const { category } = suggestion, headings = category.idDefinitionSites?.headings, other = (key?: string) => this.proposal!.suggestions.find(item => item.category.key === key)?.category.name ?? this.host.draft().categories.find(item => item.key === key)?.name ?? key;
    const parentName = other(category.numberedItems?.parent), citedName = parentName ?? 'Requirement', criteriaRule = suggestion.references?.find(rule => rule.list?.id.includes('{criterion}')), wholeRule = suggestion.references?.find(rule => rule !== criteriaRule);
    const example = (template: string, values: Record<string, string>) => template.replace(/\{([^{}:]+)(?::[^{}]*)?\}/gu, (_all, name: string) => values[name] ?? name);
    const lines = [
      ...(headings?.mode === 'keyword' ? [`Keyword heading: "${headings.keyword}: <name>" at level ${headings.levels.join(', ')}.`] : []),
      ...(category.parent ? [`Identified within its ${other(category.parent)} heading.`] : []),
      ...(category.idScopes?.length ? [`Scopes: ${category.idScopes.map(scope => scope.pattern).join(', ')}.`] : []),
      ...(category.derive ? [`Derived from files matching ${category.derive.pattern}.`] : []),
      ...(category.changes ? [`Changes: Active, or Archived inside archive folders${category.changes.capabilities ? `; proposals declare ${other(category.changes.capabilities)} elements` : ''}.`] : []),
      ...(category.deltas ? ['Records ADDED/MODIFIED/REMOVED/RENAMED sections of changes.'] : []),
      ...(category.nameReferences ? ['Backticked names refer to these elements.'] : []),
      // 96d: examples instead of templates and label patterns.
      ...(category.numberedItems ? [`Each item of an ordered list${category.numberedItems.section ? ` under "${category.numberedItems.section}"` : ''} inside a ${parentName} is numbered by its position: the second item under ${parentName} 3 is ${example(category.numberedItems.id, { parent: '3', item: '2' })}.`] : []),
      // 96e: bugfix criteria are paragraphs starting with their number.
      ...(suggestion.rule?.defines ? [category.idDefinitionSites?.lists?.enabled
        // 104: Kiro tasks are checkbox items starting with their number.
        ? `${category.idDefinitionSites.lists.checkboxOnly ? 'Checkbox items' : 'List items'} starting with a number, such as "- [ ] 1.1 …"${category.definitionPaths ? ` in ${category.definitionPaths.join(', ')}` : ''}, define ${example(suggestion.rule.id!, { group: '1', item: '1', task: '1.1' })}.`
        : `Paragraphs starting with a number, such as "2.1 The system SHALL …" in a bugfix specification, define ${example(suggestion.rule.id!, { group: '2', item: '1' })}.`] : []),
      ...(suggestion.references ?? []).filter(rule => !rule.list).map(rule => `Mentions matching ${rule.pattern} refer to them.`),
      ...(category.statusSites?.checkboxes?.enabled ? ['Checkbox markers give their status.'] : []),
      ...(criteriaRule ? [`Citations such as "${citedName}s: 3.2" or "Validates: ${citedName}s 3.2" refer to ${example(criteriaRule.list!.id, { number: '3', criterion: '2' })}${wholeRule ? `, and "${citedName}s: 3" refers to ${example(wholeRule.list!.id, { number: '3' })}` : ''}.`] : []),
    ];
    const summary = document.createElement('p'); summary.className = 'discovery-convention'; summary.textContent = lines.join(' ');
    return summary;
  }
  private deleteSuggestions(suggestion?: ReviewItem) {
    if (!this.fresh()) { this.update(); return; }
    const proposal = this.proposal!, suggestions = proposal.suggestions;
    const index = suggestion ? this.items().indexOf(suggestion) : 0;
    if (index < 0 || !this.items().length) return;
    if (suggestion && isExclusion(suggestion)) {
      proposal.exclusions!.splice(proposal.exclusions!.indexOf(suggestion), 1);
      if (!proposal.exclusions!.length) delete proposal.exclusions;
      this.review.children[index].remove();
    } else if (suggestion && isTagSuggestion(suggestion)) {
      proposal.tags!.splice(proposal.tags!.indexOf(suggestion), 1);
      if (!proposal.tags!.length) delete proposal.tags;
      this.review.children[index].remove();
    } else if (suggestion && !('category' in suggestion)) {
      proposal.folders!.splice(proposal.folders!.indexOf(suggestion), 1);
      if (!proposal.folders!.length) delete proposal.folders;
      this.review.children[index].remove();
    } else if (suggestion) {
      suggestions.splice(index, 1);
      this.review.children[index].remove();
      // 85c: children and changes no longer refer to a deleted suggestion.
      for (const { category } of suggestions) {
        if (category.parent === suggestion.category.key) delete category.parent;
        if (category.changes?.capabilities === suggestion.category.key) delete category.changes.capabilities;
      }
      // 96d: citation rules of a deleted category go with it.
      for (const other of suggestions) if (other.references) {
        other.references = other.references.filter(rule => rule.category !== suggestion.category.key);
        if (!other.references.length) delete other.references;
      }
    } else { suggestions.length = 0; delete proposal.folders; delete proposal.tags; delete proposal.exclusions; this.review.replaceChildren(); }
    // Keep surviving editors in place: names, roles, regexes and expansion stay intact.
    const items = this.items();
    [...this.review.children].forEach((entry, i) => { entry.querySelector('.config-entry-title')!.textContent = this.suggestionTitle(items[i]); });
    this.updateReviewActions(); this.host.reviewChanged();
    this.message.textContent = this.remainingSuggestions
      ? 'Deleted from this review only. Edit the remaining suggestions, then Add suggestions to draft.'
      : 'No suggestions remain. Scan again to start a new review. Configuration and Markdown are unchanged.';
    const next = this.review.children[Math.min(index, this.review.children.length - 1)];
    (next?.querySelector<HTMLElement>('summary') ?? (this.scanButton.closest('details')!.open ? this.scanButton : this.scanButton.closest('details')!.querySelector<HTMLElement>('summary')!)).focus();
  }
  private stage() {
    try {
      if (!this.fresh()) { this.update(); return; }
      this.proposal = validateProposal(this.proposal, this.documents());
      if (emptyProposal(this.proposal)) throw new Error('No suggestions remain to add.');
      // Reclassify edited names/rules immediately before staging so an edit cannot
      // recreate an equivalent category that the initial review omitted.
      this.classifyProposal('Rechecked edited suggestions.', true);
    } catch (error) { this.message.textContent = String(error); }
  }
  private commitStage() {
    try {
      if (!this.fresh()) { this.update(); return; }
      const proposal = validateProposal(this.proposal, this.documents());
      if (emptyProposal(proposal)) throw new Error('No new suggestions remain to add.');
      const base = this.host.draft(); const draft = mergeProposal(base, proposal);
      const categories = draft.categories.filter(c => !base.categories.some(old => old.key === c.key));
      const rules = draft.rules.filter(r => !base.rules.some(old => old.key === r.key));
      const tagged = (proposal.tags ?? []).map(tags => this.categoryName(tags.category));
      const added = [proposal.suggestions.length ? `Added ${categories.length} categories: ${categories.map(c => c.name).join(', ')}; ${rules.length} ID recognition rules.` : '',
        tagged.length ? `Added section tags to ${tagged.join(', ')}.` : '',
        proposal.exclusions?.length ? `Excluded ${proposal.exclusions.flatMap(x => x.paths).join(', ')} from analysis; scan again to update the other suggestions.` : ''].filter(Boolean).join(' ');
      const { configuration, added: generators } = addFolderGenerators(draft, (proposal.folders ?? []).map(folder => ({ target: folder.target, pattern: folder.pattern, exclusions: [] })));
      if (!generators.length) {
        this.resetResults(); this.host.stage(draft); this.message.textContent = added + ' Review each category and its recognition rules in Categories. Preview matches and Apply saves the draft. Nothing has been saved yet.';
        return;
      }
      // Increment 96: folder suggestions add their generators and run Update features, so the features are staged with the categories.
      const serial = this.serial;
      this.stageButton.disabled = this.deleteAllButton.disabled = true; this.message.textContent = 'Updating folder-derived features...';
      void updateFolderTargets(configuration, ['features'], this.baseline!.context.documents).then(result => {
        if (serial !== this.serial) return;
        if (!this.fresh()) { this.update(); return; }
        if (!result.configuration) {
          this.message.textContent = `Cannot add the folder-derived features: ${result.problems.join(' ')} Delete the folder suggestion or resolve the collision in Application features. No draft changes were made.`;
          this.updateReviewActions(); return;
        }
        const folders = `Added ${generators.length} folder ${generators.length === 1 ? 'pattern' : 'patterns'} (${generators.map(rule => rule.pattern).join(', ')}) with ${result.entries} new ${result.entries === 1 ? 'feature' : 'features'}.`;
        this.resetResults(); this.host.stage(result.configuration);
        this.message.textContent = [added, folders].filter(Boolean).join(' ') + ' Review them in Categories and Application features. Preview matches and Apply saves the draft. Nothing has been saved yet.';
      });
    } catch (error) { this.message.textContent = String(error); }
  }

}
