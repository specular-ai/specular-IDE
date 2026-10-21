import { categoryChange, datesChanged, sitesChanged, stageAgentProposal, statusesChanged, type ProposalChange } from '../core/agent-proposal';
import type { AgentGap, AgentProposal, DateMetrics, StatusMetrics } from '../core/agent-tools';
import { DEFAULT_STATUS_SITES, type StatusSites } from '../core/status-sites';
import { DEFAULT_DATE_SETTINGS, type DateSettings } from '../core/dates';
import type { StatusPalette } from '../core/statuses';
import type { IdCategory, IdConfiguration, IdRule } from '../core/id-configuration';
import type { IdDefinitionSites } from '../core/definition-sites';
import type { ConfigurationContext } from './project-configuration';
import { DEFAULT_RUN_LIMITS, MAX_RUN_LIMITS, MIN_TOOL_CALLS, runLimits, toolCallLimitError } from '../core/run-limits';

interface AgentDiscoveryHost {
  setupAgent(): void;
  agentPath(kind: 'codex' | 'claude'): string;
  context(): ConfigurationContext | undefined;
  draft(): IdConfiguration;
  stage(draft: IdConfiguration): void;
}
const CHANGE_LABELS: Record<ProposalChange, string> = { new: 'New', changed: 'Changes the draft', unchanged: 'Same as the draft' };
const ruleText = (rule: IdRule) => rule.list ? `Labelled list: ${rule.list.label} → ${rule.list.id}` : rule.pattern !== undefined ? `Pattern: ${rule.pattern}${rule.id !== undefined ? ` → ${rule.id}` : ''}${rule.ignoreCase ? ' (ignore case)' : ''}` : `Prefix: ${rule.prefix}${rule.separator ?? '-'}<digits>`;
function sitesText(sites: IdDefinitionSites) {
  const h = sites.headings;
  return [
    h.enabled ? (h.mode === 'keyword' ? `"${h.keyword}${h.separator ?? ':'} <name>" headings (H${h.levels.join(', H')})` : `headings (${h.mode}, H${h.levels.join(', H')})`) : '',
    sites.tables.enabled ? `table column "${sites.tables.column}"` : '',
    sites.lists?.enabled ? `${sites.lists.types.join(' and ')} list items${sites.lists.checkboxOnly ? ' with a checkbox' : ''}` : '',
    sites.paragraphs?.enabled ? 'paragraph starts' : '',
  ].filter(Boolean).join(', ') || 'none';
}
/** Plain-text summaries of status and date settings for the review (87). */
export function statusSitesText(sites: StatusSites = DEFAULT_STATUS_SITES) {
  const markers = sites.checkboxes?.enabled ? Object.entries(sites.checkboxes.markers).map(([marker, value]) => `[${marker}] ${value}`).join(', ') : '';
  return [
    sites.paragraphs.enabled ? (sites.paragraphs.mode === 'regex' ? `paragraphs matching ${sites.paragraphs.pattern}` : `paragraphs starting "${sites.paragraphs.label}"`) + (sites.paragraphs.listItems ? ' (also list items)' : '') : '',
    sites.tables.enabled ? `table column "${sites.tables.column}"${sites.tables.mode === 'regex' ? ` matching ${sites.tables.pattern}` : ''}` : '',
    sites.headings.enabled ? `headings matching ${sites.headings.pattern}` : '',
    markers ? `checkboxes (${markers})` : '',
  ].filter(Boolean).join('; ') || 'none';
}
const statusText = (status: StatusPalette) => `${status.name}${status.rules?.length ? ` (${status.rules.map(rule => `${rule.mode} "${rule.value}"`).join(', ')})` : ''}${status.colors?.light || status.colors?.dark ? ` · ${[status.colors.light, status.colors.dark].filter(Boolean).join(' / ')}` : ''}`;
export function statusListText(statuses: StatusPalette[] | undefined) { return statuses?.length ? statuses.map(statusText).join('; ') : 'none (values are shown as written)'; }
export function dateSettingsText(settings: DateSettings = DEFAULT_DATE_SETTINGS) {
  const rules = settings.rules.map(rule => `${rule.key}: ${rule.site}${rule.label ? ` "${rule.label}"` : ''}${rule.kind ? `, ${rule.kind}` : ''}${rule.enabled ? '' : ' (disabled)'}`).join('; ');
  return `${rules || 'no rules'}${settings.exclude.length ? `. Excluded: ${settings.exclude.join(', ')}` : ''}`;
}
function statusMetricsText(metrics: StatusMetrics) {
  const sites = Object.entries(metrics.sites).map(([site, count]) => `${site} ${count}`).join(', ');
  const ids = metrics.categories.filter(c => c.withStatus || c.conflicts).map(c => `${c.name}: ${c.withStatus} with a status, ${c.withoutStatus} without, ${c.conflicts} in conflict`).join('; ');
  return `${metrics.occurrences} status occurrences${sites ? ` (${sites})` : ''} · ${metrics.mapped} mapped · ${metrics.unmapped} unmapped${ids ? `. ${ids}` : ''}${metrics.unusedStatuses.length ? `. Unused statuses: ${metrics.unusedStatuses.join(', ')}` : ''}.`;
}
function dateMetricsText(metrics: DateMetrics) {
  const found = metrics.rules.filter(rule => rule.dates).map(rule => `${rule.key} ${rule.dates}`).join(', ');
  return `Dates found: ${found || 'none'}${metrics.emptyRules.length ? `. Enabled rules that find nothing: ${metrics.emptyRules.join(', ')}` : ''}${metrics.exclusions.length ? `. Exclusions: ${metrics.exclusions.map(e => `${e.path} (${e.files} files)`).join(', ')}` : ''}.`;
}
export const gapText = (gap: AgentGap) => `${gap.description}${gap.examples.length ? ` (${gap.examples.map(e => `${e.path}:${e.line}`).join(', ')})` : ''}`;
function categoryText(category: IdCategory, proposal: IdConfiguration) {
  const name = (key?: string) => proposal.categories.find(c => c.key === key)?.name ?? key;
  return [
    category.role ? `Role: ${category.role}.` : '',
    category.idDefinitionSites ? `Defined by ${sitesText(category.idDefinitionSites)}.` : '',
    category.idScopes?.length ? `Scopes: ${category.idScopes.map(scope => scope.pattern).join(', ')}.` : '',
    category.onlyInScopes ? 'Recognized only inside these scopes.' : '',
    category.definitionPaths ? `Defined only in ${category.definitionPaths.join(', ')}.` : '',
    category.parent ? `Identified within its ${name(category.parent)} heading.` : '',
    category.derive ? `Derived from files matching ${category.derive.pattern}.` : '',
    category.changes ? `Changes${category.changes.capabilities ? ` declaring ${name(category.changes.capabilities)} elements` : ''}.` : '',
    category.deltas ? 'Records change deltas.' : '',
    category.nameReferences ? 'Backticked names refer to these elements.' : '',
    category.statusSites ? `Statuses from ${statusSitesText(category.statusSites)}.` : '',
  ].filter(Boolean).join(' ');
}

/** Discover with an agent (increment 86a): run, progress, and review of the agent's measured proposal. */
export class AgentDiscoveryPanel {
  readonly root = document.createElement('details');
  private status = document.createElement('p');
  private log = document.createElement('ul');
  private review = document.createElement('div');
  private model = document.createElement('input');
  private toolCalls = document.createElement('input');
  private toolCallsHint = document.createElement('p');
  private agent = document.createElement('select');
  private runButton = this.button('Run agent discovery', () => { void this.run(); }, 'button primary');
  private cancelButton = this.button('Cancel run', () => this.cancel());
  private stageButton = this.button('Add selected to draft', () => this.stage(), 'button primary');
  private discardButton = this.button('Discard proposal', () => { this.clear(); this.status.textContent = 'Proposal discarded. No configuration was changed.'; });
  private requestId?: string;
  private baseline?: { projectId: string; diskVersion: string; versions: string; draft: string };
  private proposal?: AgentProposal;
  private selected = new Set<string>();
  private includeSites = false;
  private includeStatuses = false;
  private includeDates = false;
  constructor(private host: AgentDiscoveryHost) {
    this.root.id = 'discovery-agent'; this.root.className = 'discovery-method'; this.root.open = true;
    const summary = document.createElement('summary'); summary.textContent = 'Discover with an agent';
    const help = document.createElement('p'); help.className = 'config-hint';
    help.textContent = 'The agent explores all indexable Markdown in this project through Specular\'s read-only tools, tests draft configurations with the same analyzer as Preview, and proposes categories with their measured matches. It cannot read other files, run commands, use the network, or change the project. A run takes a few minutes and stops at its tool-call limit or time limit. Codex uses its connection from Agent setup; Claude Code uses the executable path from Agent setup, or PATH, and its own sign-in.';
    this.agent.setAttribute('aria-label', 'Agent'); this.agent.add(new Option('Codex', 'codex')); this.agent.add(new Option('Claude Code', 'claude'));
    const agentLabel = document.createElement('label'); agentLabel.textContent = 'Agent'; agentLabel.append(this.agent);
    this.model.id = 'agent-discovery-model'; this.model.setAttribute('aria-label', 'Agent model'); this.model.placeholder = 'Connected agent default'; this.model.maxLength = 128;
    const modelLabel = document.createElement('label'); modelLabel.textContent = 'Model (optional)'; modelLabel.append(this.model);
    // Tool-call limit (86d): kept while the application is open, not saved.
    Object.assign(this.toolCalls, { type: 'number', min: String(MIN_TOOL_CALLS), max: String(MAX_RUN_LIMITS.toolCalls), step: '1', value: String(DEFAULT_RUN_LIMITS.toolCalls), id: 'agent-discovery-tool-calls' });
    this.toolCalls.setAttribute('aria-label', 'Tool-call limit'); this.toolCalls.oninput = () => this.updateButtons();
    const toolCallsLabel = document.createElement('label'); toolCallsLabel.textContent = 'Tool-call limit'; toolCallsLabel.append(this.toolCalls);
    this.toolCallsHint.id = 'agent-discovery-tool-calls-hint'; this.toolCallsHint.className = 'config-hint';
    this.runButton.id = 'run-agent-discovery'; this.cancelButton.id = 'cancel-agent-discovery'; this.stageButton.id = 'agent-discovery-stage';
    const actions = document.createElement('div'); actions.className = 'discovery-method-actions';
    actions.append(this.runButton, this.cancelButton, this.button('Agent setup', () => { this.cancel(); this.host.setupAgent(); }));
    this.status.id = 'agent-discovery-status'; this.status.setAttribute('role', 'status');
    this.log.id = 'agent-discovery-progress'; this.log.className = 'agent-discovery-progress'; this.log.setAttribute('aria-label', 'Agent progress');
    this.review.id = 'agent-discovery-review';
    const body = document.createElement('div'); body.className = 'discovery-method-body';
    const fields = document.createElement('div'); fields.className = 'agent-discovery-fields'; fields.append(agentLabel, modelLabel, toolCallsLabel);
    body.append(help, fields, this.toolCallsHint, actions, this.status, this.log, this.review);
    this.root.append(summary, body);
    window.specular.onAgentDiscoveryProgress(value => {
      if (value.requestId !== this.requestId) return;
      // The agent's commentary goes to the log only; the status line follows tool calls and run state.
      if (value.kind !== 'agent') this.status.textContent = value.message;
      const item = document.createElement('li'); item.className = `agent-progress-${value.kind}`; item.textContent = value.kind === 'agent' ? `${this.agent.selectedOptions[0]?.text ?? 'Agent'}: ${value.message}` : value.message; this.log.append(item);
      while (this.log.children.length > 80) this.log.firstElementChild!.remove();
      item.scrollIntoView?.({ block: 'nearest' });
    });
    // The host's context is not available while the dialog is constructed.
    this.cancelButton.disabled = this.stageButton.disabled = true;
  }
  private button(label: string, action: () => void, className = 'quiet-button') { const b = document.createElement('button'); b.type = 'button'; b.className = className; b.textContent = label; b.onclick = action; return b; }
  /** The chosen tool-call limit, or undefined when the field is invalid. */
  private toolCallLimit() { const value = this.toolCalls.value.trim() === '' ? NaN : Number(this.toolCalls.value); return toolCallLimitError(value) ? undefined : value; }
  private updateButtons() {
    const running = !!this.requestId, limit = this.toolCallLimit();
    this.toolCallsHint.textContent = limit === undefined ? toolCallLimitError(NaN)! : `A run stops after ${limit} tool calls or ${Math.round(runLimits(limit).wallMs / 60_000)} minutes. The agent is told its limit and warned near the end.`;
    this.toolCallsHint.classList.toggle('agent-discovery-limit-invalid', limit === undefined);
    this.runButton.disabled = running || limit === undefined || !this.host.context() || !!this.host.context()?.busy; this.cancelButton.disabled = !running; this.agent.disabled = this.model.disabled = this.toolCalls.disabled = running;
    this.stageButton.disabled = !this.proposal || (!this.selected.size && !this.includeSites && !this.includeStatuses && !this.includeDates);
  }
  private snapshot() {
    const context = this.host.context();
    return context && { projectId: context.projectId, diskVersion: context.state.diskVersion, versions: JSON.stringify(context.documentVersions), draft: JSON.stringify(this.host.draft()) };
  }
  private fresh() { const now = this.snapshot(), before = this.baseline; return !!now && !!before && now.projectId === before.projectId && now.diskVersion === before.diskVersion && now.versions === before.versions && now.draft === before.draft; }
  private clear() { this.proposal = undefined; this.baseline = undefined; this.selected.clear(); this.includeSites = this.includeStatuses = this.includeDates = false; this.review.replaceChildren(); this.updateButtons(); }
  private cancel() {
    const id = this.requestId; if (!id) return;
    this.requestId = undefined; void window.specular.cancelAgentDiscovery(id).catch(() => undefined);
    this.status.textContent = 'Discovery cancelled. No configuration was changed.'; this.updateButtons();
  }
  private async run() {
    const context = this.host.context(), toolCalls = this.toolCallLimit(); if (!context || this.requestId || toolCalls === undefined) return;
    this.clear(); this.log.replaceChildren();
    const id = crypto.randomUUID(); this.requestId = id; this.baseline = this.snapshot(); this.updateButtons();
    this.status.textContent = 'Starting agent discovery…';
    try {
      const model = this.model.value.trim(), agent = this.agent.value === 'claude' ? 'claude' as const : 'codex' as const;
      const result = await window.specular.runAgentDiscovery({ requestId: id, root: context.root, documentVersions: context.documentVersions, diskVersion: context.state.diskVersion, configuration: this.host.draft(), agent, ...(agent === 'claude' ? { executable: this.host.agentPath('claude') } : {}), ...(model ? { model } : {}), toolCalls });
      if (this.requestId !== id) return;
      this.requestId = undefined;
      if (!result.ok || !result.proposal) { this.baseline = undefined; this.status.textContent = result.message; return; }
      if (!this.fresh()) { this.baseline = undefined; this.status.textContent = 'Markdown, project, or configuration draft changed during the run. Run discovery again. No configuration was changed.'; return; }
      this.proposal = result.proposal;
      const draft = this.host.draft();
      for (const category of result.proposal.configuration.categories) if (categoryChange(draft, result.proposal.configuration, category.key) !== 'unchanged') this.selected.add(category.key);
      this.includeSites = sitesChanged(draft, result.proposal.configuration);
      this.includeStatuses = statusesChanged(draft, result.proposal.configuration);
      this.includeDates = datesChanged(draft, result.proposal.configuration);
      this.status.textContent = result.message;
      this.renderReview();
    } catch { if (this.requestId === id) { this.requestId = undefined; this.status.textContent = 'Discovery failed. Retry.'; } }
    finally { this.updateButtons(); }
  }
  private renderReview() {
    const proposal = this.proposal!, configuration = proposal.configuration, draft = this.host.draft();
    const heading = document.createElement('h3'); heading.textContent = 'Agent proposal';
    const note = document.createElement('p'); note.className = 'config-hint';
    note.textContent = `Agent-generated. Counts were measured by Specular on ${proposal.evaluation.definitions} definitions and ${proposal.evaluation.references} references. Selected categories replace their draft versions with their rules; categories the agent did not propose stay unchanged.`;
    const entries: HTMLElement[] = [heading, note];
    if (proposal.summary) { const summary = document.createElement('p'); summary.className = 'agent-discovery-summary'; summary.textContent = `Agent summary (agent-generated): ${proposal.summary}`; entries.push(summary); }
    const checkbox = (label: string, checked: boolean, change: (checked: boolean) => void) => {
      const wrapper = document.createElement('label'); wrapper.className = 'config-checkbox';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked; input.setAttribute('aria-label', label);
      input.onchange = () => { change(input.checked); this.updateButtons(); };
      wrapper.append(input, label); return wrapper;
    };
    for (const category of configuration.categories) {
      const change = categoryChange(draft, configuration, category.key), metrics = proposal.evaluation.categories.find(m => m.key === category.key);
      const item = document.createElement('section'); item.className = 'agent-discovery-category'; item.dataset.category = category.key;
      const title = document.createElement('h4'); title.textContent = `${category.name} · ${CHANGE_LABELS[change]}`;
      const counts = document.createElement('p'); counts.className = 'agent-discovery-counts';
      counts.textContent = metrics ? `${metrics.definitions} definitions · ${metrics.references} references · ${metrics.distinctIds} distinct IDs · ${metrics.duplicates} duplicates · ${metrics.unresolved} unresolved` : 'Not measured';
      const rules = document.createElement('ul'); rules.className = 'agent-discovery-rules';
      for (const rule of configuration.rules.filter(r => r.category === category.key)) { const li = document.createElement('li'); li.textContent = ruleText(rule); rules.append(li); }
      const details = document.createElement('p'); details.textContent = categoryText(category, configuration);
      const rationale = document.createElement('p'); rationale.className = 'agent-discovery-rationale'; rationale.textContent = `Agent rationale (agent-generated): ${proposal.rationale[category.key] ?? ''}`;
      item.append(checkbox(`Include ${category.name}`, this.selected.has(category.key), checked => { if (checked) this.selected.add(category.key); else this.selected.delete(category.key); }), title, counts);
      if (rules.children.length) item.append(rules);
      if (details.textContent) item.append(details);
      item.append(rationale); entries.push(item);
    }
    if (sitesChanged(draft, configuration)) {
      const item = document.createElement('section'); item.className = 'agent-discovery-category'; item.dataset.category = 'project-sites';
      const text = document.createElement('p'); text.textContent = `Project-wide ID definition sites: ${configuration.idDefinitionSites ? sitesText(configuration.idDefinitionSites) : 'the defaults'}.`;
      item.append(checkbox('Include project-wide ID definition sites', this.includeSites, checked => { this.includeSites = checked; }), text); entries.push(item);
    }
    // Statuses and dates (87): each part is staged as a whole, independently of the categories.
    const part = (key: string, title: string, include: boolean, change: (checked: boolean) => void, lines: [string, string][], rationale?: string) => {
      const item = document.createElement('section'); item.className = 'agent-discovery-category'; item.dataset.category = key;
      const heading = document.createElement('h4'); heading.textContent = title;
      item.append(checkbox(`Include ${title.toLowerCase()}`, include, change), heading);
      for (const [className, text] of lines) { const p = document.createElement('p'); p.className = className; p.textContent = text; item.append(p); }
      const reason = document.createElement('p'); reason.className = 'agent-discovery-rationale'; reason.textContent = `Agent rationale (agent-generated): ${rationale ?? ''}`; item.append(reason);
      entries.push(item);
    };
    if (statusesChanged(draft, configuration)) part('statuses', 'Statuses', this.includeStatuses, checked => { this.includeStatuses = checked; }, [
      ['agent-discovery-current', `Current status sites: ${statusSitesText(draft.statusSites)}. Statuses: ${statusListText(draft.statuses)}.`],
      ['agent-discovery-proposed', `Proposed status sites: ${statusSitesText(configuration.statusSites)}. Statuses: ${statusListText(configuration.statuses)}.`],
      ['agent-discovery-counts', statusMetricsText(proposal.evaluation.statuses)],
    ], proposal.statusRationale);
    if (datesChanged(draft, configuration)) part('dates', 'Date rules', this.includeDates, checked => { this.includeDates = checked; }, [
      ['agent-discovery-current', `Current date rules: ${dateSettingsText(draft.dates)}.`],
      ['agent-discovery-proposed', `Proposed date rules: ${dateSettingsText(configuration.dates)}.`],
      ['agent-discovery-counts', dateMetricsText(proposal.evaluation.dates)],
    ], proposal.dateRationale);
    if (proposal.gaps.length) {
      const item = document.createElement('section'); item.className = 'agent-discovery-gaps'; item.dataset.category = 'gaps';
      const heading = document.createElement('h4'); heading.textContent = 'Gaps (agent-generated, not applied)';
      const note = document.createElement('p'); note.className = 'config-hint'; note.textContent = 'Conventions the agent found that the configuration cannot express. They are notes only.';
      const list = document.createElement('ul'); for (const gap of proposal.gaps) { const li = document.createElement('li'); li.textContent = gapText(gap); list.append(li); }
      const copy = this.button('Copy gaps', () => { void window.specular.copyBrief(proposal.gaps.map(gap => `- ${gapText(gap)}`).join('\n')).then(() => { this.status.textContent = 'Gaps copied.'; }, () => { this.status.textContent = 'Could not copy the gaps.'; }); });
      copy.id = 'agent-discovery-copy-gaps';
      item.append(heading, note, list, copy); entries.push(item);
    }
    const actions = document.createElement('div'); actions.className = 'discovery-actions'; actions.append(this.stageButton, this.discardButton);
    entries.push(actions);
    this.review.replaceChildren(...entries); this.updateButtons();
  }
  private stage() {
    if (!this.proposal) return;
    if (!this.fresh()) { this.clear(); this.status.textContent = 'Markdown, project, or configuration draft changed. Run discovery again. No configuration was changed.'; return; }
    try {
      const draft = stageAgentProposal(this.host.draft(), this.proposal.configuration, this.selected, this.includeSites, { statuses: this.includeStatuses, dates: this.includeDates });
      const count = this.selected.size;
      const parts = [count ? `${count} ${count === 1 ? 'category' : 'categories'}` : '', this.includeSites ? 'the project-wide ID definition sites' : '', this.includeStatuses ? 'the statuses' : '', this.includeDates ? 'the date rules' : ''].filter(Boolean);
      this.clear(); this.host.stage(draft);
      this.status.textContent = `Added ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]} to the draft. Preview matches, then Apply to save. Nothing has been saved yet.`;
    } catch (error) { this.status.textContent = error instanceof Error ? error.message : String(error); }
  }
  update() { if (this.proposal && !this.fresh()) { this.clear(); this.status.textContent = 'Markdown, project, or configuration draft changed. Run discovery again before using the proposal.'; } this.updateButtons(); }
  dispose() { this.cancel(); this.clear(); }
}
