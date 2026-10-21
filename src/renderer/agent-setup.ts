import type { AgentId, CodexConnectionState, SpecularBridge } from '../shared/types';

export class AgentSetup {
  private readonly dialog = document.createElement('dialog');
  private onClose?: () => void;
  constructor(private readonly api: SpecularBridge) {
    this.dialog.id = 'agent-setup-dialog';
    this.dialog.setAttribute('aria-labelledby', 'agent-setup-title');
    this.dialog.innerHTML = `<h2 id="agent-setup-title">Agent setup</h2>
      <p>Check your locally installed agents. Leave the path empty to search PATH, or choose an executable. Each check runs only <code>--version</code>, with a five-second limit.</p>
      <div class="agent-cards"></div>
      <p class="agent-note">Install agents manually. Claude paths last for this session. Remembered Codex connections retain their executable path. Open Codex chat after connecting to start a conversation.</p>
      <div class="dialog-actions"><button class="button secondary" id="agent-setup-close">Close</button></div>`;
    for (const [id, name] of [['codex', 'Codex'], ['claude', 'Claude Code']] as const) this.addAgent(id, name);
    this.dialog.querySelector<HTMLButtonElement>('#agent-setup-close')!.onclick = () => this.dialog.close();
    document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => { const key = this.dialog.querySelector<HTMLInputElement>('#codex-api-key'); if (key) key.value = ''; const callback = this.onClose; this.onClose = undefined; callback?.(); });
  }
  show(onClose?: () => void) { if (!document.querySelector('dialog[open]')) { this.onClose = onClose; this.dialog.showModal(); void this.api.codexStatus().then(state => this.updateConnection?.(state)).catch(() => undefined); } }
  private updateConnection?: (state: CodexConnectionState) => void;
  private addAgent(id: AgentId, name: string) {
    const card = document.createElement('form'); card.className = 'agent-card'; card.dataset.agent = id;
    card.innerHTML = `<h3>${name}</h3><label for="${id}-path">Executable path (optional)</label>
      <div class="agent-path-row"><input id="${id}-path" class="search" placeholder="Find ${id} on PATH" spellcheck="false" autocomplete="off" maxlength="4096" />
      <button type="button" class="button secondary agent-browse">Browse…</button></div>
      <button type="submit" class="button primary agent-check">Check installation</button>
      <div class="agent-result" role="status" aria-live="polite">Not checked.</div>`;
    const input = card.querySelector<HTMLInputElement>('input')!;
    const browse = card.querySelector<HTMLButtonElement>('.agent-browse')!;
    const check = card.querySelector<HTMLButtonElement>('.agent-check')!;
    const result = card.querySelector<HTMLDivElement>('.agent-result')!;
    let installationBusy = false;
    let connection: CodexConnectionState = { status: 'disconnected', message: 'Connect using your OpenAI API key.' };
    const updateControls = () => {
      const active = id === 'codex' && ['connecting', 'connected', 'disconnecting'].includes(connection.status);
      input.disabled = browse.disabled = check.disabled = installationBusy || active;
      card.setAttribute('aria-busy', String(installationBusy || connection.status === 'connecting' || connection.status === 'disconnecting'));
      if (id === 'codex') {
        card.querySelector<HTMLInputElement>('#codex-api-key')!.disabled = active;
        card.querySelector<HTMLInputElement>('#codex-remember-key')!.disabled = active;
        card.querySelector<HTMLInputElement>('#codex-auto-connect')!.disabled = active || !card.querySelector<HTMLInputElement>('#codex-remember-key')!.checked;
        card.querySelector<HTMLButtonElement>('#codex-forget-key')!.disabled = connection.status === 'disconnecting';
        card.querySelector<HTMLButtonElement>('#codex-connect')!.disabled = installationBusy || active;
        card.querySelector<HTMLButtonElement>('#codex-disconnect')!.disabled = !['connecting', 'connected'].includes(connection.status);
        card.querySelector<HTMLButtonElement>('#codex-status-refresh')!.disabled = ['connecting', 'disconnecting'].includes(connection.status);
      }
    };
    const busy = (value: boolean) => { installationBusy = value; updateControls(); };
    if (id === 'codex') {
      const auth = document.createElement('section'); auth.className = 'codex-auth';
      auth.innerHTML = `<h4>API-key connection</h4><label for="codex-api-key">OpenAI API key</label>
        <input id="codex-api-key" type="password" class="search" autocomplete="off" spellcheck="false" maxlength="4096" placeholder="Enter your API key" />
        <p class="agent-note">Leave the key empty to use a remembered key, or enter a replacement. Disconnect keeps the saved key; Forget key removes it. Your other Codex logins are separate.</p>
        <label class="credential-option"><input id="codex-remember-key" type="checkbox" /> Remember API key on this device</label>
        <label class="credential-option"><input id="codex-auto-connect" type="checkbox" disabled /> Connect automatically when Specular starts</label>
        <p class="agent-note">Options apply when you connect. Unchecked Remember uses an entered key for this session only and retains any previously saved key and preferences. Auto-connect sends no messages.</p>
        <div id="codex-credential-state" role="status" class="agent-note"></div>
        <div class="codex-auth-actions"><button id="codex-connect" type="button" class="button primary">Connect Codex</button>
        <button id="codex-disconnect" type="button" class="button secondary">Disconnect</button>
        <button id="codex-forget-key" type="button" class="quiet-button">Forget key</button>
        <button id="codex-status-refresh" type="button" class="quiet-button">Refresh status</button></div>
        <div id="codex-connection-state" class="codex-connection-result" role="status" aria-live="polite"></div>`;
      card.append(auth);
      const keyInput = auth.querySelector<HTMLInputElement>('#codex-api-key')!;
      const stateView = auth.querySelector<HTMLElement>('#codex-connection-state')!;
      const remember = auth.querySelector<HTMLInputElement>('#codex-remember-key')!;
      const automatic = auth.querySelector<HTMLInputElement>('#codex-auto-connect')!;
      const credentialView = auth.querySelector<HTMLElement>('#codex-credential-state')!;
      const refreshCredentials = async (restore = false) => {
        try {
          const saved = await this.api.codexCredentials();
          credentialView.textContent = saved.warning ?? (saved.remembered ? 'A protected key is saved on this device.' : 'No API key is saved.');
          if (restore) { remember.checked = saved.remembered; automatic.checked = saved.autoConnect; if (saved.executable) input.value = saved.executable; }
          updateControls();
        } catch { credentialView.textContent = 'Could not read saved-key settings.'; }
      };
      remember.onchange = () => { if (!remember.checked) automatic.checked = false; updateControls(); };
      auth.querySelector<HTMLButtonElement>('#codex-forget-key')!.onclick = async () => {
        keyInput.value = ''; this.updateConnection!({ ...connection, status: 'disconnecting', message: 'Disconnecting and forgetting the saved key...' });
        try {
          const saved = await this.api.forgetCodexKey();
          remember.checked = saved.remembered; automatic.checked = saved.autoConnect;
          credentialView.textContent = saved.warning ?? 'Saved key removed. Auto-connect is disabled.';
          this.updateConnection!(await this.api.codexStatus());
        } catch { this.updateConnection!({ status: 'error', message: 'Could not forget the saved key. Please retry.' }); }
      };
      void refreshCredentials(true);
      this.updateConnection = state => {
        connection = state; stateView.dataset.status = state.status; stateView.textContent = state.message;
        if (state.path) stateView.textContent += `\n${state.version ?? 'Codex'} · ${state.path}`;
        if (state.status === 'connected') { result.textContent = `${state.version ?? 'Codex'} · Installation checked while connecting.`; result.dataset.status = 'detected'; }
        updateControls();
      };
      const connect = async () => {
        if (auth.querySelector<HTMLButtonElement>('#codex-connect')!.disabled) return;
        const pending = this.api.connectCodex(input.value, keyInput.value, remember.checked, automatic.checked); keyInput.value = '';
        this.updateConnection!({ status: 'connecting', message: 'Connecting Codex…' });
        try { this.updateConnection!(await pending); }
        catch { this.updateConnection!({ status: 'error', message: 'Could not connect Codex. Please retry.' }); }
        await refreshCredentials();
      };
      auth.querySelector<HTMLButtonElement>('#codex-connect')!.onclick = () => { void connect(); };
      keyInput.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void connect(); } };
      auth.querySelector<HTMLButtonElement>('#codex-disconnect')!.onclick = async () => {
        keyInput.value = ''; this.updateConnection!({ ...connection, status: 'disconnecting', message: 'Disconnecting Codex…' });
        try { this.updateConnection!(await this.api.disconnectCodex()); }
        catch { this.updateConnection!({ status: 'error', message: 'Could not confirm disconnect. Retry or close Specular.' }); }
      };
      auth.querySelector<HTMLButtonElement>('#codex-status-refresh')!.onclick = async () => {
        try { this.updateConnection!(await this.api.codexStatus()); } catch { this.updateConnection!({ status: 'error', message: 'Could not read Codex status.' }); }
      };
      this.api.onCodexState(state => this.updateConnection!(state)); this.updateConnection(connection);
    }
    input.oninput = () => { result.textContent = 'Path changed. Check this installation to update the result.'; delete result.dataset.status; };
    browse.onclick = async () => {
      busy(true);
      try {
        const selected = await this.api.chooseAgentPath();
        if (selected) { input.value = selected; result.textContent = 'Path selected. Check this installation to see its version.'; delete result.dataset.status; }
      } catch { result.textContent = 'Could not open the file picker. Enter an executable path instead.'; }
      finally { busy(false); }
    };
    card.onsubmit = async event => {
      event.preventDefault(); if (check.disabled) return;
      busy(true); result.textContent = 'Checking installation…'; delete result.dataset.status;
      try {
        const found = await this.api.checkAgent(id, input.value);
        result.replaceChildren(); result.dataset.status = found.status;
        const title = document.createElement('strong'); title.textContent = found.version ?? ({ missing: 'Not found', invalid: 'Invalid path', failed: 'Check failed', timeout: 'Timed out', detected: 'Detected' }[found.status]);
        result.append(title);
        if (found.path) { const file = document.createElement('code'); file.textContent = found.path; result.append(file); }
        const message = document.createElement('span'); message.textContent = found.message; result.append(message);
      } catch { result.textContent = 'Could not check the installation. Please try again.'; result.dataset.status = 'failed'; }
      finally { busy(false); }
    };
    this.dialog.querySelector('.agent-cards')!.append(card);
  }
}
