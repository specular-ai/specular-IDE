import type { Occurrence, ProjectIndex } from './model.js';

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
    for (const item of [...index.definitions, ...index.references]) if (item.category) map.set(item.id, item.category);
    categories.set(index, map);
  }
  return map.get(id);
}
export function relationshipRole(id: string, index?: ProjectIndex) {
  const category = index && categoryFor(index, id);
  if (category || index?.configurationRevision !== undefined) return category?.role;
  return /^(REQ|DD|TASK)-\d+$/.test(id) ? ({ REQ: 'requirement', DD: 'design', TASK: 'task' } as const)[id.split('-')[0] as 'REQ' | 'DD' | 'TASK'] : undefined;
}
/** 100b: an ID takes part when its category is in a layer, so a category without a role can join through configured layers. */
export function supportsRelationships(id: string, index?: ProjectIndex) { return layerOf(id, index) !== undefined; }

/**
 * Increment 100a (DD-065): the traceability layers, in order, from the categories' roles. Focus draws one column per layer in use.
 * Configured layers (100b) replace this default; the index then carries them.
 */
export const DEFAULT_LAYERS = [
  { name: 'Requirements', role: 'requirement' },
  { name: 'Design decisions', role: 'design' },
  { name: 'Implementation tasks', role: 'task' },
] as const;
/** The position of an ID's layer, or undefined when its category is in no layer. 100b: the index's effective layers decide when present. */
export function layerOf(id: string, index?: ProjectIndex) {
  if (index?.layers) {
    const key = categoryFor(index, id)?.key;
    const layer = key === undefined ? -1 : index.layers.findIndex(item => item.categories.includes(key));
    return layer < 0 ? undefined : layer;
  }
  const role = relationshipRole(id, index), layer = DEFAULT_LAYERS.findIndex(item => item.role === role);
  return layer < 0 ? undefined : layer;
}
/** The names of the layers, in order. */
export function layerNames(index?: ProjectIndex): string[] { return index?.layers ? index.layers.map(item => item.name) : DEFAULT_LAYERS.map(item => item.name); }

/** Connections between layered IDs, preserving authored direction and every evidence location. */
export function relationshipsFor(index: ProjectIndex, id: string) {
  const groups = new Map<string, RelationshipGroup>();
  const definitions = new Map<string, Occurrence[]>();
  for (const item of index.definitions) definitions.set(item.id, [...(definitions.get(item.id) ?? []), item]);
  // Iterate references in index order so evidence keeps its authored order; the model's link supplies the endpoints.
  if (supportsRelationships(id, index)) for (const reference of index.references) {
    const link = index.linkOf.get(reference);
    if (!link) continue;
    const from = link.from, to = link.to;
    if (!isRelationshipPair(from, to, index)) continue;
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

/** 100a: any link between two layered IDs is a connection, including direct requirement/task links and links within a layer; Overview keeps every link. */
export function isRelationshipPair(from: string, to: string, index?: ProjectIndex) {
  return from !== to && layerOf(from, index) !== undefined && layerOf(to, index) !== undefined;
}

/**
 * 100a: the second hop. From a uniquely defined ID, continue through each uniquely defined direct neighbour in another layer
 * to the IDs it connects in layers further away in the same direction (requirement -> design -> task, or back).
 * Ambiguous IDs never bridge; with the default layers this is the former second hop through design decisions.
 */
export function relatedThroughNeighbours(index: ProjectIndex, id: string, neighbours: RelationshipGroup[], file = '') {
  const own = layerOf(id, index);
  if (own === undefined || index.definitions.filter(item => item.id === id).length !== 1) return [];
  return neighbours.filter(group => group.definitionCount === 1 && layerOf(group.id, index) !== undefined && layerOf(group.id, index) !== own).flatMap(bridge => {
    const at = layerOf(bridge.id, index)!, step = Math.sign(at - own);
    return relationshipsFor(index, bridge.id).groups.filter(group => group.id !== id && Math.sign((layerOf(group.id, index) ?? at) - at) === step)
      .map(group => ({ ...group, anchor: bridge.id, key: `${bridge.id}/${group.id}`,
        evidence: group.evidence.filter(item => !file || item.reference.file === file) }))
      .filter(group => group.evidence.length);
  });
}
