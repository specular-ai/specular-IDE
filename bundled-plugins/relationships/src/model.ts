import type { Models } from '@specular/plugin-api';
import { setIdentities } from './id-identity.js';

/** Plugin-local projection; every location is derived from public UTF-16 ranges. */
export interface Occurrence {
  category?: { key: string; name: string; role?: 'requirement' | 'design' | 'task' };
  id: string; kind: 'definition' | 'reference'; label: string;
  file: string; offset: number; end: number; line: number; column: number;
}
/** A link recorded by the project model: `to` is mentioned in the section defining `from`. */
export interface Link { from: string; to: string; evidence: Occurrence[] }
export interface ProjectIndex {
  configurationRevision?: string; definitions: Occurrence[]; references: Occurrence[]; findings: never[]; diagrams: never[];
  /** The model's relationships, with evidence resolved to the reference occurrences above. */
  links: Link[]; linkOf: Map<Occurrence, Link>; unownedMentions: number;
}
export function projectIndex(models: Models): ProjectIndex {
  const project = models.project!;
  setIdentities(project.occurrences);
  const documents = new Map(models.physical!.documents.map(d => [d.file, d.text]));
  const occurrences: Occurrence[] = project.ready ? project.occurrences.map(o => {
    const before = documents.get(o.source.file)!.slice(0, o.source.start);
    return { ...(o.category ? { category: o.category } : {}), id: o.key ?? o.id, kind: o.kind, label: o.label, file: o.source.file, offset: o.source.start, end: o.source.end,
      line: before.split('\n').length, column: o.source.start - before.lastIndexOf('\n') };
  }) : [];
  const references = occurrences.filter(o => o.kind === 'reference');
  // Links come from the project model; this plugin no longer derives them from section ownership.
  const byPosition = new Map(references.map(o => [`${o.file}:${o.offset}:${o.end}`, o]));
  const linkOf = new Map<Occurrence, Link>();
  const links = project.ready ? project.relationships.map(r => {
    const link: Link = { from: r.from, to: r.to, evidence: [] };
    for (const source of r.evidence) {
      const reference = byPosition.get(`${source.file}:${source.start}:${source.end}`);
      if (reference) { link.evidence.push(reference); linkOf.set(reference, link); }
    }
    return link;
  }) : [];
  return { configurationRevision: project.provenance.configurationRevision, definitions: occurrences.filter(o => o.kind === 'definition'), references, findings: [], diagrams: [],
    links, linkOf, unownedMentions: project.ready ? project.unownedMentions : 0 };
}
