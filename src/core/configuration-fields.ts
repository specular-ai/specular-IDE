/** Where configuration fields belong, so a rejection can name a misplaced field (increment 92, DD-058). */
const CATEGORY_FIELDS = ['role', 'colors', 'idScopes', 'onlyInScopes', 'definitionPaths', 'idDefinitionSites', 'statusSites', 'parent', 'derive', 'deltas', 'nameReferences', 'changes'];
const RULE_FIELDS = ['category', 'prefix', 'separator', 'pattern', 'id', 'list', 'ignoreCase'];

/** `Unknown <where> field "key".`, with where the field belongs when it is a category or rule field. */
export function unknownField(where: string, key: string, allowed: string[]) {
  const hint = CATEGORY_FIELDS.includes(key) && !allowed.includes('name') ? ` ${key} is a category field; put it on the category.`
    : RULE_FIELDS.includes(key) && allowed.includes('name') ?` ${key} is a rule field; put it in a rule.` : '';
  return `Unknown ${where} field "${key}".${hint}`;
}
