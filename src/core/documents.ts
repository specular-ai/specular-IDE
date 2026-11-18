import { idKey, idLabel } from './id-identity';
import { DEFAULT_ID_DEFINITION_SITES, compileDefinitionSite, definitionSourceOffset, keywordName } from './definition-sites';
import { extractStatuses, aggregateStatuses } from './statuses';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';
import type { Nodes, Root } from 'mdast';
import type { Diagram, DocumentModel, Finding, Occurrence, ProjectIndex, SourceLocation } from '../shared/types';
import { compileIdMatcher, SECTION_TAG, sectionHeadingDisplay, sectionHeadingText, sectionPatternTag, sectionTagRegex, type DefinitionSiteKind, type IdCategory, type IdMatch, type IdMatcher, type SectionTag } from './id-configuration';

import { captureForFile, captureName, fileInScopes, pathsContain, scopeForFile } from './id-scopes';

/** Increment 99b: Spec Kit's open-question marker, `[NEEDS CLARIFICATION: question]`; the bare words in prose are not a marker. */
const CLARIFICATION_MARKER = /\[NEEDS CLARIFICATION:\s*([^\]\n]*)\]/g;
/** Questions copied from the templates' instructions, not real open questions. */
const PLACEHOLDER_QUESTION = /^(?:|specific question|question|\.\.\.|…)$/i;

const parser = unified().use(remarkParse).use(remarkGfm);
export function parseMarkdown(text: string): Root { return parser.parse(text); }

export function analyzeDocument(file: string, text: string, matchIds: IdMatcher = compileIdMatcher()): DocumentModel {
  matchIds = matchIds.forFile?.(file) ?? matchIds;
  const root = parseMarkdown(text);
  const sites = matchIds.definitionSites ?? DEFAULT_ID_DEFINITION_SITES;
  // Labelled-list items are references only, so definition sites never see them; matches of defining templated rules (96e) only define.
  const ids = ((input: string, site?: DefinitionSiteKind) => matchIds(input, site).filter(match => !match.listed || match.defines)) as IdMatcher;
  // 104: each definition site reads its text as that site, so anchored defining rules run only where their category defines.
  const at = (site: DefinitionSiteKind, matcher: IdMatcher) => ((input: string) => matcher(input, site)) as IdMatcher;
  const effectiveSites = matchIds.definitionSitesByCategory?.size
    // Outside a category's definition paths (90), its definition sites do not apply, so its IDs there are references.
    ? [...matchIds.definitionSitesByCategory].filter(([category]) => { const paths = matchIds.categories?.get(category)?.definitionPaths; return !paths || pathsContain(file, paths); }).map(([category, value]) => {
      const filtered = ((input: string, site?: DefinitionSiteKind) => ids(input, site).filter(match => match.category.key === category)) as IdMatcher;
      const heading = compileDefinitionSite(value.headings.mode, value.headings, at('headings', value.headings.mode === 'regex' ? ids : filtered));
      const table = compileDefinitionSite(value.tables.mode, value.tables, at('tables', value.tables.mode === 'regex' ? ids : filtered));
      const list = compileDefinitionSite('start', {}, at('lists', filtered)), paragraph = compileDefinitionSite('start', {}, at('paragraphs', filtered));
      const own = (match: IdMatch | undefined) => match?.category.key === category ? match : undefined;
      return { category, sites: value, headingMatch: (input: string) => own(heading(input)), tableMatch: (input: string) => own(table(input)),
        listMatch: (input: string) => own(list(input)), paragraphMatch: (input: string) => own(paragraph(input)) };
    })
    : [{ category: undefined, sites, headingMatch: compileDefinitionSite(sites.headings.mode, sites.headings, at('headings', ids)), tableMatch: compileDefinitionSite(sites.tables.mode, sites.tables, at('tables', ids)),
      listMatch: compileDefinitionSite('start', {}, at('lists', ids)), paragraphMatch: compileDefinitionSite('start', {}, at('paragraphs', ids)) }];
  const definitionsBySite = new Map<Nodes, Occurrence>();
  /** A link reference definition such as `[R1]: Title`, read as its literal source so a bracketed ID can define (91). */
  const literalText = (node: Nodes): Nodes => ({ type: 'text', value: text.slice(node.position?.start.offset, node.position?.end.offset), position: node.position });
  const idTables = new Set<Nodes>();
  const occurrences: Occurrence[] = [];
  const pending: Finding[] = [];
  const diagrams: Diagram[] = [];
  const definitionOffsets = new Set<number>();
  const pendingLines = new Set<number>();
  // Increment 85a: enclosing headings and their definitions, for nested (parent) categories.
  const headingStack: { depth: number; definition?: Occurrence; text?: string }[] = [];
  const parentLinks: [Occurrence, Occurrence][] = [];
  // Increment 96d: categories numbering ordered list items inside an element of their parent, such as Kiro acceptance criteria.
  const numbered = [...(matchIds.categories?.values() ?? [])].filter(category => category.numberedItems
    && (!category.onlyInScopes || fileInScopes(file, category.idScopes)) && (!category.definitionPaths || pathsContain(file, category.definitionPaths)));
  const sectionText = sectionHeadingText;
  const numberItems = (list: Extract<Nodes, { type: 'list' }>) => {
    for (const category of numbered) {
      const options = category.numberedItems!;
      let at = headingStack.length - 1; while (at >= 0 && headingStack[at].definition?.category?.key !== options.parent) at--;
      if (at < 0 || (options.section && (headingStack.length - 1 <= at || sectionText(headingStack.at(-1)!.text ?? '') !== sectionText(options.section)))) continue;
      const parent = headingStack[at].definition!, number = /(\d+)(?!.*\d)/u.exec(parent.id)?.[1];
      if (number === undefined) continue;
      list.children.forEach((item, index) => {
        const first = item.children[0];
        if (definitionsBySite.has(item) || !first?.position || first.position.start.offset === undefined) return;
        const start = first.position.start.offset, newline = text.indexOf('\n', start);
        const end = Math.min(first.position.end.offset ?? start, newline < 0 ? text.length : text[newline - 1] === '\r' ? newline - 1 : newline);
        const id = options.id.replaceAll('{parent}', number).replaceAll('{item}', String(index + 1));
        const definition: Occurrence = { ...location(start, Math.max(end - start, 1)), id, category, kind: 'definition', label: toString(first).split('\n')[0].trim() };
        occurrences.push(definition); definitionsBySite.set(item, definition); parentLinks.push([definition, parent]);
      });
    }
  };
  // Increment 85b: the enclosing ADDED/MODIFIED/REMOVED/RENAMED section, and categories linked by backticked names.
  let deltaSection: { depth: number; kind: NonNullable<Occurrence['delta']> } | undefined;
  const nameCategories = [...(matchIds.categories?.values() ?? [])].filter(category => category.nameReferences);
  // Current specifications may keep ADDED headings from their creation, so with change categories only change folders hold deltas.
  const changeFolders = [...(matchIds.categories?.values() ?? [])].flatMap(category => category.changes && category.derive ? [{ pattern: category.derive.pattern.split('/').slice(0, -1).join('/') }] : []);
  const inChange = !changeFolders.length || changeFolders.some(pattern => scopeForFile(file, [pattern]) !== undefined);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const location = (offset: number, length = 1): SourceLocation => {
    let low = 0, high = lineStarts.length;
    while (low + 1 < high) { const mid = (low + high) >>> 1; if (lineStarts[mid] <= offset) low = mid; else high = mid; }
    return { file, offset, end: offset + length, line: low + 1, column: offset - lineStarts[low] + 1 };
  };
  const addDefinition = (node: Nodes, match: IdMatch, label: string, mode: string, allowedLeafTypes?: string[]) => {
    const id = match.id;
    // A defining templated match (96e) is found by its source text, which is also its range.
    const offset = definitionSourceOffset(node, text, match.text === undefined ? match : { ...match, id: match.text }, allowedLeafTypes);
    if (offset === undefined) {
      if (mode === 'regex') throw new Error(`Line ${node.position?.start.line}: captured ID ${id} has no reliable literal source span.`);
      return;
    }
    definitionOffsets.add(offset);
    const definition: Occurrence = { ...location(offset, (match.text ?? id).length), id, category: match.category, kind: 'definition', label };
    occurrences.push(definition); definitionsBySite.set(node, definition);
    return definition;
  };
  /** A named element: its ID is the name; the range covers the name when it is one literal span, otherwise the heading content. */
  const nameRange = (node: Nodes, name: string, index: number) => {
    let offset = definitionSourceOffset(node, text, { id: name, index, end: index + name.length }), length = name.length;
    if (offset === undefined && 'children' in node && node.children.length) {
      offset = node.children[0].position?.start.offset; length = (node.children.at(-1)!.position?.end.offset ?? 0) - (offset ?? 0);
    }
    return offset === undefined ? undefined : { offset, length: Math.max(length, 0) };
  };
  const enclosingParent = (category: IdCategory) => category.parent ? [...headingStack].reverse().find(entry => entry.definition?.category?.key === category.parent)?.definition : undefined;
  /** 85b: a keyword heading inside a delta section (or inside a change record) records the change instead of defining. */
  const addRecord = (node: Nodes, category: IdCategory, name: string, index: number, label: string, parent?: Occurrence) => {
    const range = nameRange(node, name, index);
    if (!range) return;
    const record: Occurrence = { ...location(range.offset, range.length), id: parent ? `${parent.id} / ${name}` : name, category, kind: 'reference', label, named: true,
      delta: parent?.delta ?? deltaSection!.kind, ...(parent ? { deltaParent: parent } : {}) };
    occurrences.push(record);
    return record;
  };
  const addNamed = (node: Nodes, category: IdCategory, name: string, index: number, label: string) => {
    const parent = enclosingParent(category);
    const id = parent ? `${parent.id} / ${name}` : name;
    const range = nameRange(node, name, index);
    if (!range) return;
    const { offset, length } = range;
    definitionOffsets.add(offset);
    const definition: Occurrence = { ...location(offset, length), id, category, kind: 'definition', label, named: true };
    occurrences.push(definition); definitionsBySite.set(node, definition);
    if (parent) parentLinks.push([definition, parent]);
    return definition;
  };
  /** 85b: a change is Active or Archived by location, and its proposal's New/Modified Capabilities lists are change records. */
  const changeDefinition = (definition: Occurrence, category: IdCategory) => {
    const archived = file.split('/').slice(0, -1).includes(category.changes!.archive ?? 'archive');
    definition.authoredStatus = { state: 'authored', evidence: [{ site: 'headings', value: archived ? 'Archived' : 'Active', source: location(definition.offset, definition.end - definition.offset) }] };
    const capabilities = category.changes!.capabilities === undefined ? undefined : matchIds.categories?.get(category.changes!.capabilities);
    if (!capabilities) return;
    let section: { depth: number; kind: 'new' | 'modified' } | undefined;
    for (const node of root.children) {
      if (node.type === 'heading') {
        if (section && node.depth <= section.depth) section = undefined;
        const kind = /^(New|Modified)\s+Capabilities\s*$/iu.exec(toString(node).trim())?.[1];
        if (kind) section = { depth: node.depth, kind: kind.toLowerCase() as 'new' | 'modified' };
      } else if (section && node.type === 'list') for (const item of node.children) {
        const first = item.children[0], code = first?.type === 'paragraph' ? first.children[0] : undefined;
        if (code?.type !== 'inlineCode' || !code.position) continue;
        const name = code.value.replace(/\s+/gu, ' ').trim(), start = code.position.start.offset!;
        const scope = capabilities.derive ? `${captureName(capabilities.derive.pattern)}:${name}` : undefined;
        if (name && name.length <= 512) occurrences.push({ ...location(start, code.position.end.offset! - start), id: name, category: capabilities, kind: 'reference', named: true, delta: section.kind, ...(scope ? { scope } : {}), label: toString(item).split('\n')[0].trim() });
      }
    }
  };
  const checkboxStatus = (definition: Occurrence | undefined) => !!definition
    && !!(matchIds.statusSitesByCategory?.get(definition.category?.key ?? '') ?? matchIds.statusSites)?.checkboxes?.enabled;
  const markerLines = new Set<number>();
  const addPending = (node: Nodes, message: string) => {
    const offset = node.position?.start.offset ?? 0;
    const source = location(offset);
    if (!pendingLines.has(source.line)) {
      pendingLines.add(source.line);
      pending.push({ ...source, kind: 'pending', message });
    }
  };
  // Increment 99b: each open clarification marker is its own pending item, and replaces the line's generic one (an unchecked item, a TODO).
  const addClarifications = (node: Nodes) => {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const code: [number, number][] = [];
    const collect = (child: Nodes) => {
      if (child.type === 'inlineCode' && child.position) code.push([child.position.start.offset!, child.position.end.offset!]);
      else if ('children' in child) for (const grandchild of child.children) collect(grandchild);
    };
    collect(node);
    for (const match of text.slice(start, end).matchAll(CLARIFICATION_MARKER)) {
      const offset = start + match.index, question = match[1].replace(/\s+/g, ' ').trim();
      if (code.some(([from, to]) => offset >= from && offset < to) || PLACEHOLDER_QUESTION.test(question)) continue;
      const source = location(offset, match[0].length);
      if (pendingLines.has(source.line) && !markerLines.has(source.line)) {
        const generic = pending.findIndex(item => item.line === source.line && !item.clarification);
        if (generic >= 0) pending.splice(generic, 1);
      }
      pendingLines.add(source.line); markerLines.add(source.line);
      pending.push({ ...source, kind: 'pending', message: question, clarification: true });
    }
  };
  const walk = (node: Nodes, suppressPending = false, listType?: 'unordered' | 'ordered', inListItem = false) => {
    if (node.type === 'blockquote' || node.type === 'html') return;
    if (node.type === 'list') {
      if (node.ordered && !inListItem && numbered.length) numberItems(node);
      const kind = node.ordered ? 'ordered' : 'unordered';
      for (const child of node.children) walk(child, suppressPending, kind, inListItem);
      return;
    }
    // Paragraph definitions (increment 82): a plain paragraph starting with an ID, as in `Property 1: Bug Condition - ...`.
    if ((node.type === 'paragraph' || node.type === 'definition') && !inListItem) {
      const site = node.type === 'definition' ? literalText(node) : node;
      const value = toString(site), found: IdMatch[] = [];
      for (const effective of effectiveSites) {
        if (!effective.sites.paragraphs?.enabled) continue;
        let match: IdMatch | undefined;
        try { match = effective.paragraphMatch(value); } catch (error) { throw new Error('Line ' + node.position?.start.line + ', paragraph: ' + String(error)); }
        // A bracketed ID's closing bracket is its separator (91).
        // A defining rule's pattern decides where its ID ends (96e), as in `2.1 The system SHALL …`.
        if (match && (match.index === 1 || match.defines || /^[ \t]*(?:[:\uff1a]|[-\u2013\u2014][ \t])/u.test(value.slice(match.end)))) found.push(match);
      }
      if (found.length > 1) throw new Error('Line ' + node.position?.start.line + ', paragraph: Ambiguous definition site: ' + found.map(item => item.id).join(', ') + '.');
      if (found[0]) addDefinition(site, found[0], value.split('\n')[0].trim(), 'start', ['text']);
      // 96e: criteria written on consecutive lines form one paragraph, so a defining rule also defines at each later line start.
      if (found[0]?.defines) for (let at = value.indexOf('\n'); at >= 0; at = value.indexOf('\n', at + 1)) {
        const line = value.slice(at + 1), next = effectiveSites.find(effective => effective.sites.paragraphs?.enabled && effective.paragraphMatch(line)?.defines)?.paragraphMatch(line);
        if (next) addDefinition(site, { ...next, index: next.index + at + 1, end: next.end + at + 1 }, line.split('\n')[0].trim(), 'start', ['text']);
      }
    }    if (node.type === 'listItem' && node.checked !== null && node.checked !== undefined) suppressPending = node.checked;
    if (node.type === 'listItem' && listType) {
      const first = node.children[0]?.type === 'definition' ? literalText(node.children[0]) : node.children[0];
      if (first?.type === 'paragraph' || first?.type === 'text') {
        const value = toString(first), found: { match: IdMatch; mode: string }[] = [];
        // A checkbox marker the parser left as text, such as Kiro's `[-] `, does not hide the ID that follows it (88).
        const skip = node.checked === null || node.checked === undefined ? /^\[[^\]\r\n]\][ \t]+/u.exec(value)?.[0].length ?? 0 : 0;
        const checkbox = skip > 0 || (node.checked !== null && node.checked !== undefined);
        for (const effective of effectiveSites) {
          const options = effective.sites.lists ?? DEFAULT_ID_DEFINITION_SITES.lists!;
          if (!options.enabled || !options.types.includes(listType) || (options.checkboxOnly && !checkbox)) continue;
          let match: IdMatch | undefined;
          try { match = effective.listMatch(value.slice(skip)); } catch (error) { throw new Error('Line ' + node.position?.start.line + ', list item: ' + String(error)); }
          // A bracketed ID in a list item needs `:` or a dash after the bracket, as in `- [R1]: Title`: lists such as
          // `- [Task 2] depends on [Task 1]` or `1. **[CQ-H2]** Fix ...` cite IDs (91).
          if (match?.index === 1 && !/^\][ \t]*(?:[:：]|[-–—](?:[ \t]|$))/u.test(value.slice(skip + match.end))) match = undefined;
          if (match) found.push({ match: skip ? { ...match, index: match.index + skip, end: match.end + skip } : match, mode: options.mode });
        }
        if (found.length > 1) throw new Error('Line ' + node.position?.start.line + ', list item: Ambiguous definition site: ' + found.map(item => item.match.id).join(', ') + '.');
        if (found[0]) {
          const definition = addDefinition(first, found[0].match, toString(node) || value, found[0].mode, ['text']);
          if (definition) definitionsBySite.set(node, definition);
        }
      }
    }    if (node.type === 'code') {
      if (node.lang?.toLowerCase() === 'mermaid') {
        const start = node.position?.start.offset ?? 0;
        diagrams.push({ ...location(start), source: node.value });
        const bodyStart = text.indexOf('\n', start) + 1;
        for (const match of matchIds(text.slice(bodyStart, node.position?.end.offset))) {
          if (match.defines) continue;
          occurrences.push({ ...location(bodyStart + match.index, match.end - match.index),
            id: match.id, category: match.category, kind: 'reference', label: text.slice(lineStarts[location(bodyStart + match.index).line - 1], text.indexOf('\n', bodyStart + match.index) < 0 ? text.length : text.indexOf('\n', bodyStart + match.index)).trim() });
        }
      }
      return;
    }
    if (node.type === 'heading') {
      while (headingStack.length && headingStack.at(-1)!.depth >= node.depth) headingStack.pop();
      if (deltaSection && node.depth <= deltaSection.depth) deltaSection = undefined;
      const value = toString(node), found: { match: IdMatch; mode: string }[] = [], named: { category: IdCategory; name: string; index: number }[] = [];
      for (const effective of effectiveSites) if (effective.sites.headings.enabled && effective.sites.headings.levels.includes(node.depth)) {
        if (effective.sites.headings.mode === 'keyword') {
          const category = effective.category === undefined ? undefined : matchIds.categories?.get(effective.category);
          const result = category && keywordName(value, effective.sites.headings.keyword!, effective.sites.headings.separator);
          // A name that another category's rule recognizes in full, such as "Parallel Example: User Story 1", makes the heading
          // a section about that ID: it defines nothing, and the rule's match in it stays a reference (rather than one ID in two categories).
          if (category && result && !matchIds(result.name).some(match => match.index === 0 && match.end === result.name.length && match.category.key !== category.key)) named.push({ category, ...result });
          continue;
        }
        let match: IdMatch | undefined;
        try { match = effective.headingMatch(value); } catch (error) { throw new Error(`Line ${node.position?.start.line}, heading: ${String(error)}`); }
        if (match) found.push({ match, mode: effective.sites.headings.mode });
      }
      if (found.length + named.length > 1) throw new Error(`Line ${node.position?.start.line}, heading: Ambiguous definition site: ${[...found.map(item => item.match.id), ...named.map(item => item.name)].join(', ')}.`);
      let definition: Occurrence | undefined;
      if (found[0]) definition = addDefinition(node, found[0].match, value, found[0].mode);
      else if (named[0]) {
        const { category, name, index } = named[0], parent = enclosingParent(category);
        definition = parent?.delta ? addRecord(node, category, name, index, value, parent)
          : deltaSection && category.deltas ? addRecord(node, category, name, index, value) : addNamed(node, category, name, index, value);
      }
      headingStack.push({ depth: node.depth, definition, text: value });
      const section = /^(ADDED|MODIFIED|REMOVED|RENAMED)\s+\S/u.exec(value.trim())?.[1];
      if (section && inChange) deltaSection = { depth: node.depth, kind: section.toLowerCase() as NonNullable<Occurrence['delta']> };
    }
    if (node.type === 'table') {
      const headings = node.children[0].children.map(cell => toString(cell).trim().toLowerCase());
      const columns: { index: number; match: (value: string) => IdMatch | undefined; mode: string }[] = [];
      for (const effective of effectiveSites) if (effective.sites.tables.enabled) {
        const column = effective.sites.tables.column.toLowerCase(), index = headings.indexOf(column);
        if (index >= 0) {
          if (headings.filter(heading => heading === column).length > 1) throw new Error(`Line ${node.position?.start.line}: ambiguous ID table columns.`);
          columns.push({ index, match: effective.tableMatch, mode: effective.sites.tables.mode });
        }
      }
      if (columns.length) idTables.add(node);
      const statusColumn = headings.indexOf('status');
      for (const row of node.children.slice(1)) {
        const found: { cell: Nodes; match: IdMatch; mode: string; column: number }[] = [];
        for (const candidate of columns) {
          const cell = row.children[candidate.index]; if (!cell) continue;
          const id = toString(cell).trim(); let match: IdMatch | undefined;
          try { match = candidate.match(id); } catch (error) { throw new Error(`Line ${cell.position?.start.line}, ID cell: ${String(error)}`); }
          if (match) found.push({ cell, match, mode: candidate.mode, column: candidate.index });
        }
        if (found.length > 1) throw new Error(`Line ${row.position?.start.line}: ambiguous ID table row definitions: ${found.map(item => item.match.id).join(', ')}.`);
        if (found[0]) {
          const item = found[0], label = row.children.filter((_cell, i) => i !== item.column && i !== statusColumn).map(cell => toString(cell)).join(' · ');
          const rendered = toString(item.cell), leading = rendered.length - rendered.trimStart().length;
          const definition = addDefinition(item.cell, { ...item.match, index: item.match.index + leading, end: item.match.end + leading }, label, item.mode);
          if (definition) definitionsBySite.set(row, definition);
        }
        const status = row.children[statusColumn];
        if (!suppressPending && status && /^(open|pending|to confirm|needs confirmation|unresolved)$/i.test(toString(status).trim())) addPending(row, toString(row));
      }
    }
    // With the checkbox status site (88), an unchecked ID-defining item is an Open task rather than pending work.
    if (node.type === 'listItem' && node.checked === false && !checkboxStatus(definitionsBySite.get(node))) addPending(node, toString(node));
    if (node.type === 'inlineCode' && nameCategories.length && node.position) {
      // 85b: a backticked name becomes a reference only if buildIndex finds an element with that name.
      const value = node.value.replace(/\s+/gu, ' ').trim(), start = node.position.start.offset!, end = node.position.end.offset!;
      if (value && value.length <= 512) for (const category of nameCategories) {
        occurrences.push({ ...location(start, end - start), id: value, category, kind: 'reference', named: true, candidate: true,
          label: text.slice(lineStarts[location(start).line - 1], text.indexOf('\n', start) < 0 ? text.length : text.indexOf('\n', start)).trim() });
      }
    }
    if (node.type === 'text' || node.type === 'inlineCode') {
      const start = node.position?.start.offset ?? 0;
      const raw = text.slice(start, node.position?.end.offset);
      for (const match of matchIds(raw)) {
        if (match.defines) continue;
        const offset = start + match.index;
        if (!definitionOffsets.has(offset)) occurrences.push({ ...location(offset, match.end - match.index),
          id: match.id, category: match.category, kind: 'reference', label: text.slice(lineStarts[location(offset).line - 1], text.indexOf('\n', offset) < 0 ? text.length : text.indexOf('\n', offset)).trim() });
      }
      if (!suppressPending && node.type === 'text' && /\b(?:TODO|TO-DO|FIXME|TBC)\b/.test(node.value)) addPending(node, node.value.trim());
    }
    if (!suppressPending && (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell')) addClarifications(node);
    if ('children' in node) for (const child of node.children) walk(child, suppressPending, undefined, inListItem || node.type === 'listItem');
  };
  walk(root);
  // Derived elements (85a): a file matching a category's capture pattern defines the captured name, at its first heading.
  // When that heading has no text or already defines another element, such as `### Requirement: …`, it is the first line (85e).
  for (const category of matchIds.categories?.values() ?? []) {
    const name = category.derive && captureForFile(file, category.derive.pattern);
    if (!name) continue;
    const heading = root.children.find(node => node.type === 'heading');
    if (heading && !definitionsBySite.has(heading) && 'children' in heading && heading.children.length) {
      const offset = heading.children[0].position!.start.offset!, end = heading.children.at(-1)!.position!.end.offset!;
      // Each derived element is its own captured scope, so a change and a capability may share a name (85b).
      const definition: Occurrence = { ...location(offset, end - offset), id: name, category, kind: 'definition', label: toString(heading), named: true, scope: `${captureName(category.derive!.pattern)}:${name}` };
      occurrences.push(definition); definitionsBySite.set(heading, definition); definitionOffsets.add(offset);
      if (category.changes) changeDefinition(definition, category);
    } else {
      const line = text.indexOf('\n'), end = line < 0 ? text.length : text[line - 1] === '\r' ? line - 1 : line;
      const definition: Occurrence = { ...location(0, end), id: name, category, kind: 'definition', label: file, named: true, scope: `${captureName(category.derive!.pattern)}:${name}` };
      occurrences.push(definition);
      if (category.changes) changeDefinition(definition, category);
    }
  }
  for (const item of occurrences) {
    const scope = scopeForFile(file, item.category?.idScopes);
    if (scope) item.scope = scope;
  }
  for (const [child, parent] of parentLinks) child.owner = { id: parent.id, offset: parent.offset, ...(parent.scope ? { scope: parent.scope } : {}) };
  tagSections(root, occurrences, location, pending);
  assignReferenceOwners(root, occurrences, definitionsBySite, idTables, pending);
  const unmappedMarkers = extractStatuses(root, definitionsBySite, text, location, matchIds.statusSites, matchIds.statusSitesByCategory, matchIds.statuses);
  return { file, occurrences, pending, diagrams, ...(Object.keys(unmappedMarkers).length ? { unmappedMarkers } : {}) };
}

/** Increment 96f: definitions (and change records, which may become definitions) take the tags of their category's
 * section headings that enclose them at any level; a definition's own heading names it, so it is not a section. */
function tagSections(root: Root, occurrences: Occurrence[], location: (offset: number, length?: number) => SourceLocation, pending: Finding[]) {
  const tagged = occurrences.filter(item => item.category?.sectionTags?.length && (item.kind === 'definition' || item.delta)).sort((a, b) => a.offset - b.offset);
  if (!tagged.length) return;
  const headings = root.children.flatMap(node => node.type === 'heading' ? [{ depth: node.depth, start: node.position!.start.offset!, end: node.position!.end.offset!, display: sectionHeadingDisplay(toString(node)) }] : [])
    .map(heading => ({ ...heading, text: heading.display.toLocaleLowerCase() }));
  // 96g: pattern entries are compiled once per document; a heading whose captures give an invalid tag is reported once.
  const regexes = new Map<SectionTag, RegExp>(), reported = new Set<string>();
  const tagOf = (entry: SectionTag, heading: (typeof headings)[number]) => {
    if (entry.heading !== undefined) return heading.text === sectionHeadingText(entry.heading) ? entry.tag : undefined;
    let regex = regexes.get(entry); if (!regex) regexes.set(entry, regex = sectionTagRegex(entry));
    const tag = sectionPatternTag(entry, regex, heading.display);
    if (tag === undefined || SECTION_TAG.test(tag)) return tag;
    if (!reported.has(`${heading.start}\u0000${entry.pattern}`)) {
      reported.add(`${heading.start}\u0000${entry.pattern}`);
      pending.push({ ...location(heading.start, heading.end - heading.start), kind: 'consistency', message: `Heading "${heading.display}" gives the section tag "${tag}", which is not a valid tag; nothing is tagged by it. Tags use 1-64 lowercase letters, digits, colons, underscores, or hyphens.` });
    }
    return undefined;
  };
  const stack: typeof headings = [];
  let next = 0;
  for (const item of tagged) {
    while (next < headings.length && headings[next].end <= item.offset) {
      const heading = headings[next++];
      while (stack.length && stack.at(-1)!.depth >= heading.depth) stack.pop();
      stack.push(heading);
    }
    const own = next < headings.length && headings[next].start <= item.offset ? headings[next] : undefined;
    const enclosing = own ? stack.filter(heading => heading.depth < own.depth) : stack;
    const tags = item.category!.sectionTags!.flatMap(entry => enclosing.flatMap(heading => tagOf(entry, heading) ?? []));
    if (tags.length) item.tags = [...new Set(tags)];
  }
}

/** Names both categories of an ID recognized in two of them, so the message says which rules or headings to reconcile. */
function conflictingCategories(item: Occurrence, previousKey: string, occurrences: readonly Occurrence[]) {
  const previous = occurrences.find(other => other.category?.key === previousKey)?.category?.name ?? previousKey;
  return `${item.id} has conflicting categories at ${item.file}:${item.line}: it is recognized both as ${previous} and as ${item.category!.name}. `
    + 'Keep one: delete the other category, or narrow its rule or keyword heading so it no longer matches this ID; recognition is incomplete.';
}
/** Assign ownership after recognition, so encoded/invalid definitions never become owners. */
function assignReferenceOwners(root: Root, occurrences: Occurrence[], sites: Map<Nodes, Occurrence>, idTables: Set<Nodes>, pending: Finding[]) {
  const categories = new Map<string, string>();
  for (const item of occurrences) if (item.category && !item.candidate) {
    const previous = categories.get(idKey(item));
    if (previous !== undefined && previous !== item.category.key) throw new Error(conflictingCategories(item, previous, occurrences));
    categories.set(idKey(item), item.category.key);
  }
  const references = occurrences.filter(item => item.kind === 'reference').sort((a, b) => a.offset - b.offset);
  let cursor = 0;
  type Owner = Occurrence['owner'];
  const definitionIn = (node: Nodes): Owner => {
    const definition = sites.get(node);
    return definition && { id: definition.id, offset: definition.offset, ...(definition.scope ? { scope: definition.scope } : {}) };
  };
  const pendingByOffset = [...pending].sort((a, b) => a.offset - b.offset);
  const assignPending = (node: Nodes, owner: Owner) => {
    const start = node.position?.start.offset ?? Infinity, end = node.position?.end.offset ?? -1;
    let low = 0, high = pendingByOffset.length;
    while (low < high) { const mid = (low + high) >>> 1; if (pendingByOffset[mid].offset < start) low = mid + 1; else high = mid; }
    for (let i = low; i < pendingByOffset.length && pendingByOffset[i].offset < end; i++) {
      const item = pendingByOffset[i];
      if (owner?.scope) item.scope = owner.scope; else delete item.scope;
      if (owner) item.owner = owner; else delete item.owner;
    }
  };
  const assign = (node: Nodes, owner: Owner) => {
    assignPending(node, owner);
    const start = node.position?.start.offset ?? Infinity, end = node.position?.end.offset ?? -1;
    while (cursor < references.length && references[cursor].offset < start) cursor++;
    while (cursor < references.length && references[cursor].offset < end) {
      if (owner) references[cursor].owner = owner;
      cursor++;
    }
  };
  const visit = (nodes: readonly Nodes[], inherited?: Owner) => {
    const sections: { depth: number; owner: Owner }[] = [];
    let paragraphOwner: Owner;
    for (const node of nodes) {
      if (node.type === 'blockquote' || node.type === 'html') continue;
      if (node.type === 'heading') {
        while (sections.length && sections.at(-1)!.depth >= node.depth) sections.pop();
        const parent = sections.length ? sections.at(-1)!.owner : inherited;
        const owner = definitionIn(node) ?? parent;
        sections.push({ depth: node.depth, owner }); paragraphOwner = undefined;
        assign(node, owner);
        continue;
      }
      if (node.type === 'paragraph' && definitionIn(node)) paragraphOwner = definitionIn(node);
      const owner = paragraphOwner ?? (sections.length ? sections.at(-1)!.owner : inherited);
      if (node.type === 'listItem') {
        assignPending(node, definitionIn(node) ?? owner);
        visit(node.children, definitionIn(node) ?? owner);
      } else if (node.type === 'table' && idTables.has(node)) {
        // An ID table is a collection of elements, not part of the enclosing element.
        assign(node.children[0], undefined);
        for (const row of node.children.slice(1)) assign(row, definitionIn(row));
      } else if ('children' in node) visit(node.children, owner);
      else assign(node, owner);
    }
  };
  visit(root.children);
}

const authoredSpelling = new WeakMap<object, string>();
/**
 * Increment 85b: link change records to the change whose folder contains them; make ADDED requirements and New capabilities
 * of active changes proposed definitions when the specs do not define them yet; keep backticked candidates that name an
 * element; and check declared capabilities against the change's spec folders. Creates new objects: cached models stay unchanged.
 */
function resolveChanges(occurrences: Occurrence[], files: string[]): { occurrences: Occurrence[]; findings: Finding[] } {
  if (!occurrences.some(item => item.delta || item.candidate)) return { occurrences, findings: [] };
  const lower = (item: { id: string; scope?: string }) => idKey({ id: item.id.toLocaleLowerCase(), ...(item.scope ? { scope: item.scope } : {}) });
  const nameKey = (item: Occurrence) => item.category!.key + '\u0000' + lower(item);
  const defined = new Map<string, Occurrence>();
  for (const item of occurrences) if (item.kind === 'definition' && item.category) defined.set(nameKey(item), item);
  const changes = occurrences.filter(item => item.kind === 'definition' && item.category?.changes).map(definition => {
    const folder = definition.file.includes('/') ? definition.file.slice(0, definition.file.lastIndexOf('/')) : '';
    return { definition, folder, archived: folder.split('/').includes(definition.category!.changes!.archive ?? 'archive') };
  }).sort((a, b) => b.folder.length - a.folder.length);
  const changeFor = (file: string) => changes.find(change => !change.folder || file.startsWith(change.folder + '/'));
  const ownerOf = ({ definition }: (typeof changes)[number]) => ({ id: definition.id, offset: definition.offset, ...(definition.scope ? { scope: definition.scope } : {}), file: definition.file });
  const children = new Map<Occurrence, Occurrence[]>();
  for (const item of occurrences) if (item.deltaParent) children.set(item.deltaParent, [...(children.get(item.deltaParent) ?? []), item]);
  const strip = (item: Occurrence): Occurrence => { const { deltaParent: _parent, candidate: _candidate, ...rest } = item; return rest; };
  const result: Occurrence[] = [], findings: Finding[] = [];
  for (const item of occurrences) {
    if (item.deltaParent) continue;
    if (item.candidate) { const target = item.category && defined.get(nameKey(item)); if (target) result.push({ ...strip(item), id: target.id }); continue; }
    if (!item.delta) { result.push(item); continue; }
    const change = changeFor(item.file), owner = change ? ownerOf(change) : item.owner;
    if ((item.delta === 'added' || item.delta === 'new') && change && !change.archived && item.category && !defined.has(nameKey(item))) {
      const proposed: Occurrence = { ...strip(item), kind: 'definition', ...(owner ? { owner } : {}),
        authoredStatus: { state: 'authored', evidence: [{ site: 'headings', value: 'Proposed', source: { file: item.file, offset: item.offset, end: item.end, line: item.line, column: item.column } }] } };
      result.push(proposed); defined.set(nameKey(item), proposed);
      for (const child of children.get(item) ?? []) result.push({ ...strip(child), kind: 'definition', owner: { id: proposed.id, offset: proposed.offset, ...(proposed.scope ? { scope: proposed.scope } : {}) } });
      continue;
    }
    // An archived change is history: a record whose element no longer exists (removed or renamed later) is not an error.
    if (change?.archived && item.category && !defined.has(nameKey(item))) continue;
    result.push({ ...strip(item), ...(owner ? { owner } : {}) });
  }
  for (const change of changes) {
    const capabilities = change.definition.category!.changes!.capabilities;
    const declared = capabilities === undefined ? [] : result.filter(item => (item.delta === 'new' || item.delta === 'modified') && item.category?.key === capabilities && item.file === change.definition.file);
    if (!declared.length) continue;
    const prefix = (change.folder ? change.folder + '/' : '') + 'specs/';
    const actual = new Map<string, string>();
    for (const file of files) if (file.startsWith(prefix) && file.slice(prefix.length).includes('/')) { const name = file.slice(prefix.length).split('/')[0]; actual.set(name.toLocaleLowerCase(), name); }
    const names = new Set(declared.map(item => item.id.toLocaleLowerCase()));
    for (const item of declared) if (!actual.has(item.id.toLocaleLowerCase())) {
      findings.push({ file: item.file, offset: item.offset, end: item.end, line: item.line, column: item.column, kind: 'consistency', message: `${change.definition.id} declares capability ${item.id}, but has no ${prefix}${item.id}/ specification.` });
    }
    const definition = change.definition;
    for (const [key, name] of actual) if (!names.has(key)) {
      findings.push({ file: definition.file, offset: definition.offset, end: definition.end, line: definition.line, column: definition.column, kind: 'consistency', message: `${definition.id} has ${prefix}${name}/, but its proposal does not declare capability ${name}.` });
    }
  }
  return { occurrences: result, findings };
}
export function buildIndex(models: DocumentModel[]): ProjectIndex {
  let occurrences = models.flatMap(model => model.occurrences);
  // Named elements (85a) are identified ignoring case: every spelling takes the first one seen. Cached document
  // models are shared across builds, so the authored spelling is kept and the canonical one recomputed each time.
  const spellings = new Map<string, string>();
  const written = (item: { id: string }) => { let value = authoredSpelling.get(item); if (value === undefined) authoredSpelling.set(item, value = item.id); return value; };
  const canonical = (id: string, scope?: string) => idKey({ id: id.toLocaleLowerCase(), ...(scope ? { scope } : {}) });
  // Definitions spell a name first; records and backticked candidates only adopt it.
  for (const item of [...occurrences.filter(item => item.named && item.kind === 'definition'), ...occurrences.filter(item => item.named && item.kind !== 'definition')]) {
    const key = canonical(written(item), item.scope), first = spellings.get(key);
    if (first === undefined) spellings.set(key, written(item));
  }
  if (spellings.size) for (const item of occurrences) {
    if (item.named) item.id = spellings.get(canonical(written(item), item.scope))!;
    if (item.owner) { const owner = spellings.get(canonical(written(item.owner), item.owner.scope)); if (owner !== undefined) item.owner.id = owner; }
  }
  const changes = resolveChanges(occurrences, models.map(model => model.file));
  occurrences = changes.occurrences;
  const categories = new Map<string, string>();
  for (const item of occurrences) if (item.category) {
    const previous = categories.get(idKey(item));
    if (previous !== undefined && previous !== item.category.key) throw new Error(conflictingCategories(item, previous, occurrences));
    categories.set(idKey(item), item.category.key);
  }
  const definitions = occurrences.filter(item => item.kind === 'definition');
  const references = occurrences.filter(item => item.kind === 'reference');
  const grouped = new Map<string, Occurrence[]>();
  for (const item of definitions) grouped.set(idKey(item), [...(grouped.get(idKey(item)) ?? []), item]);
  const findings: Finding[] = [...models.flatMap(model => model.pending), ...changes.findings];
  for (const group of grouped.values()) if (group.length > 1) for (const definition of group) {
    findings.push({ ...definition, kind: 'duplicate', message: `${idLabel(definition)} has ${group.length} definitions. Choose a unique ID.` });
  }
  for (const reference of references) if (!grouped.has(idKey(reference))) {
    findings.push({ ...reference, kind: 'unresolved', message: `No definition found for ${idLabel(reference)}.` });
  }
  const unmappedMarkers: Record<string, number> = {};
  for (const model of models) for (const [marker, count] of Object.entries(model.unmappedMarkers ?? {})) unmappedMarkers[marker] = (unmappedMarkers[marker] ?? 0) + count;
  return aggregateStatuses({ definitions, references, findings, diagrams: models.flatMap(model => model.diagrams), ...(Object.keys(unmappedMarkers).length ? { unmappedMarkers } : {}) });
}

export function slugHeading(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
}
