import { assignFeatures } from './features';
import { mapStatuses } from './statuses';
import { annotateDates, DEFAULT_DATE_SETTINGS } from './dates';
import { assignModules } from './modules';
import { analyzeDocument, buildIndex } from './documents';
import { compileIdMatcher, LEGACY_ID_CONFIGURATION, type IdConfiguration } from './id-configuration';
import type { DocumentModel, ProjectIndex } from '../shared/types';

export type DocumentCache = Map<string, { text: string; model: DocumentModel }>;
/** The configured recognition pipeline shared by Preview's worker and agent evaluation (86a). */
export function indexProject(documents: Record<string, string>, configuration?: IdConfiguration, cache: DocumentCache = new Map()): ProjectIndex {
  const match = compileIdMatcher(configuration ?? LEGACY_ID_CONFIGURATION);
  if (Object.values(documents).reduce((size, text) => size + text.length, 0) > 20 * 1024 * 1024) throw new Error('Markdown recognition exceeds the 20 MB project limit.');
  for (const path of cache.keys()) if (!(path in documents)) cache.delete(path);
  for (const [file, text] of Object.entries(documents)) {
    try {
      if (cache.get(file)?.text !== text) cache.set(file, { text, model: analyzeDocument(file, text, match) });
    } catch (error) { throw new Error(`${file}: ${error instanceof Error ? error.message : error}`); }
  }
  const models = [...cache.values()].map(value => value.model);
  if (models.reduce((total, model) => total + model.occurrences.length, 0) > 100000) throw new Error('Project recognition exceeds 100,000 occurrences.');
  // Date rules may be user regexes, so they run here with the other configured extraction (increment 79).
  return annotateDates(mapStatuses(assignFeatures(assignModules(buildIndex(models), configuration ?? LEGACY_ID_CONFIGURATION), configuration ?? LEGACY_ID_CONFIGURATION), configuration?.statuses ?? []), documents, configuration?.dates ?? DEFAULT_DATE_SETTINGS);
}
