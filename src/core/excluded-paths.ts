import { pathsContain } from './id-scopes';
import type { ProjectIndex } from '../shared/types';

/**
 * Increment 99a (DD-064): folders where specification tools keep templates and their copies of commands for each coding agent.
 * Their Markdown is full of placeholder IDs, unchecked checkboxes, and example markers, so discovery proposes excluding them.
 * Tool memory such as `.specify/memory` (the constitution) holds real content and is not listed.
 */
export const TOOL_FOLDERS: readonly string[] = [
  '.specify/templates',
  '.claude/commands', '.claude/skills/speckit-*',
  '.github/prompts',
  '.cursor/commands',
  '.windsurf/workflows',
  '.devin/workflows',
  '.opencode/command',
  '.codex/prompts',
  '.gemini/commands',
  '.qwen/commands',
  '.kilocode/workflows',
  '.roo/commands',
  '.augment/commands',
  '.amazonq/prompts',
  '.kittify/missions', '.kittify/overrides',
];

/** A tool folder present in the project, with what its Markdown contributes to the index. */
export interface ToolFolder { path: string; files: number; definitions: number; pending: number }

/**
 * The tool folders holding Markdown, and per folder its files, definitions, and pending items in `index`.
 * With an index, a folder whose files add nothing to it (no definitions, references, or findings) is left out: excluding it would change nothing.
 */
export function toolFolders(files: readonly string[], index?: ProjectIndex): ToolFolder[] {
  return TOOL_FOLDERS.flatMap(path => {
    const inside = (file: string) => pathsContain(file, [path]);
    const count = files.filter(inside).length;
    if (!count) return [];
    if (index && ![...index.definitions, ...index.references, ...index.findings].some(item => inside(item.file))) return [];
    return [{ path, files: count,
      definitions: index ? index.definitions.filter(item => inside(item.file)).length : 0,
      pending: index ? index.findings.filter(item => item.kind === 'pending' && inside(item.file)).length : 0 }];
  });
}
