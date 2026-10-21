export const MAX_TERMINAL_BRIEF_LENGTH = 60_000;

/** One bracketed paste, with no submit key outside the paste envelope. */
export function encodeTerminalBrief(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('The brief is empty.');
  if (value.length > MAX_TERMINAL_BRIEF_LENGTH) throw new Error('The brief exceeds 60,000 characters. Shorten it or use Copy brief.');
  // Never allow pasted content to end the envelope or act as terminal control input.
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value)) throw new Error('The brief contains terminal control characters. Remove them before inserting.');
  return '\x1b[200~' + value.replace(/\r\n|\n|\r/g, '\r') + '\x1b[201~';
}
