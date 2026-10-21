import { categoryFor } from './relationships.js';
import type { Occurrence, ProjectIndex } from './model.js';

export interface DependencyNode { id: string; kind: string; kindLabel?: string; definitions: Occurrence[] }
export interface DependencyEdge { key: string; from: string; to: string; evidence: Occurrence[] }
export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Map<string, DependencyEdge>;
  incoming: Map<string, DependencyEdge[]>;
  outgoing: Map<string, DependencyEdge[]>;
  unownedMentions: number;
}
export const dependencyKey = (from: string, to: string) => from.includes('>') || to.includes('>') || from.startsWith('@') || to.startsWith('@') ? JSON.stringify([from, to]) : `${from}>${to}`;

/** Complete recorded graph, independent of filters, paging, or a selected view. */
export function buildDependencyGraph(index: ProjectIndex): DependencyGraph {
  const graph: DependencyGraph = { nodes: new Map(), edges: new Map(), incoming: new Map(), outgoing: new Map(), unownedMentions: 0 };
  const node = (id: string) => {
    let value = graph.nodes.get(id);
    if (!value) {
      const category = categoryFor(index, id);
      value = { id, kind: category?.key ?? id.split('-')[0], ...(category ? { kindLabel: category.name } : {}), definitions: [] }; graph.nodes.set(id, value);
    }
    return value;
  };
  for (const definition of index.definitions) node(definition.id).definitions.push(definition);
  // Links and evidence come from the project model; only the view-specific indexes are built here.
  graph.unownedMentions = index.unownedMentions;
  for (const { from, to, evidence } of index.links) {
    node(from); node(to);
    const edge: DependencyEdge = { key: dependencyKey(from, to), from, to, evidence: [...evidence] }; graph.edges.set(edge.key, edge);
    const outgoing = graph.outgoing.get(from) ?? []; outgoing.push(edge); graph.outgoing.set(from, outgoing);
    const incoming = graph.incoming.get(to) ?? []; incoming.push(edge); graph.incoming.set(to, incoming);
  }
  return graph;
}

export interface DependencyFilter { file?: string; kind?: string; query?: string }
/** Select nodes, retaining cross-file/kind context in every incident edge. */
export function filterDependencies(graph: DependencyGraph, filter: DependencyFilter) {
  const query = filter.query?.trim().toLowerCase() ?? '';
  const nodes = [...graph.nodes.values()].filter(node => {
    const files = node.definitions.length ? node.definitions.map(item => item.file) :
      [...(graph.incoming.get(node.id) ?? []), ...(graph.outgoing.get(node.id) ?? [])].flatMap(edge => edge.evidence.map(item => item.file));
    return (!filter.kind || node.kind === filter.kind) && (!filter.file || files.includes(filter.file)) &&
      (!query || `${node.id} ${node.definitions.map(item => item.label + ' ' + item.file).join(' ')}`.toLowerCase().includes(query));
  }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const ids = new Set(nodes.map(node => node.id));
  const edges = [...graph.edges.values()].filter(edge => ids.has(edge.from) || ids.has(edge.to))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return { nodes, edges };
}

export type DependencyDirection = 'incoming' | 'outgoing';
/** One shortest recorded path per reachable ID. Never combine ambiguous definitions. */
export function dependencyPaths(graph: DependencyGraph, start: string, direction: DependencyDirection) {
  const parents = new Map<string, { previous: string; edge: DependencyEdge }>();
  const visited = new Set([start]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    if (graph.nodes.get(id)?.definitions.length !== 1) continue;
    for (const edge of graph[direction].get(id) ?? []) {
      const other = direction === 'outgoing' ? edge.to : edge.from;
      if (visited.has(other)) continue;
      visited.add(other); parents.set(other, { previous: id, edge }); queue.push(other);
    }
  }
  return {
    ids: [...parents.keys()],
    pathTo(id: string) {
      const path: DependencyEdge[] = [];
      for (let item = parents.get(id); item; item = parents.get(item.previous)) path.push(item.edge);
      return path.reverse();
    },
  };
}
