import { previewFolderGenerators, stageFolderUpdate } from '../core/folder-generators';
import { discoverIds } from '../core/id-discovery';
import { classifyDiscoveryCategory } from '../core/discovery-category-classification';
import { overridesForCategories } from '../core/category-overrides';
import { indexProject, type DocumentCache } from '../core/project-index';
import { LEGACY_ID_CONFIGURATION, matchesIds, ruleRegex, validateIdConfiguration } from '../core/id-configuration';
import type { IndexRequest } from '../core/index-worker';
const cache: DocumentCache = new Map();
let configurationRevision: string | undefined;
self.onmessage = (event: MessageEvent<IndexRequest>) => {
  const { revision, documents, configuration } = event.data;
  try {
    if (event.data.removeCategoryKeys) {
      if (!configuration) throw new Error('Category removal needs a configuration draft.');
      self.postMessage({ revision, removedOverrideIds: overridesForCategories(configuration, event.data.removeCategoryKeys) }); return;
    }
    if (event.data.classify) {
      if (!configuration) throw new Error('Discovery classification needs a configuration draft.');
      const draft = validateIdConfiguration(configuration), proposal = event.data.classify;
      const rules = draft.rules.filter(matchesIds).map(rule => ({ rule, regex: ruleRegex(rule) }));
      for (const item of rules) if (item.regex.test('')) throw new Error('An ID recognition rule matches empty text. Adjust it before discovery.');
      const classifications = proposal.suggestions.map(suggestion => classifyDiscoveryCategory(draft, suggestion, { owners: suggestion.evidence.map(evidence => rules.filter(item => {
        item.regex.lastIndex = 0; const match = item.regex.exec(evidence.id);
        return match?.index === 0 && match[0].length === evidence.id.length;
      }).map(item => item.rule.category)) }, proposal.suggestions));
      self.postMessage({ revision, classifications }); return;
    }
    if (event.data.discover) { self.postMessage({ revision, inventory: discoverIds(documents) }); return; }
    if (configurationRevision !== event.data.configurationRevision) { cache.clear(); configurationRevision = event.data.configurationRevision; }
    const index = { ...indexProject(documents, configuration, cache), configurationRevision };
    if (event.data.updateFolders) {
      const result = stageFolderUpdate(configuration ?? LEGACY_ID_CONFIGURATION, event.data.updateFolders, Object.keys(documents), index);
      self.postMessage({ revision, folderPreview: result.preview, folderConfiguration: result.configuration }); return;
    }
    if (event.data.folderGenerators) {
      self.postMessage({ revision, folderPreview: previewFolderGenerators(event.data.folderGenerators, Object.keys(documents), index, configuration ?? LEGACY_ID_CONFIGURATION, event.data.previousFolders) }); return;
    }
    self.postMessage({ revision, index });
  } catch (error) { cache.clear(); self.postMessage({ revision, error: String(error) }); }
};
