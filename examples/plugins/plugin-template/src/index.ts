import type { PluginModule, RenderRequest } from '@specular/plugin-api';

export const render: PluginModule['render'] = (request: RenderRequest) => {
  if (request.viewId !== 'items') throw new Error('Unknown view.');
  // Declared models arrive under request.models; this template reads the project model.
  const items = request.models.project!.occurrences
    .filter(item => item.kind === 'definition')
    .map((item, index) => ({
      id: `definition-${index + 1}`,
      title: item.id,
      description: item.label,
      sources: [{ ...item.source, projectId: request.context.projectId, revision: request.context.revision }],
    }));
  return { apiVersion: request.apiVersion, requestId: request.requestId, viewId: request.viewId, projectId: request.context.projectId, revision: request.context.revision, model: { kind: 'list', items } };
};
