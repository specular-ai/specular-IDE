import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathFilter } from '../src/renderer/file-explorer';

const paths = ['README.md', 'specs/login.md', 'specs/api/auth.md', 'src/a.ts', 'docs/notes.markdown', 'specs/v1.2/plan.md'];
const matching = (query: string) => paths.filter(pathFilter(query));

test('plain text matches anywhere in the path, ignoring case', () => {
  assert.deepEqual(matching('LOGIN'), ['specs/login.md']);
  assert.deepEqual(matching('specs/'), ['specs/login.md', 'specs/api/auth.md', 'specs/v1.2/plan.md']);
});

test('a wildcard without a slash matches file names in any folder', () => {
  assert.deepEqual(matching('*.md'), ['README.md', 'specs/login.md', 'specs/api/auth.md', 'specs/v1.2/plan.md']);
  assert.deepEqual(matching('*.MD'), matching('*.md'));
  assert.deepEqual(matching('a*'), ['specs/api/auth.md', 'src/a.ts']);
  assert.deepEqual(matching('?.ts'), ['src/a.ts']);
});

test('a wildcard with a slash matches the whole path; * stays in a folder and ** crosses folders', () => {
  assert.deepEqual(matching('specs/*.md'), ['specs/login.md']);
  assert.deepEqual(matching('specs/**/*.md'), ['specs/login.md', 'specs/api/auth.md', 'specs/v1.2/plan.md']);
  assert.deepEqual(matching('**/auth.*'), ['specs/api/auth.md']);
});

test('regular-expression characters in a pattern are literal', () => {
  assert.deepEqual(matching('specs/v1.2/*'), ['specs/v1.2/plan.md']);
  assert.deepEqual(matching('*(*'), []);
});
