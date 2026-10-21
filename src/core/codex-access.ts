import type { CodexConnection } from './codex-connection';
import { CredentialStore, validApiKey } from './credential-store';
import type { CodexConnectionState } from '../shared/types';

export class CodexAccess {
  private pending?: Promise<CodexConnectionState>;
  private generation = 0;
  private lastError?: CodexConnectionState;
  private startupAttempted = false;
  private ending = 0;
  constructor(private readonly connection: Pick<CodexConnection, 'connect' | 'disconnect' | 'snapshot'>, private readonly store: CredentialStore) {}
  credentials() { return this.store.snapshot(); }
  snapshot() { return this.lastError ?? this.connection.snapshot(); }
  private error(message: string): CodexConnectionState { return this.lastError = { status: 'error', message }; }
  connect(executable: unknown, key: unknown, remember: unknown = false, autoConnect: unknown = false, project?: string) {
    if (this.pending || this.ending || ['connecting', 'connected', 'disconnecting'].includes(this.connection.snapshot().status)) return Promise.resolve(this.connection.snapshot());
    if (typeof executable !== 'string' || executable.length > 4096 || /[\x00-\x1f]/.test(executable) || typeof key !== 'string'
      || typeof remember !== 'boolean' || typeof autoConnect !== 'boolean' || (key !== '' && !validApiKey(key))) return Promise.resolve(this.error('Enter a non-empty API key without spaces or line breaks and a valid executable path.'));
    this.lastError = undefined;
    const generation = this.generation;
    this.pending = (async () => {
      let secret = key;
      if (!secret) secret = await this.store.key() ?? '';
      if (!secret) return this.error(this.store.snapshot().warning ?? 'Enter an API key or remember one first.');
      if (generation !== this.generation) return this.connection.snapshot();
      if (remember) {
        const saved = key ? await this.store.remember(secret, executable, autoConnect) : await this.store.preferences(executable, autoConnect);
        if (!saved) return this.error(this.store.snapshot().warning!);
      } else if (autoConnect) return this.error('Remember an API key before enabling auto-connect.');
      if (generation !== this.generation) return this.connection.snapshot();
      const result = this.connection.connect(executable, secret, project); secret = '';
      return result;
    })().catch(() => this.error('Could not configure Codex access. Retry or use a session-only key.')).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  async startup(project?: string) {
    if (this.startupAttempted) return this.connection.snapshot();
    this.startupAttempted = true;
    const saved = this.store.snapshot();
    return saved.autoConnect ? this.connect(saved.executable, '', false, false, project) : this.connection.snapshot();
  }
  async disconnect() {
    this.startupAttempted = true; this.generation++; this.ending++; this.lastError = undefined;
    try {
      await this.connection.disconnect();
      await this.pending;
      return await this.connection.disconnect();
    } finally { this.lastError = undefined; this.ending--; }
  }
  async forget() {
    this.ending++;
    try { await this.disconnect(); await this.store.forget(); return this.credentials(); }
    finally { this.ending--; }
  }
}
