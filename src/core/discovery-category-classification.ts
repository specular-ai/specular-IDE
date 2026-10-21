import type { IdCategory, IdConfiguration, IdRule } from './id-configuration';
import type { ConventionSuggestion } from './id-discovery';

export type DiscoveryCategoryDecision =
  | { kind: 'existing'; category: string; reason: 'equivalent-rule' }
  | { kind: 'new'; reason: 'unrecognized-convention' | 'shared-proposal-category' }
  | { kind: 'ambiguous'; reason: 'display-name-collision' | 'partial-evidence-coverage' | 'multiple-existing-categories' | 'different-rule-for-existing-evidence' | 'equivalent-rule-evidence-mismatch' | 'proposal-category-collision' };

export interface DiscoveryCategoryEvidence {
  /** Existing draft category keys that recognize each evidence ID, computed in the bounded matcher. */
  owners: readonly (readonly string[])[];
}

function canonicalRule(rule: IdRule): string {
  const flags = rule.ignoreCase ? 'i' : '';
  if (rule.prefix !== undefined) return `stem:${flags}:${rule.prefix}${rule.separator ?? '-'}`;
  if (rule.list) return `list:${flags}:${JSON.stringify(rule.list)}`;
  if (rule.id !== undefined) return `template:${flags}:${JSON.stringify([rule.pattern, rule.id])}`;
  // Local discovery emits this exact regex form. Treating it like a prefix rule is a
  // syntax conversion, not a claim that arbitrary regular expressions are equivalent.
  const generated = /^\\b([A-Za-z][A-Za-z0-9_]*)([-_])?\\d\+\\b$/.exec(rule.pattern!);
  if (generated) return `stem:${flags}:${generated[1]}${generated[2] ?? ''}`;
  return `pattern:${flags}:${rule.pattern}`;
}

function categorySignature(category: IdCategory) {
  const headings = category.idDefinitionSites?.headings;
  if (headings?.mode === 'keyword' && headings.keyword) return `keyword:${headings.keyword.toLocaleLowerCase()}`;
  return category.derive ? `derive:${category.derive.pattern}` : undefined;
}
/**
 * Classify one reviewed suggestion without executing regular expressions.
 * Evidence ownership must come from the bounded recognition worker. Finite evidence
 * can expose disagreement, but can never prove two different rules equivalent.
 */
export function classifyDiscoveryCategory(
  draft: IdConfiguration,
  suggestion: ConventionSuggestion,
  evidence: DiscoveryCategoryEvidence,
  proposal: readonly ConventionSuggestion[] = [suggestion],
): DiscoveryCategoryDecision {
  // 85c: keyword and derived suggestions have no rule; an existing category with the same keyword or derive pattern is equivalent.
  if (!suggestion.rule) {
    const signature = categorySignature(suggestion.category);
    const owners = draft.categories.filter(category => categorySignature(category) === signature && signature !== undefined).map(category => category.key);
    if (owners.length > 1) return { kind: 'ambiguous', reason: 'multiple-existing-categories' };
    if (owners.length === 1) return { kind: 'existing', category: owners[0], reason: 'equivalent-rule' };
  }
  const signature = suggestion.rule && canonicalRule(suggestion.rule);
  const equivalentOwners = new Set(signature === undefined ? [] : draft.rules.filter(rule => canonicalRule(rule) === signature).map(rule => rule.category));
  if (equivalentOwners.size > 1) return { kind: 'ambiguous', reason: 'multiple-existing-categories' };

  const owners = evidence.owners.map(keys => new Set(keys));
  const recognized = owners.filter(keys => keys.size > 0);
  const recognizedCategories = new Set(recognized.flatMap(keys => [...keys]));
  if (recognized.some(keys => keys.size > 1) || recognizedCategories.size > 1) return { kind: 'ambiguous', reason: 'multiple-existing-categories' };
  if (evidence.owners.length !== suggestion.evidence.length) return { kind: 'ambiguous', reason: 'partial-evidence-coverage' };
  if (equivalentOwners.size === 1) {
    const category = [...equivalentOwners][0];
    if (owners.every(keys => keys.size === 1 && keys.has(category))) return { kind: 'existing', category, reason: 'equivalent-rule' };
    return { kind: 'ambiguous', reason: 'equivalent-rule-evidence-mismatch' };
  }
  if (recognized.length && recognized.length !== owners.length) return { kind: 'ambiguous', reason: 'partial-evidence-coverage' };
  if (recognized.length) return { kind: 'ambiguous', reason: 'different-rule-for-existing-evidence' };

  const sameKey = proposal.filter(item => item.category.key === suggestion.category.key);
  const metadata = (item: ConventionSuggestion) => JSON.stringify({ name: item.category.name, role: item.category.role, colors: item.category.colors, idDefinitionSites: item.category.idDefinitionSites });
  if (sameKey.some(item => metadata(item) !== metadata(suggestion))) {
    return { kind: 'ambiguous', reason: 'proposal-category-collision' };
  }

  const foldedName = suggestion.category.name.trim().toLocaleLowerCase();
  if (draft.categories.some(category => category.name.trim().toLocaleLowerCase() === foldedName)) {
    return { kind: 'ambiguous', reason: 'display-name-collision' };
  }
  if (proposal.some(item => item !== suggestion && item.category.key !== suggestion.category.key && item.category.name.trim().toLocaleLowerCase() === foldedName)) {
    return { kind: 'ambiguous', reason: 'display-name-collision' };
  }
  if (sameKey.length > 1) return { kind: 'new', reason: 'shared-proposal-category' };
  return { kind: 'new', reason: 'unrecognized-convention' };
}
