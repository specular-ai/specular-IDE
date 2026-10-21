import { MAX_SEARCH_QUERY, SEARCH_LIMIT, searchMarkdown, type MarkdownMatch } from '../core/markdown-search';

export interface SearchSnapshot {
  projectId: string;
  currentFile?: string;
  documents: Record<string, string>;
  warnings: string[];
  busy: boolean;
}
export type SearchScope = 'current' | 'project';

export class MarkdownSearchPanel {
  private readonly panel = document.createElement('section');
  private readonly query: HTMLInputElement;
  private readonly scope: HTMLSelectElement;
  private readonly matchCase: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly results: HTMLElement;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly parent: HTMLElement, private readonly trigger: HTMLButtonElement,
    private readonly snapshot: () => SearchSnapshot,
    private readonly navigate: (match: MarkdownMatch, text: string, valid: () => boolean) => Promise<void>) {
    this.panel.id = 'markdown-search-panel'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Markdown text search');
    this.panel.innerHTML = `<div class="markdown-search-heading"><strong>Search Markdown</strong><button id="markdown-search-close" class="icon-button" aria-label="Close Markdown search">×</button></div>
      <label for="markdown-search-query">Find text</label><input id="markdown-search-query" type="text" class="search" autocomplete="off" spellcheck="false" placeholder="Text to find…" maxlength="${MAX_SEARCH_QUERY}" />
      <label for="markdown-search-scope">Search in</label><select id="markdown-search-scope"><option value="current">Current file</option><option value="project">Project Markdown</option></select>
      <label class="markdown-search-case"><input id="markdown-search-case" type="checkbox" /> Match case</label>
      <p id="markdown-search-status" role="status" aria-live="polite"></p><p id="markdown-search-notice" hidden></p>
      <div id="markdown-search-results" aria-label="Markdown search results"></div>`;
    const find = <T extends HTMLElement>(id: string) => this.panel.querySelector<T>(id)!;
    this.query = find('#markdown-search-query'); this.scope = find('#markdown-search-scope');
    this.matchCase = find('#markdown-search-case'); this.status = find('#markdown-search-status');
    this.notice = find('#markdown-search-notice'); this.results = find('#markdown-search-results');
    find('#markdown-search-close').onclick = () => this.close();
    this.query.oninput = () => this.update();
    this.scope.onchange = this.matchCase.onchange = () => this.update();
    this.query.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); this.results.querySelector<HTMLButtonElement>('button')?.focus(); }
    };
    this.panel.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); this.close(); } };
    trigger.setAttribute('aria-controls', this.panel.id); trigger.setAttribute('aria-expanded', 'false');
    trigger.onclick = () => this.show('project');
    parent.append(this.panel);
  }

  show(scope: SearchScope) {
    this.scope.value = scope; this.panel.hidden = false;
    this.parent.classList.add('markdown-search-open'); this.trigger.setAttribute('aria-expanded', 'true');
    this.update(); this.query.focus(); this.query.select();
  }
  close() {
    ++this.generation; clearTimeout(this.timer); this.panel.hidden = true;
    this.parent.classList.remove('markdown-search-open'); this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.focus();
  }
  update() {
    const generation = ++this.generation; clearTimeout(this.timer);
    if (this.panel.hidden) return;
    this.results.replaceChildren(); this.notice.hidden = true;
    this.status.textContent = 'Searching…';
    this.timer = setTimeout(() => this.render(generation), 120);
  }
  private render(generation: number) {
    if (generation !== this.generation || this.panel.hidden) return;
    const snapshot = this.snapshot(), query = this.query.value;
    this.notice.textContent = snapshot.warnings.length ? 'Search coverage or file availability notices:\n' + snapshot.warnings.join('\n') : '';
    this.notice.hidden = !snapshot.warnings.length;
    if (!snapshot.projectId) { this.status.textContent = 'Open a project to search Markdown.'; return; }
    if (snapshot.busy) { this.status.textContent = 'Refreshing the workspace…'; return; }
    const file = snapshot.currentFile;
    if (this.scope.value === 'current' && (!file || !/\.(md|markdown)$/i.test(file))) {
      this.status.textContent = 'Open a Markdown document to search the current file.'; return;
    }
    if (!query) { this.status.textContent = 'Enter text to search.'; return; }
    if (query.length > MAX_SEARCH_QUERY || /[\r\n]/.test(query)) { this.status.textContent = `Enter a single line of at most ${MAX_SEARCH_QUERY} characters.`; return; }
    const documents = this.scope.value === 'current' ? (file! in snapshot.documents ? { [file!]: snapshot.documents[file!] } : {}) : snapshot.documents;
    const { matches, truncated } = searchMarkdown(documents, query, this.matchCase.checked);
    const scope = this.scope.value === 'current' ? file! : 'project Markdown';
    this.status.textContent = truncated ? `Showing the first ${SEARCH_LIMIT} matches in ${scope}. More matches exist; narrow your search.`
      : matches.length ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'} in ${scope}.` : `No matches in ${scope}.`;
    let lastFile = '', group: HTMLElement;
    for (const match of matches) {
      if (match.file !== lastFile) {
        lastFile = match.file; group = document.createElement('section'); group.className = 'markdown-search-group';
        const heading = document.createElement('h3'); heading.textContent = match.file; heading.title = match.file;
        group.append(heading); this.results.append(group);
      }
      const button = document.createElement('button'); button.type = 'button'; button.className = 'markdown-search-result';
      button.dataset.file = match.file; button.dataset.offset = String(match.offset);
      button.setAttribute('aria-label', `${match.file}:${match.line}:${match.column} ${match.before}${match.match}${match.after}`);
      const location = document.createElement('small'); location.textContent = `Line ${match.line}, column ${match.column}`;
      const snippet = document.createElement('span'), highlight = document.createElement('mark'); highlight.textContent = match.match;
      snippet.append(match.before, highlight, match.after); button.append(location, snippet);
      button.onclick = () => {
        const valid = () => generation === this.generation && !this.panel.hidden && this.snapshot().projectId === snapshot.projectId;
        if (!valid()) return;
        void this.navigate(match, snapshot.documents[match.file], valid).catch(error => {
          if (valid()) { this.status.textContent = error instanceof Error ? error.message : 'The match could not be opened. Refresh the project and try again.'; }
        });
      };
      group!.append(button);
    }
  }
}
