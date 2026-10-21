import type { OpenDocument, SaveResult } from '../shared/types';

export const AUTOSAVE_DELAY = 500;
export interface AutosaveTarget {
  text(): string;
  savedText(): string;
  version(): string;
  write(text: string, version: string): Promise<SaveResult>;
  saved(document: OpenDocument): void;
  changed(): void;
}

/** One scheduler per buffer. A successful older write never marks newer edits saved. */
export class Autosave {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private paused = false;
  private disposed = false;
  error?: string;
  conflict = false;
  constructor(private readonly target: AutosaveTarget, private readonly delay = AUTOSAVE_DELAY) {}
  get saving() { return !!this.pending; }
  get dirty() { return this.target.text() !== this.target.savedText(); }
  get status() { return this.conflict ? 'Conflict' : this.error ? 'Save failed' : this.saving ? 'Saving' : this.dirty ? 'Pending changes' : 'Saved'; }
  edit() {
    clearTimeout(this.timer);
    if (!this.disposed && !this.paused && !this.error && this.dirty) this.timer = setTimeout(() => { void this.flush(); }, this.delay);
    this.target.changed();
  }
  block(message: string) { this.error = message; this.conflict = true; clearTimeout(this.timer); this.target.changed(); }
  pause() { this.paused = true; clearTimeout(this.timer); }
  resume() { this.paused = false; this.edit(); }
  async settle() { this.pause(); await this.pending; }
  dispose() { this.disposed = true; this.pause(); }
  async flush(retry = false): Promise<boolean> {
    clearTimeout(this.timer);
    // Departure can explicitly drain a paused buffer; an older background flush stops after settle().
    const allowPaused = this.paused;
    if (retry && !this.conflict) { this.error = undefined; this.target.changed(); }
    while (!this.disposed) {
      if (this.paused && !allowPaused && !this.pending) return !this.dirty;
      if (this.pending) { await this.pending; continue; }
      if (!this.dirty) return true;
      if (this.error) return false;
      const text = this.target.text(), version = this.target.version();
      this.pending = Promise.resolve().then(async () => {
        try {
          const result = await this.target.write(text, version);
          if (this.disposed) return;
          if (result.ok) this.target.saved(result.document);
          else { this.error = result.message; this.conflict = true; }
        } catch (error) {
          this.error = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error);
        }
      }).finally(() => { this.pending = undefined; if (!this.disposed) this.target.changed(); });
      this.target.changed();
      await this.pending;
      clearTimeout(this.timer);
      // Continue with any newer text, using the version returned by the completed write.
    }
    return false;
  }
}
