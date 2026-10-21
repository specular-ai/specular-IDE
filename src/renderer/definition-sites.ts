import { StatusSitesEditor } from './status-sites';
import { DEFAULT_ID_DEFINITION_SITES } from '../core/definition-sites';
import type { IdCategory, IdConfiguration } from '../core/id-configuration';
import { pathsContain, validateDefinitionPaths } from '../core/id-scopes';

/** Increment 90: how many indexed Markdown files a scope or definition-path setting covers. */
export function fileCoverage(files: readonly string[], contains: (file: string) => boolean) {
  try { const markdown = files.filter(file => /\.(md|markdown)$/i.test(file)); return `Covers ${markdown.filter(contains).length} of ${markdown.length} indexed Markdown files.`; }
  catch { return 'Fix the patterns to count the files they cover.'; }
}

/** `keyword` (85a) offers Keyword heading mode, which only categories can use; its keyword defaults to the category name. */
export function definitionSiteGroups(settings: import('../core/definition-sites').IdDefinitionSites, stage: () => void, keyword?: { name: string }): HTMLElement[] {
  const checkbox = (text: string, checked: boolean, change: (checked: boolean) => void) => {
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked;
    input.onchange = () => { change(input.checked); stage(); }; label.append(input, text); return label;
  };
  const groups = (['headings', 'tables'] as const).map(kind => {
    const options = settings[kind], group = document.createElement('section'); group.className = 'definition-site-group';
    const title = document.createElement('h4'); title.textContent = kind === 'headings' ? 'ID definitions in headings' : 'ID definitions in tables'; group.append(title);
    group.append(checkbox(kind === 'headings' ? 'Enable heading definitions' : 'Enable table definitions', options.enabled, checked => { options.enabled = checked; }));
    if (kind === 'headings') {
      const levels = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = 'Heading levels'; levels.append(legend);
      for (let n = 1; n <= 6; n++) levels.append(checkbox(`H${n}`, settings.headings.levels.includes(n), checked => { settings.headings.levels = checked ? [...settings.headings.levels, n] : settings.headings.levels.filter(level => level !== n); }));
      group.append(levels);
    } else {
      const label = document.createElement('label'); label.textContent = 'ID column name'; const input = document.createElement('input'); input.value = settings.tables.column; input.maxLength = 128;
      input.oninput = () => { settings.tables.column = input.value; stage(); }; label.append(input); group.append(label);
    }
    const modeLabel = document.createElement('label'); modeLabel.textContent = kind === 'headings' ? 'ID position in heading' : 'ID cell content';
    const mode = document.createElement('select'); mode.setAttribute('aria-label', modeLabel.textContent!);
    const modes = kind === 'headings' ? [['start', 'Start of heading'], ['anywhere', 'Anywhere (one ID)'], ['regex', 'Advanced pattern'], ...(keyword ? [['keyword', 'Keyword and name']] : [])] : [['exact', 'Exactly one ID'], ['regex', 'Advanced pattern']];
    modes.forEach(([value, name]) => mode.add(new Option(name, value))); mode.value = options.mode; modeLabel.append(mode); group.append(modeLabel);
    const advanced = document.createElement('div'); advanced.hidden = options.mode !== 'regex';
    const patternLabel = document.createElement('label'); patternLabel.textContent = kind === 'headings' ? 'Heading ID pattern' : 'Table ID pattern';
    const pattern = document.createElement('input'); pattern.maxLength = 512; pattern.spellcheck = false; pattern.value = options.pattern ?? '(?<id>[A-Z]+-[0-9]+)';
    pattern.oninput = () => { options.pattern = pattern.value; stage(); }; patternLabel.append(pattern); advanced.append(patternLabel);
    const caseControl = checkbox(kind === 'headings' ? 'Ignore case in heading pattern' : 'Ignore case in table pattern', options.ignoreCase ?? false, checked => { options.ignoreCase = checked; }); advanced.append(caseControl);
    const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'Use one named (?<id>...) capture. The captured ID must match an existing recognition rule. Patterns run on heading text or trimmed cell text, with exact source evidence.'; advanced.append(hint);
    // Increment 85a: `Requirement: <name>` headings define the element named by the rest of the heading.
    const named = document.createElement('div'); named.className = 'definition-site-keyword'; named.hidden = options.mode !== 'keyword';
    if (kind === 'headings' && keyword) {
      const headings = settings.headings;
      const keywordLabel = document.createElement('label'); keywordLabel.textContent = 'Heading keyword';
      const keywordInput = document.createElement('input'); keywordInput.maxLength = 64; keywordInput.spellcheck = false; keywordInput.value = headings.keyword ?? keyword.name;
      keywordInput.oninput = () => { headings.keyword = keywordInput.value; stage(); }; keywordLabel.append(keywordInput);
      const separatorLabel = document.createElement('label'); separatorLabel.textContent = 'Separator after the keyword';
      const separator = document.createElement('select'); separator.setAttribute('aria-label', 'Separator after the keyword');
      for (const [value, name] of [[':', 'Colon (:)'], ['-', 'Hyphen (-)'], ['\u2013', 'En dash (\u2013)'], ['\u2014', 'Em dash (\u2014)'], ['.', 'Period (.)']]) separator.add(new Option(name, value));
      separator.value = headings.separator ?? ':';
      separator.onchange = () => { if (separator.value === ':') delete headings.separator; else headings.separator = separator.value; stage(); }; separatorLabel.append(separator);
      const namedHint = document.createElement('p'); namedHint.className = 'config-hint';
      namedHint.textContent = 'A heading such as "Requirement: User login" defines the element named "User login". Names are matched ignoring case and spacing. With a parent category, the element is identified within the nearest enclosing heading of that category.';
      named.append(keywordLabel, separatorLabel, namedHint);
    }
    mode.onchange = () => {
      options.mode = mode.value as typeof options.mode; advanced.hidden = options.mode !== 'regex'; named.hidden = options.mode !== 'keyword';
      if (options.mode === 'regex') { options.pattern = pattern.value; options.ignoreCase = caseControl.querySelector<HTMLInputElement>('input')!.checked; }
      else { delete options.pattern; delete options.ignoreCase; }
      if (kind === 'headings' && keyword) {
        const headings = settings.headings;
        if (options.mode === 'keyword') headings.keyword = named.querySelector<HTMLInputElement>('input')!.value;
        else { delete headings.keyword; delete headings.separator; }
      }
      stage();
    };
    group.append(advanced, named); return group;
  });
  const options = settings.lists ?? structuredClone(DEFAULT_ID_DEFINITION_SITES.lists!);
  const group = document.createElement('section'); group.className = 'definition-site-group';
  const title = document.createElement('h4'); title.textContent = 'ID definitions in lists'; group.append(title);
  group.append(checkbox('Enable list definitions', options.enabled, checked => { options.enabled = checked; settings.lists = options; }));
  const types = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = 'List types'; types.append(legend);
  for (const [type, label] of [['unordered', 'Bulleted lists'], ['ordered', 'Numbered lists']] as const) {
    types.append(checkbox(label, options.types.includes(type), checked => {
      options.types = checked ? [...options.types, type] : options.types.filter(item => item !== type); settings.lists = options;
    }));
  }
  // Increment 91: only checkbox items define, so `- T001 and T002 can run in parallel` stays a reference.
  const checkboxOnly = checkbox('Only items with a checkbox', options.checkboxOnly ?? false, checked => {
    if (checked) options.checkboxOnly = true; else delete options.checkboxOnly; settings.lists = options;
  });
  const hint = document.createElement('p'); hint.className = 'config-hint';
  hint.textContent = 'A recognized ID must start the first paragraph of the item, optionally in brackets as in [R1]. Bold/emphasis and task-checkbox markers do not count as content; later mentions remain references. With Only items with a checkbox, items without [x], [ ], or a marker such as [-] are references.';
  group.append(types, checkboxOnly, hint);
  // Increment 82: plain paragraphs such as `Property 1: Bug Condition - ...`, off by default.
  const paragraphs = settings.paragraphs ?? structuredClone(DEFAULT_ID_DEFINITION_SITES.paragraphs!);
  const paragraphGroup = document.createElement('section'); paragraphGroup.className = 'definition-site-group';
  const paragraphTitle = document.createElement('h4'); paragraphTitle.textContent = 'ID definitions in paragraphs';
  const paragraphHint = document.createElement('p'); paragraphHint.className = 'config-hint';
  paragraphHint.textContent = 'A recognized ID must start a plain paragraph and be followed by a colon or a dash, as in "Property 1: Bug Condition - ...", or be enclosed in brackets, as in "[CQ-H1] Missing input". Bold/emphasis does not count as content. The definition owns the following blocks up to the next heading or paragraph definition.';
  paragraphGroup.append(paragraphTitle, checkbox('Enable paragraph definitions', paragraphs.enabled, checked => { paragraphs.enabled = checked; settings.paragraphs = paragraphs; }), paragraphHint);
  return [...groups, group, paragraphGroup];
}
export class DefinitionSitesEditor {
  readonly root = document.createElement('section');
  constructor(private draft: () => IdConfiguration, private changed: () => void) { this.root.id = 'config-definition-sites'; }
  render() {
    const settings = structuredClone(this.draft().idDefinitionSites ?? DEFAULT_ID_DEFINITION_SITES);
    const stage = () => { this.draft().idDefinitionSites = structuredClone(settings); this.changed(); };
    const summary = document.createElement('h3'); summary.textContent = 'Definition and status sites';
    const intro = document.createElement('p'); intro.className = 'config-hint'; intro.textContent = 'ID definitions: choose where recognized IDs define elements. Other mentions remain references. These project settings are inherited by categories that do not define an override.';
    const sections = definitionSiteGroups(settings, stage);
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'quiet-button'; reset.textContent = 'Restore ID site defaults';
    reset.onclick = () => { delete this.draft().idDefinitionSites; this.render(); this.changed(); };
    const statuses = new StatusSitesEditor(this.draft, this.changed); statuses.render();
    this.root.replaceChildren(summary, intro, ...sections, reset, statuses.root);
  }
}

export function categoryDefinitionSites(category: IdCategory, draft: () => IdConfiguration, changed: () => void, files: () => readonly string[] = () => []) {
  const section = document.createElement('details'); section.className = 'config-category-definition-sites';
  const summary = document.createElement('summary'); summary.textContent = 'ID definition sites';
  const hint = document.createElement('p'); hint.className = 'config-hint'; hint.textContent = 'Inherit the project definition sites or replace the complete headings, tables, lists, and paragraphs block for this category.';
  const label = document.createElement('label'); label.textContent = 'Category definition sites';
  const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Category definition sites');
  mode.add(new Option('Inherit project settings', 'inherit')); mode.add(new Option('Override for this category', 'override'));
  mode.value = category.idDefinitionSites ? 'override' : 'inherit'; label.append(mode);
  const settings = category.idDefinitionSites ?? structuredClone(draft().idDefinitionSites ?? DEFAULT_ID_DEFINITION_SITES);
  const controls = document.createElement('div'); controls.className = 'config-category-definition-site-controls'; controls.hidden = !category.idDefinitionSites;
  const renderControls = () => controls.replaceChildren(...definitionSiteGroups(settings, () => { category.idDefinitionSites = structuredClone(settings); changed(); }, { name: category.name || 'Requirement' }));
  renderControls();
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'quiet-button'; reset.textContent = 'Restore inheritance';
  reset.onclick = () => { delete category.idDefinitionSites; mode.value = 'inherit'; controls.hidden = true; changed(); };
  mode.onchange = () => {
    if (mode.value === 'override') {
      const inherited = structuredClone(draft().idDefinitionSites ?? DEFAULT_ID_DEFINITION_SITES); settings.headings = inherited.headings; settings.tables = inherited.tables; settings.lists = inherited.lists; settings.paragraphs = inherited.paragraphs;
      category.idDefinitionSites = structuredClone(settings); renderControls(); controls.hidden = false;
    }
    else { delete category.idDefinitionSites; controls.hidden = true; }
    changed();
  };
  // Increment 90: outside these paths the category's definition sites give references.
  const pathsLabel = document.createElement('label'); pathsLabel.textContent = 'Define only in (optional, comma-separated paths)';
  const paths = document.createElement('input'); paths.type = 'text'; paths.className = 'config-definition-paths'; paths.maxLength = 32 * 4098; paths.spellcheck = false;
  paths.setAttribute('aria-label', 'Define only in'); paths.value = (category.definitionPaths ?? []).join(', '); pathsLabel.append(paths);
  const coverage = document.createElement('p'); coverage.className = 'config-hint config-definition-paths-coverage';
  const count = () => { coverage.textContent = category.definitionPaths ? fileCoverage(files(), file => pathsContain(file, validateDefinitionPaths(category.definitionPaths))) : 'Definitions are recognized in every file.'; };
  paths.oninput = () => {
    const value = paths.value.split(',').map(line => line.trim()).filter(Boolean);
    if (value.length) category.definitionPaths = value; else delete category.definitionPaths;
    count(); changed();
  };
  const pathsHint = document.createElement('p'); pathsHint.className = 'config-hint';
  pathsHint.textContent = 'Patterns use the scope syntax without captures, such as specs/*/tasks.md or docs/specs (a folder and everything below it). Outside them, IDs of this category at definition sites are references in that file\'s scope. Derived elements are not affected.';
  count();
  section.append(summary, hint, label, controls, reset, pathsLabel, pathsHint, coverage); return section;
}
