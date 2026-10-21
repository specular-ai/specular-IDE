import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeTerminalBrief, MAX_TERMINAL_BRIEF_LENGTH } from '../src/shared/terminal-brief';

test('brief paste preserves Unicode, shell punctuation and trailing lines inside one envelope without submitting', () => {
  const text = '# REQ-001 café 🧭\r\n$(do-not-run)\nsecond\rthird\tcolumn\n';
  assert.equal(encodeTerminalBrief(text), '\x1b[200~# REQ-001 café 🧭\r$(do-not-run)\rsecond\rthird\tcolumn\r\x1b[201~');
  assert.equal(encodeTerminalBrief('a'.repeat(MAX_TERMINAL_BRIEF_LENGTH)).length, MAX_TERMINAL_BRIEF_LENGTH + 12);
});

test('brief paste refuses empty, oversized and terminal control payloads instead of truncating or executing them', () => {
  for (const value of [null, 3, '', ' \n', 'a'.repeat(MAX_TERMINAL_BRIEF_LENGTH + 1), 'hi\x1b[201~\r', 'hi\x03', 'hi\x00', 'hi\x9b']) {
    assert.throws(() => encodeTerminalBrief(value));
  }
});
