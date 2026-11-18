// Spec Kitty discovery (increment 97c): an example discovery contribution, installable from this folder.
// It reads the markdown@1 model only and returns proposals in the discovery contract; Specular validates and reviews them.
// Spec Kitty writes each work package as <root>/<feature>/tasks/WPnn-<slug>.md, whose YAML front matter holds
// work_package_id, subtasks (T001...), dependencies, and the lane history, and whose title heading repeats the ID.

const WORK_PACKAGE = /^WP\d+$/u, SUBTASK = /^T\d{3,}$/u;
const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Where `id` is written in `text` from `start` up to `end`, as evidence. */
function evidence(file, text, id, start, end, context) {
  const offset = text.indexOf(id, start);
  return offset >= 0 && offset + id.length <= end ? { id, file: file.file, offset, end: offset + id.length, context } : undefined;
}

export function discover(request) {
  const files = request.models.markdown?.files ?? [];
  const packages = [];
  for (const file of files) {
    const match = /^(.+)\/([^/]+)\/tasks\/[^/]+\.md$/u.exec(file.file), data = file.frontMatter && 'data' in file.frontMatter ? file.frontMatter.data : undefined;
    const id = data && typeof data === 'object' ? data.work_package_id : undefined;
    if (!match || typeof id !== 'string' || !WORK_PACKAGE.test(id)) continue;
    // The title heading defines the work package: `# Work Package Prompt: WP01 – …`.
    const heading = file.headings.find(item => item.depth === 1 && item.text.includes(id));
    const lanes = Array.isArray(data.history) ? data.history.map(entry => entry && typeof entry === 'object' ? entry.lane : undefined).filter(lane => typeof lane === 'string') : [];
    packages.push({ file, root: match[1], feature: match[2], id, heading, subtasks: list(data.subtasks).filter(item => SUBTASK.test(item)), dependencies: list(data.dependencies).filter(item => WORK_PACKAGE.test(item)), lane: lanes.at(-1) });
  }
  if (packages.length < 2) return { apiVersion: request.apiVersion, requestId: request.requestId, suggestions: [] };
  // The folder holding the most feature folders with work packages.
  const roots = new Map();
  for (const item of packages) roots.set(item.root, (roots.get(item.root) ?? 0) + 1);
  const root = [...roots].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const inRoot = packages.filter(item => item.root === root), features = [...new Set(inRoot.map(item => item.feature))].sort();
  const titled = inRoot.filter(item => item.heading);
  const suggestions = [], gaps = [];
  if (titled.length >= 2) {
    const examples = titled.slice(0, 8).map(item => evidence(item.file, item.file.text, item.id, item.heading.range.start, item.heading.range.end, 'heading')).filter(Boolean);
    suggestions.push({ key: 'spec-kitty-work-package', category: { key: 'spec-kitty-work-package', name: 'Work package', role: 'task', idScopes: [{ pattern: `${root}/*` }], definitionPaths: [`${root}/*/tasks/*.md`],
      idDefinitionSites: { headings: { enabled: true, levels: [1], mode: 'anywhere' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: false, types: ['unordered', 'ordered'], mode: 'start' }, paragraphs: { enabled: false, mode: 'start' } } },
      rule: { key: 'spec-kitty-work-package', category: 'spec-kitty-work-package', pattern: '\\bWP\\d+\\b' }, evidence: examples,
      uncertainty: `${plural(titled.length, 'work package prompt')} in ${plural(features.length, 'feature folder')} of ${root}/ name their work_package_id in front matter and repeat it in the title heading, so the title heading defines it, numbered per feature folder. Mentions elsewhere, such as the tasks.md overview, refer to it.` });
  }
  // Subtasks are defined by the checkbox items of the feature's tasks.md that start with them.
  const listed = new Map();
  for (const item of inRoot) for (const subtask of item.subtasks) listed.set(`${item.feature}/${subtask}`, item);
  const subtaskExamples = [];
  let defined = 0;
  for (const file of files) {
    const match = /^(.+)\/([^/]+)\/tasks\.md$/u.exec(file.file);
    if (!match || match[1] !== root) continue;
    for (const block of file.blocks) {
      const id = block.kind === 'list-item' && block.checked !== undefined ? /^(T\d{3,})\b/u.exec(block.text)?.[1] : undefined;
      if (!id || !listed.has(`${match[2]}/${id}`)) continue;
      defined++;
      const example = subtaskExamples.length < 8 && evidence(file, file.text, id, block.range.start, block.range.end, 'list-item');
      if (example) subtaskExamples.push(example);
    }
  }
  if (defined >= 2 && subtaskExamples.length) suggestions.push({ key: 'spec-kitty-subtask', category: { key: 'spec-kitty-subtask', name: 'Subtask', role: 'task', idScopes: [{ pattern: `${root}/*` }], definitionPaths: [`${root}/*/tasks.md`],
    idDefinitionSites: { headings: { enabled: false, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered', 'ordered'], mode: 'start', checkboxOnly: true }, paragraphs: { enabled: false, mode: 'start' } } },
    rule: { key: 'spec-kitty-subtask', category: 'spec-kitty-subtask', pattern: '\\bT\\d{3,}\\b' }, evidence: subtaskExamples,
    uncertainty: `${plural(listed.size, 'subtask')} listed in work package front matter; ${defined} start checkbox items of their feature's tasks.md, which define them, numbered per feature folder. Specular's own T suggestion may cover the same IDs; keep one of them.` });
  // What the configuration cannot express is reported as gaps.
  const mention = item => evidence(item.file, item.file.text, item.id, item.file.frontMatter.range.start, item.file.frontMatter.range.end, 'mention');
  // Dependencies are front matter lists, and "Depends on WP01" lines under a work package's heading in tasks.md.
  const links = new Map(), linkExamples = [];
  for (const item of inRoot) for (const target of item.dependencies) links.set(`${item.feature}/${item.id}>${target}`, `${item.id} depends on ${target} in ${item.feature}`);
  for (const example of inRoot.filter(item => item.dependencies.length).slice(0, 4).map(mention)) if (example) linkExamples.push(example);
  for (const file of files) {
    const match = /^(.+)\/([^/]+)\/tasks\.md$/u.exec(file.file);
    if (!match || match[1] !== root) continue;
    const owner = index => { for (let i = index; i !== undefined; i = file.headings[i].parent) { const id = /\bWP\d+\b/u.exec(file.headings[i].text)?.[0]; if (id) return id; } };
    for (const block of file.blocks) {
      const statement = block.kind !== 'table' && block.heading !== undefined ? /\bdepends on:?\s*((?:\**WP\d+\**(?:\s*(?:,|and|&)\s*)?)+)/iu.exec(block.text) : undefined;
      const from = statement && owner(block.heading);
      if (!from) continue;
      for (const [target] of statement[1].matchAll(/WP\d+/gu)) if (target !== from) links.set(`${match[2]}/${from}>${target}`, `${from} depends on ${target} in ${match[2]}`);
      const example = linkExamples.length < 8 && evidence(file, file.text, /WP\d+/u.exec(statement[1])[0], block.range.start, block.range.end, 'mention');
      if (example) linkExamples.push(example);
    }
  }
  if (links.size) gaps.push({ text: `${plural(links.size, 'dependency', 'dependencies')} between work packages are written in front matter or as "Depends on" lines in tasks.md (for example ${[...links.values()][0]}). Typed dependency links cannot be configured, so they are recorded at most as mentions.`, evidence: linkExamples });
  const withSubtasks = inRoot.filter(item => item.subtasks.length);
  if (withSubtasks.length) gaps.push({ text: `${plural(withSubtasks.length, 'work package')} list their subtasks in front matter (for example ${withSubtasks[0].id}: ${withSubtasks[0].subtasks.slice(0, 4).join(', ')}${withSubtasks[0].subtasks.length > 4 ? ', …' : ''}). The configuration cannot make subtasks children of a work package, so they stay separate elements.`,
    evidence: withSubtasks.slice(0, 8).map(mention).filter(Boolean) });
  const laned = inRoot.filter(item => item.lane);
  if (laned.length) {
    const lanes = [...new Set(laned.map(item => item.lane))].sort();
    gaps.push({ text: `${plural(laned.length, 'work package')} record their lane (${lanes.join(', ')}) in the front matter history. Status sites do not read front matter, so these lanes are not statuses.`, evidence: laned.slice(0, 8).map(mention).filter(Boolean) });
  }
  const untitled = inRoot.filter(item => !item.heading);
  if (untitled.length && titled.length >= 2) {
    const folders = [...new Set(untitled.map(item => item.feature))].sort();
    gaps.push({ text: `${plural(untitled.length, 'work package prompt')} in ${folders.join(', ')} ${untitled.length === 1 ? 'has a title heading that does' : 'have title headings that do'} not repeat the work_package_id (such as "${untitled[0].file.headings.find(item => item.depth === 1)?.text ?? 'no title'}"), so ${untitled.length === 1 ? 'it is' : 'they are'} not defined. Front matter cannot be a definition site.`,
      evidence: untitled.slice(0, 8).map(mention).filter(Boolean) });
  }
  // Work packages written only in tasks.md (no prompt file) stay references, since prompt files define.
  const prompted = new Set(inRoot.map(item => `${item.feature}/${item.id}`)), only = new Map();
  for (const file of files) {
    const match = /^(.+)\/([^/]+)\/tasks\.md$/u.exec(file.file);
    if (!match || match[1] !== root) continue;
    for (const heading of file.headings) for (const [id] of heading.text.matchAll(/\bWP\d+\b/gu)) if (!prompted.has(`${match[2]}/${id}`)) only.set(`${match[2]}/${id}`, match[2]);
  }
  if (only.size) {
    const folders = [...new Set(only.values())].sort();
    gaps.push({ text: `${plural(only.size, 'work package')} in ${plural(folders.length, 'feature')} (${folders.slice(0, 6).join(', ')}${folders.length > 6 ? ', …' : ''}) appear only as tasks.md headings, without a prompt file. Definitions are taken from prompt files, so these stay references; a definition path per feature cannot be configured.` });
  }
  return { apiVersion: request.apiVersion, requestId: request.requestId, suggestions, gaps: gaps.slice(0, 16) };
}
