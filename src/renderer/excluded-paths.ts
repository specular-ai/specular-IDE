import { pathsContain, validateExcludedPaths } from '../core/id-scopes';
import type { IdConfiguration } from '../core/id-configuration';
import { fileCoverage } from './definition-sites';
import { explain } from './hover-hint';

/** Increment 99a: the project's excluded paths, comma-separated like Define only in, with the Markdown files they cover. */
export class ExcludedPathsEditor {
  readonly root = document.createElement('section');
  constructor(private draft: () => IdConfiguration, private files: () => string[], private changed: () => void) { this.root.id = 'config-excluded-paths'; }
  render() {
    const heading = document.createElement('h3'); heading.textContent = 'Excluded from analysis';
    const intro = document.createElement('p'); intro.className = 'config-hint';
    intro.textContent = 'Markdown under these paths is not analyzed: no IDs, references, pending items, statuses, or dates, and Discover ignores it. The files stay in the Explorer and can be opened, edited, and searched. Use it for tool templates and agent command copies, such as .specify/templates or .claude/commands.';
    const label = document.createElement('label'); label.textContent = 'Excluded paths (comma-separated)';
    const input = document.createElement('input'); input.type = 'text'; input.id = 'config-excluded-paths-input'; input.spellcheck = false; input.maxLength = 64 * 4098;
    input.setAttribute('aria-label', 'Excluded paths'); input.value = (this.draft().excludedPaths ?? []).join(', '); label.append(input);
    const hint = document.createElement('p'); hint.className = 'config-hint';
    hint.textContent = 'Patterns use the scope syntax without captures: * within a folder, ** across folders, and a folder covers everything below it. Preview matches shows the effect.';
    const coverage = document.createElement('p'); coverage.className = 'config-hint'; coverage.id = 'config-excluded-paths-coverage'; coverage.setAttribute('aria-live', 'polite');
    const count = () => {
      const paths = this.draft().excludedPaths;
      if (!paths) { coverage.textContent = 'Every indexed Markdown file is analyzed.'; return; }
      try { const valid = validateExcludedPaths(paths); coverage.textContent = fileCoverage(this.files(), file => pathsContain(file, valid)).replace(/^Covers/, 'Excludes'); }
      catch (error) { coverage.textContent = error instanceof Error ? error.message : String(error); }
    };
    input.oninput = () => {
      const value = input.value.split(',').map(item => item.trim()).filter(Boolean);
      if (value.length) this.draft().excludedPaths = value; else delete this.draft().excludedPaths;
      count(); this.changed();
    };
    count();
    explain(heading, intro.textContent!); explain(label, hint.textContent!);
    this.root.replaceChildren(heading, label, coverage);
  }
}
