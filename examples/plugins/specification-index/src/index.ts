import type { PluginModule, RenderRequest, RenderResult } from '@specular/plugin-api';

export function render(request: RenderRequest): RenderResult {
  if (request.viewId !== 'definitions') throw new Error('Unknown view.');
  const { context } = request, project = request.models.project!;
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    viewId: request.viewId,
    projectId: context.projectId,
    revision: context.revision,
    model: {
      kind: 'list',
      items: project.ready ? project.occurrences.filter(item => item.kind === 'definition').map(item => ({
        id: `${item.source.file}:${item.source.start}:${item.id}`,
        title: item.label.startsWith(item.id) ? item.label : `${item.id}: ${item.label}`,
        description: item.source.file,
        sources: [{ ...item.source, projectId: context.projectId, revision: context.revision }],
      })) : [],
    },
  };
}
// Check the entry contract without requiring SDK code at runtime.
const plugin = { render } satisfies PluginModule;
export default plugin;
