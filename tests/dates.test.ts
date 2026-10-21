import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { annotateDates, DEFAULT_DATE_PATTERN, DEFAULT_DATE_SETTINGS, documentEvents, documentTitle, findStatusDate, headingLabel, validateDateSettings, DEFAULT_STATUS_DATE_PATTERN } from '../src/core/dates';
import { compileIdMatcher, LEGACY_ID_CONFIGURATION, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { mapStatuses } from '../src/core/statuses';
import { modelsFor } from '../src/renderer/plugin-models';

const pattern = () => new RegExp(DEFAULT_STATUS_DATE_PATTERN, 'gu');
/** The worker pipeline, minus modules/features: index, mapped statuses, then dates. */
function indexed(documents: Record<string, string>, configuration: IdConfiguration = LEGACY_ID_CONFIGURATION) {
  const index = mapStatuses(buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, compileIdMatcher(configuration)))), configuration.statuses ?? []);
  return annotateDates(index, documents, configuration.dates ?? DEFAULT_DATE_SETTINGS);
}

test('date settings default to typed rules, migrate the increment 79 form, and reject unsafe or incomplete rules', () => {
  const defaults = validateDateSettings({});
  assert.deepEqual(defaults.rules.map(rule => [rule.key, rule.site, rule.enabled, rule.kind ?? '-']), [
    ['status-date', 'status', true, '-'], ['list-entry', 'list-entry', true, 'entry'], ['heading', 'heading', true, 'milestone'],
    ['created', 'field', true, 'milestone'], ['ratified', 'field', true, 'milestone'], ['date', 'field', true, 'milestone'],
    ['last-updated', 'field', false, 'snapshot'], ['last-amended', 'field', false, 'snapshot']]);
  assert.deepEqual(defaults.exclude, []);
  // Increment 79 settings keep their meaning inside the default rule list.
  const migrated = validateDateSettings({ statusDates: { enabled: false }, events: { enabled: false } });
  assert.deepEqual(migrated.rules.filter(rule => !rule.enabled).map(rule => rule.key), ['status-date', 'list-entry', 'last-updated', 'last-amended']);
  assert.equal(validateDateSettings({ statusDates: { pattern: '(?<date>\\d{4}-\\d{2}-\\d{2})' } }).rules[0].pattern, '(?<date>\\d{4}-\\d{2}-\\d{2})');
  const custom = validateDateSettings({ exclude: ['Vendor/', 'docs/old.md'], rules: [{ key: 'released', site: 'field', label: 'Released' }, { key: 'log', site: 'list-entry', kind: 'milestone' }] });
  assert.deepEqual(custom.exclude, ['Vendor', 'docs/old.md']);
  assert.deepEqual(custom.rules, [{ key: 'released', site: 'field', enabled: true, pattern: DEFAULT_DATE_PATTERN, label: 'Released', kind: 'milestone' }, { key: 'log', site: 'list-entry', enabled: true, kind: 'milestone' }]);
  for (const bad of [null, [], { other: true }, { statusDates: { pattern: '(\\d{4})' } }, { statusDates: { pattern: '(?<date>[' } }, { statusDates: { enabled: 'yes' } }, { events: { pattern: 'x' } },
    { statusDates: {}, rules: [] }, { rules: [{ key: 'X', site: 'heading' }] }, { rules: [{ key: 'a', site: 'prose' }] }, { rules: [{ key: 'a', site: 'field' }] },
    { rules: [{ key: 'a', site: 'field', label: 'Created:' }] }, { rules: [{ key: 'a', site: 'heading', label: 'x' }] }, { rules: [{ key: 'a', site: 'list-entry', pattern: DEFAULT_DATE_PATTERN }] },
    { rules: [{ key: 'a', site: 'status', kind: 'milestone' }] }, { rules: [{ key: 'a', site: 'heading', kind: 'release' }] }, { rules: [{ key: 'a', site: 'heading', pattern: 'no capture' }] },
    { rules: [{ key: 'a', site: 'heading' }, { key: 'a', site: 'heading' }] }, { exclude: ['../outside'] }, { exclude: ['/abs'] }, { exclude: ['C:/x'] }, { exclude: 'Vendor' }]) {
    assert.throws(() => validateDateSettings(bad), JSON.stringify(bad));
  }
  const configuration = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, dates: { statusDates: { enabled: false } } });
  assert.equal(configuration.dates?.rules[0].enabled, false);
  assert.throws(() => validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, dates: { statusDates: { pattern: 'no capture' } } }), /named/);
});

test('status dates are found in every dated status form used in this repository, first match only', () => {
  const cases: [string, string | undefined][] = [
    ['Implemented on 2026-09-15.', '2026-09-15'],
    ['Implemented and validated on 2026-10-13. Original target: 40-55 minutes.', '2026-10-13'],
    ['Implemented and live-validated on 2026-09-30', '2026-09-30'],
    ['Superseded on 2026-10-13 by [increment 74](#increment-74).', '2026-10-13'],
    ['Proposed on 2026-10-13; scope agreed, not implemented.', '2026-10-13'],
    ['Investigation delivered on 2026-09-20 in the commit recorded below', '2026-09-20'],
    ['Implemented on 2026-09-30 after increment 20', '2026-09-30'],
    ['Proposed on 2026-10-01; implemented on 2026-10-05', '2026-10-01'],
    ['Implemented on 2026-02-30, then on 2026-03-01', '2026-03-01'],
    ['Confirmed', undefined], ['Proposed after 74, using delivered 24 and 34', undefined], ['Proposed; independent, can be brought forward.', undefined],
    ['Released 2026-10-13', undefined], ['Implemented on 2026-02-30', undefined],
  ];
  for (const [value, expected] of cases) assert.equal(findStatusDate(value, pattern())?.value, expected, value);
  assert.deepEqual(findStatusDate('Implemented on 2026-10-13.', pattern()), { value: '2026-10-13', text: 'on 2026-10-13', offset: 12, end: 25 });
});

test('dated statuses get exact ranges, dates never leak between sections, and rules can be disabled', () => {
  const documents = { 'spec.md': '# REQ-001 First\n\nStatus: Implemented on 2026-10-13.\n\n# REQ-002 Second\n\nStatus: Confirmed\n\nWritten on 2026-01-01 elsewhere.\n' };
  const statusOf = (index: ReturnType<typeof indexed>, id: string) => index.definitions.find(item => item.id === id)!.authoredStatus!.evidence[0];
  const index = indexed(documents);
  const first = statusOf(index, 'REQ-001');
  assert.deepEqual([first.date?.value, documents['spec.md'].slice(first.date!.offset, first.date!.end)], ['2026-10-13', 'on 2026-10-13']);
  assert.equal(statusOf(index, 'REQ-002').date, undefined);
  const off = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, dates: { statusDates: { enabled: false } } });
  assert.equal(statusOf(indexed(documents, off), 'REQ-001').date, undefined);
  assert.equal(statusOf(indexed(documents, validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, dates: { exclude: ['spec.md'] } })), 'REQ-001').date, undefined);
  const bare = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, dates: { statusDates: { pattern: '(?<date>\\d{4}-\\d{2}-\\d{2})' } } });
  assert.equal(statusOf(indexed({ 'a.md': '# REQ-001 A\n\nStatus: Released 2026-10-13\n' }, bare), 'REQ-001').date?.text, '2026-10-13');
});

test('events record their owning ID section and referenced IDs; ownership ends at the next heading', () => {
  const text = ['Intro.', '- 2026-09-01: Before any heading mentions REQ-001.', '', '# REQ-001 Requirement', '', '- 2026-10-01: Drafted with DD-001', '  and REQ-001 again.',
    '> - 2026-10-02: Quoted, ignored.', '```', '- 2026-10-03: Fenced, ignored.', '```', '## Notes', '- 2026-10-04: Under a plain heading.', '', '# DD-001 Design', '1. 2026-10-05 Numbered entry.'].join('\n');
  const index = indexed({ 'log.md': text });
  assert.deepEqual(index.events!.map(event => [event.date.value, event.owner, event.mentioned]), [
    ['2026-09-01', undefined, ['REQ-001']], ['2026-10-01', 'REQ-001', ['DD-001', 'REQ-001']], ['2026-10-04', undefined, []], ['2026-10-05', 'DD-001', []]]);
  const drafted = index.events![1];
  assert.equal(drafted.text, 'Drafted with DD-001\nand REQ-001 again.');
  assert.equal(text.slice(drafted.date.offset, drafted.date.end), '2026-10-01');
  assert.equal(text.slice(drafted.offset, drafted.end), '- 2026-10-01: Drafted with DD-001\n  and REQ-001 again.');
  const off = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, dates: { events: { enabled: false } } });
  assert.deepEqual(indexed({ 'log.md': text }, off).events, []);
});

test('events keep the increment 74 timeline semantics on its fixtures', () => {
  // These expectations were the timeline plugin's own output before increment 25 moved extraction into the model.
  const notes = ['# REQ-001 - Timeline fixture', 'Last updated: 2020-01-01', '- 2026-09-15: Later REQ-001', '- 2025-02-28: Earlier', '  Continued DD-001', '- 2025-02-30: Invalid', '> - 2024-01-01: Quoted', '```md', '- 2024-01-01: Fenced', '```', '- Undated entry'].join('\n');
  assert.deepEqual(documentEvents('notes.md', notes).map(event => [event.date.value, event.text, notes.slice(event.offset, event.end)]), [
    ['2026-09-15', 'Later REQ-001', '- 2026-09-15: Later REQ-001'], ['2025-02-28', 'Earlier\nContinued DD-001', '- 2025-02-28: Earlier\n  Continued DD-001']]);
  const nested = ['- 2025-02-28: Nested same day', '- 2024-02-29: Leap day TASK-007', '- 2026-09-15: Later REQ-001', ''].join('\n');
  assert.deepEqual(documentEvents('specs/notes.md', nested).map(event => [event.date.value, nested.slice(event.offset, event.end)]), [
    ['2025-02-28', '- 2025-02-28: Nested same day'], ['2024-02-29', '- 2024-02-29: Leap day TASK-007'], ['2026-09-15', '- 2026-09-15: Later REQ-001']]);
  const blank = '- 2026-01-01: Entry\n\n  continued after a blank line\n- 2026-01-02 no separator\n';
  assert.deepEqual(documentEvents('blank.md', blank).map(event => [event.date.value, event.text]), [['2026-01-01', 'Entry\n\ncontinued after a blank line'], ['2026-01-02', 'no separator']]);
});

test('the project model exposes events and status dates, dated statuses are not repeated as events, and nothing is shown while indexing', () => {
  const documents = { 'spec.md': '# REQ-001 First\n\nStatus: Implemented on 2026-10-13.\n\n- 2026-10-14: Follow-up REQ-002\n\n# REQ-002 Second\n' };
  const snapshot = { projectId: 'p', revision: 2, ready: true, notice: '', documents, configuration: LEGACY_ID_CONFIGURATION, folders: [], files: [], index: indexed(documents), warnings: [] };
  const project = modelsFor(snapshot).project;
  assert.deepEqual(project.events.map(event => [event.date.value, event.date.rule, event.owner, event.mentionedIds, event.text]), [['2026-10-14', 'event', 'REQ-001', ['REQ-002'], 'Follow-up REQ-002']]);
  assert.equal(project.ids.find(item => item.key === 'REQ-001')!.status!.occurrences[0].date?.value, '2026-10-13');
  assert.deepEqual(modelsFor({ ...snapshot, ready: false }).project.events, []);
});

test('dated headings become milestones labelled by their text without the date', () => {
  const cases: [string, string | undefined][] = [
    ['[0.23.2] - 2026-05-22', '[0.23.2]'], ['Increment 1 progress — 2026-09-12', 'Increment 1 progress'], ['Current Stack (2025-12-02)', 'Current Stack'],
    ['Revision 2025-12-10: Simplified Plugin Approach', 'Revision: Simplified Plugin Approach'], ['Session 2025-11-21', 'Session'], ['2026-10-14', undefined]];
  for (const [heading, label] of cases) assert.equal(headingLabel(heading, heading.match(/\d{4}-\d{2}-\d{2}/)![0]) || undefined, label, heading);
  const text = ['# REQ-001 2026-01-05 Kick-off', '', '## [1.0.0] - 2026-02-01', '- Added things', '', '### Session 2026-02-03', '', '```', '## [0.9.0] - 2026-01-01', '```',
    '> ## Quoted 2026-01-02', '## Not a date 2026-02-30', 'Prose mentions 2026-03-01 inline.'].join('\n');
  const events = indexed({ 'CHANGELOG.md': text }).events!;
  assert.deepEqual(events.map(event => [event.date.value, event.site, event.kind, event.label, event.owner]), [
    ['2026-01-05', 'heading', 'milestone', 'REQ-001 Kick-off', 'REQ-001'], ['2026-02-01', 'heading', 'milestone', '[1.0.0]', undefined], ['2026-02-03', 'heading', 'milestone', 'Session', undefined]]);
  const release = events[1];
  assert.equal(text.slice(release.date.offset, release.date.end), '2026-02-01');
  assert.equal(text.slice(release.offset, release.end), '## [1.0.0] - 2026-02-01');
});

test('heading, list-entry, field, and status dates are found with CRLF line endings, with the same ranges as LF (increment 87a)', () => {
  const lines = ['# Changelog', '', '**Created**: 2025-12-08', '', '## [1.0.0] - 2026-02-01', '', '### DD-001 - Decision', '', 'Status: Confirmed on 2026-02-02.', 'Related requirements: REQ-001.', '',
    '- 2026-02-03: Follow-up for DD-001', '  continued', '- 2026-02-04: Last entry', ''];
  const found = (eol: string) => {
    const text = lines.join(eol), result = indexed({ 'CHANGELOG.md': text });
    return { events: result.events!.map(event => [event.date.value, event.site, event.label, event.text, text.slice(event.date.offset, event.date.end), text.slice(event.offset, event.end)]),
      status: result.definitions.find(d => d.id === 'DD-001')!.authoredStatus!.evidence.map(e => [e.value, e.date?.value]) };
  };
  const lf = found('\n'), crlf = found('\r\n');
  assert.deepEqual(lf.events.map(event => [event[0], event[1]]), [['2025-12-08', 'field'], ['2026-02-01', 'heading'], ['2026-02-03', 'list-entry'], ['2026-02-04', 'list-entry']]);
  assert.deepEqual(lf.status, [['Confirmed on 2026-02-02.', '2026-02-02']]);
  // CRLF ranges cover the same text, apart from the \r inside a multi-line list entry.
  assert.deepEqual(crlf.events.map(event => event.map(part => typeof part === 'string' ? part.replace(/\r/g, '') : part)), lf.events);
  assert.equal(crlf.events[1][5], '## [1.0.0] - 2026-02-01');
  assert.equal(crlf.events[3][5], '- 2026-02-04: Last entry');
  assert.deepEqual(crlf.status, lf.status);
});

test('labelled fields become milestones or snapshots named by the document title', () => {
  const spec = ['# Feature Specification: Swift Version Compatibility Table', '', '**Feature Branch**: `002-swift-version-compat`  ', '**Created**: 2025-12-12  ', '**Status**: Complete',
    '**Last Updated**: 2026-06-05', 'Date: 2025-12-13', '**Ratified:** 2025-12-02', '- **Created**: 2025-01-01 in a list is not a field', '> **Created**: 2025-01-02 quoted', '**Dates**: 2025-01-03', '**Created**: 2025-02-30'].join('\n');
  const events = indexed({ 'specs/002/spec.md': spec }).events!;
  assert.deepEqual(events.map(event => [event.date.value, event.site, event.kind, event.label, event.text]), [
    ['2025-12-12', 'field', 'milestone', 'Created', 'Feature Specification: Swift Version Compatibility Table'], ['2025-12-13', 'field', 'milestone', 'Date', 'Feature Specification: Swift Version Compatibility Table'],
    ['2025-12-02', 'field', 'milestone', 'Ratified', 'Feature Specification: Swift Version Compatibility Table']]);
  assert.equal(spec.slice(events[0].date.offset, events[0].date.end), '2025-12-12');
  // Snapshots appear only when their rule is enabled; a document without a level-one heading is named by its path.
  const snapshots = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, dates: { rules: [{ key: 'last-updated', site: 'field', label: 'Last Updated', kind: 'snapshot' }] } });
  assert.deepEqual(indexed({ 'roadmap/phase-0.md': '**Last Updated**: 2025-12-26\n' }, snapshots).events!.map(event => [event.kind, event.label, event.text]), [['snapshot', 'Last Updated', 'roadmap/phase-0.md']]);
  assert.equal(documentTitle('Intro\n```\n# Fenced\n```\n# Real title\n'), 'Real title');
  // A field inside an ID's section belongs to that ID.
  assert.equal(indexed({ 'adr.md': '# DD-001 Use SQLite\n\n**Date**: 2026-01-10\n' }).events![0].owner, 'DD-001');
});

test('date exclusions remove dates from vendored files while their IDs stay indexed', () => {
  const documents = { 'CHANGELOG.md': '## [1.0.0] - 2026-02-01\n', 'Vendor/lib/CHANGELOG.md': '## [9.9.9] - 2020-01-01\n\n# REQ-900 Vendored\n\n- 2020-01-02: Upstream entry\n' };
  const configuration = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, dates: { exclude: ['Vendor'] } });
  const index = indexed(documents, configuration);
  assert.deepEqual(index.events!.map(event => event.file), ['CHANGELOG.md']);
  assert.ok(index.definitions.some(item => item.id === 'REQ-900'));
  assert.equal(indexed(documents).events!.length, 3);
});
