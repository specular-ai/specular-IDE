import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Autosave } from '../src/core/autosave';
import type { SaveResult } from '../src/shared/types';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function fixture() {
  const data = { text: 'original', saved: 'original', version: 'v1', writes: [] as { text: string; version: string }[], fail: false };
  const save = new Autosave({ text: () => data.text, savedText: () => data.saved, version: () => data.version,
    write: async (text, version) => {
      data.writes.push({ text, version });
      if (data.fail) throw new Error('Disk unavailable');
      return { ok: true, document: { path: 'notes.md', text, version: 'v' + (data.writes.length + 1) } };
    }, saved: document => { data.saved = document.text; data.version = document.version; }, changed: () => {},
  }, 5);
  return { data, save };
}
test('edits debounce, idle loads do not write, and multiple buffers save independently', async () => {
  const a = fixture(), b = fixture();
  await delay(15); assert.equal(a.data.writes.length, 0);
  a.data.text = 'a'; a.save.edit(); a.data.text = 'latest'; a.save.edit();
  b.data.text = 'other'; b.save.edit();
  await delay(25);
  assert.deepEqual(a.data.writes, [{ text: 'latest', version: 'v1' }]);
  assert.equal(b.data.saved, 'other'); assert.equal(a.save.status, 'Saved');
  a.save.dispose(); b.save.dispose();
});
test('edits during a delayed write serialize with its returned version and never mark newer text saved early', async () => {
  let text = 'first', saved = 'original', version = 'v1';
  const writes: { text: string; version: string; resolve: (result: SaveResult) => void }[] = [];
  const save = new Autosave({ text: () => text, savedText: () => saved, version: () => version,
    write: (text, version) => new Promise(resolve => writes.push({ text, version, resolve })),
    saved: document => { saved = document.text; version = document.version; }, changed: () => {},
  });
  const flushing = save.flush(); await Promise.resolve();
  text = 'newer'; save.edit(); assert.equal(save.status, 'Saving'); assert.equal(writes.length, 1);
  writes[0].resolve({ ok: true, document: { path: 'a.md', text: 'first', version: 'v2' } });
  await delay(0);
  assert.equal(saved, 'first'); assert.equal(save.status, 'Saving');
  assert.equal(writes[1].text, 'newer'); assert.equal(writes[1].version, 'v2');
  writes[1].resolve({ ok: true, document: { path: 'a.md', text: 'newer', version: 'v3' } });
  assert.equal(await flushing, true); assert.equal(saved, text); assert.equal(save.status, 'Saved'); save.dispose();
});
test('failures stop automatic retries, preserve edits, and allow explicit retry; conflicts cannot be bypassed', async () => {
  const { data, save } = fixture(); data.text = 'pending'; data.fail = true; save.edit();
  await delay(20); assert.equal(save.status, 'Save failed'); assert.equal(data.saved, 'original');
  data.text = 'newer'; save.edit(); await delay(20); assert.equal(data.writes.length, 1);
  data.fail = false; assert.equal(await save.flush(true), true); assert.equal(data.saved, 'newer');
  data.text = 'conflicting'; save.block('External change');
  assert.equal(await save.flush(true), false); assert.equal(data.writes.length, 2); assert.equal(save.status, 'Conflict'); save.dispose();
});
test('pausing and settling stop follow-up writes before reload/discard, while an explicit paused flush drains edits', async () => {
  let text = 'first', saved = 'original', release!: (result: SaveResult) => void, writes = 0;
  const save = new Autosave({ text: () => text, savedText: () => saved, version: () => 'v1',
    write: async () => { writes++; return new Promise(resolve => { release = resolve; }); },
    saved: document => { saved = document.text; }, changed: () => {},
  });
  const running = save.flush(); await Promise.resolve(); text = 'discard this'; save.edit();
  const settled = save.settle(); release({ ok: true, document: { path: 'a.md', text: 'first', version: 'v2' } });
  await settled; await running; assert.equal(writes, 1); assert.equal(saved, 'first'); save.dispose();
  await delay(10); assert.equal(writes, 1);
  const next = fixture(); next.data.text = 'close immediately'; next.save.edit(); next.save.pause();
  assert.equal(await next.save.flush(), true); assert.equal(next.data.saved, 'close immediately'); next.save.dispose();
});
