import type { Models, SummaryRecord, SummarySubject } from '../../packages/plugin-api/src/index';
import { canonicalSubject, summaryChanges, summaryCitations, summaryInput, SUMMARY_INSTRUCTION_VERSION, validSubject, type StoredSummary, type SummaryEntries } from '../core/summaries';
import type { SpecularBridge } from '../shared/types';

type Agent = 'codex' | 'claude';
type Call = Parameters<Parameters<SpecularBridge['onCustomPluginSummary']>[0]>[0];

/**
 * Increment 94 (DD-060): answers custom views' summary calls. Specular builds the input from the current models, asks
 * for consent once per project, and has the main process run one tool-less agent turn and store the JSON record.
 */
export class SummaryService {
  private runs = new Map<string, string>();
  private readonly dialog = document.createElement('dialog');
  constructor(private api: SpecularBridge, private host: { models(): Models | undefined; agentPath(agent: Agent): string }) {
    this.dialog.id = 'summary-consent-dialog';
    this.dialog.setAttribute('aria-labelledby', 'summary-consent-title');
    this.dialog.innerHTML = `<h2 id="summary-consent-title">Allow summaries for this project?</h2>
      <p id="summary-consent-detail"></p>
      <p>The agent runs one turn without tools and cannot read other files or change the project. Summaries are saved in this project's <code>.specular/summaries</code> folder. You can stop allowing summaries in Agent setup.</p>
      <div class="dialog-actions"><button type="button" class="button secondary" id="summary-consent-cancel">Cancel</button><button type="button" class="button primary" id="summary-consent-allow">Allow and generate</button></div>`;
    document.body.append(this.dialog);
    api.onCustomPluginSummary(call => { void this.handle(call); });
  }

  private reply(call: Call, result: { ok: true; record?: SummaryRecord } | { ok: false; message: string }) { void this.api.summaryReply(call.id, call.call, result).catch(() => undefined); }
  private runId(plugin: string, subject: SummarySubject) { return `${plugin}:${JSON.stringify(canonicalSubject(subject))}`; }

  async handle(call: Call) {
    if (!validSubject(call.subject)) { if (call.op !== 'cancel') this.reply(call, { ok: false, message: 'Unsupported summary subject.' }); return; }
    const subject = canonicalSubject(call.subject);
    if (call.op === 'cancel') { const run = this.runs.get(this.runId(call.id, subject)); if (run) void this.api.summaryCancel(run); return; }
    try {
      if (call.op === 'get') this.reply(call, { ok: true, record: await this.get(subject) });
      else this.reply(call, { ok: true, record: await this.generate(call.id, subject, call.options) });
    } catch (error) { this.reply(call, { ok: false, message: error instanceof Error ? error.message : 'The summary failed.' }); }
  }

  async get(subject: SummarySubject): Promise<SummaryRecord | undefined> {
    const stored = await this.api.summaryRead(subject);
    if (!stored) return;
    const models = this.host.models(), input = models ? summaryInput(models, subject) : undefined;
    return this.record(stored, input && !('error' in input) ? input.entries : {});
  }

  async generate(plugin: string, subject: SummarySubject, options: unknown): Promise<SummaryRecord> {
    const o = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>;
    if (o.agent !== 'codex' && o.agent !== 'claude') throw new Error('Choose Codex or Claude Code.');
    const agent: Agent = o.agent, model = typeof o.model === 'string' && o.model.trim() ? o.model.trim().slice(0, 200) : undefined;
    const models = this.host.models();
    if (!models) throw new Error('Open a project first.');
    const input = summaryInput(models, subject);
    if ('error' in input) throw new Error(input.error);
    const key = this.runId(plugin, subject);
    if (this.runs.has(key)) throw new Error('A summary of this subject is already being generated.');
    if (!(await this.api.summaryConsent())) {
      if (!(await this.ask(input.name, agent, input.text.length))) throw new Error('Summaries were not allowed for this project.');
      const saved = await this.api.saveSummaryConsent(true);
      if (!saved.ok && !(await this.api.summaryConsent())) throw new Error(saved.message ?? 'The consent could not be recorded.');
    }
    const run = crypto.randomUUID(); this.runs.set(key, run);
    try {
      const result = await this.api.summaryRun({ runId: run, agent, ...(agent === 'claude' ? { executable: this.host.agentPath('claude') } : {}), ...(model ? { model } : {}), input: input.text });
      if (!result.ok) throw new Error(result.message);
      // Citations are checked against the models the summary was built from.
      const stored: StoredSummary = { version: 1, subject, name: input.name, text: result.text, generatedAt: new Date().toISOString(), agent, ...(model ? { model } : {}),
        instructionVersion: SUMMARY_INSTRUCTION_VERSION, entries: input.entries, ...summaryCitations(result.text, models) };
      await this.api.summaryWrite(stored);
      return this.record(stored, input.entries);
    } finally { this.runs.delete(key); }
  }

  private record(stored: StoredSummary, current: SummaryEntries): SummaryRecord {
    return { subject: stored.subject, name: stored.name, text: stored.text, generatedAt: stored.generatedAt, agent: stored.agent, ...(stored.model ? { model: stored.model } : {}),
      citedIds: stored.citedIds, unknownCitations: stored.unknownCitations, changes: summaryChanges(stored.entries, current, stored.instructionVersion) };
  }

  /** One-time consent per project; any other open dialog means the user is busy, so the request is refused. */
  private ask(name: string, agent: Agent, size: number): Promise<boolean> {
    if (document.querySelector('dialog[open]')) return Promise.resolve(false);
    this.dialog.querySelector('#summary-consent-detail')!.textContent =
      `To summarize ${name}, Specular sends about ${Math.max(1, Math.round(size / 1000))} KB of recorded specification text from this project to ${agent === 'claude' ? 'Claude Code' : 'Codex'}, which passes it to its model provider.`;
    return new Promise(resolve => {
      const done = (value: boolean) => { this.dialog.onclose = null; if (this.dialog.open) this.dialog.close(); resolve(value); };
      this.dialog.querySelector<HTMLButtonElement>('#summary-consent-allow')!.onclick = () => done(true);
      this.dialog.querySelector<HTMLButtonElement>('#summary-consent-cancel')!.onclick = () => done(false);
      this.dialog.onclose = () => done(false);
      this.dialog.showModal(); this.dialog.querySelector<HTMLButtonElement>('#summary-consent-cancel')!.focus();
    });
  }
}
