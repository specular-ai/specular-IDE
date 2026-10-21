import type { CodexConnectionState, ConversationState, SpecularBridge } from '../shared/types';
import { codexCommands, parseCodexCommand, commandRuntimeSupported } from '../shared/codex-commands';

export class ConversationPanel {
  private readonly dialog = document.createElement('dialog');
  private state: ConversationState = { status: 'idle', message: 'Connect Codex to begin.', messages: [] };
  private connected = false;
  private runtimeCommands = false;
  private sending = false;
  private ending = false;
  private modelRequest = 0;
  private commandChoice = 0;
  private readonly nodes = new Map<string, HTMLElement>();
  constructor(private readonly api: SpecularBridge, openSetup: () => void) {
    this.dialog.id = 'codex-conversation-dialog'; this.dialog.setAttribute('aria-labelledby', 'conversation-title');
    this.dialog.innerHTML = `<div class="conversation-heading"><div><h2 id="conversation-title">Codex conversation</h2><span id="conversation-connection">Disconnected</span></div><button id="conversation-hide" class="button secondary">Hide</button></div>
      <p class="agent-note">Messages go to the selected model using your API key. Messages are saved on this device. After reconnecting, choose Resume or Start fresh. Codex can read saved files in its project; unsaved editor text is included only when you explicitly send it, for example in a reviewed brief.</p>
      <div class="conversation-project-row"><div><div id="conversation-project"></div><div id="conversation-project-note" class="agent-note"></div></div><button id="conversation-use-project" class="button secondary" hidden>Use open project</button></div>
      <div class="conversation-model-row"><label for="conversation-model">Model</label><input id="conversation-model" class="search" list="conversation-models" placeholder="Choose or enter a model ID" maxlength="128" autocomplete="off" spellcheck="false" /><datalist id="conversation-models"></datalist><button id="conversation-model-refresh" class="quiet-button">Refresh models</button><button id="conversation-setup" class="button secondary">Agent setup</button></div>
      <div id="conversation-transcript" role="region" aria-label="Conversation transcript" tabindex="0"><p class="conversation-empty">Discuss your specification with Codex.</p></div>
      <div id="conversation-history-warning" class="agent-note" role="status"></div>
      <div class="conversation-actions"><button id="conversation-resume" class="button primary" hidden>Resume saved context</button><button id="conversation-fresh" class="button secondary">Start fresh</button></div>
      <div id="conversation-status" role="status" aria-live="polite"></div>
      <section id="conversation-result" aria-labelledby="conversation-result-title" hidden><strong id="conversation-result-title">Notice</strong><div id="conversation-feedback" role="status" aria-live="polite"></div></section>
      <label for="conversation-prompt">Message or /command</label><textarea id="conversation-prompt" class="search" rows="3" maxlength="32000" placeholder="Ask Codex a question, or type / for commands…" aria-controls="conversation-commands" aria-describedby="conversation-command-hint"></textarea>
      <div id="conversation-commands" role="group" aria-label="Supported commands" hidden></div>
      <div id="conversation-command-hint" class="agent-note">Type / for commands · ↑ ↓ and Tab to complete · Enter to run a complete command</div>
      <div class="conversation-actions"><span class="agent-note">Ctrl+Enter to send · Read-only tools · 3 min limit</span><button id="conversation-end" class="quiet-button">End session</button><button id="conversation-stop" class="button secondary">Stop</button><button id="conversation-send" class="button primary">Send</button></div>
      `;
    document.body.append(this.dialog);
    this.element<HTMLButtonElement>('conversation-hide').onclick = () => this.dialog.close();
    this.element<HTMLButtonElement>('conversation-setup').onclick = () => { this.dialog.close(); openSetup(); };
    this.element<HTMLButtonElement>('conversation-send').onclick = () => { void this.send(); };
    this.element<HTMLInputElement>('conversation-model').onchange = () => { void api.selectCodexModel(this.element<HTMLInputElement>('conversation-model').value).catch(() => this.feedback('Could not save model selection.')); };
    for (const [id, action] of [['conversation-resume', () => api.resumeCodexConversation()], ['conversation-fresh', () => api.freshCodexConversation()]] as const) {
      this.element<HTMLButtonElement>(id).onclick = async () => {
        if (this.sending) return; this.sending = true; this.controls();
        try { const result = await action(); this.feedback(result.message ?? (result.ok ? 'Conversation ready.' : 'Could not change context.')); }
        catch { this.feedback('Could not change context. Your saved transcript is retained.'); }
        finally { this.sending = false; this.controls(); }
      };
    }
    this.element<HTMLButtonElement>('conversation-model-refresh').onclick = () => { void this.loadModels(); };
    this.element<HTMLButtonElement>('conversation-use-project').onclick = async () => {
      const button = this.element<HTMLButtonElement>('conversation-use-project'); button.disabled = true;
      try { const result = await api.useOpenProjectForCodex(); this.feedback(result.message ?? 'New project context selected. Earlier messages will not be sent.'); }
      catch { this.feedback('Could not change the conversation project. Please retry.'); }
      finally { this.controls(); }
    };
    const prompt = this.element<HTMLTextAreaElement>('conversation-prompt');
    prompt.oninput = () => { this.commandChoice = 0; this.suggestions(); this.controls(); };
    prompt.onkeydown = event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void this.send(); return; }
      const command = parseCodexCommand(prompt.value);
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && command?.prefix === '/' && codexCommands.some(c => c.name === command.name)) {
        event.preventDefault(); void this.send(); return;
      }
      const list = this.element('conversation-commands'); const buttons = [...list.querySelectorAll<HTMLButtonElement>('button')];
      if (list.hidden || !buttons.length) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); list.hidden = true; }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.commandChoice = (this.commandChoice + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length; this.suggestions(); }
      else if (event.key === 'Tab' || event.key === 'Enter') { event.preventDefault(); buttons[this.commandChoice].click(); }
    };
    this.element<HTMLButtonElement>('conversation-stop').onclick = async () => { try { await api.stopCodexTurn(); } catch { this.feedback('Could not stop the response. Use End session.'); } };
    this.element<HTMLButtonElement>('conversation-end').onclick = async () => {
      if (this.ending) return; this.ending = true; this.controls();
      try { await api.disconnectCodex(); } catch { this.feedback('Could not confirm disconnection. Close Specular to end the session.'); }
      finally { this.ending = false; this.controls(); }
    };
    api.onConversationState(state => this.update(state));
    api.onCodexState(state => this.connection(state));
    this.controls();
  }
  private element<T extends HTMLElement = HTMLElement>(id: string) { return this.dialog.querySelector<T>(`#${id}`)!; }
  async show() {
    if (document.querySelector('dialog[open]')) return;
    this.dialog.showModal();
    try { this.update(await this.api.conversationState()); this.connection(await this.api.codexStatus()); await this.loadModels(); }
    catch { this.feedback('Could not read the Codex connection. Open Agent setup and retry.'); }
    this.element('conversation-prompt').focus();
  }
  private connection(state: CodexConnectionState) {
    this.connected = state.status === 'connected';
    this.runtimeCommands = commandRuntimeSupported(state.version);
    this.element('conversation-connection').textContent = this.connected ? 'Connected' : state.message;
    this.controls();
    if (!this.element('conversation-commands').hidden) this.suggestions();
  }
  private controls() {
    const active = ['starting', 'running', 'stopping'].includes(this.state.status);
    const command = parseCodexCommand(this.element<HTMLTextAreaElement>('conversation-prompt').value);
    const control = command?.prefix === '/' && ['help', 'stop'].includes(command.name);
    this.element<HTMLButtonElement>('conversation-send').disabled = this.sending || this.ending || (!control && (active || !!this.state.commandBusy)) || (!command && (!this.connected || !!this.state.scopeMismatch || !!this.state.needsResume));
    const resume = this.element<HTMLButtonElement>('conversation-resume'); resume.hidden = !this.state.needsResume;
    resume.disabled = !this.connected || active || this.sending || this.ending || !!this.state.commandBusy || !!this.state.scopeMismatch;
    this.element<HTMLButtonElement>('conversation-fresh').disabled = active || this.sending || this.ending || !!this.state.commandBusy;
    const useProject = this.element<HTMLButtonElement>('conversation-use-project');
    useProject.hidden = !this.state.scopeMismatch || !this.state.openProject;
    useProject.disabled = active || this.sending || this.ending || !!this.state.commandBusy;
    this.element<HTMLButtonElement>('conversation-stop').disabled = !this.connected || !active || this.state.status === 'stopping' || this.ending;
    this.element<HTMLInputElement>('conversation-model').disabled = active || this.sending || this.ending || !!this.state.commandBusy;
    this.element<HTMLButtonElement>('conversation-model-refresh').disabled = !this.connected || active || this.ending || !!this.state.commandBusy;
    this.element<HTMLButtonElement>('conversation-end').disabled = !this.connected || this.ending;
  }
  private feedback(message: string, command = false) {
    this.element('conversation-result').hidden = !message;
    this.element('conversation-result-title').textContent = command ? 'Command result' : 'Notice';
    this.element('conversation-feedback').textContent = message;
  }
  private suggestions() {
    const prompt = this.element<HTMLTextAreaElement>('conversation-prompt'); const list = this.element('conversation-commands');
    const value = prompt.value.trimStart();
    const matches = /^\/[^\s]*$/.test(value) ? codexCommands.filter(c => c.name.startsWith(value.slice(1))) : [];
    list.hidden = !matches.length; this.commandChoice = Math.min(this.commandChoice, Math.max(0, matches.length - 1));
    list.replaceChildren(...matches.map((command, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'command-suggestion';
      button.dataset.selected = String(index === this.commandChoice);
      const availability = ['status', 'compact', 'model'].includes(command.name) ? (!this.connected ? ' · Runtime operation requires connection' : !this.runtimeCommands ? ' · Runtime operation requires Codex 0.154.0' : '') : '';
      button.textContent = `${command.usage} · ${command.kind} — ${command.description}${availability}`;
      button.onclick = () => { prompt.value = `/${command.name}${command.name === 'model' ? ' ' : ''}`; list.hidden = true; this.controls(); prompt.focus(); };
      return button;
    }));
    list.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  private async loadModels() {
    if (!this.connected) return;
    const request = ++this.modelRequest;
    try {
      const result = await this.api.codexModels(); if (request !== this.modelRequest || !this.connected) return;
      const options = result.models.map(model => { const option = document.createElement('option'); option.value = model.id; option.label = model.label; return option; });
      this.element('conversation-models').replaceChildren(...options);
      const input = this.element<HTMLInputElement>('conversation-model');
      if (!input.value) input.value = result.models.find(model => model.isDefault)?.id ?? result.models[0]?.id ?? '';
      if (result.message) this.feedback(result.message);
    } catch { this.feedback('Could not load models. Retry or enter a model ID.'); }
  }
  private update(state: ConversationState) {
    if (state.selectedModel && state.selectedModel !== this.state.selectedModel) this.element<HTMLInputElement>('conversation-model').value = state.selectedModel;
    this.state = state;
    this.element('conversation-history-warning').textContent = state.historyWarning ?? (state.needsResume ? 'Saved messages are readable offline. Resume restores native context; Start fresh clears this transcript.' : '');
    this.element('conversation-project').textContent = `Project: ${state.projectPath ?? (state.scopeMismatch ? 'Isolated conversation' : state.openProject ?? 'None — isolated conversation')}`;
    this.element('conversation-project-note').textContent = state.scopeMismatch ? `Open project: ${state.openProject ?? 'none'}. Use open project starts fresh context; earlier text stays visible.` : 'Read-only files · Project executable configuration is disabled';
    const transcript = this.element('conversation-transcript'); const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 70;
    const ids = new Set(state.messages.map(message => message.id));
    for (const [id, node] of this.nodes) if (!ids.has(id)) { node.remove(); this.nodes.delete(id); }
    if (state.messages.length) transcript.querySelector('.conversation-empty')?.remove();
    else if (!transcript.querySelector('.conversation-empty')) { const empty = document.createElement('p'); empty.className = 'conversation-empty'; empty.textContent = 'Discuss your specification with Codex.'; transcript.append(empty); }
    for (const message of state.messages) {
      let node = this.nodes.get(message.id);
      if (!node) {
        node = document.createElement('article'); node.className = `conversation-message ${message.role}`;
        const label = document.createElement('strong'); label.textContent = message.role === 'assistant' ? 'Codex' : message.role === 'user' ? 'You' : 'Session';
        node.append(label, document.createElement('div')); transcript.append(node); this.nodes.set(message.id, node);
      }
      if (node.lastElementChild!.textContent !== message.text) node.lastElementChild!.textContent = message.text;
    }
    const status = this.element('conversation-status'); status.textContent = state.message; status.dataset.status = state.status;
    this.controls(); if (atBottom) transcript.scrollTop = transcript.scrollHeight;
  }
  private async send() {
    if (this.element<HTMLButtonElement>('conversation-send').disabled) return;
    const prompt = this.element<HTMLTextAreaElement>('conversation-prompt'); const text = prompt.value;
    const command = parseCodexCommand(text);
    this.sending = true; this.controls(); this.feedback(command ? 'Running command…' : '', !!command);
    try {
      const result = await this.api.sendCodexMessage(text, this.element<HTMLInputElement>('conversation-model').value);
      if (result.ok) {
        if (prompt.value === text) prompt.value = '';
        if (result.selectedModel) { ++this.modelRequest; this.element<HTMLInputElement>('conversation-model').value = result.selectedModel; }
        if (result.models) {
          ++this.modelRequest;
          this.element('conversation-models').replaceChildren(...result.models.map(model => { const option = document.createElement('option'); option.value = model.id; option.label = model.label; return option; }));
        }
        if (result.message || command) this.feedback(result.message ?? 'Command accepted. Follow its progress above.', !!command);
        this.suggestions();
      }
      else this.feedback(result.message ?? 'Could not send. Your draft was kept.', !!command);
    } catch { this.feedback('Could not confirm sending. Your draft was kept; check the transcript before retrying.', !!command); }
    finally { this.sending = false; this.controls(); prompt.focus(); }
  }
}
