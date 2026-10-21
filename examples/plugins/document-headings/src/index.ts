import type { PluginModule, RenderRequest, RenderResult, SourceReference } from '@specular/plugin-api';

const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function renderHeadings(request: RenderRequest): RenderResult['model'] {
  // Headings come from current document text, so only the physical model is needed.
  const document = request.models.physical!.documents.find(item => item.file === request.context.currentFile);
  if (!document) return { kind: 'list', items: [] };
  const items: { id: string; title: string; description: string; sources: SourceReference[] }[] = [];
  let offset = 0;
  for (const line of document.text.split('\n')) {
    const match = heading.exec(line);
    if (match) {
      const source: SourceReference = { projectId: request.context.projectId, revision: request.context.revision, file: document.file, start: offset, end: offset + line.length };
      items.push({ id: `heading-${items.length + 1}`, title: match[2], description: `Level ${match[1].length}`, sources: [source] });
    }
    offset += line.length + 1;
  }
  return { kind: 'list', items };
}

export const render: PluginModule['render'] = request => {
  if (request.viewId !== 'headings') throw new Error('Unknown view.');
  return { apiVersion: request.apiVersion, requestId: request.requestId, viewId: request.viewId, projectId: request.context.projectId, revision: request.context.revision, model: renderHeadings(request) };
};
