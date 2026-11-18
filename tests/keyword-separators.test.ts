import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { validateIdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, mergeProposal, validateProposal, type ConventionProposal } from '../src/core/id-discovery';

// Increment 102: keyword suggestions take the separator their headings use.
const proposal = (documents: Record<string, string>) => validateProposal(JSON.parse(JSON.stringify(candidateProposal(discoverIds(documents)))), documents);
const named = (p: ConventionProposal, name: string) => p.suggestions.filter(item => item.category.name === name);
const defined = (documents: Record<string, string>, p: ConventionProposal, name: string) => {
  const index = indexProject(documents, validateIdConfiguration(mergeProposal({ version: 1, categories: [], rules: [] }, p)));
  return index.definitions.filter(item => item.category?.name === name).map(item => item.id);
};

const steps: Record<string, string> = {
  'tests/a.md': '# Plan A\n\n### Test Steps - Save\n\nText.\n\n### Test Steps - Load\n\n### Test Steps - Delete\n',
  'tests/b.md': '# Plan B\n\n### Test Steps - Export\n\n### Test Steps - Import\n',
};

test('a hyphen-separated keyword is proposed with separator "-" and defines its headings once staged', () => {
  const p = proposal(steps), [suggestion] = named(p, 'Test Steps');
  assert.ok(suggestion, JSON.stringify(p.suggestions.map(s => s.category.name)));
  assert.deepEqual(suggestion.category.idDefinitionSites?.headings, { enabled: true, levels: [3], mode: 'keyword', keyword: 'Test Steps', separator: '-' });
  assert.match(suggestion.uncertainty, /Keyword headings "Test Steps - <name>": 5 headings in 2 files/);
  assert.deepEqual(defined(steps, p, 'Test Steps').sort(), ['Delete', 'Export', 'Import', 'Load', 'Save']);
});

test('em and en dashes are kept as separators', () => {
  const documents = {
    'a.md': '# A\n\n## Fact Tables — Sales\n\n## Fact Tables — Stock\n\n## Fact Tables — Returns\n',
    'b.md': '# B\n\n## Fact Tables — Orders\n\n## Rule – One\n\n## Rule – Two\n',
    'c.md': '# C\n\n## Rule – Three\n',
  };
  const p = proposal(documents);
  assert.equal(named(p, 'Fact Tables')[0].category.idDefinitionSites?.headings.separator, '—');
  assert.equal(named(p, 'Rule')[0].category.idDefinitionSites?.headings.separator, '–');
  assert.deepEqual(defined(documents, p, 'Fact Tables').sort(), ['Orders', 'Returns', 'Sales', 'Stock']);
  assert.deepEqual(defined(documents, p, 'Rule').sort(), ['One', 'Three', 'Two']);
});

test('mixed separators use the majority and report the headings left out', () => {
  const documents = {
    'a.md': '# A\n\n## Backend — Auth\n\n## Backend — Billing\n\n## Backend: Search\n',
    'b.md': '# B\n\n## Backend — Mail\n\n## Backend — Jobs\n\n## Backend: Cache\n',
  };
  const p = proposal(documents), [backend] = named(p, 'Backend');
  assert.equal(named(p, 'Backend').length, 1);
  assert.equal(backend.category.idDefinitionSites?.headings.separator, '—');
  assert.match(backend.uncertainty, /"Backend — <name>": 4 headings in 2 files at level 2\..* 2 other Backend headings use another separator and are left out\./);
  assert.deepEqual(defined(documents, p, 'Backend').sort(), ['Auth', 'Billing', 'Jobs', 'Mail']);
});

test('a minority separator below the thresholds is not proposed on its own', () => {
  const documents = {
    'a.md': '# A\n\n## Module - One\n\n## Module - Two\n',
    'b.md': '# B\n\n## Module - Three\n\n## Module: Four\n\n## Module: Five\n',
  };
  const p = proposal(documents), [module] = named(p, 'Module');
  assert.equal(module.category.idDefinitionSites?.headings.separator, '-');
  assert.match(module.uncertainty, /3 headings in 2 files.* 2 other Module headings use another separator and are left out\./);
});

test('colon keyword suggestions are unchanged: no separator, no left-out note', () => {
  const documents = {
    'a.md': '# A\n\n### Requirement: Login\n\n### Requirement: Logout\n',
    'b.md': '# B\n\n### Requirement: Reset\n',
  };
  const [requirement] = named(proposal(documents), 'Requirement');
  assert.deepEqual(requirement.category.idDefinitionSites?.headings, { enabled: true, levels: [3], mode: 'keyword', keyword: 'Requirement' });
  assert.match(requirement.uncertainty, /^Keyword headings "Requirement: <name>": 3 headings in 2 files at level 3\. The name after the keyword is the element's ID\. Delete it/);
});

test('the overlap warning compares names as the chosen separators read them', () => {
  const documents = {
    'a.md': '# A\n\n## Orders table — Items\n\n## Orders table — Totals\n\n## Members Table — Items\n',
    'b.md': '# B\n\n## Orders table — Notes\n\n## Members Table — Roles\n\n## Members Table — Notes\n',
  };
  const p = proposal(documents), [orders] = named(p, 'Orders table');
  assert.match(orders.uncertainty, /Members Table headings define the same names \("Items", "Notes"\)/);
});
