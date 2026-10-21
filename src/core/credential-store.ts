import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CodexCredentialState } from '../shared/types';

export interface CredentialEncryption {
  available(): Promise<boolean>;
  encrypt(key: string): Promise<Buffer>;
  decrypt(bytes: Buffer): Promise<string>;
}
interface RecordData { version: 1; credential?: string; executable: string; autoConnect: boolean }
export const validApiKey = (key: unknown): key is string => typeof key === 'string' && key.length > 0 && key.length <= 4096 && !/\s/.test(key);

/** Only this main-process store can read the protected key. Snapshots contain no secrets. */
export class CredentialStore {
  private data: RecordData = { version: 1, executable: '', autoConnect: false };
  private warning?: string;
  private writable = true;
  private constructor(private readonly directory: string, private readonly encryption: CredentialEncryption) {}
  static async load(directory: string, encryption: CredentialEncryption) {
    const store = new CredentialStore(directory, encryption);
    try {
      const file = path.join(directory, 'preferences.json');
      if ((await stat(file)).size > 16384) throw new Error();
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (data.version !== 1 || typeof data.autoConnect !== 'boolean' || typeof data.executable !== 'string' || data.executable.length > 4096 || /[\x00-\x1f]/.test(data.executable)
        || (data.credential !== undefined && (typeof data.credential !== 'string' || !/^[a-f0-9-]{36}\.bin$/.test(data.credential))) || (data.autoConnect && !data.credential)) throw new Error();
      store.data = { version: 1, executable: data.executable, autoConnect: data.autoConnect, credential: data.credential };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        store.writable = false;
        store.warning = 'Saved connection preferences could not be read. Existing data is preserved; use a session-only key or Forget key to reset.';
      }
    }
    return store;
  }
  snapshot(): CodexCredentialState { return { remembered: !!this.data.credential, autoConnect: this.data.autoConnect, executable: this.data.executable, warning: this.warning }; }
  async key() {
    try {
      if (!this.data.credential) return undefined;
      if (!await this.encryption.available()) throw new Error();
      const file = path.join(this.directory, this.data.credential);
      if ((await stat(file)).size > 32768) throw new Error();
      const key = await this.encryption.decrypt(await readFile(file));
      if (!validApiKey(key)) throw new Error();
      this.warning = undefined;
      return key;
    } catch { this.warning = 'The saved key could not be decrypted or read. Existing data is preserved. Enter a session-only key, replace it, or choose Forget key.'; return undefined; }
  }
  private async commit(data: RecordData) {
    await mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(data) + '\n', { flag: 'wx' });
      await rename(temporary, path.join(this.directory, 'preferences.json'));
      this.data = data; this.warning = undefined;
    } finally { await unlink(temporary).catch(() => undefined); }
  }
  async remember(key: string, executable: string, autoConnect: boolean) {
    const credential = `${randomUUID()}.bin`;
    try {
      if (!this.writable || !validApiKey(key) || !await this.encryption.available()) throw new Error();
      const encrypted = await this.encryption.encrypt(key);
      if (!encrypted.length || encrypted.length > 32768) throw new Error();
      await mkdir(this.directory, { recursive: true });
      await writeFile(path.join(this.directory, credential), encrypted, { flag: 'wx' });
      const old = this.data.credential;
      await this.commit({ version: 1, credential, executable, autoConnect });
      if (old) await unlink(path.join(this.directory, old)).catch(() => undefined);
      return true;
    } catch {
      await unlink(path.join(this.directory, credential)).catch(() => undefined);
      this.warning = 'The key could not be saved with protected storage. Previous data is retained. Uncheck Remember API key to connect for this session only.';
      return false;
    }
  }
  async preferences(executable: string, autoConnect: boolean) {
    try {
      if (!this.writable || (autoConnect && !this.data.credential)) throw new Error();
      await this.commit({ ...this.data, executable, autoConnect }); return true;
    } catch { this.warning = 'Connection preferences could not be saved. Previous settings are retained.'; return false; }
  }
  async forget() {
    try {
      // Disable startup first. If deletion fails the reference remains available for retry.
      await this.commit({ ...this.data, autoConnect: false });
      for (const name of await readdir(this.directory)) {
        if (/^[a-f0-9-]{36}\.bin$/.test(name)) await unlink(path.join(this.directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      await this.commit({ version: 1, executable: this.data.executable, autoConnect: false });
      this.writable = true; return true;
    } catch { this.warning = 'The saved key could not be fully removed. Retry Forget key after checking storage permissions.'; return false; }
  }
}
