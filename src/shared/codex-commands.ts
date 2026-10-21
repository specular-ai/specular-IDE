/** Explicit adapter registry. Runtime mappings verified against Codex 0.154.0. */
export const codexCommands = [
  { name: 'help', usage: '/help', description: 'Show these commands', kind: 'IDE' },
  { name: 'status', usage: '/status', description: 'Read connection and current thread status', kind: 'Codex' },
  { name: 'model', usage: '/model [model-id]', description: 'List Codex models, or select a model in the IDE for the next message', kind: 'Codex / IDE' },
  { name: 'compact', usage: '/compact', description: 'Compact current model context; uses API credits and keeps visible messages', kind: 'Codex' },
  { name: 'stop', usage: '/stop', description: 'Request Stop for the current operation', kind: 'IDE control' },
] as const;
export function parseCodexCommand(text: string) {
  const value = text.trim();
  if (!value.startsWith('/') && !value.startsWith('\\')) return undefined;
  const match = /^([/\\])([^\s]*)(?:\s+([\s\S]*))?$/.exec(value)!;
  return { prefix: match[1], name: match[2], argument: match[3] ?? '' };
}
export const validModelId = (value: string) => /^[a-zA-Z0-9._:/-]{1,128}$/.test(value);
export const commandRuntimeSupported = (version?: string) => /^(?:codex-cli|codex) 0\.154\.0$/.test(version ?? '');
