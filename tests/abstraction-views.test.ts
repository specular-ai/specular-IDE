import { LEGACY_ID_CONFIGURATION } from '../src/core/id-configuration';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AbstractionViewHost, ViewRegistry, ViewWorkspace, type ViewContext, type WorkspaceViewSnapshot, type SurfaceFactory } from '../src/renderer/abstraction-views';
import { analyzeDocument, buildIndex } from '../src/core/documents';

function snapshot(text = '# REQ-001\nFirst.', revision = 1, ready = true, projectId = 'project-a'): WorkspaceViewSnapshot {
  return { projectId, revision, ready, currentFile: 'spec.md', configuration: LEGACY_ID_CONFIGURATION, notice: ready ? '' : 'Updating', documents: { 'spec.md': text }, folders: [], files: [{ path: 'spec.md', markdown: true }],
    index: buildIndex([analyzeDocument('spec.md', text)]), warnings: [] };
}
function harness() {
  const errors: unknown[] = [], navigations: string[] = [], events: string[] = [];
  const contexts = new Map<string, ViewContext>();
  const workspace = new ViewWorkspace(snapshot(), async evidence => { navigations.push(evidence.source.id); }, id => events.push(`occurrences:${id}`), error => errors.push(error));
  const registry = new ViewRegistry();
  const surface: SurfaceFactory = group => ({ container: () => ({} as HTMLElement), show: id => events.push(`surface:${group.id}:${id ?? 'hidden'}`), dispose: () => events.push(`surface-dispose:${group.id}`) });
  const host = new AbstractionViewHost(registry, workspace, surface, () => {}, () => events.push('before-open'));
  function register(id: string, group: string) {
    registry.register({ id, title: id, group, create(_root, context) {
      contexts.set(id, context); events.push(`create:${id}`);
      // Deliberately rely on the host to revoke subscriptions, as a minimal new view might.
      context.onSnapshotChanged(next => events.push(`update:${id}:${next.revision}`));
      return { activate: target => events.push(`activate:${id}:${target?.elementId ?? ''}`), deactivate: () => events.push(`deactivate:${id}`),
        reset: () => events.push(`reset:${id}`), dispose: () => events.push(`dispose:${id}`) };
    } });
  }
  registry.registerGroup({ id: 'relationships', title: 'Relationships', containerId: 'relationships' });
  registry.registerGroup({ id: 'sample', title: 'Independent sample', containerId: 'sample' });
  register('focus', 'relationships'); register('overview', 'relationships'); register('sample', 'sample');
  return { workspace, registry, host, errors, navigations, events, contexts };
}

test('registry rejects duplicate IDs and unknown groups', () => {
  const { registry } = harness();
  assert.throws(() => registry.registerGroup({ id: 'sample', title: 'Duplicate', containerId: 'duplicate' }), /Duplicate/);
  const definition = registry.definition('focus');
  assert.throws(() => registry.register(definition), /Duplicate/);
  assert.throws(() => registry.register({ ...definition, id: 'bad', group: 'missing' }), /Unknown view group/);
  assert.throws(() => registry.definition('missing'), /Unknown view/);
});
test('an independent view opens its own tab, receives a target, and navigates through services without graph-specific wiring', () => {
  const h = harness(); h.host.openView('focus', { elementId: 'REQ-001' });
  h.contexts.get('focus')!.openView('sample', { elementId: 'REQ-002' });
  assert.equal(h.host.activeGroup, 'sample'); assert.deepEqual(h.host.tabs.map(tab => tab.id), ['relationships', 'sample']);
  assert.ok(h.events.includes('deactivate:focus')); assert.ok(h.events.includes('activate:sample:REQ-002'));
  h.contexts.get('sample')!.showOccurrences('REQ-002'); assert.ok(h.events.includes('occurrences:REQ-002'));
  h.host.close('relationships'); assert.equal(h.host.activeGroup, 'sample');
});
test('source return and close/reopen retain instances and the selected group mode', () => {
  const h = harness(); h.host.openView('overview'); h.host.showDocument();
  assert.equal(h.host.activeGroup, undefined); assert.equal(h.host.tabs.length, 1);
  h.host.openGroup('relationships'); assert.equal(h.events.at(-1), 'activate:overview:');
  h.host.close('relationships'); assert.equal(h.host.tabs.length, 0);
  h.host.openGroup('relationships'); assert.equal(h.events.at(-1), 'activate:overview:');
  assert.equal(h.events.filter(event => event === 'create:overview').length, 1);
  assert.ok(!h.events.some(event => event.startsWith('dispose:')));
});
test('snapshot publication preserves unsaved content and invalidation, freezes copies, and isolates failing listeners', () => {
  const h = harness(); h.host.openView('sample'); const context = h.contexts.get('sample')!;
  const earlier = context.getSnapshot(), next = snapshot('# REQ-001\nUnsaved.', 2, false);
  context.onSnapshotChanged(() => { throw new Error('sample failure'); });
  h.workspace.publish(next);
  assert.equal(context.getSnapshot().documents['spec.md'], '# REQ-001\nUnsaved.');
  assert.equal(context.getSnapshot().ready, false); assert.ok(h.events.includes('update:sample:2'));
  assert.equal(earlier.documents['spec.md'], '# REQ-001\nFirst.'); assert.equal(h.errors.length, 1);
  assert.throws(() => { (context.getSnapshot().documents as Record<string, string>)['spec.md'] = 'Changed'; }, TypeError);
  assert.throws(() => { context.getSnapshot().index.definitions[0].id = 'Changed'; }, TypeError);
  assert.equal(next.index.definitions[0].id, 'REQ-001');
});
test('navigation rejects stale revisions, invalidating snapshots, other projects, and disposed contexts', async () => {
  const h = harness(); h.host.openView('sample'); const context = h.contexts.get('sample')!;
  const evidence = { projectId: 'project-a', revision: 1, source: snapshot().index.definitions[0] };
  await context.openSource(evidence); assert.deepEqual(h.navigations, ['REQ-001']);
  h.workspace.publish(snapshot('Unsaved', 2, false)); await context.openSource(evidence);
  h.workspace.publish(snapshot(undefined, 2)); await context.openSource(evidence);
  await context.openSource({ ...evidence, revision: 2, projectId: 'project-b' });
  h.host.reset(); await context.openSource({ ...evidence, revision: 2 });
  assert.equal(h.errors.length, 4); assert.deepEqual(h.navigations, ['REQ-001']);
});
test('project reset and final disposal clean up every view once and revoke retained callbacks', () => {
  const h = harness(); h.host.openView('focus'); h.host.openView('sample');
  const old = h.contexts.get('sample')!; h.host.reset(); h.host.dispose();
  assert.equal(h.host.tabs.length, 0); assert.equal(h.host.activeGroup, undefined);
  for (const id of ['focus', 'overview', 'sample']) {
    assert.equal(h.events.filter(event => event === `reset:${id}`).length, 1);
    assert.equal(h.events.filter(event => event === `dispose:${id}`).length, 1);
  }
  const count = h.events.length;
  h.workspace.publish(snapshot(undefined, 3, true, 'project-b'));
  old.openView('focus'); old.showOccurrences('REQ-001'); assert.equal(h.events.length, count);
  h.host.openView('sample'); assert.equal(h.events.filter(event => event === 'create:sample').length, 2);
  assert.equal(h.contexts.get('sample')!.getSnapshot().projectId, 'project-b');
});

test('failed group creation revokes subscriptions and disposes the views already created', () => {
  const h = harness();
  h.registry.register({ id: 'broken', title: 'Broken', group: 'relationships', create(_root, context) {
    context.onSnapshotChanged(() => h.events.push('leaked'));
    throw new Error('Creation failed');
  } });
  assert.throws(() => h.host.openView('focus'), /Creation failed/);
  assert.equal(h.host.tabs.length, 0); assert.equal(h.host.activeGroup, undefined);
  assert.ok(h.events.includes('dispose:focus')); assert.ok(h.events.includes('dispose:overview'));
  const count = h.events.length; h.workspace.publish(snapshot(undefined, 2)); assert.equal(h.events.length, count);
});

test('subscriptions remain independent and disposal suppresses callbacks already queued for publication', () => {
  const h = harness(), first = h.workspace.scope(() => {}), second = h.workspace.scope(() => {});
  let calls = 0; const listener = () => { calls++; };
  first.context.onSnapshotChanged(listener); second.context.onSnapshotChanged(listener);
  first.dispose(); h.workspace.publish(snapshot(undefined, 2)); assert.equal(calls, 1);
  second.dispose();
  const disposing = h.workspace.scope(() => {}), disposed = h.workspace.scope(() => {});
  disposing.context.onSnapshotChanged(() => disposed.dispose());
  disposed.context.onSnapshotChanged(listener);
  h.workspace.publish(snapshot(undefined, 3)); assert.equal(calls, 1);
});
