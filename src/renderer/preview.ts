import { idKey, idLabel } from '../core/id-identity';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import type { Root } from 'mdast';
import type { Root as HtmlRoot, Element, Text as HtmlText, RootContent, ElementContent } from 'hast';
import DOMPurify from 'dompurify';
import { slugHeading, parseMarkdown } from '../core/documents';
import type { Occurrence } from '../shared/types';
import { currentAppearance } from './appearance';

const processor = unified().use(remarkParse).use(remarkGfm).use(function sourceHeadings() {
  return (tree: Root) => {
    const used = new Map<string, number>();
    visit(tree, 'heading', node => {
      const slug = slugHeading(toString(node));
      const count = used.get(slug) ?? 0;
      used.set(slug, count + 1);
      node.data = { ...node.data, hProperties: { id: count ? `${slug}-${count}` : slug } };
    });
  };
}).use(remarkRehype).use(function sourceBlocks() {
  return (tree: HtmlRoot) => {
    visit(tree, 'element', node => {
      if (!/^(h[1-6]|p|blockquote|ul|ol|li|pre|table|tr|th|td|hr)$/.test(node.tagName)) return;
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      node.properties['data-source-start'] = start;
      node.properties['data-source-end'] = end;
    });
  };
}).use(function indexedLinks() {
  return (tree: HtmlRoot, file: { data: Record<string, unknown>; value: unknown }) => {
    const occurrences = (file.data.occurrences ?? []) as readonly Occurrence[];
    const rewrite = (parent: HtmlRoot | Element) => {
      if (parent.type === 'element' && ['a', 'pre', 'blockquote'].includes(parent.tagName)) return;
      const children = (parent.children as RootContent[]).flatMap<RootContent>(node => {
        if (node.type === 'element') { rewrite(node); return [node]; }
        if (node.type !== 'text') return [node];
        const inlineCode = parent.type === 'element' && parent.tagName === 'code';
        const position = node.position ?? (inlineCode ? parent.position : undefined);
        const start = position?.start.offset, end = position?.end.offset;
        if (start === undefined || end === undefined) return [node];
        const matches = occurrences.filter(item => item.offset >= start && item.end <= end).sort((a, b) => a.offset - b.offset);
        const parts: (HtmlText | Element)[] = []; let from = 0;
        for (const item of matches) {
          // Decode the source prefix, so an encoded lookalike before an actual ID cannot steal its link.
          let prefix = String(file.value).slice(start, item.offset);
          if (inlineCode) prefix = prefix.replace(/^`+/, '').replace(/\r\n|\r|\n/g, ' ');
          else {
            const decoder = document.createElement('textarea'); decoder.innerHTML = prefix.replace(/</g, '&lt;');
            prefix = decoder.value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
          }
          const offset = prefix.length;
          if (offset < from || node.value.slice(offset, offset + item.id.length) !== item.id) continue;
          parts.push({ type: 'text', value: node.value.slice(from, offset) });
          parts.push({ type: 'element', tagName: 'button', properties: { className: ['id-link'], 'data-id': idKey(item),
            title: `Go to ${idLabel(item)} · Shift-click for references` }, children: [{ type: 'text', value: item.id }] });
          from = offset + item.id.length;
        }
        parts.push({ type: 'text', value: node.value.slice(from) });
        return parts;
      });
      parent.children = children as ElementContent[];
    };
    rewrite(tree);
  };
}).use(rehypeStringify);

export function markdownDiagrams(text: string) {
  const diagrams: { source: string; offset: number; end: number; line: number; column: number }[] = [];
  visit(parseMarkdown(text), 'code', node => {
    if (node.lang?.toLowerCase() !== 'mermaid' || !node.position) return;
    diagrams.push({ source: node.value, offset: node.position.start.offset!, end: node.position.end.offset!,
      line: node.position.start.line, column: node.position.start.column });
  });
  return diagrams;
}

export function renderMarkdown(target: HTMLElement, text: string, occurrences: readonly Occurrence[] = []): void {
  target.innerHTML = DOMPurify.sanitize(String(processor.processSync({ value: text, data: { occurrences } })), {
    FORBID_TAGS: ['img', 'style', 'iframe', 'object', 'form'],
  });
}

let mermaidPromise: Promise<typeof import('mermaid')['default']> | undefined;
let serial = 0;
let renderQueue: Promise<void> = Promise.resolve();
const diagrams = new Map<HTMLElement, { source: string; generation: number }>();
window.addEventListener('specular:appearance', () => {
  for (const [target, entry] of diagrams) {
    if (!target.isConnected) diagrams.delete(target);
    else void renderDiagram(target, entry.source);
  }
});
export async function renderDiagram(target: HTMLElement, source: string): Promise<void> {
  for (const old of diagrams.keys()) if (!old.isConnected) diagrams.delete(old);
  const generation = (diagrams.get(target)?.generation ?? 0) + 1;
  diagrams.set(target, { source, generation });
  const selected = currentAppearance();
  const valid = () => target.isConnected && diagrams.get(target)?.generation === generation && currentAppearance().mode === selected.mode;
  const task = async () => {
    mermaidPromise ??= import('mermaid').then(module => module.default);
    try {
      const mermaid = await mermaidPromise;
      if (!valid()) return;
      // Mermaid has global configuration; serialize initialization and render together.
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: selected.mode === 'dark' ? 'dark' : 'default', htmlLabels: false,
      secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'themeCSS', 'dompurifyConfig'],
      suppressErrorRendering: true,
      // Journey section names are SVG text sharing their section's fill; keep them readable.
      themeCSS: `text.journey-section { fill: ${selected.mode === 'dark' ? '#e3e9ed' : '#243442'}; }`,
      themeVariables: selected.mode === 'dark'
        ? { primaryColor: '#223e45', primaryTextColor: '#e3e9ed', primaryBorderColor: '#6bc7c1', lineColor: '#8da3af', fontFamily: 'Segoe UI, sans-serif' }
        : { primaryColor: '#e0efec', primaryTextColor: '#243442', primaryBorderColor: '#176c63', lineColor: '#526575', textColor: '#243442', fontFamily: 'Segoe UI, sans-serif' } });
      const { svg } = await mermaid.render(`diagram-${++serial}`, source);
      if (!valid()) return;
      target.classList.remove('diagram-error');
      target.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'script'] });
      target.dataset.theme = selected.mode;
    } catch (error) {
      if (!valid()) return;
      target.classList.add('diagram-error');
      target.textContent = `Diagram could not be rendered. ${String(error).slice(0, 280)}`;
    }
  };
  renderQueue = renderQueue.then(task, task);
  await renderQueue;
}
