import { randomUUID } from 'node:crypto';
import { ConversationHistory, type SavedConversation } from './conversation-history';
import { CodexConnection, projectDirectory } from './codex-connection';
import type { CodexModel, CodexSendResult, ConversationState } from '../shared/types';
import { codexCommands, parseCodexCommand, validModelId, commandRuntimeSupported } from '../shared/codex-commands';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const busy = (state: ConversationState) => ['starting', 'running', 'stopping'].includes(state.status);
const MAX_TEXT = 200_000;
const samePath = (a?: string, b?: string) => a?.toLowerCase() === b?.toLowerCase();
type ActiveTurn = { id?: string; compact?: boolean; compacted?: boolean; interruptRequested?: boolean; cancelled: boolean; dispatched: boolean; timer?: ReturnType<typeof setTimeout>; stopTimer?: ReturnType<typeof setTimeout> };
export function turnError(value: unknown): string {
  const error = record(value); const info = error.codexErrorInfo;
  const code = typeof info === 'string' ? info : Object.keys(record(info))[0];
  const http = record(record(info)[code]).httpStatusCode;
  // Some runtime versions wrap upstream 401s in `other` with no structured HTTP status.
  // Inspect only for classification; raw error text is never returned or logged.
  const raw = typeof error.message === 'string' ? error.message : '';
  if (code === 'unauthorized' || http === 401 || /\b401\b|invalid_api_key|incorrect api key|invalid api key/i.test(raw)) return 'OpenAI rejected the API key. Reconnect in Agent setup with a valid key.';
  if (code === 'usageLimitExceeded' || code === 'rateLimitExceeded' || code === 'sessionBudgetExceeded' || http === 429) return 'OpenAI usage or rate limit reached. Check API billing and limits, then retry.';
  if (code === 'badRequest' || http === 400 || http === 403 || http === 404) return 'OpenAI could not accept this request. Check the model name and your account’s model access.';
  if (code === 'contextWindowExceeded') return 'The conversation is too long. End the session and reconnect to start fresh.';
  if (code === 'sandboxError') return 'Codex could not run within the required sandbox. Check your Codex Windows setup.';
  return 'Codex could not complete the response. Check the connection, model access, and API billing before retrying.';
}
export class CodexConversation {
  private state: ConversationState = { status: 'idle', message: 'Connect in Agent setup, choose a model, and send a message.', messages: [] };
  private threadId?: string;
  private savedThreadId?: string;
  private savedRuntimeVersion?: string;
  private restoring = false;
  private contextId: string = randomUUID();
  private active?: ActiveTurn;
  private publishTimer?: ReturnType<typeof setTimeout>;
  private endedTurns = new Set<string>();
  private changingProject = false;
  constructor(private readonly connection: CodexConnection, private readonly changed: (state: ConversationState) => void,
    private readonly limits = { turnMs: 180_000, stopMs: 10_000 }, private readonly history?: ConversationHistory) {
    connection.subscribe((method, params) => this.receive(method, params));
    this.state.historyEnabled = !!history;
    this.state.historyWarning = history?.warning;
    const saved = history?.snapshot();
    if (saved) {
      this.contextId = saved.contextId; this.savedThreadId = saved.threadId; this.savedRuntimeVersion = saved.runtimeVersion;
      const interrupted = ['starting','running','stopping'].includes(saved.status);
      this.state = { ...this.state, messages: saved.messages, projectPath: saved.projectPath, selectedModel: saved.selectedModel,
        needsResume: !!saved.threadId || saved.messages.length > 0, status: interrupted ? 'interrupted' : saved.status,
        message: interrupted ? 'The previous operation was interrupted. Nothing was resent. Connect and choose Resume or Start fresh.' : saved.threadId || saved.messages.length ? 'Saved transcript restored. Connect and choose Resume or Start fresh before sending.' : 'Saved chat settings restored. Send a message to start a new context.' };
    }
  }
  snapshot(): ConversationState { return { ...this.state, scopeMismatch: !!(this.threadId || this.savedThreadId || this.state.projectPath) && !samePath(this.state.projectPath, this.state.openProject), messages: this.state.messages.map(item => ({ ...item })) }; }
  setOpenProject(root: string) { this.state.openProject = root; this.publish(); }
  async useOpenProject(): Promise<{ ok: boolean; message?: string }> {
    if (this.active || this.changingProject || this.restoring || this.state.commandBusy) return { ok: false, message: 'Stop or finish the operation before changing its project.' };
    const root = this.state.openProject;
    if (!root) return { ok: false, message: 'Open a project first.' };
    this.changingProject = true;
    try {
      const canonical = await projectDirectory(root);
      if (!samePath(canonical, root)) throw new Error('Folder changed.');
      if (this.threadId) await this.connection.runtime()?.client.request('thread/unsubscribe', { threadId: this.threadId });
      this.threadId = undefined;
      if (!samePath(this.state.openProject, root)) { this.publish(); return { ok: false, message: 'The open project changed. Choose its conversation again.' }; }
      this.threadId = undefined; this.savedThreadId = undefined; this.state.needsResume = false; this.endedTurns.clear(); this.state.projectPath = canonical;
      this.set('idle', 'New project context selected. Send a message to start it.');
      return { ok: true };
    } catch { return { ok: false, message: 'Could not select the project conversation. Reopen the folder or reconnect Codex and retry.' }; }
    finally { this.changingProject = false; }
  }
  private record(): SavedConversation {
    return { version: 1, runtimeHome: 'codex-runtime-v1', runtimeVersion: this.savedRuntimeVersion, threadId: this.threadId ?? this.savedThreadId,
      contextId: this.contextId, projectPath: this.state.projectPath, selectedModel: this.state.selectedModel, status: this.state.status, messages: this.state.messages };
  }
  private async persist() {
    if (!this.history) return true;
    const ok = await this.history.save(this.record());
    this.state.historyWarning = this.history.warning;
    this.changed(this.snapshot()); return ok;
  }
  async flush() { clearTimeout(this.publishTimer); this.publishTimer = undefined; await this.persist(); await this.history?.flush(); }
  private publish() { clearTimeout(this.publishTimer); this.publishTimer = undefined; this.changed(this.snapshot()); if (this.history) void this.persist(); }
  selectModel(model: unknown) {
    if (typeof model === 'string' && validModelId(model) && !this.active && !this.restoring && !this.state.commandBusy) { this.state.selectedModel = model; this.publish(); }
  }
  async startFresh(): Promise<CodexSendResult> {
    if (this.active || this.restoring || this.changingProject || this.state.commandBusy) return { ok: false, message: 'Finish or stop the current operation first.' };
    this.changingProject = true;
    try {
      if (this.threadId) {
        await this.connection.runtime()?.client.request('thread/unsubscribe', { threadId: this.threadId });
        this.savedThreadId = this.threadId; this.threadId = undefined; this.state.needsResume = true;
      }
      const next: SavedConversation = { ...this.record(), threadId: undefined, runtimeVersion: undefined, contextId: randomUUID(), projectPath: this.state.openProject, status: 'idle', messages: [] };
      if (this.history && !await this.history.save(next)) {
        this.state.historyWarning = this.history.warning; this.changed(this.snapshot());
        return { ok: false, message: 'Could not save fresh context. Earlier history is retained; check storage and retry.' };
      }
      this.threadId = undefined; this.savedThreadId = undefined; this.savedRuntimeVersion = undefined; this.contextId = next.contextId; this.endedTurns.clear();
      this.state.messages = []; this.state.needsResume = false; this.state.projectPath = next.projectPath;
      this.set('idle', 'Fresh conversation selected. Earlier text will not be sent.'); return { ok: true };
    } catch { return { ok: false, message: 'Could not leave the current thread. Disconnect and retry; history is retained.' }; }
    finally { this.changingProject = false; }
  }
  async resume(): Promise<CodexSendResult> {
    if (!this.history || !this.state.needsResume || !this.savedThreadId) return { ok: false, message: 'No saved native thread is available. Start fresh to continue; earlier text will not be replayed.' };
    const runtime = this.connection.runtime();
    if (!runtime) return { ok: false, message: 'Connect in Agent setup before resuming. Saved messages remain readable offline.' };
    if (this.active || this.restoring || this.changingProject || this.state.commandBusy) return { ok: false, message: 'Wait for the current operation.' };
    if (this.snapshot().scopeMismatch) return { ok: false, message: 'Reopen the saved conversation project before resuming, or use the open project for fresh context.' };
    if (!commandRuntimeSupported(this.savedRuntimeVersion) || this.connection.snapshot().version !== this.savedRuntimeVersion) return { ok: false, message: 'Saved context resumption is verified for the same Codex 0.154.0 runtime. Use that version or explicitly start fresh.' };
    const id = this.savedThreadId; const project = this.state.projectPath;
    this.restoring = true; this.state.commandBusy = true; this.state.message = 'Verifying and resuming saved context...'; this.publish();
    try {
      const cwd = await this.connection.prepareProject(project ?? runtime.cwd);
      if (this.connection.runtime()?.client !== runtime.client || !samePath(this.state.openProject, project)) throw new Error();
      // Read metadata first: never overwrite a mismatched stored project's cwd during resume.
      const stored = record(record(await runtime.client.request('thread/read', { threadId: id, includeTurns: false })).thread);
      if (stored.id !== id || stored.ephemeral !== false || !samePath(typeof stored.cwd === 'string' ? stored.cwd : undefined, cwd)) throw new Error();
      const result = record(await runtime.client.request('thread/resume', { threadId: id, cwd, model: this.state.selectedModel, approvalPolicy: 'never', sandbox: 'read-only', excludeTurns: true }));
      const thread = record(result.thread); const sandbox = record(result.sandbox);
      if (thread.id !== id || thread.ephemeral !== false || result.approvalPolicy !== 'never' || sandbox.type !== 'readOnly' || sandbox.networkAccess !== false
        || !samePath(typeof result.cwd === 'string' ? result.cwd : undefined, cwd) || !samePath(typeof thread.cwd === 'string' ? thread.cwd : undefined, cwd)
        || this.connection.runtime()?.client !== runtime.client || !samePath(this.state.openProject, project)) throw new Error();
      this.threadId = id; this.state.needsResume = false;
      this.set('idle', 'Original Codex context resumed. No message was sent.'); return { ok: true };
    } catch {
      this.threadId = undefined; this.state.needsResume = true;
      this.set('error', 'Saved context could not be resumed safely. History stays readable. Reopen the original project, check runtime history, or explicitly Start fresh.');
      await this.connection.disconnect();
      return { ok: false, message: this.state.message };
    } finally { this.restoring = false; this.state.commandBusy = false; this.publish(); }
  }
  private set(status: ConversationState['status'], message: string) { this.state.status = status; this.state.message = message; this.publish(); }
  private finish(status: ConversationState['status'], message: string) {
    if (this.active?.id) this.endedTurns.add(this.active.id);
    clearTimeout(this.active?.timer); clearTimeout(this.active?.stopTimer); this.active = undefined; this.set(status, message);
  }
  async models(): Promise<{ models: CodexModel[]; message?: string }> {
    const runtime = this.connection.runtime();
    if (!runtime) return { models: [], message: 'Connect Codex in Agent setup first.' };
    try {
      const models: CodexModel[] = []; let cursor: unknown;
      for (let page = 0; page < 5; page++) {
        const result = record(await runtime.client.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }));
        if (!Array.isArray(result.data)) throw new Error('Invalid model list.');
        for (const item of result.data) {
          const model = record(item);
          if (typeof model.model === 'string' && model.model.length <= 128) models.push({ id: model.model, label: typeof model.displayName === 'string' ? model.displayName.slice(0,160) : model.model, isDefault: model.isDefault === true });
        }
        cursor = result.nextCursor; if (typeof cursor !== 'string' || !cursor) break;
      }
      return this.connection.runtime()?.client === runtime.client ? { models } : { models: [], message: 'Connection changed. Refresh models.' };
    } catch { return { models: [], message: 'Could not load models. Retry or enter a model ID.' }; }
  }
  private async command(command: NonNullable<ReturnType<typeof parseCodexCommand>>): Promise<CodexSendResult> {
    const { prefix, name, argument } = command;
    if (prefix !== '/') return { ok: false, message: 'Commands start with /, not backslash. Type /help for supported commands.' };
    const definition = codexCommands.find(c => c.name === name);
    if (!definition) return { ok: false, message: 'Unsupported command. Type /help for supported commands. Nothing was sent to Codex.' };
    if (argument && (name !== 'model' || !validModelId(argument))) return { ok: false, message: `Usage: ${definition.usage}. Arguments were not sent.` };
    if (name === 'help') return { ok: true, message: codexCommands.map(c => `${c.usage} — ${c.kind}: ${c.description}`).join('\n') };
    if (name === 'stop') {
      if (!this.active) return { ok: false, message: 'No active response or compaction to stop.' };
      await this.stop(); return { ok: true, message: 'Stop requested.' };
    }
    if (this.active || busy(this.state) || this.changingProject || this.restoring || this.state.commandBusy) return { ok: false, message: 'Wait for the current operation or use /stop.' };
    if (name === 'model' && argument) { this.selectModel(argument); return { ok: true, selectedModel: argument, message: `IDE model selected: ${argument}. It applies to the next message; account access is checked when used.` }; }
    const runtime = this.connection.runtime();
    if (!runtime) return { ok: false, message: 'Connect Codex in Agent setup first.' };
    if (!commandRuntimeSupported(this.connection.snapshot().version)) return { ok: false, message: 'Runtime commands are verified for Codex 0.154.0. This runtime version is not supported by the command registry.' };
    if (this.snapshot().scopeMismatch) return { ok: false, message: 'Use open project or reopen the conversation’s original project before running this command.' };
    if (name === 'compact' && this.state.needsResume) return { ok: false, message: 'Resume saved context or start fresh before compacting.' };
    if (name === 'compact') return this.compact();
    this.state.commandBusy = true; this.publish();
    const threadId = this.threadId; const project = this.state.openProject;
    try {
      let result: CodexSendResult;
      if (name === 'model') {
        const catalog = await this.models();
        result = catalog.message ? { ok: false, message: catalog.message } : { ok: true, models: catalog.models, message: `Codex models: ${catalog.models.map(m => m.id).join(', ')}. Select with /model <model-id>.` };
      } else if (!threadId) {
        const connection = await this.connection.refresh();
        result = { ok: connection.status === 'connected', message: connection.status === 'connected' ? this.state.needsResume ? 'Codex connected. Saved context awaits explicit Resume or Start fresh.' : 'Codex connected. No conversation context yet. Send a message to start one.' : connection.message };
      } else {
        const response = record(await runtime.client.request('thread/read', { threadId, includeTurns: false }));
        const thread = record(response.thread); const status = record(thread.status).type;
        if (thread.id !== threadId || !['idle', 'active', 'notLoaded', 'systemError'].includes(String(status))
          || !samePath(typeof thread.cwd === 'string' ? thread.cwd : undefined, this.state.projectPath ?? runtime.cwd)) throw new Error('Invalid thread status.');
        result = { ok: true, message: `Codex thread: ${status} · ${this.state.projectPath ?? 'Isolated workspace'} · Read-only · ${this.history ? 'Saved context' : 'Session only'}` };
      }
      if (this.connection.runtime()?.client !== runtime.client || this.threadId !== threadId || !samePath(this.state.openProject, project)) return { ok: false, message: 'Connection or project changed. Retry the command in its current context.' };
      return result;
    } catch { return { ok: false, message: 'Codex could not complete this command. Check the connection and retry. Your command was kept.' }; }
    finally { this.state.commandBusy = false; this.publish(); }
  }
  private async compact(): Promise<CodexSendResult> {
    const runtime = this.connection.runtime(); const threadId = this.threadId; const project = this.state.projectPath;
    if (!runtime || !threadId) return { ok: false, message: 'Send a message first. There is no current context to compact.' };
    const active: ActiveTurn = { compact: true, cancelled: false, dispatched: false }; this.active = active;
    this.set('starting', 'Preparing context compaction…');
    active.timer = setTimeout(() => { if (this.active === active) { this.finish('error', 'Compaction exceeded the three-minute limit. Reconnect to continue.'); void this.connection.disconnect(); } }, this.limits.turnMs);
    try {
      if (project) await this.connection.prepareProject(project);
      if (this.active !== active || active.cancelled || !samePath(this.state.openProject, project)) {
        if (this.active === active) this.finish('interrupted', 'Compaction stopped before dispatch.');
        return { ok: false, message: 'Compaction was not sent. Your command was kept.' };
      }
      active.dispatched = true;
      await runtime.client.request('thread/compact/start', { threadId });
      if (this.connection.runtime()?.client !== runtime.client) return { ok: false, message: 'Codex disconnected during compaction. Reconnect before retrying.' };
      return { ok: true };
    } catch {
      if (this.active === active) { this.finish('error', 'Could not start compaction safely. Reconnect and retry; your command was kept.'); await this.connection.disconnect(); }
      return { ok: false, message: 'Compaction dispatch failed. Your command was kept; check status before retrying.' };
    }
  }
  async send(text: unknown, model: unknown): Promise<CodexSendResult> {
    if (typeof text === 'string' && text.length <= 32_000) {
      const command = parseCodexCommand(text); if (command) return this.command(command);
    }
    return this.sendText(text, model);
  }

  /** Reviewed briefs are literal messages, including leading slash commands. */
  async sendBrief(root: unknown, text: unknown, model: unknown): Promise<CodexSendResult> {
    if (typeof root !== 'string' || !root || !samePath(root, this.state.openProject)) return { ok: false, message: 'The brief belongs to a different project. Reopen its project before sending.' };
    return this.sendText(text, model);
  }

  private async sendText(text: unknown, model: unknown): Promise<CodexSendResult> {
    const runtime = this.connection.runtime();
    if (!runtime) return { ok: false, message: 'Connect Codex in Agent setup first.' };
    if (this.active || busy(this.state) || this.changingProject || this.restoring || this.state.commandBusy) return { ok: false, message: 'Wait for the response or stop it before sending another message.' };
    if (this.state.needsResume) return { ok: false, message: 'Choose Resume or Start fresh before sending. Saved text is never silently replayed.' };
    if (this.snapshot().scopeMismatch) return { ok: false, message: 'This conversation belongs to a different project. Use open project to start fresh, or reopen the original project.' };
    if (typeof text !== 'string' || !text.trim() || text.length > 32_000) return { ok: false, message: 'Enter a message of 1–32,000 characters.' };
    if (typeof model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,128}$/.test(model)) return { ok: false, message: 'Choose or enter a model ID.' };
    if (this.state.messages.length >= 200 || this.state.messages.reduce((n, m) => n + m.text.length, 0) + text.length > MAX_TEXT) return { ok: false, message: 'Transcript limit reached. Start fresh to clear the displayed history.' };
    this.state.selectedModel = model;
    const active: ActiveTurn = { cancelled: false, dispatched: false }; this.active = active;
    const project = this.state.projectPath ?? this.state.openProject;
    let cwd = runtime.cwd;
    let preparingProject = !!project;
    this.set('starting', 'Starting a response…');
    active.timer = setTimeout(() => { if (this.active === active) { this.finish('error', 'Response exceeded the three-minute limit. Reconnect to continue.'); void this.connection.disconnect(); } }, this.limits.turnMs);
    try {
      if (project) {
        cwd = await this.connection.prepareProject(project);
        if (active.cancelled || this.active !== active || !samePath(this.state.openProject, project)) {
          if (this.active === active) this.finish('interrupted', 'Stopped before sending because the project changed or the request was cancelled.');
          return { ok: false, message: 'Nothing was sent. Your draft was kept; select the current project and retry.' };
        }
        this.state.projectPath = cwd; this.publish();
      }
      preparingProject = false;
      if (!this.threadId) {
        const result = record(await runtime.client.request('thread/start', { cwd, model, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: !this.history }));
        const sandbox = record(result.sandbox); const thread = record(result.thread);
        if (result.approvalPolicy !== 'never' || sandbox.type !== 'readOnly' || sandbox.networkAccess !== false || typeof thread.id !== 'string' || thread.ephemeral !== !this.history) throw new Error('Restricted thread persistence not confirmed.');
        if (project && (!samePath(typeof result.cwd === 'string' ? result.cwd : undefined, cwd) || !samePath(typeof thread.cwd === 'string' ? thread.cwd : undefined, cwd))) throw new Error('Project directory not confirmed.');
        if (this.active !== active) return { ok: false, message: 'Connection changed before sending. Your draft was kept.' };
        this.threadId = thread.id; this.savedRuntimeVersion = this.connection.snapshot().version;
        this.contextId = randomUUID();
        if (this.state.messages.length) this.state.messages.push({ id: randomUUID(), role: 'system', text: `New Codex context${project ? ` for ${project}` : ''}. Earlier messages remain visible but are not included in this new context.` });
      }
      if (!samePath(this.state.openProject, project)) { this.finish('interrupted', 'The open project changed before sending.'); return { ok: false, message: 'Nothing was sent. Use open project to start a new context, or reopen the original project.' }; }
      if (active.cancelled || this.active !== active) { if (this.active === active) this.finish('interrupted', 'Stopped before sending.'); return { ok: false, message: 'Stopped before sending. Your draft was kept.' }; }
      const messageId = randomUUID();
      this.state.messages.push({ id: messageId, role: 'user', text }); this.publish();
      if (!await this.persist()) { this.state.messages = this.state.messages.filter(m => m.id !== messageId); this.finish('error', 'The message was not sent because history could not be saved. Your draft is kept.'); return { ok: false, message: this.state.historyWarning }; }
      if (active.cancelled || this.active !== active || this.connection.runtime()?.client !== runtime.client || !samePath(this.state.openProject, project)) { this.state.messages = this.state.messages.filter(m => m.id !== messageId); if (this.active === active) this.finish('interrupted', 'Stopped before sending.'); return { ok: false, message: 'Nothing was sent. Your draft was kept.' }; }
      active.dispatched = true;
      const result = record(await runtime.client.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text }], model, cwd, approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false } }));
      const turn = record(result.turn);
      if (typeof turn.id !== 'string') throw new Error('Missing turn ID.');
      if (this.active === active) {
        active.id ??= turn.id;
        if (active.id !== turn.id) throw new Error('Turn mismatch.');
        if (['completed', 'interrupted', 'failed'].includes(String(turn.status))) this.complete(turn);
        else if (active.cancelled) await this.interrupt(active);
        else this.set('running', 'Codex is responding…');
      }
      return { ok: true };
    } catch {
      if (this.active === active) {
        this.finish('error', preparingProject ? 'The project is unavailable or its restricted configuration could not be verified. Reopen the folder and reconnect; your draft was kept.' : 'Could not start the response safely. Your draft was kept. Reconnect and check the selected model.');
        await this.connection.disconnect();
      }
      return { ok: false, message: 'Response dispatch failed. Your draft was kept; check the transcript before retrying.' };
    }
  }
  private complete(turn: Record<string, unknown>) {
    if (turn.status === 'failed') this.finish('error', turnError(turn.error));
    else if (turn.status === 'interrupted') this.finish('interrupted', 'Stopped. You can send another message.');
    else if (this.active?.compact) {
      if (this.active.compacted) this.finish('completed', 'Context compacted. Visible messages are preserved; future replies use the compacted context.');
      else { this.finish('error', 'Codex ended compaction without confirming its result. Reconnect before retrying.'); void this.connection.disconnect(); }
    } else { this.connection.modelRequestCompleted(); this.finish('completed', 'Response complete.'); }
  }
  private receive(method: string, params: unknown) {
    if (method === 'specular/disconnected') {
      if (this.history) {
        this.savedThreadId = this.threadId ?? this.savedThreadId; this.state.needsResume = !!this.savedThreadId || this.state.messages.length > 0;
        this.threadId = undefined; this.endedTurns.clear();
        if (this.active) this.finish('interrupted', 'Codex disconnected during an operation. Partial history is saved; nothing will be resent.');
        else if (this.state.status !== 'error') this.set(this.state.status, 'Codex disconnected. History is saved; reconnect and choose Resume or Start fresh.');
        else this.publish();
        return;
      }
      this.threadId = undefined; this.endedTurns.clear();
      if (this.active) this.finish('error', 'Codex disconnected. The transcript is preserved; reconnect to start a new context.');
      else if (this.state.status !== 'error') this.set('idle', 'Codex disconnected. Reconnect to start a new context.');
      return;
    }
    const active = this.active; const p = record(params); const turn = record(p.turn);
    const turnId = p.turnId ?? turn.id;
    if (!active?.dispatched || p.threadId !== this.threadId || typeof turnId !== 'string' || this.endedTurns.has(turnId)) return;
    if (active.id && active.id !== turnId) return;
    active.id ??= turnId;
    if (method === 'turn/started') { if (active.cancelled) void this.interrupt(active); else this.set('running', active.compact ? 'Codex is compacting context…' : 'Codex is responding…'); }
    else if (method === 'turn/completed') this.complete(turn);
    else if (method === 'error') this.set(active.cancelled ? 'stopping' : 'running', p.willRetry === true ? 'Codex is retrying the response…' : turnError(p.error));
    else if (method === 'item/agentMessage/delta' || method === 'item/completed') {
      const item = record(p.item);
      if (active.compact && method === 'item/completed' && item.type === 'contextCompaction') { active.compacted = true; return; }
      if (method === 'item/completed' && item.type !== 'agentMessage') return;
      const id = method === 'item/completed' ? item.id : p.itemId;
      const value = method === 'item/completed' ? item.text : p.delta;
      if (typeof id !== 'string' || typeof value !== 'string') return;
      const messageId = `${this.contextId}/${turnId}/${id}`;
      let message = this.state.messages.find(m => m.id === messageId);
      if (!message) { message = { id: messageId, role: 'assistant', text: '' }; this.state.messages.push(message); }
      const text = method === 'item/completed' ? value : message.text + value;
      const size = this.state.messages.reduce((n,m) => n + m.text.length, 0) - message.text.length + text.length;
      if (size > MAX_TEXT || this.state.messages.length > 200) { this.finish('error', 'Transcript limit reached. Start fresh to clear the displayed history.'); void this.connection.disconnect(); return; }
      message.text = text;
      this.publishTimer ??= setTimeout(() => this.publish(), 40);
    }
  }
  async stop() {
    const active = this.active; if (!active || active.cancelled) return;
    active.cancelled = true; this.set('stopping', 'Stopping Codex…');
    if (active.compact && !active.id) active.stopTimer = setTimeout(() => { if (this.active === active) { this.finish('error', 'Stop was not confirmed. Codex has been disconnected.'); void this.connection.disconnect(); } }, this.limits.stopMs);
    if (active.id) await this.interrupt(active);
  }
  private async interrupt(active: ActiveTurn) {
    if (this.active !== active || active.interruptRequested) return;
    active.interruptRequested = true;
    active.stopTimer ??= setTimeout(() => { if (this.active === active) { this.finish('error', 'Stop was not confirmed. Codex has been disconnected.'); void this.connection.disconnect(); } }, this.limits.stopMs);
    try { await this.connection.runtime()?.client.request('turn/interrupt', { threadId: this.threadId, turnId: active.id }); }
    catch { if (this.active === active) { this.finish('error', 'Stop failed. Codex has been disconnected.'); await this.connection.disconnect(); } }
  }
}
