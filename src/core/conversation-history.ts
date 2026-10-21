import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ConversationMessage, ConversationState } from '../shared/types';
import { validModelId } from '../shared/codex-commands';

export interface SavedConversation {
  version: 1;
  runtimeHome: 'codex-runtime-v1';
  runtimeVersion?: string;
  threadId?: string;
  contextId: string;
  projectPath?: string;
  selectedModel?: string;
  status: ConversationState['status'];
  messages: ConversationMessage[];
}
export function parseHistory(value: unknown): SavedConversation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const d = value as SavedConversation;
  const text = (v: unknown, limit: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= limit;
  if (d.version !== 1 || d.runtimeHome !== 'codex-runtime-v1' || !text(d.contextId, 128)
    || (d.threadId !== undefined && (!text(d.threadId, 128) || !/^[a-zA-Z0-9_-]+$/.test(d.threadId)))
    || (d.runtimeVersion !== undefined && !text(d.runtimeVersion, 128))
    || (d.selectedModel !== undefined && (typeof d.selectedModel !== 'string' || !validModelId(d.selectedModel)))
    || (d.projectPath !== undefined && (!text(d.projectPath, 4096) || !path.isAbsolute(d.projectPath) || /[\x00-\x1f]/.test(d.projectPath)))
    || !['idle','starting','running','stopping','completed','interrupted','error'].includes(d.status)
    || !Array.isArray(d.messages) || d.messages.length > 200) throw new Error();
  const ids = new Set<string>(); let size = 0;
  const messages = d.messages.map(m => {
    if (!m || !text(m.id, 512) || ids.has(m.id) || !['user','assistant','system'].includes(m.role) || typeof m.text !== 'string') throw new Error();
    ids.add(m.id); size += m.text.length; if (size > 200_000) throw new Error();
    return { id: m.id, role: m.role, text: m.text };
  });
  return { version: 1, runtimeHome: 'codex-runtime-v1', runtimeVersion: d.runtimeVersion, threadId: d.threadId, contextId: d.contextId, projectPath: d.projectPath, selectedModel: d.selectedModel, status: d.status, messages };
}
export class ConversationHistory {
  private data?: SavedConversation;
  private backup = false;
  private recovered = false;
  private queue: Promise<unknown> = Promise.resolve();
  warning?: string;
  private constructor(private readonly file: string) {}
  static async load(file: string) {
    const history = new ConversationHistory(file);
    try {
      if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error();
      history.data = parseHistory(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        history.backup = true;
        history.warning = 'Saved chat could not be read or has an unsupported format. The original is preserved and will be backed up before a new transcript is saved.';
      }
    }
    return history;
  }
  snapshot() { return this.data ? structuredClone(this.data) : undefined; }
  save(record: SavedConversation): Promise<boolean> {
    let data: SavedConversation;
    try { data = parseHistory(record); } catch { this.warning = 'Chat exceeds the saved-history limits. Earlier saved history is retained.'; return Promise.resolve(false); }
    const operation = this.queue.then(async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        if (this.backup) { await copyFile(this.file, `${this.file}.invalid-${randomUUID()}.bak`); this.backup = false; this.recovered = true; }
        const content = JSON.stringify(data) + '\n';
        if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error();
        await writeFile(temporary, content, { flag: 'wx' });
        await rename(temporary, this.file); this.data = data; this.warning = this.recovered ? 'Unreadable previous chat was backed up beside the history file. A new transcript is being saved.' : undefined; return true;
      } catch { this.warning = 'Chat history could not be saved. Previous saved data is retained. Check user-data storage permissions and space before sending again.'; return false; }
      finally { await unlink(temporary).catch(() => undefined); }
    });
    this.queue = operation.catch(() => undefined); return operation;
  }
  async flush() { await this.queue; }
}
