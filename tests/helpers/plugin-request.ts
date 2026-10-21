import { API_VERSION, type IdElement, type IdOccurrence, type ProjectConfiguration, type ProjectEvent, type ProjectRelationship, type RenderRequest } from '../../packages/plugin-api/src/index';

export interface RequestOptions {
  projectId?: string; revision?: number; viewId?: string; ready?: boolean; currentFile?: string; configurationRevision?: string;
  documents?: { file: string; text: string }[]; occurrences?: IdOccurrence[]; folders?: string[]; warnings?: string[];
  ids?: IdElement[]; configuration?: ProjectConfiguration; relationships?: ProjectRelationship[]; unownedMentions?: number; events?: ProjectEvent[];
}
/** A complete host request: both models, with the project model ready unless stated. */
export function hostRequest(options: RequestOptions = {}): RenderRequest {
  const revision = options.revision ?? 1, documents = options.documents ?? [{ file: 'file.md', text: 'REQ-001' }];
  return {
    apiVersion: API_VERSION, requestId: 'request', viewId: options.viewId ?? 'list',
    context: { projectId: options.projectId ?? 'opaque', revision, ...(options.currentFile === undefined ? {} : { currentFile: options.currentFile }) },
    models: {
      project: { name: 'project', version: 1, revision, ready: options.ready ?? true, warnings: [],
        provenance: { extractor: 'specular.project', extractorVersion: '1', ...(options.configurationRevision === undefined ? {} : { configurationRevision: options.configurationRevision }) },
        occurrences: options.occurrences ?? [], ids: options.ids ?? [], relationships: options.relationships ?? [], unownedMentions: options.unownedMentions ?? 0, events: options.events ?? [], configuration: options.configuration ?? { categories: [], statuses: [], modules: [], features: [] } },
      physical: { name: 'physical', version: 1, revision, ready: true, warnings: options.warnings ?? [],
        provenance: { extractor: 'specular.physical', extractorVersion: '1' },
        folders: options.folders ?? [], files: documents.map(document => ({ path: document.file, markdown: true })), documents },
    },
  };
}
/** Replace one model's fields while keeping the rest of the request. */
export function withProject(request: RenderRequest, patch: Record<string, unknown>): RenderRequest {
  return { ...request, models: { ...request.models, project: { ...request.models.project!, ...patch } as never } };
}
export function withPhysical(request: RenderRequest, patch: Record<string, unknown>): RenderRequest {
  return { ...request, models: { ...request.models, physical: { ...request.models.physical!, ...patch } as never } };
}
