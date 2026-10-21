import { validateIdConfiguration, type IdCategory, type IdConfiguration, type IdRule } from './id-configuration';

/** Review of an agent proposal (increment 86a): what each proposed category changes, and staging a selection into the draft. */
export type ProposalChange = 'new' | 'changed' | 'unchanged';
const ruleList = (configuration: IdConfiguration, key: string) => JSON.stringify(configuration.rules.filter(rule => rule.category === key).map(({ key: _key, ...rule }) => rule));
export function categoryChange(draft: IdConfiguration, proposed: IdConfiguration, key: string): ProposalChange {
  const current = draft.categories.find(category => category.key === key);
  if (!current) return 'new';
  const next = proposed.categories.find(category => category.key === key)!;
  return JSON.stringify(current) === JSON.stringify(next) && ruleList(draft, key) === ruleList(proposed, key) ? 'unchanged' : 'changed';
}
/** Whether a configuration changes the project-wide status settings (sites and list), or the date settings, of another (87). */
export const statusesChanged = (base: IdConfiguration, next: IdConfiguration) => JSON.stringify([base.statusSites ?? null, base.statuses ?? null]) !== JSON.stringify([next.statusSites ?? null, next.statuses ?? null]);
export const datesChanged = (base: IdConfiguration, next: IdConfiguration) => JSON.stringify(base.dates ?? null) !== JSON.stringify(next.dates ?? null);
export function sitesChanged(draft: IdConfiguration, proposed: IdConfiguration) { return JSON.stringify(draft.idDefinitionSites ?? null) !== JSON.stringify(proposed.idDefinitionSites ?? null); }

/** Parts of a proposal staged as a whole (87): the project-wide status sites and status list, and the date settings. */
export interface ProposalParts { statuses?: boolean; dates?: boolean }
const replaceField = (next: IdConfiguration, proposed: IdConfiguration, field: 'statusSites' | 'statuses' | 'dates') => {
  if (proposed[field] === undefined) delete next[field]; else Object.assign(next, { [field]: structuredClone(proposed[field]) });
};
/** Add or replace the selected categories with their rules; categories the proposal omits stay as they are. */
export function stageAgentProposal(draft: IdConfiguration, proposed: IdConfiguration, selected: Iterable<string>, includeSites: boolean, parts: ProposalParts = {}): IdConfiguration {
  const keys = new Set(selected);
  const categories: IdCategory[] = draft.categories.map(category => keys.has(category.key) ? structuredClone(proposed.categories.find(c => c.key === category.key)!) : category);
  for (const category of proposed.categories) if (keys.has(category.key) && !draft.categories.some(c => c.key === category.key)) categories.push(structuredClone(category));
  const rules: IdRule[] = draft.rules.filter(rule => !keys.has(rule.category));
  const used = new Set(rules.map(rule => rule.key));
  for (const rule of proposed.rules.filter(rule => keys.has(rule.category))) {
    let key = rule.key, n = 2; while (used.has(key)) key = `${rule.key}-${n++}`;
    used.add(key); rules.push({ ...structuredClone(rule), key });
  }
  for (const category of categories) {
    if (!keys.has(category.key)) continue;
    for (const reference of [category.parent, category.changes?.capabilities]) {
      if (reference && !categories.some(c => c.key === reference)) {
        const name = proposed.categories.find(c => c.key === reference)?.name ?? reference;
        throw new Error(`${category.name} refers to ${name}. Select ${name} too.`);
      }
    }
  }
  const next: IdConfiguration = { ...structuredClone(draft), categories, rules };
  if (includeSites) { if (proposed.idDefinitionSites) next.idDefinitionSites = structuredClone(proposed.idDefinitionSites); else delete next.idDefinitionSites; }
  if (parts.statuses) { replaceField(next, proposed, 'statusSites'); replaceField(next, proposed, 'statuses'); }
  if (parts.dates) replaceField(next, proposed, 'dates');
  return validateIdConfiguration(next);
}
