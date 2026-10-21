import { assembleBrief, describeBriefSource, type BriefSource } from '../core/briefs';
import type { CodexModel, CodexSendResult, ConversationState, TerminalInfo } from '../shared/types';

interface TerminalHandoff {
  targets(): TerminalInfo[];
  insert(id: string, root: string, text: string): Promise<{ ok: boolean; message?: string }>;
  reveal(id: string): void;
}

interface ConversationHandoff {
  state(): Promise<ConversationState>;
  models(): Promise<{ models: CodexModel[]; message?: string }>;
  send(root: string, text: string, model: string): Promise<CodexSendResult>;
  reveal(): void;
}

export class BriefDialog {
  private readonly dialog = document.createElement('dialog');
  private sources: BriefSource[] = [];
  private generation = 0;
  private root = '';
  private busy = false;
  private insertedTarget?: string;
  private sentToConversation = false;
  private refreshingChat = false;

  constructor(private readonly copy: (text: string) => Promise<void>, onClose: () => void, private readonly handoff: TerminalHandoff, private readonly conversation: ConversationHandoff) {
    this.dialog.id = 'brief-dialog';
    this.dialog.className = 'brief-dialog';
    this.dialog.setAttribute('aria-labelledby', 'brief-title');
    this.dialog.innerHTML = `
      <div class="brief-heading"><div><div class="eyebrow">FROM SPECIFICATION TO ACTION</div><h2 id="brief-title">Prepare agent brief</h2></div><button id="brief-close" class="icon-button" aria-label="Close agent brief">×</button></div>
      <div class="brief-source"><strong id="brief-file"></strong><span id="brief-state"></span><span id="brief-ids"></span></div>
      <form id="brief-compose">
        <label for="brief-use">Selections to use</label>
        <select id="brief-use">
          <option value="source">Source Markdown selection</option>
          <option value="preview">Preview text selection</option>
          <option value="both">Both selections</option>
        </select>
        <p class="brief-note">Preview selections contain rendered text. Both keeps each selection separately, including overlapping content.</p>
        <label for="brief-instruction">What should the agent do?</label>
        <textarea id="brief-instruction" rows="3" placeholder="For example: Implement this requirement." required></textarea>
        <label for="brief-selection">Selected content · captured when opened</label>
        <pre id="brief-selection" tabindex="0"></pre>
        <div class="dialog-actions"><button id="brief-create" class="button primary" type="submit" disabled>Create brief →</button></div>
      </form>
      <section id="brief-review" hidden>
        <label for="brief-output">Review and edit the complete brief</label>
        <textarea id="brief-output" rows="14" spellcheck="false"></textarea>
        <div class="dialog-actions"><span id="brief-feedback" role="status" aria-live="polite"></span><button id="brief-copy" class="button primary">Copy brief</button></div>
        <label for="brief-model">Send to Codex chat · model</label>
        <div class="brief-terminal-row"><input id="brief-model" class="search" maxlength="128" spellcheck="false" list="brief-models" placeholder="Choose or enter a model ID" autocomplete="off"><datalist id="brief-models"></datalist><button id="brief-chat-refresh" class="button secondary">Refresh</button></div>
        <p id="brief-chat-target" class="brief-note" role="status"></p>
        <p class="brief-note">Sends exactly the text above, up to 32,000 characters. Codex may read saved files in this project; unsaved text is included only where captured in the brief. File edits are disabled.</p>
        <div class="dialog-actions"><button id="brief-send" class="button primary">Send to Codex chat</button></div>
        <label for="brief-terminal">Insert into an agent terminal</label>
        <div class="brief-terminal-row"><select id="brief-terminal" aria-describedby="brief-terminal-project brief-terminal-hint"></select><button id="brief-terminal-refresh" class="button secondary">Refresh</button></div>
        <p id="brief-terminal-project" class="brief-note"></p>
        <p id="brief-terminal-hint" class="brief-note">Choose an agent at its input prompt. Text is pasted at its cursor without pressing Enter; existing input is retained. Shell tabs are not targets.</p>
        <div class="dialog-actions"><button id="brief-insert" class="button primary" disabled>Insert brief</button></div>
      </section>
      <p class="brief-note">Send, copy, or insert the brief before closing. Unsent drafts are not saved. Inserting leaves submission to you and does not create a managed agent task.</p>
    `;
    document.body.append(this.dialog);
    this.element<HTMLSelectElement>('#brief-use').onchange = () => this.showSelection();
    this.element<HTMLTextAreaElement>('#brief-instruction').oninput = () => {
      this.element<HTMLButtonElement>('#brief-create').disabled = !this.element<HTMLTextAreaElement>('#brief-instruction').value.trim();
    };
    this.element<HTMLFormElement>('#brief-compose').onsubmit = event => {
      event.preventDefault();
      if (!this.sources.length) return;
      const instruction = this.element<HTMLTextAreaElement>('#brief-instruction').value;
      if (!instruction.trim()) return;
      this.element<HTMLTextAreaElement>('#brief-output').value = assembleBrief(this.chosenSources(), instruction);
      this.element('#brief-compose').hidden = true;
      this.element('#brief-review').hidden = false;
      this.refreshTargets();
      void this.refreshConversation();
      const output = this.element<HTMLTextAreaElement>('#brief-output');
      output.focus();
      output.setSelectionRange(0, 0);
      output.scrollTop = 0;
    };
    this.element('#brief-close').onclick = () => this.dialog.close();
    this.element('#brief-copy').onclick = () => { void this.copyBrief(); };
    this.element('#brief-terminal-refresh').onclick = () => this.refreshTargets();
    this.element<HTMLSelectElement>('#brief-terminal').onchange = () => this.updateButtons();
    this.element('#brief-insert').onclick = () => { void this.insertBrief(); };
    this.element('#brief-chat-refresh').onclick = () => { void this.refreshConversation(); };
    this.element('#brief-send').onclick = () => { void this.sendBrief(); };
    this.element<HTMLTextAreaElement>('#brief-output').oninput = () => {
      this.feedback('');
      this.updateButtons();
    };
    this.dialog.oncancel = event => { if (this.busy) event.preventDefault(); };
    this.dialog.onclose = () => {
      this.generation++;
      this.sources = [];
      this.element<HTMLTextAreaElement>('#brief-instruction').value = '';
      this.element<HTMLTextAreaElement>('#brief-output').value = '';
      this.element('#brief-selection').textContent = '';
      onClose();
      const target = this.insertedTarget; this.insertedTarget = undefined;
      if (target) this.handoff.reveal(target);
      if (this.sentToConversation) { this.sentToConversation = false; this.conversation.reveal(); }
    };
  }

  get isOpen() { return this.dialog.open; }
  private element<T extends HTMLElement = HTMLElement>(selector: string): T { return this.dialog.querySelector<T>(selector)!; }
  private feedback(message: string, error = false) {
    const element = this.element('#brief-feedback');
    element.textContent = message;
    element.classList.toggle('coral', error);
  }

  private chosenSources() {
    const choice = this.element<HTMLSelectElement>('#brief-use').value;
    return this.sources.filter(source => choice === 'both' || source.kind === choice);
  }

  private showSelection() {
    const sources = this.chosenSources();
    const source = sources[0];
    this.element('#brief-file').textContent = sources.map(item => item.kind === 'source'
      ? `${item.file} · lines ${item.startLine}–${item.endLine}` : `${item.file} · rendered preview text`).join(' | ');
    this.element('#brief-state').textContent = describeBriefSource(source);
    this.element('#brief-state').classList.toggle('amber', source.unsaved || source.diskConflict);
    const ids = [...new Set(sources.flatMap(item => item.ids))];
    this.element('#brief-ids').textContent = ids.length ? `IDs: ${ids.join(', ')}` : 'No recognized IDs in this selection.';
    this.element('#brief-selection').textContent = sources.length === 1 ? source.text
      : sources.map(item => `${item.kind === 'source' ? 'SOURCE MARKDOWN' : 'PREVIEW TEXT'}\n${item.text}`).join('\n\n');
  }

  open(sources: BriefSource[], root: string) {
    if (this.isOpen) return;
    if (!sources.length) return;
    this.generation++;
    this.sources = sources;
    this.root = root;
    this.busy = false; this.insertedTarget = undefined; this.sentToConversation = false; this.refreshingChat = false;
    this.element<HTMLInputElement>('#brief-model').value = '';
    this.element<HTMLInputElement>('#brief-model').disabled = false;
    this.element<HTMLButtonElement>('#brief-chat-refresh').disabled = false;
    this.element('#brief-models').replaceChildren();
    this.element('#brief-chat-target').textContent = '';
    const choice = this.element<HTMLSelectElement>('#brief-use');
    for (const option of choice.options) option.disabled = option.value === 'both'
      ? sources.length < 2 : !sources.some(source => source.kind === option.value);
    choice.value = sources.some(source => source.kind === 'source') ? 'source' : 'preview';
    this.showSelection();
    this.element('#brief-compose').hidden = false;
    this.element('#brief-review').hidden = true;
    this.element<HTMLTextAreaElement>('#brief-instruction').value = '';
    this.element<HTMLTextAreaElement>('#brief-output').value = '';
    this.element<HTMLTextAreaElement>('#brief-output').readOnly = false;
    this.element<HTMLButtonElement>('#brief-create').disabled = true;
    this.element<HTMLButtonElement>('#brief-copy').disabled = false;
    this.element<HTMLButtonElement>('#brief-close').disabled = false;
    this.element<HTMLButtonElement>('#brief-terminal-refresh').disabled = false;
    this.element<HTMLSelectElement>('#brief-terminal').disabled = false;
    this.feedback('');
    this.dialog.showModal();
    this.element<HTMLTextAreaElement>('#brief-instruction').focus();
  }

  private async copyBrief() {
    const output = this.element<HTMLTextAreaElement>('#brief-output');
    const button = this.element<HTMLButtonElement>('#brief-copy');
    if (!output.value.trim() || button.disabled || this.busy) return;
    const generation = this.generation;
    this.setBusy(true);
    this.feedback('Copying…');
    try {
      await this.copy(output.value);
      if (this.generation === generation) this.feedback('Copied to clipboard.');
    } catch {
      if (this.generation === generation) this.feedback('Could not copy the brief. Try again, or select the text and copy it manually.', true);
    } finally {
      if (this.generation === generation) this.setBusy(false);
    }
  }

  private refreshTargets() {
    const select = this.element<HTMLSelectElement>('#brief-terminal');
    const previous = select.value;
    select.replaceChildren(new Option('Choose an agent terminal…', ''));
    for (const terminal of this.handoff.targets()) {
      const sameProject = terminal.root.toLowerCase() === this.root.toLowerCase();
      const option = new Option(`${terminal.kind === 'codex' ? 'Codex' : 'Claude'} · ${terminal.id.slice(0, 8)} · ${terminal.status}${sameProject ? '' : ' · different project'} · ${terminal.root}`, terminal.id);
      option.disabled = !sameProject || terminal.status !== 'running'; select.append(option);
    }
    if ([...select.options].some(option => option.value === previous && !option.disabled)) select.value = previous;
    const eligible = [...select.options].some(option => option.value && !option.disabled);
    this.element('#brief-terminal-project').textContent = `Brief project: ${this.root}`;
    this.element('#brief-terminal-hint').textContent = eligible
      ? 'Choose an agent at its input prompt. Text is pasted at its cursor without pressing Enter; existing input is retained. Shell tabs are not targets.'
      : 'Open a Codex or Claude terminal in this project before preparing a brief, or use Copy brief. Refresh updates the available tabs.';
    this.updateButtons();
  }

  private updateButtons() {
    const empty = !this.element<HTMLTextAreaElement>('#brief-output').value.trim();
    this.element<HTMLButtonElement>('#brief-copy').disabled = this.busy || empty;
    this.element<HTMLButtonElement>('#brief-send').disabled = this.busy || empty || this.refreshingChat;
    this.element<HTMLButtonElement>('#brief-chat-refresh').disabled = this.busy || this.refreshingChat;
    const target = this.element<HTMLSelectElement>('#brief-terminal').selectedOptions[0];
    this.element<HTMLButtonElement>('#brief-insert').disabled = this.busy || empty || !target?.value || target.disabled;
  }

  private setBusy(busy: boolean) {
    this.busy = busy;
    this.element<HTMLInputElement>('#brief-model').disabled = busy;
    this.element<HTMLTextAreaElement>('#brief-output').readOnly = busy;
    this.element<HTMLButtonElement>('#brief-close').disabled = busy;
    this.element<HTMLSelectElement>('#brief-terminal').disabled = busy;
    this.element<HTMLButtonElement>('#brief-terminal-refresh').disabled = busy;
    this.updateButtons();
  }

  private async refreshConversation() {
    if (this.busy || this.refreshingChat) return;
    const generation = this.generation;
    this.refreshingChat = true; this.updateButtons();
    this.element('#brief-chat-target').textContent = `Brief project: ${this.root}. Checking Codex chat...`;
    try {
      const [state, catalog] = await Promise.all([this.conversation.state(), this.conversation.models()]);
      if (generation !== this.generation) return;
      const model = this.element<HTMLInputElement>('#brief-model');
      if (!model.value) model.value = state.selectedModel ?? catalog.models.find(item => item.isDefault)?.id ?? '';
      this.element('#brief-models').replaceChildren(...catalog.models.map(item => new Option(item.label, item.id)));
      const context = state.projectPath ? `Conversation project: ${state.projectPath}.` : `New conversation in ${this.root}.`;
      const warning = state.scopeMismatch ? 'Open Codex chat and choose Use open project before sending.'
        : state.needsResume ? 'Open Codex chat and choose Resume or Start fresh before sending.'
        : ['starting', 'running', 'stopping'].includes(state.status) || state.commandBusy ? 'Wait for the current response or command to finish.' : '';
      this.element('#brief-chat-target').textContent = `Brief project: ${this.root}. ${context} Read-only. ${warning || catalog.message || (state.projectPath ? 'The brief joins the current conversation.' : 'The brief starts a new conversation.')}`;
    } catch {
      if (generation === this.generation) this.element('#brief-chat-target').textContent = `Brief project: ${this.root}. Could not check Codex chat. Refresh to retry; you can still copy the brief.`;
    } finally {
      if (generation === this.generation) { this.refreshingChat = false; this.updateButtons(); }
    }
  }

  private async sendBrief() {
    if (this.element<HTMLButtonElement>('#brief-send').disabled || this.busy) return;
    const text = this.element<HTMLTextAreaElement>('#brief-output').value;
    const model = this.element<HTMLInputElement>('#brief-model').value;
    this.setBusy(true); this.feedback('Sending brief to Codex chat...');
    try {
      const result = await this.conversation.send(this.root, text, model);
      if (!result.ok) { this.feedback(result.message ?? 'Could not send the brief. Check Codex chat before retrying; your brief is still here.', true); return; }
      this.sentToConversation = true;
      this.dialog.close();
    } catch { this.feedback('Sending could not be confirmed. Check Codex chat before retrying; your brief is still here.', true); }
    finally { this.setBusy(false); }
  }

  private async insertBrief() {
    if (this.element<HTMLButtonElement>('#brief-insert').disabled || this.busy) return;
    const id = this.element<HTMLSelectElement>('#brief-terminal').value;
    const text = this.element<HTMLTextAreaElement>('#brief-output').value;
    this.setBusy(true); this.feedback('Inserting brief…');
    try {
      const result = await this.handoff.insert(id, this.root, text);
      if (!result.ok) { this.feedback(result.message ?? 'Could not insert the brief. Check the terminal before retrying.', true); this.refreshTargets(); return; }
      this.insertedTarget = id;
      this.dialog.close();
    } catch { this.feedback('Insertion could not be confirmed. Check the terminal before retrying; your brief is still here.', true); }
    finally { this.setBusy(false); }
  }
}
