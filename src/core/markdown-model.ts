import { toString } from 'mdast-util-to-string';
import type { Nodes } from 'mdast';
import { parse as parseYaml } from 'yaml';
import { parseMarkdown } from './documents';
import type { MarkdownBlock, MarkdownFile, MarkdownModel } from '../../packages/plugin-api/src/index';

/** Increment 97c: bounds of the `markdown@1` model, like the physical model's (4096 files, 32 MiB of requests). */
export const MARKDOWN_LIMITS = { files: 4096, characters: 16 * 1024 * 1024, blocksPerFile: 20000, frontMatter: 64 * 1024 } as const;
const FRONT_MATTER = /^---[ \t]*\n([\s\S]*?\n)?---[ \t]*(?:\n|$)/u;

/** One file: front matter parsed as YAML data, then the rest parsed as Markdown with the front matter blanked so ranges stay in file coordinates. */
export function markdownFile(file: string, input: string): MarkdownFile {
  const text = input.replace(/\r\n?/gu, '\n');
  const match = FRONT_MATTER.exec(text);
  let frontMatter: MarkdownFile['frontMatter'], body = text;
  if (match) {
    const range = { file, start: 0, end: match[0].length };
    if (match[0].length > MARKDOWN_LIMITS.frontMatter) frontMatter = { range, error: 'Front matter exceeds 64 KB.' };
    else try { frontMatter = { range, data: parseYaml(match[1] ?? '', { maxAliasCount: 0 }) ?? null }; }
    catch (error) { frontMatter = { range, error: (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 500) }; }
    body = text.slice(0, match[0].length).replace(/[^\n]/gu, ' ') + text.slice(match[0].length);
  }
  const headings: { depth: number; text: string; range: { file: string; start: number; end: number }; parent?: number }[] = [], blocks: MarkdownBlock[] = [];
  const stack: number[] = [];
  const range = (node: Nodes) => ({ file, start: node.position!.start.offset!, end: node.position!.end.offset! });
  const enclosing = () => stack.length ? { heading: stack.at(-1)! } : {};
  const visit = (node: Nodes, depth: number) => {
    if (blocks.length >= MARKDOWN_LIMITS.blocksPerFile || !node.position) return;
    if (node.type === 'heading') {
      while (stack.length && headings[stack.at(-1)!].depth >= node.depth) stack.pop();
      headings.push({ depth: node.depth, text: toString(node).trim(), range: range(node), ...(stack.length ? { parent: stack.at(-1)! } : {}) });
      stack.push(headings.length - 1); return;
    }
    if (node.type === 'paragraph') { blocks.push({ kind: 'paragraph', text: toString(node), range: range(node), ...enclosing() }); return; }
    if (node.type === 'table') { blocks.push({ kind: 'table', rows: node.children.map(row => row.children.map(cell => toString(cell).trim())), range: range(node), ...enclosing() }); return; }
    if (node.type === 'list') {
      for (const item of node.children) {
        if (blocks.length >= MARKDOWN_LIMITS.blocksPerFile || !item.position) break;
        const first = item.children[0];
        blocks.push({ kind: 'list-item', text: first?.type === 'paragraph' ? toString(first) : '', range: range(item), ...enclosing(), ordered: !!node.ordered, depth,
          ...(typeof item.checked === 'boolean' ? { checked: item.checked } : {}) });
        // Nested lists are items of their own; the first paragraph is the item's text.
        for (const child of item.children) if (child !== first || child.type !== 'paragraph') visit(child, child.type === 'list' ? depth + 1 : depth);
      }
      return;
    }
    if (node.type === 'blockquote' || node.type === 'root') for (const child of node.children) visit(child, depth);
  };
  visit(parseMarkdown(body), 0);
  return { file, text, ...(frontMatter ? { frontMatter } : {}), headings, blocks };
}

/** The model a discovery contribution reads: the files, bounded; files past the limits are left out with a warning. */
export function markdownModel(documents: Record<string, string>, revision: number): MarkdownModel {
  const files: MarkdownFile[] = [], warnings: string[] = [];
  let characters = 0, skipped = 0;
  for (const [file, text] of Object.entries(documents).sort(([a], [b]) => a.localeCompare(b))) {
    if (files.length >= MARKDOWN_LIMITS.files || characters + text.length > MARKDOWN_LIMITS.characters) { skipped++; continue; }
    characters += text.length;
    const model = markdownFile(file, text);
    if (model.blocks.length >= MARKDOWN_LIMITS.blocksPerFile) warnings.push(`${file}: only the first ${MARKDOWN_LIMITS.blocksPerFile} blocks are included.`);
    files.push(model);
  }
  if (skipped) warnings.push(`${skipped} files exceed the model's limits (${MARKDOWN_LIMITS.files} files, ${MARKDOWN_LIMITS.characters / 1024 / 1024} MiB) and are left out.`);
  return { name: 'markdown', version: 1, revision, ready: true, provenance: { extractor: 'specular-markdown', extractorVersion: '1.0.0' }, warnings, files };
}
