import type { SourceLocation } from '../shared/types';

export const SEARCH_LIMIT = 500;
export const MAX_SEARCH_QUERY = 512;
export interface MarkdownMatch extends SourceLocation { before: string; match: string; after: string }
export interface MarkdownSearchResults { matches: MarkdownMatch[]; truncated: boolean }

/** Offsets and columns use the normalized UTF-16 text used by the source editor. */
export function searchMarkdown(documents: Record<string, string>, query: string, matchCase = false): MarkdownSearchResults {
  const matches: MarkdownMatch[] = [];
  if (!query || query.length > MAX_SEARCH_QUERY || /[\r\n]/.test(query)) return { matches, truncated: false };
  // Escaping keeps punctuation literal; Unicode matching preserves original offsets even for case variants.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu');
  for (const file of Object.keys(documents).filter(file => /\.(md|markdown)$/i.test(file)).sort()) {
    const text = documents[file].replace(/\r\n|\r/g, '\n');
    let line = 1, lineStart = 0;
    for (const match of text.matchAll(pattern)) {
      if (matches.length === SEARCH_LIMIT) return { matches, truncated: true };
      const offset = match.index, end = offset + match[0].length;
      let newline: number;
      while ((newline = text.indexOf('\n', lineStart)) !== -1 && newline < offset) { line++; lineStart = newline + 1; }
      const lineEnd = text.indexOf('\n', end), stop = lineEnd === -1 ? text.length : lineEnd;
      const start = Math.max(lineStart, offset - 60), finish = Math.min(stop, end + 100);
      matches.push({ file, line, column: offset - lineStart + 1, offset, end, match: match[0],
        before: (start > lineStart ? '…' : '') + text.slice(start, offset),
        after: text.slice(end, finish) + (finish < stop ? '…' : '') });
    }
  }
  return { matches, truncated: false };
}
