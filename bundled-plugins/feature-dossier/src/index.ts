import type { CustomViewContext, RenderRequest, SourceRange, SummaryRecord } from '@specular/plugin-api';
import { buildDossier, changesText, citationParts, featureChoices, MAX_EXCERPT_LINES, type Dossier, type DossierId, type DossierLink } from './dossier.js';
import { style } from './style.js';

interface State { feature?: string; open: string[]; closedSections: string[]; agent?: 'codex' | 'claude'; model?: string; summaryClosed?: boolean }
/** Increment 94b: what the dossier knows about each feature's generated summary. */
interface SummaryState { record?: SummaryRecord; loaded: boolean; generating: boolean; error?: string; fetched?: string }

export function activate(context: CustomViewContext) {
  const root = context.root as unknown as HTMLElement;
  let request = context.request;
  const state: State = { open: [], closedSections: [] };
  if (request.customState) { try { Object.assign(state, JSON.parse(request.customState)); } catch {} }
  const css = document.createElement('style'); css.textContent = style;
  const surface = document.createElement('section'); surface.id = 'feature-dossier';
  root.replaceChildren(css, surface);
  const save = () => context.saveState?.(JSON.stringify(state));
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
  };
  const open = (source: SourceRange, revision: number) => {
    if (revision !== request.context.revision) return;
    save(); context.openSource({ projectId: request.context.projectId, revision, file: source.file, start: source.start, end: source.end });
  };
  const sourceButton = (text: string, source: SourceRange, revision: number, className = 'dossier-source') => {
    const button = element('button', className, text); button.type = 'button'; button.onclick = () => open(source, revision); return button;
  };
  const colorOf = (colors?: { light?: string; dark?: string }) => colors?.[request.appearance?.mode ?? 'dark'];

  function empty(message: string) { const p = element('p', 'dossier-empty', message); surface.append(p); }

  function picker(choices: { key: string; name: string; count: number }[]) {
    const row = element('div', 'dossier-picker');
    const label = element('label', undefined, 'Feature'); label.htmlFor = 'dossier-feature';
    const select = element('select'); select.id = 'dossier-feature';
    if (!choices.some(c => c.key === state.feature)) select.append(new Option('Choose a feature', ''));
    for (const c of choices) select.append(new Option(`${c.name} (${c.count} ${c.count === 1 ? 'ID' : 'IDs'})`, c.key));
    select.value = choices.some(c => c.key === state.feature) ? state.feature! : '';
    select.onchange = () => { state.feature = select.value || undefined; state.open = []; save(); render(); };
    row.append(label, select); surface.append(row);
  }

  function summary(dossier: Dossier) {
    const box = element('section', 'dossier-summary'); box.setAttribute('aria-label', 'Summary');
    const total = dossier.sections.reduce((n, s) => n + s.ids.length, 0);
    box.append(element('h2', undefined, dossier.feature.name));
    box.append(element('p', 'dossier-counts', `${total} ${total === 1 ? 'ID' : 'IDs'}: ${dossier.sections.map(s => `${s.ids.length} ${s.name}`).join(' · ')}`));
    const s = dossier.summary;
    const segments = [...s.statuses.map(x => ({ name: x.name, count: x.count, color: colorOf(x.colors) })),
      ...(s.statusConflicts ? [{ name: 'Status conflicts', count: s.statusConflicts, color: undefined, kind: 'conflict' }] : []),
      ...(s.noStatus ? [{ name: 'No status', count: s.noStatus, color: undefined, kind: 'none' }] : [])];
    if (total) {
      const bar = element('div', 'dossier-status-bar'); bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `Authored statuses: ${segments.map(x => `${x.name} ${x.count}`).join(', ')}`);
      const legend = element('ul', 'dossier-legend');
      for (const x of segments) {
        const part = element('span', `dossier-segment${'kind' in x ? ` ${x.kind}` : ''}`); part.style.flexGrow = String(x.count); part.title = `${x.name}: ${x.count}`;
        if (x.color) part.style.background = x.color;
        bar.append(part);
        const item = element('li'); const swatch = element('span', `dossier-swatch${'kind' in x ? ` ${x.kind}` : ''}`); if (x.color) swatch.style.background = x.color;
        item.append(swatch, document.createTextNode(`${x.name} ${x.count}`)); legend.append(item);
      }
      box.append(bar, legend);
    }
    const markers = [[s.featureConflicts, 'with a feature conflict'], [s.referencedOnly, 'referenced only'], [s.duplicated, 'duplicated']].filter(([n]) => n) as [number, string][];
    if (markers.length) box.append(element('p', 'dossier-markers', markers.map(([n, text]) => `${n} ${text}`).join(' · ')));
    surface.append(box);
  }

  function badges(item: DossierId) {
    const row = element('span', 'dossier-badges');
    if (item.status) row.append(element('span', `dossier-badge status${item.status.conflict ? ' conflict' : ''}`, item.status.name));
    if (item.featureConflict) row.append(element('span', 'dossier-badge warning', 'Feature conflict'));
    if (item.referencedOnly) row.append(element('span', 'dossier-badge muted', 'Referenced only'));
    if (item.duplicate) row.append(element('span', 'dossier-badge warning', 'Duplicate'));
    return row;
  }

  function links(title: string, list: DossierLink[], revision: number, inside: boolean) {
    const box = element('div', 'dossier-links');
    box.append(element('h4', undefined, `${title} (${list.length})`));
    if (!list.length) { box.append(element('p', 'dossier-muted', 'None recorded.')); return box; }
    for (const link of list) {
      const arrow = link.direction === 'out' ? '→' : link.direction === 'in' ? '←' : '↔';
      const text = `${arrow} ${link.label}${link.defined ? '' : ' (not defined)'} · ${link.evidence} ${link.evidence === 1 ? 'mention' : 'mentions'}`;
      if (inside) {
        const button = element('button', 'dossier-link', text); button.type = 'button'; button.dataset.target = link.key;
        button.onclick = () => reveal(link.key); box.append(button);
      } else if (link.target) box.append(sourceButton(text, link.target, revision, 'dossier-link'));
      else box.append(element('span', 'dossier-link', text));
    }
    return box;
  }

  function idCard(item: DossierId, revision: number) {
    const card = element('details', 'dossier-id'); card.dataset.key = item.key;
    card.open = state.open.includes(item.key);
    const head = element('summary');
    head.append(element('span', 'dossier-id-label', item.label), element('span', 'dossier-id-title', item.title), badges(item));
    card.append(head);
    const body = element('div', 'dossier-id-body');
    for (const e of item.excerpts) {
      const block = element('div', 'dossier-excerpt');
      block.append(element('pre', undefined, e.text));
      if (e.truncated) block.append(element('p', 'dossier-muted', `Excerpt limited to ${MAX_EXCERPT_LINES} lines.`));
      block.append(sourceButton(`Open ${e.source.file}:${e.line}`, e.source, revision));
      body.append(block);
    }
    if (!item.excerpts.length) body.append(element('p', 'dossier-muted', 'Referenced only: no definition is recorded.'));
    body.append(links('In this feature', item.inside, revision, true), links('Other features and IDs', item.outside, revision, false));
    card.append(body);
    card.ontoggle = () => {
      state.open = card.open ? [...new Set([...state.open, item.key])] : state.open.filter(k => k !== item.key); save();
    };
    return card;
  }

  function reveal(key: string) {
    const card = [...surface.querySelectorAll<HTMLDetailsElement>('.dossier-id')].find(c => c.dataset.key === key);
    if (!card) return;
    const section = card.closest<HTMLDetailsElement>('.dossier-section'); if (section) section.open = true;
    card.open = true; card.scrollIntoView({ block: 'nearest' }); card.querySelector<HTMLElement>('summary')?.focus();
  }

  // Increment 94b: generated summaries, through Specular's summary service when the host offers it.
  const summaries = new Map<string, SummaryState>();
  // A collapsible section below the summary card; its header stays in place so focus survives updates.
  let summaryBox: { body: HTMLElement; hint: HTMLElement } | undefined;
  const summaryOf = (feature: string) => { let s = summaries.get(feature); if (!s) { s = { loaded: false, generating: false }; summaries.set(feature, s); } return s; };
  async function fetchSummary(feature: string) {
    const s = summaryOf(feature), tag = `${request.context.projectId}@${request.context.revision}`;
    if (!context.summaries || s.fetched === tag) return;
    s.fetched = tag;
    try { s.record = await context.summaries.get({ kind: 'feature', key: feature }); s.error = undefined; }
    catch (error) { s.error = error instanceof Error ? error.message : 'The summary could not be read.'; }
    s.loaded = true; if (state.feature === feature) renderSummary();
  }
  async function generateSummary(feature: string) {
    const s = summaryOf(feature);
    if (!context.summaries || s.generating) return;
    s.generating = true; s.error = undefined; renderSummary();
    try { s.record = await context.summaries.generate({ kind: 'feature', key: feature }, { agent: state.agent ?? 'claude', ...(state.model ? { model: state.model } : {}) }); }
    catch (error) { s.error = error instanceof Error ? error.message : 'The summary failed.'; }
    s.generating = false; s.loaded = true; if (state.feature === feature) renderSummary();
  }
  function citedText(record: SummaryRecord, members: Set<string>) {
    const p = element('p', 'dossier-summary-text'), project = request.models.project!, revision = request.context.revision;
    const byKey = new Map(project.ids.map(e => [e.key, e]));
    for (const part of citationParts(record.text, project)) {
      const target = part.key ? byKey.get(part.key) : undefined;
      if (!part.key) p.append(document.createTextNode(part.text));
      else if (members.has(part.key)) { const b = element('button', 'dossier-citation', part.text); b.type = 'button'; b.onclick = () => reveal(part.key!); p.append(b); }
      else if (target?.definitions[0]) p.append(sourceButton(part.text, target.definitions[0], revision, 'dossier-citation'));
      else p.append(document.createTextNode(part.text));
    }
    return p;
  }
  function renderSummary() {
    const feature = state.feature;
    if (!summaryBox || !feature || !context.summaries) return;
    const box = summaryBox.body, s = summaryOf(feature), stale = s.record && changesText(s.record.changes);
    box.replaceChildren();
    summaryBox.hint.textContent = s.generating ? 'Generating…' : stale ? 'Out of date' : s.loaded && !s.record ? 'None yet' : '';
    summaryBox.hint.className = `dossier-generated-hint${stale && !s.generating ? ' stale' : ''}`;
    const members = new Set([...surface.querySelectorAll<HTMLElement>('.dossier-id')].map(c => c.dataset.key!));
    if (!s.loaded && !s.generating) box.append(element('p', 'dossier-muted', 'Looking for a stored summary…'));
    if (s.record) {
      const r = s.record, date = new Date(r.generatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      box.append(element('p', 'dossier-summary-label', `Generated by ${r.agent === 'claude' ? 'Claude Code' : 'Codex'}${r.model ? ` (${r.model})` : ''} on ${date} from the recorded specifications. Not recorded content.`));
      if (stale) box.append(element('p', 'dossier-summary-stale', `Out of date: ${stale} since it was generated.`));
      box.append(citedText(r, members));
      if (r.unknownCitations.length) box.append(element('p', 'dossier-summary-unknown', `Cites ${r.unknownCitations.length} ${r.unknownCitations.length === 1 ? 'ID' : 'IDs'} not in the project: ${r.unknownCitations.join(', ')}.`));
    } else if (s.loaded && !s.generating) box.append(element('p', 'dossier-muted', 'No summary yet. Generate one from the recorded content of this feature; Specular asks before sending it to an agent.'));
    if (s.error) box.append(element('p', 'dossier-summary-error', s.error));
    const controls = element('div', 'dossier-summary-controls');
    if (s.generating) {
      controls.append(element('span', 'dossier-muted', 'Generating…'));
      const cancel = element('button', 'dossier-button', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => context.summaries!.cancel({ kind: 'feature', key: feature });
      controls.append(cancel);
    } else {
      const agent = element('select'); agent.id = 'dossier-summary-agent'; agent.setAttribute('aria-label', 'Agent');
      agent.append(new Option('Claude Code', 'claude'), new Option('Codex', 'codex')); agent.value = state.agent ?? 'claude';
      agent.onchange = () => { state.agent = agent.value as 'codex' | 'claude'; save(); };
      const model = element('input'); model.id = 'dossier-summary-model'; model.placeholder = 'Model (optional)'; model.setAttribute('aria-label', 'Model'); model.maxLength = 200; model.value = state.model ?? '';
      model.onchange = () => { state.model = model.value.trim() || undefined; save(); };
      const go = element('button', 'dossier-button primary', s.record ? 'Regenerate' : 'Generate summary'); go.type = 'button'; go.onclick = () => { void generateSummary(feature); };
      controls.append(agent, model, go);
    }
    box.append(controls);
  }

  function render() {
    const scroller = document.scrollingElement ?? document.documentElement, scroll = scroller.scrollTop, focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key;
    surface.replaceChildren();
    const project = request.models.project!, revision = request.context.revision;
    if (!project.ready) { empty('Waiting for the project model…'); return; }
    const choices = featureChoices(project);
    if (!choices.length) { empty('No features are configured. Add features in Project configuration to see their dossiers.'); return; }
    if (state.feature === undefined && !request.customState) state.feature = choices[0].key;
    picker(choices);
    const dossier = state.feature === undefined ? undefined : buildDossier(request.models, state.feature);
    if (!dossier) { empty('Choose a feature to see its requirements, design, tasks, statuses, and sources.'); return; }
    if (!dossier.sections.length) { summaryBox = undefined; summary(dossier); empty('No IDs belong to this feature yet. Assign IDs with file rules or overrides in Project configuration.'); return; }
    summary(dossier);
    summaryBox = undefined;
    if (context.summaries) {
      const details = element('details', 'dossier-generated'); details.open = !state.summaryClosed;
      const head = element('summary'), hint = element('span', 'dossier-generated-hint'), body = element('div', 'dossier-generated-body');
      head.append(element('span', undefined, 'Generated summary'), hint); body.setAttribute('aria-live', 'polite');
      details.append(head, body); surface.append(details);
      details.ontoggle = () => { state.summaryClosed = !details.open; save(); };
      summaryBox = { body, hint };
    }
    for (const section of dossier.sections) {
      const box = element('details', 'dossier-section'); box.dataset.section = section.key; box.open = !state.closedSections.includes(section.key);
      box.append(element('summary', undefined, `${section.name} (${section.ids.length})`));
      for (const item of section.ids) box.append(idCard(item, revision));
      box.ontoggle = () => { state.closedSections = box.open ? state.closedSections.filter(k => k !== section.key) : [...new Set([...state.closedSections, section.key])]; save(); };
      surface.append(box);
    }
    const dates = element('section', 'dossier-dates'); dates.append(element('h3', undefined, 'Recent dates'));
    if (!dossier.dates.length) dates.append(element('p', 'dossier-muted', 'No dated statuses or events are recorded for these IDs.'));
    for (const d of dossier.dates) dates.append(sourceButton(`${d.value} · ${d.label} · ${d.text}`, d.source, revision, 'dossier-source dossier-date'));
    const files = element('section', 'dossier-files'); files.append(element('h3', undefined, 'Files'));
    for (const f of dossier.files) files.append(sourceButton(`${f.file} · ${f.count} ${f.count === 1 ? 'definition' : 'definitions'}`, f.first, revision, 'dossier-source dossier-file'));
    surface.append(dates, files);
    renderSummary(); void fetchSummary(dossier.feature.key);
    scroller.scrollTop = scroll;
    if (focused) [...surface.querySelectorAll<HTMLElement>('.dossier-id')].find(c => c.dataset.key === focused)?.querySelector<HTMLElement>('summary')?.focus();
  }

  // Every update re-renders: content follows the revision, and status colours follow the theme.
  const update = (next: RenderRequest) => { request = next; render(); };
  render();
  return { update, dispose() {} };
}
