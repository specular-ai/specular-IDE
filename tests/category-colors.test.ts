import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIdConfiguration, compileIdMatcher, type IdCategory } from '../src/core/id-configuration';
import { categoryPalette, contrastRatio, categoryAccent } from '../src/shared/category-colors';
import { analyzeDocument, buildIndex } from '../src/core/documents';
const category: IdCategory = { key: 'needs', name: 'Business needs', role: 'requirement' };
const config = { version: 1, categories: [category], rules: [{ key: 'ref', category: 'needs', prefix: 'REF' }] };
test('category colors validate independently of rules, preserve old files, and normalize hex', () => {
  assert.equal(validateIdConfiguration(config).categories[0].colors, undefined);
  assert.deepEqual(validateIdConfiguration({ ...config, categories: [{ ...category, colors: { dark: '#FFCC00' } }] }).categories[0].colors, { dark: '#ffcc00' });
  for (const colors of [null, 'yellow', [], { light: '#fff' }, { dark: 'yellow' }, { dark: '#12345678' }, { light: 'url(x)' }, { light: 1 }, { light: '#123456', extra: '#ffffff' }]) {
    assert.throws(() => validateIdConfiguration({ ...config, categories: [{ ...category, colors }] }));
  }
});
test('extreme and saturated category colors keep readable normal and hover text in both themes', () => {
  for (const color of ['#000000', '#ffffff', '#ffcc00', '#ff0000', '#00ff00', '#0000ff', '#777777', '#888888']) for (const mode of ['light', 'dark'] as const) {
    const palette = categoryPalette({ ...category, colors: { [mode]: color } }, mode);
    assert.equal(palette.accent, color);
    assert.ok(contrastRatio(palette.foreground, palette.background) >= 4.5);
    assert.ok(contrastRatio(palette.foreground, palette.hover) >= 4.5);
  }
  assert.equal(categoryAccent({ ...category, colors: { dark: 'invalid' } }, 'dark'), categoryAccent(category, 'dark'));
});
test('palette changes preserve IDs, ranges, ownership, and diagnostics', () => {
  const text = '# REF-01 First\nREF-404\n# REF-01 Duplicate\n';
  const index = (colors?: IdCategory['colors']) => buildIndex([analyzeDocument('a.md', text, compileIdMatcher(validateIdConfiguration({ ...config, categories: [{ ...category, ...(colors ? { colors } : {}) }] })))]);
  const before = index(), after = index({ light: '#ffffff', dark: '#000000' });
  const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, value) => key === 'colors' ? undefined : value));
  assert.deepEqual(strip(after), strip(before));
  assert.deepEqual(after.findings.map(f => f.kind), ['duplicate', 'duplicate', 'unresolved']);
});
