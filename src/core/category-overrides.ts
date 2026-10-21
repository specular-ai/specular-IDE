import { idKey } from './id-identity';
import { matchesIds, ruleRegex, validateIdConfiguration, type IdConfiguration } from './id-configuration';

/** Runs in the bounded analysis worker: category regexes must never execute on the UI thread. */
export function overridesForCategories(configuration: IdConfiguration, keys: readonly string[]): string[] {
  const removed = new Set(keys);
  const overrides = [...(configuration.moduleOverrides ?? []), ...(configuration.featureOverrides ?? [])];
  if (!overrides.length) return [];
  // Unrelated draft fields (names, colors, module assignments) need not be valid to remove a category.
  const recognition = validateIdConfiguration({ version: 1,
    categories: configuration.categories.filter(category => removed.has(category.key)).map(category => ({ key: category.key, name: 'Category' })),
    rules: configuration.rules.filter(rule => removed.has(rule.category)),
  });
  const patterns = recognition.rules.filter(matchesIds).map(ruleRegex);
  return overrides.filter(override => patterns.some(pattern => {
    pattern.lastIndex = 0;
    const match = pattern.exec(override.id);
    return match?.index === 0 && match[0] === override.id;
  })).map(idKey);
}
