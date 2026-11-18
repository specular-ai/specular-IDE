import type { AgentSession, AgentTurn, CustomViewContext, RenderRequest, ToolCall } from '@specular/plugin-api';
import { AGENT_NAMES, callTarget, commandGroups, durationText, failed, filterSessions, groupCalls, REPEATED_FAILURES, resources, sessionKey, totals, type Agent, type Filters } from './activity.js';
import { style } from './style.js';

type Tab = 'sessions' | 'resources' | 'commands';
interface State extends Filters { tab: Tab; open: string[]; openGroups: string[]; specOnly?: boolean; failedSessionsOnly?: boolean; failedCommandsOnly?: boolean }
const TABS: [Tab, string][] = [['sessions', 'Sessions'], ['resources', 'Resources'], ['commands', 'Commands']];
const OUTCOMES: Record<ToolCall['outcome'], string> = { ok: 'ok', error: 'failed', denied: 'denied', unknown: 'no result' };
/** Rows shown before asking to narrow the filters. */
const MAX_ROWS = 500, MAX_TURN_CALLS = 500;

export function activate(context: CustomViewContext) {
  const root = context.root as unknown as HTMLElement;
  let request = context.request;
  const state: State = { tab: 'sessions', open: [], openGroups: [] };
  if (request.customState) { try { Object.assign(state, JSON.parse(request.customState)); } catch {} }
  const css = document.createElement('style'); css.textContent = style;
  const surface = document.createElement('section'); surface.id = 'agent-activity';
  root.replaceChildren(css, surface);
  const save = () => context.saveState?.(JSON.stringify(state));
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
  };
  const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const outcome = (c: { outcome: ToolCall['outcome']; exitCode?: number }) =>
    element('span', `activity-outcome ${c.outcome}`, `${OUTCOMES[c.outcome]}${c.exitCode !== undefined && c.exitCode !== 0 ? ` (exit ${c.exitCode})` : ''}`);
  const empty = (message: string) => surface.append(element('p', 'activity-empty', message));
  const sessionName = (s: AgentSession) => s.title || `${AGENT_NAMES[s.agent]} session ${s.id.slice(0, 8)}`;
  const check = (id: string, label: string, key: 'specOnly' | 'failedSessionsOnly' | 'failedCommandsOnly') => {
    const toggle = element('label', 'activity-check'), box = element('input'); box.type = 'checkbox'; box.id = id; box.checked = !!state[key];
    box.onchange = () => { state[key] = box.checked || undefined; save(); render(); };
    toggle.append(box, document.createTextNode(` ${label}`));
    return toggle;
  };

  function openFile(file: string) {
    const revision = request.context.revision;
    if (!request.models.physical?.documents.some(d => d.file === file)) return;
    save(); context.openSource({ projectId: request.context.projectId, revision, file, start: 0, end: 0 });
  }

  function header(all: readonly AgentSession[]) {
    const activity = request.models.activity!;
    const box = element('header', 'activity-header');
    box.append(element('h2', undefined, 'Agent activity'));
    const t = totals(all);
    box.append(element('p', 'activity-counts', `${plural(t.sessions, 'session')} · ${plural(t.turns, 'turn')} · ${plural(t.toolCalls, 'tool call')} · ${plural(t.failures, 'failure')}`));
    const sources = activity.sources.map(s => `${AGENT_NAMES[s.agent]}: ${plural(s.files, 'log')}${s.skippedLines ? `, ${plural(s.skippedLines, 'line')} skipped` : ''}${s.truncated ? ', limit reached' : ''}`);
    if (sources.length) box.append(element('p', 'activity-note', sources.join(' · ')));
    for (const warning of activity.warnings) box.append(element('p', 'activity-warning', warning));
    surface.append(box);
  }

  function filters() {
    const row = element('div', 'activity-filters');
    const field = (label: string, control: HTMLElement, id: string) => {
      const wrap = element('div', 'activity-field'), l = element('label', undefined, label); l.htmlFor = id; control.id = id; wrap.append(l, control); row.append(wrap);
    };
    const agent = element('select');
    agent.append(new Option('All agents', ''), ...(Object.keys(AGENT_NAMES) as Agent[]).map(a => new Option(AGENT_NAMES[a], a)));
    agent.value = state.agent ?? '';
    agent.onchange = () => { state.agent = (agent.value || undefined) as Agent | undefined; state.session = undefined; save(); render(); };
    field('Agent', agent, 'activity-agent');
    for (const [key, label] of [['from', 'From'], ['to', 'To']] as const) {
      const input = element('input'); input.type = 'date'; input.value = state[key] ?? '';
      input.onchange = () => { state[key] = input.value || undefined; state.session = undefined; save(); render(); };
      field(label, input, `activity-${key}`);
    }
    const session = element('select'), choices = filterSessions(request.models.activity!, { ...state, session: undefined });
    session.append(new Option(`All sessions (${choices.length})`, ''), ...choices.map(s => new Option(`${when(s.started)} · ${AGENT_NAMES[s.agent]} · ${sessionName(s)}`, sessionKey(s))));
    session.value = choices.some(s => sessionKey(s) === state.session) ? state.session! : '';
    session.onchange = () => { state.session = session.value || undefined; if (state.session) state.open = [...new Set([...state.open, state.session])]; save(); render(); };
    field('Session', session, 'activity-session');
    if (state.agent || state.from || state.to || state.session) {
      const clear = element('button', 'activity-button', 'Clear filters'); clear.type = 'button';
      clear.onclick = () => { state.agent = state.from = state.to = state.session = undefined; save(); render(); };
      row.append(clear);
    }
    surface.append(row);
  }

  function tabs() {
    const list = element('div', 'activity-tabs'); list.setAttribute('role', 'tablist');
    for (const [tab, label] of TABS) {
      const button = element('button', 'activity-tab', label); button.type = 'button'; button.setAttribute('role', 'tab'); button.dataset.tab = tab;
      button.setAttribute('aria-selected', String(state.tab === tab));
      button.onclick = () => { state.tab = tab; save(); render(); };
      list.append(button);
    }
    surface.append(list);
  }

  function callRow(c: ToolCall) {
    const row = element('li', `activity-call${failed(c) ? ' failed' : ''}`);
    row.append(element('span', 'activity-time', clock(c.at)), element('span', 'activity-tool', c.tool), element('span', `activity-kind ${c.kind}`, c.kind));
    const target = element('span', 'activity-target', callTarget(c)); target.title = callTarget(c);
    row.append(target, outcome(c));
    if (c.sidechain) row.append(element('span', 'activity-badge', 'subagent'));
    return row;
  }

  function turnBox(turn: AgentTurn) {
    const box = element('details', 'activity-turn');
    const fails = turn.toolCalls.filter(failed).length;
    const head = element('summary');
    head.append(element('span', undefined, `Turn ${turn.index + 1}`), element('span', 'activity-muted', `${clock(turn.started)} · ${plural(turn.toolCalls.length, 'tool call')}`));
    if (fails) head.append(element('span', 'activity-badge failed', plural(fails, 'failure')));
    box.append(head);
    box.ontoggle = () => {
      if (!box.open || box.querySelector('ul')) return;
      const list = element('ul', 'activity-calls');
      for (const c of turn.toolCalls.slice(0, MAX_TURN_CALLS)) list.append(callRow(c));
      box.append(list);
      if (turn.toolCalls.length > MAX_TURN_CALLS) box.append(element('p', 'activity-muted', `Showing the first ${MAX_TURN_CALLS} of ${turn.toolCalls.length} tool calls.`));
      if (!turn.toolCalls.length) box.append(element('p', 'activity-muted', 'No tool calls.'));
    };
    return box;
  }

  function sessionsView(all: AgentSession[]) {
    const panel = element('div', 'activity-panel'); panel.dataset.view = 'sessions';
    panel.append(check('activity-failed-sessions', 'Only sessions with failures', 'failedSessionsOnly'));
    const sessions = state.failedSessionsOnly ? all.filter(s => s.failures) : all;
    if (!sessions.length) panel.append(element('p', 'activity-muted', 'No sessions with failures match the filters.'));
    for (const s of sessions.slice(0, MAX_ROWS)) {
      const key = sessionKey(s), box = element('details', 'activity-session'); box.dataset.key = key;
      const head = element('summary');
      head.append(element('span', `activity-agent ${s.agent}`, AGENT_NAMES[s.agent]), element('span', 'activity-title', sessionName(s)));
      const facts = [when(s.started), durationText(s.started, s.ended), s.branch, s.cwd ? `in ${s.cwd}` : '', s.model, plural(s.turns.length, 'turn'), plural(s.toolCalls, 'tool call')].filter(Boolean);
      head.append(element('span', 'activity-muted', facts.join(' · ')));
      if (s.failures) head.append(element('span', 'activity-badge failed', plural(s.failures, 'failure')));
      if (s.truncated) head.append(element('span', 'activity-badge', 'truncated'));
      box.append(head);
      const body = element('div', 'activity-session-body');
      const turns = state.failedSessionsOnly ? s.turns.filter(t => t.toolCalls.some(failed)) : s.turns;
      const fill = () => { if (!body.childElementCount) { for (const turn of turns) body.append(turnBox(turn)); if (!turns.length) body.append(element('p', 'activity-muted', 'No turns recorded.')); } };
      box.append(body);
      box.open = state.open.includes(key) || state.session === key;
      if (box.open) fill();
      box.ontoggle = () => { if (box.open) fill(); state.open = box.open ? [...new Set([...state.open, key])] : state.open.filter(k => k !== key); save(); };
      panel.append(box);
    }
    if (sessions.length > MAX_ROWS) panel.append(element('p', 'activity-muted', `Showing the newest ${MAX_ROWS} of ${sessions.length} sessions; narrow the filters to see others.`));
    surface.append(panel);
  }

  function resourcesView(sessions: AgentSession[]) {
    const panel = element('div', 'activity-panel'); panel.dataset.view = 'resources';
    const { files, outside } = resources(sessions, request.models.physical);
    panel.append(check('activity-spec-only', 'Specification files only', 'specOnly'));
    const shown = state.specOnly ? files.filter(f => f.spec) : files;
    if (!shown.length) panel.append(element('p', 'activity-muted', state.specOnly ? 'No specification files were read or written in these sessions.' : 'No project files were named in these sessions.'));
    else {
      const table = element('table', 'activity-table'), head = element('tr');
      for (const h of ['File', 'Reads', 'Writes', 'Other', 'Sessions', 'Last access']) head.append(element('th', undefined, h));
      table.append(element('thead'), element('tbody')); table.tHead!.append(head);
      for (const f of shown.slice(0, MAX_ROWS)) {
        const row = element('tr'); row.dataset.path = f.path;
        const cell = element('td', 'activity-path');
        if (f.spec) { const b = element('button', 'activity-file', f.path); b.type = 'button'; b.onclick = () => openFile(f.path); cell.append(b, element('span', 'activity-badge spec', 'spec')); }
        else cell.append(element('span', undefined, f.path));
        row.append(cell, ...[f.reads, f.writes, f.other, f.sessions].map(n => element('td', 'activity-number', n ? n.toLocaleString() : '')), element('td', 'activity-muted', when(f.last)));
        table.tBodies[0].append(row);
      }
      panel.append(table);
      if (shown.length > MAX_ROWS) panel.append(element('p', 'activity-muted', `Showing the ${MAX_ROWS} most used of ${shown.length} files.`));
    }
    panel.append(element('p', 'activity-note', `${outside ? `${plural(outside, 'path')} outside the project ${outside === 1 ? 'was' : 'were'} named; they are counted, not listed. ` : ''}Other counts searches and commands that name a file.`));
    surface.append(panel);
  }

  function commandsView(sessions: AgentSession[]) {
    const panel = element('div', 'activity-panel'); panel.dataset.view = 'commands';
    panel.append(check('activity-failed-commands', 'Only commands with failures', 'failedCommandsOnly'));
    const groups = commandGroups(sessions).filter(g => !state.failedCommandsOnly || g.failures);
    if (!groups.length) panel.append(element('p', 'activity-muted', state.failedCommandsOnly ? 'No shell commands failed in these sessions.' : 'No shell commands were run in these sessions.'));
    for (const g of groups.slice(0, MAX_ROWS)) {
      const box = element('details', `activity-group${g.repeated ? ' repeated' : ''}`); box.dataset.group = g.name;
      const head = element('summary');
      head.append(element('code', 'activity-group-name', g.name), element('span', 'activity-muted', `${plural(g.count, 'call')} · ${plural(g.sessions, 'session')}`));
      if (g.failures) head.append(element('span', 'activity-badge failed', plural(g.failures, 'failure')));
      if (g.repeated) { const b = element('span', 'activity-badge repeated', `Repeated failure in ${plural(g.repeated, 'session')}`); b.title = `Failed at least ${REPEATED_FAILURES} times in one session.`; head.append(b); }
      const last = element('span', 'activity-last'); last.append(document.createTextNode(`Last ${when(g.last.at)}: `), outcome(g.last)); head.append(last);
      box.append(head);
      const fill = () => {
        if (box.querySelector('ul')) return;
        const list = element('ul', 'activity-calls');
        for (const { session, call } of groupCalls(sessions, g.name)) {
          const row = element('li', `activity-call${failed(call) ? ' failed' : ''}`);
          const text = element('span', 'activity-target', call.command!); text.title = call.command!;
          row.append(element('span', 'activity-time', when(call.at)), element('span', `activity-agent ${session.agent}`, AGENT_NAMES[session.agent]), text, outcome(call));
          list.append(row);
        }
        box.append(list);
        if (g.count > 50) box.append(element('p', 'activity-muted', `Showing the newest 50 of ${g.count} calls.`));
      };
      box.open = state.openGroups.includes(g.name); if (box.open) fill();
      box.ontoggle = () => { if (box.open) fill(); state.openGroups = box.open ? [...new Set([...state.openGroups, g.name])] : state.openGroups.filter(k => k !== g.name); save(); };
      panel.append(box);
    }
    if (groups.length > MAX_ROWS) panel.append(element('p', 'activity-muted', `Showing the ${MAX_ROWS} most used of ${groups.length} command groups.`));
    panel.append(element('p', 'activity-note', `Commands are grouped by their first words. A group that failed at least ${REPEATED_FAILURES} times in one session is marked as a repeated failure.`));
    surface.append(panel);
  }

  function render() {
    const scroller = document.scrollingElement ?? document.documentElement, scroll = scroller.scrollTop;
    surface.replaceChildren();
    const activity = request.models.activity;
    if (!activity) { empty('This version of Specular does not provide agent activity.'); return; }
    if (!activity.enabled) { empty('Reading agent sessions is off for this project. Turn on "Read agent sessions for this project" in Agent setup to see what Claude Code and Codex did here.'); return; }
    if (!activity.ready) { empty('Reading agent sessions…'); return; }
    if (!activity.sessions.length) { header(activity.sessions); empty('No Claude Code or Codex sessions were found for this project. Sessions appear here when an agent works in the project folder or one of its subfolders.'); return; }
    if (state.session && !activity.sessions.some(s => sessionKey(s) === state.session)) state.session = undefined;
    const sessions = filterSessions(activity, state);
    header(activity.sessions); filters(); tabs();
    if (!sessions.length) empty('No sessions match the filters.');
    else if (state.tab === 'resources') resourcesView(sessions);
    else if (state.tab === 'commands') commandsView(sessions);
    else sessionsView(sessions);
    scroller.scrollTop = scroll;
  }

  // Every update re-renders: activity follows the logs, specification files follow the revision.
  const update = (next: RenderRequest) => { request = next; render(); };
  render();
  return { update, dispose() {} };
}
