import { analyzeDocument } from './documents';
import type { Occurrence } from '../shared/types';

interface BriefMetadata {
  file: string;
  text: string;
  ids: string[];
  unsaved: boolean;
  diskConflict: boolean;
}
export type BriefSource = BriefMetadata & (
  { kind: 'source'; startLine: number; endLine: number } | { kind: 'preview' }
);

export function captureBriefSource(file: string, document: string, from: number, to: number,
  unsaved: boolean, diskConflict = false, indexedOccurrences?: readonly Occurrence[]): Extract<BriefSource, { kind: 'source' }> {
  if (!/\.(md|markdown)$/i.test(file)) throw new Error('Open a Markdown file to prepare an agent brief.');
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > document.length || from >= to || !document.slice(from, to).trim()) {
    throw new Error('Select some Markdown in the source editor first.');
  }
  const occurrences = (indexedOccurrences ?? analyzeDocument(file, document).occurrences)
    .filter(item => item.file === file && item.offset >= from && item.end <= to);
  const lineAt = (offset: number) => document.slice(0, offset).split(/\r\n|\r|\n/).length;
  return { kind: 'source', file, text: document.slice(from, to), startLine: lineAt(from), endLine: lineAt(to - 1),
    ids: [...new Set(occurrences.map(item => item.id))], unsaved, diskConflict };
}

export function describeBriefSource(source: BriefSource): string {
  const state = source.unsaved ? 'Unsaved editor snapshot' : 'Saved editor snapshot';
  return state + (source.diskConflict ? ' — disk conflict or unavailable file at capture' : '');
}

export function assembleBrief(input: BriefSource | BriefSource[], instruction: string): string {
  if (!instruction.trim()) throw new Error('Enter an instruction for the agent.');
  const sources = Array.isArray(input) ? input : [input];
  if (!sources.length) throw new Error('Choose a selection for the brief.');
  // A longer fence preserves selected Markdown even when it already contains fenced examples.
  const longestRun = (text: string) => {
    let longest = 0;
    for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
    return longest;
  };
  return [
    '# Agent brief', '', '## Instruction', '', instruction.trim(), '',
    ...sources.flatMap(source => {
      const fence = '`'.repeat(Math.max(3, longestRun(source.text) + 1));
      const fileTicks = '`'.repeat(longestRun(source.file) + 1);
      return [source.kind === 'source' ? '## Source' : '## Preview source', '',
        `- File: ${fileTicks} ${source.file} ${fileTicks}`,
        source.kind === 'source' ? `- Selection: lines ${source.startLine}–${source.endLine}`
          : '- Selection: rendered preview text; Markdown formatting and exact source lines are unavailable.',
        `- Content: ${describeBriefSource(source)} (captured when the brief was opened).`,
        `- IDs: ${source.ids.length ? source.ids.join(', ') : 'None recognized in this selection.'}`,
        '', source.kind === 'source' ? '## Selected Markdown' : '## Selected preview text', '',
        `${fence}${source.kind === 'source' ? 'markdown' : 'text'}`, source.text,
        ...(source.text.endsWith('\n') ? [] : ['']), fence, '',
      ];
    }),
  ].join('\n');
}
