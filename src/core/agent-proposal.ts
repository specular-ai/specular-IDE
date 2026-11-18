import { MAX_SECTION_TAGS, newSectionTags, validateIdConfiguration, type IdCategory, type IdConfiguration, type IdRule } from './id-configuration';
import { addFolderGenerators, type FolderGenerator } from './folder-generators';

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
/** Whether a configuration proposes folder generators another lacks (96); keys are ignored, as staging assigns them. */
const generatorSet = (configuration: IdConfiguration) => new Set((configuration.folderGenerators ?? []).map(rule => JSON.stringify([rule.target, rule.pattern.toLowerCase(), [...rule.exclusions].sort()])));
export const proposedGenerators = (base: IdConfiguration, next: IdConfiguration): FolderGenerator[] => { const current = generatorSet(base); return (next.folderGenerators ?? []).filter(rule => !current.has(JSON.stringify([rule.target, rule.pattern.toLowerCase(), [...rule.exclusions].sort()]))); };
export const foldersChanged = (base: IdConfiguration, next: IdConfiguration) => proposedGenerators(base, next).length > 0;
/** Section tag entries a configuration adds (96h), per category: `existing` when the base already has the category, so its tags can be staged without it. */
export const proposedSectionTags = (base: IdConfiguration, next: IdConfiguration) => next.categories.flatMap(category => {
  const current = base.categories.find(item => item.key === category.key), entries = newSectionTags(current?.sectionTags, category.sectionTags);
  return entries.length ? [{ category: category.key, entries, existing: !!current }] : [];
});
export function sitesChanged(draft: IdConfiguration, proposed: IdConfiguration) { return JSON.stringify(draft.idDefinitionSites ?? null) !== JSON.stringify(proposed.idDefinitionSites ?? null); }

/** Parts of a proposal staged as a whole (87): the project-wide status sites and status list, and the date settings; the new folder generators (96) and section tags of existing categories (96h), which are only added. */
export interface ProposalParts { statuses?: boolean; dates?: boolean; folders?: boolean; tags?: boolean }
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
  // Section tags (96h) join categories the draft already has, selected or not; their own entries stay.
  if (parts.tags) for (const { category: key, entries, existing } of proposedSectionTags(draft, proposed)) {
    const index = next.categories.findIndex(item => item.key === key);
    if (!existing || index < 0) continue;
    // Unselected categories are the draft's own objects, so the tagged one is a copy.
    const category = next.categories[index] = structuredClone(next.categories[index]);
    category.sectionTags = [...category.sectionTags ?? [], ...newSectionTags(category.sectionTags, entries)];
    if (category.sectionTags.length > MAX_SECTION_TAGS) throw new Error(`${category.name} would have more than ${MAX_SECTION_TAGS} section tags. Clear Section tags, or delete some of its entries in Categories first.`);
  }
  // Folder generators (96) are added, never replaced or removed; staging then runs Update for their targets.
  return validateIdConfiguration(parts.folders ? addFolderGenerators(next, proposedGenerators(draft, proposed)).configuration : next);
}
