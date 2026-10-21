import { mkdir, writeFile, realpath, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { discoverAgent } from './agent-discovery';
import { JsonLineClient } from './json-line-client';
import type { CodexConnectionState } from '../shared/types';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const restrictedConfig = 'cli_auth_credentials_store = "ephemeral"\nsandbox_mode = "read-only"\napproval_policy = "never"\nweb_search = "disabled"\n[windows]\nsandbox = "unelevated"\n[features]\nmulti_agent = false\nhooks = false\n';
export async function projectDirectory(root: string) { const canonical = await realpath(root); await readdir(canonical); return canonical; }
export function codexEnvironment(home: string, inherited = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(inherited)) if (/^(path|systemroot|windir|comspec|pathext|processor_architecture|number_of_processors)$/i.test(key)) env[key] = value;
  return { ...env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'),
    APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), TEMP: path.join(home, 'tmp'), TMP: path.join(home, 'tmp') };
}
export class CodexConnection {
  private state: CodexConnectionState = { status: 'disconnected', message: 'Connect Codex with an API key for this app session.' };
  private client?: JsonLineClient;
  private operation?: Promise<CodexConnectionState>;
  private disconnecting?: Promise<CodexConnectionState>;
  private releasing?: Promise<boolean>;
  private cancelled = false;
  private workspace?: string;
  private configFile?: string;
  private readonly listeners = new Set<(method: string, params: unknown) => void>();
  constructor(private readonly userData: string, private readonly changed: (state: CodexConnectionState) => void,
    private readonly inherited = process.env) {}
  snapshot() { return { ...this.state }; }
  subscribe(listener: (method: string, params: unknown) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  runtime() { return this.state.status === 'connected' && this.client && this.workspace ? { client: this.client, cwd: this.workspace } : undefined; }
  async prepareProject(root: string) {
    const runtime = this.runtime(); const configFile = this.configFile;
    if (!runtime || !configFile) throw new Error('Connect Codex first.');
    const canonical = await projectDirectory(root);
    if (canonical.toLowerCase() !== root.toLowerCase()) throw new Error('The project folder changed. Reopen it in Specular.');
    // Mark every ancestor untrusted so repository-root discovery cannot load a parent .codex layer.
    let config = restrictedConfig;
    for (let directory = canonical; ; directory = path.dirname(directory)) {
      config += `\n[projects.${JSON.stringify(directory)}]\ntrust_level = "untrusted"\n`;
      if (path.dirname(directory) === directory) break;
    }
    await writeFile(configFile + '.tmp', config); await rename(configFile + '.tmp', configFile);
    const result = record(await runtime.client.request('config/read', { cwd: canonical, includeLayers: true }));
    const effective = record(result.config); const features = record(effective.features);
    const layers = result.layers;
    if (!Array.isArray(layers) || layers.some(layer => record(record(layer).name).type === 'project' && !record(layer).disabledReason)
      || effective.sandbox_mode !== 'read-only' || effective.approval_policy !== 'never' || effective.web_search !== 'disabled'
      || features.hooks !== false || features.multi_agent !== false || record(effective.windows).sandbox !== 'unelevated'
      || effective.cli_auth_credentials_store !== 'ephemeral' || Object.keys(record(effective.mcp_servers)).length
      || Object.keys(record(effective.hooks)).length || effective.notify != null) throw new Error('Codex could not verify restricted project configuration.');
    if (this.runtime()?.client !== runtime.client) throw new Error('Codex connection changed.');
    return canonical;
  }
  modelRequestCompleted() { if (this.state.status === 'connected') this.set({ ...this.state, message: 'Connected to Codex · API key configured for this session. A model request completed successfully.' }); }
  private set(state: CodexConnectionState) { this.state = state; this.changed(this.snapshot()); return this.snapshot(); }
  connect(executable: string, apiKey: string, projectRoot?: string): Promise<CodexConnectionState> {
    if (this.operation || this.client || this.disconnecting || this.releasing) return Promise.resolve(this.snapshot());
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 || /\s/.test(apiKey)) return Promise.resolve(this.set({ status: 'error', message: 'Enter a non-empty API key without spaces or line breaks.' }));
    this.cancelled = false;
    this.set({ status: 'connecting', message: 'Starting Codex and configuring API-key access…' });
    this.operation = this.start(executable, apiKey, projectRoot).finally(() => { this.operation = undefined; });
    return this.operation;
  }
  private async start(executable: string, key: string, projectRoot?: string) {
    let phase = 'installation';
    try {
      const home = path.join(this.userData, 'codex-runtime-v1'); await mkdir(home, { recursive: true });
      for (const directory of ['.codex', 'AppData/Roaming', 'AppData/Local', 'tmp', 'workspace']) await mkdir(path.join(home, directory), { recursive: true });
      this.workspace = path.join(home, 'workspace');
      this.configFile = path.join(home, '.codex/config.toml');
      await writeFile(this.configFile, restrictedConfig);
      const env = codexEnvironment(home, this.inherited);
      const installed = await discoverAgent('codex', executable, { cwd: path.join(home, 'workspace'), env, projectRoot });
      if (installed.status !== 'detected' || !installed.path) throw new Error('Installation unavailable.');
      if (this.cancelled) throw new Error('Cancelled.');
      phase = 'startup';
      const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(installed.path);
      if (batch && /[%!^"\r\n]/.test(installed.path)) throw new Error('Unsupported launcher path.');
      if (this.cancelled) throw new Error('Cancelled.');
      const client = new JsonLineClient(batch ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe') : installed.path,
        batch ? ['/d', '/s', '/c', `""${installed.path}" app-server"`] : ['app-server'], {
          cwd: path.join(home, 'workspace'), env, windowsVerbatimArguments: batch, maxBytes: 8_388_608,
          onNotification: (method, params) => { for (const listener of this.listeners) listener(method, params); },
          onFailure: () => {
            if (this.client === client && !this.operation) {
              this.set({ status: 'error', message: 'Codex disconnected unexpectedly. Reconnect with your API key.' });
              void this.release();
            }
          },
        });
      this.client = client;
      await client.request('initialize', { clientInfo: { name: 'specular', title: 'Specular', version: '0.1.0' }, capabilities: { experimentalApi: false } });
      client.notify('initialized', {});
      phase = 'storage';
      const configuration = record(await client.request('config/read', { includeLayers: false }));
      if (record(configuration.config).cli_auth_credentials_store !== 'ephemeral') throw new Error('Ephemeral credential storage unavailable.');
      const before = record(await client.request('account/read', { refreshToken: false }));
      if (before.account !== null) throw new Error('Expected an isolated, signed-out account.');
      if (this.cancelled) throw new Error('Cancelled.');
      phase = 'authentication';
      // Register before sending: completion may precede the request response.
      const completed = client.nextNotification('account/login/completed');
      const login = client.request('account/login/start', { type: 'apiKey', apiKey: key });
      key = '';
      const [response, notification] = await Promise.all([login, completed]);
      if (record(response).type !== 'apiKey' || record(notification).success !== true) throw new Error('Login rejected.');
      const account = record(await client.request('account/read', { refreshToken: false }));
      if (record(account.account).type !== 'apiKey') throw new Error('API-key mode not confirmed.');
      if (this.cancelled) throw new Error('Cancelled.');
      return this.set({ status: 'connected', path: installed.path, version: installed.version,
        message: 'Connected to Codex · API key configured for this session. Model access has not been tested.' });
    } catch {
      key = ''; const cleanup = await this.release();
      const messages: Record<string, string> = {
        installation: 'Could not find a usable Codex installation. Check installation or choose its executable.',
        startup: 'Could not start or initialize Codex. Check its path and app-server support, then retry.',
        storage: 'Codex could not confirm isolated, ephemeral credential storage. No key was sent. Check the runtime version.',
        authentication: 'Codex did not accept or confirm API-key access. Check the key and retry. No model request was made.',
      };
      return this.set({ status: this.cancelled ? 'disconnected' : 'error', message: (this.cancelled ? 'Connection cancelled. Enter your key to reconnect.' : messages[phase]) + (cleanup ? '' : ' Process cleanup could not be confirmed.') });
    }
  }
  private release() {
    this.releasing ??= this.stopClient().finally(() => { this.releasing = undefined; });
    return this.releasing;
  }
  private async stopClient() {
    const client = this.client; this.client = undefined;
    this.workspace = undefined;
    this.configFile = undefined;
    for (const listener of this.listeners) listener('specular/disconnected', {});
    if (!client) return true;
    const stopped = await client.stop(); return stopped.exited && stopped.treeTerminated;
  }
  disconnect() {
    this.disconnecting ??= this.endConnection().finally(() => { this.disconnecting = undefined; });
    return this.disconnecting;
  }
  private async endConnection() {
    this.cancelled = true;
    this.set({ ...this.state, status: 'disconnecting', message: 'Disconnecting Codex…' });
    const stopped = await this.release();
    await this.operation;
    return this.set({ status: stopped ? 'disconnected' : 'error', message: stopped ? 'Disconnected. Enter your API key to reconnect.' : 'Disconnected, but process cleanup could not be confirmed.' });
  }
  async refresh() {
    if (this.state.status !== 'connected' || !this.client || this.operation) return this.snapshot();
    const client = this.client;
    try {
      const response = record(await client.request('account/read', { refreshToken: false }));
      if (record(response.account).type !== 'apiKey') throw new Error('Not connected.');
    } catch {
      if (this.client === client) { await this.release(); this.set({ status: 'error', message: 'Codex API-key access is no longer configured. Reconnect to continue.' }); }
    }
    return this.snapshot();
  }
}
