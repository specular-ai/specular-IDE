import type { FeatureAssignment, SourceLocation } from '../shared/types';
import { idLabel } from '../core/id-identity';
import type { Occurrence } from '../shared/types';
export function featureBadges(assignment: NonNullable<Occurrence['featureAssignment']>) {
  const row = document.createElement('span'); row.className = 'feature-badges'; row.setAttribute('aria-label', 'Application features');
  if (assignment.state === 'conflict') { const badge = document.createElement('span'); badge.className = 'feature-badge'; badge.textContent = 'Feature conflict'; row.append(badge); }
  for (const feature of assignment.features) {
    const badge = document.createElement('span'); badge.className = 'feature-badge'; badge.textContent = feature.name; badge.title = 'Feature: ' + feature.name; row.append(badge);
  }
  return row;
}

export function featureEvidence(assignment: FeatureAssignment, navigate: (source: SourceLocation) => void, scope?: string) {
  const details = document.createElement('details'); details.className = 'feature-evidence'; const summary = document.createElement('summary'); summary.textContent = 'Features'; details.append(summary);
  for (const evidence of assignment.evidence) {
    const prefix = evidence.kind === 'file-rule' ? `File rule ${evidence.rule}: ${evidence.path} (${evidence.scope})` : evidence.kind === 'id-override' ? `Exact-ID override: ${idLabel({ id: evidence.id!, scope })}` : 'No file rule or override';
    const text = `${prefix} \u2192 ${evidence.features.map(feature => feature.name).join(', ') || 'Unassigned'}`;
    const row = document.createElement('p'); row.textContent = text;
    if (evidence.kind !== 'unassigned') row.title = '.specular/project.json';
    if (evidence.source) {
      const source = evidence.source; const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = `${source.file}:${source.line}`; button.onclick = () => navigate(source); row.append(button);
    }
    details.append(row);
  }
  return details;
}
