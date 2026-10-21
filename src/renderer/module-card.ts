import type { ModuleAssignment, SourceLocation } from '../shared/types';
import { idLabel } from '../core/id-identity';
export function moduleBadges(assignment: ModuleAssignment) {
  const row = document.createElement('span'); row.className = 'module-badges'; row.setAttribute('aria-label', 'Application modules');
  const names = assignment.state === 'assigned' ? assignment.modules.map(module => module.name) : [assignment.state === 'conflict' ? 'Module conflict' : 'Unassigned'];
  for (const name of names) { const badge = document.createElement('span'); badge.className = 'module-badge'; badge.textContent = name; row.append(badge); }
  return row;
}
export function moduleEvidence(assignment: ModuleAssignment, navigate: (source: SourceLocation) => void, scope?: string) {
  const details = document.createElement('details'); details.className = 'module-evidence'; const summary = document.createElement('summary'); summary.textContent = 'Modules'; details.append(summary);
  for (const evidence of assignment.evidence) {
    const prefix = evidence.kind === 'file-rule' ? `File rule ${evidence.rule}: ${evidence.path} (${evidence.scope})` : evidence.kind === 'id-override' ? `Exact-ID override: ${idLabel({ id: evidence.id!, scope })}` : 'No file rule or override';
    const text = `${prefix} \u2192 ${evidence.modules.map(module => module.name).join(', ') || 'Unassigned'}`;
    const row = document.createElement('p'); row.textContent = text;
    if (evidence.kind !== 'unassigned') row.title = '.specular/project.json';
    if (evidence.source) {
      const source = evidence.source; const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.textContent = `${source.file}:${source.line}`; button.onclick = () => navigate(source); row.append(button);
    }
    details.append(row);
  }
  return details;
}
