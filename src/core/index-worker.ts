import type { IdConfiguration } from './id-configuration';
import type { ProjectIndex } from '../shared/types';
export interface IndexRequest { updateFolders?: import('./folder-generators').GeneratorTarget; folderGenerators?: import('./folder-generators').FolderGenerator[]; previousFolders?: import('./folder-generators').GeneratedFolder[]; discover?: boolean; classify?: import('./id-discovery').ConventionProposal; removeCategoryKeys?: string[]; revision: number; configurationRevision?: string; configuration?: IdConfiguration; documents: Record<string, string> }
export interface IndexResponse { folderConfiguration?: IdConfiguration; folderPreview?: import('./folder-generators').FolderPreview; classifications?: import('./discovery-category-classification').DiscoveryCategoryDecision[]; removedOverrideIds?: string[]; inventory?: import('./id-discovery').CandidateInventory; revision: number; index?: ProjectIndex; error?: string }
export interface AnalysisWorker {
  onmessage: ((event: MessageEvent<IndexResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => unknown) | null;
  postMessage(request: IndexRequest): void;
  terminate(): void;
}
/** Markdown characters in a request. */
export function requestSize(documents: Record<string, string>) { let size = 0; for (const text of Object.values(documents)) size += text.length; return size; }
/** Recognition budget until batched indexing (86e, DD-052): 5 seconds plus 1 second per million characters, at most 30 seconds. */
export function recognitionBudget(characters: number) { return Math.min(30_000, 5000 + Math.round(characters / 1000)); }
/** "18.5-second limit for 13.5 million characters" */
export function budgetText(budget: number, characters: number) {
  const size = characters >= 100_000 ? `${(characters / 1_000_000).toFixed(1)} million` : characters.toLocaleString('en-US');
  return `${Number((budget / 1000).toFixed(1))}-second limit for ${size} characters`;
}
/** At most one analysis at a time; an obsolete or over-budget worker is terminated. */
export class IndexWorker {
  private worker?: AnalysisWorker;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: number;
  /** `budget` is a fixed time limit in milliseconds; by default it follows the request's size. */
  constructor(private create: () => AnalysisWorker, private receive: (response: IndexResponse) => void, private budget?: number) {}
  cancel() {
    clearTimeout(this.timer);
    if (this.pending !== undefined) { this.worker?.terminate(); this.worker = undefined; }
    this.pending = undefined;
  }
  dispose() { this.cancel(); this.worker?.terminate(); this.worker = undefined; }
  run(request: IndexRequest) {
    this.cancel();
    this.pending = request.revision;
    const worker = this.worker ??= this.create();
    const finish = (response: IndexResponse) => {
      if (this.worker !== worker || this.pending !== request.revision || response.revision !== request.revision) return;
      clearTimeout(this.timer); this.pending = undefined; this.receive(response);
    };
    worker.onmessage = event => finish(event.data);
    worker.onerror = () => {
      worker.terminate();
      finish({ revision: request.revision, error: 'Markdown recognition worker failed. Edit the configuration or Refresh to retry.' });
      if (this.worker === worker) this.worker = undefined;
    };
    const characters = requestSize(request.documents), budget = this.budget ?? recognitionBudget(characters);
    this.timer = setTimeout(() => {
      worker.terminate();
      finish({ revision: request.revision, error: `Markdown recognition exceeded its ${budgetText(budget, characters)} and was stopped. Check project regex rules or reduce the indexed content, then Refresh. No partial index was accepted.` });
      if (this.worker === worker) this.worker = undefined;
    }, budget);
    worker.postMessage(request);
  }
}
