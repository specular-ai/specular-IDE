import { idKey } from './id-identity';
import type { Occurrence, ProjectIndex } from '../shared/types';

export interface RelationshipEvidence { from: string; to: string; reference: Occurrence }
export interface RelationshipGroup {
  id: string;
  definition?: Occurrence;
  definitionCount: number;
  evidence: RelationshipEvidence[];
}
const categories = new WeakMap<ProjectIndex, Map<string, NonNullable<Occurrence['category']>>>();
/** Indexed metadata is authoritative, including categories with no semantic role. */
export function categoryFor(index: ProjectIndex, id: string) {
  let map = categories.get(index);
  if (!map) {
    map = new Map();
    for (const item of [...index.definitions, ...index.references]) if (item.category) map.set(idKey(item), item.category);
    categories.set(index, map);
  }
  return map.get(id);
}
export function relationshipRole(id: string, index?: ProjectIndex) {
  const category = index && categoryFor(index, id);
  if (category || index?.configurationRevision !== undefined) return category?.role;
  return /^(REQ|DD|TASK)-\d+$/.test(id) ? ({ REQ: 'requirement', DD: 'design', TASK: 'task' } as const)[id.split('-')[0] as 'REQ' | 'DD' | 'TASK'] : undefined;
}
export function supportsRelationships(id: string, index?: ProjectIndex) { return relationshipRole(id, index) !== undefined; }

/** Pair requirement/design and design/task roles while preserving authored direction and every evidence location. */
export function relationshipsFor(index: ProjectIndex, id: string) {
  const groups = new Map<string, RelationshipGroup>();
  const definitions = new Map<string, Occurrence[]>();
  for (const item of index.definitions) definitions.set(idKey(item), [...(definitions.get(idKey(item)) ?? []), item]);
  if (supportsRelationships(id, index)) for (const reference of index.references) {
    const from = (reference.owner && idKey(reference.owner)), to = idKey(reference);
    if (!from || !isRelationshipPair(from, to, index)) continue;
    if (from !== id && to !== id) continue;
    const other = from === id ? to : from;
    let group = groups.get(other);
    if (!group) {
      const targets = definitions.get(other) ?? [];
      group = { id: other, definition: targets.length === 1 ? targets[0] : undefined, definitionCount: targets.length, evidence: [] };
      groups.set(other, group);
    }
    group.evidence.push({ from, to, reference });
  }
  return { definitionCount: definitions.get(id)?.length ?? 0, groups: [...groups.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })) };
}

/** Focus deliberately excludes direct REQ/TASK links; Overview retains all pairs. */
export function isRelationshipPair(from: string, to: string, index?: ProjectIndex) {
  return supportsRelationships(from, index) && supportsRelationships(to, index)
    && (relationshipRole(from, index) === 'design') !== (relationshipRole(to, index) === 'design');
}

/** Expand only through unique decisions, never through an ambiguous focus or bridge. */
export function relatedThroughDecisions(index: ProjectIndex, id: string, decisions: RelationshipGroup[], file = '') {
  if (!supportsRelationships(id, index) || relationshipRole(id, index) === 'design' || index.definitions.filter(item => idKey(item) === id).length !== 1) return [];
  const targetRole = relationshipRole(id, index) === 'requirement' ? 'task' : 'requirement';
  return decisions.filter(group => relationshipRole(group.id, index) === 'design' && group.definitionCount === 1).flatMap(decision =>
    relationshipsFor(index, decision.id).groups.filter(group => relationshipRole(group.id, index) === targetRole)
      .map(group => ({ ...group, anchor: decision.id, key: `${decision.id}/${group.id}`,
        evidence: group.evidence.filter(item => !file || item.reference.file === file) }))
      .filter(group => group.evidence.length));
}
