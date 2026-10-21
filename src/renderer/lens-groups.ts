import { idKey } from '../core/id-identity';
import { statusKey } from '../core/statuses';
import type { Occurrence } from '../shared/types';

export type LensGrouping = 'none' | 'status' | 'module' | 'feature';
export interface LensGroup { key: string; label: string; items: Occurrence[]; count: number }

/** Group the filtered definitions, retaining every source but counting scoped identities once. */
export function groupDefinitions(items: readonly Occurrence[], mode: Exclude<LensGrouping, 'none'>): LensGroup[] {
  const groups = new Map<string, LensGroup>();
  for (const item of items) {
    let memberships: { key: string; label: string }[];
    if (mode === 'status') {
      const status = item.authoredStatus, evidence = status?.evidence[0];
      const value = evidence?.display ?? evidence?.value;
      memberships = status?.state === 'conflict' ? [{ key: 'conflict', label: 'Status conflicts' }]
        : value ? [{ key: `value:${statusKey(value)}`, label: value }]
        : [{ key: 'missing', label: 'No status' }];
    } else {
      const assignment = mode === 'module' ? item.moduleAssignment : item.featureAssignment;
      const members = assignment ? ('modules' in assignment ? assignment.modules : assignment.features) : [];
      memberships = assignment?.state === 'conflict' ? [{ key: 'conflict', label: mode === 'module' ? 'Module conflicts' : 'Feature conflicts' }]
        : assignment?.state === 'assigned' && members.length
          ? members.map(member => ({ key: `value:${member.key}`, label: member.name }))
          : [{ key: 'missing', label: `No ${mode}` }];
    }
    for (const { key, label } of new Map(memberships.map(m => [m.key, m])).values()) {
      const group = groups.get(key) ?? { key, label, items: [], count: 0 };
      group.items.push(item); groups.set(key, group);
    }
  }
  for (const group of groups.values()) group.count = new Set(group.items.map(idKey)).size;
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

/** Session-only group expansion; usable by later grouping dimensions without changing cards. */
export class LensGroups {
  private closed = new Set<string>();
  reset() { this.closed.clear(); }

  render(parent: HTMLElement, mode: string, groups: LensGroup[], renderCard: (item: Occurrence) => HTMLElement) {
    for (const group of groups) {
      const key = `${mode}:${group.key}`;
      const details = document.createElement('details'); details.className = 'lens-group'; details.dataset.group = key;
      details.open = !this.closed.has(key);
      const summary = document.createElement('summary');
      const label = document.createElement('span'); label.textContent = group.label;
      const count = document.createElement('span'); count.className = 'lens-group-count'; count.textContent = `${group.count} ${group.count === 1 ? 'ID' : 'IDs'}`;
      summary.append(label, count); details.append(summary);
      const content = document.createElement('div'); content.className = 'lens-group-items'; details.append(content);
      let shown = 0;
      const more = document.createElement('button'); more.className = 'quiet-button lens-group-more';
      const appendPage = () => {
        more.remove();
        for (const item of group.items.slice(shown, shown + 250)) content.append(renderCard(item));
        shown = Math.min(shown + 250, group.items.length);
        if (shown < group.items.length) { more.textContent = `Show more definitions (${shown} of ${group.items.length})`; content.append(more); }
      };
      more.onclick = () => { appendPage(); (more.isConnected ? more : content.lastElementChild?.querySelector<HTMLElement>('button'))?.focus(); };
      // Closed groups keep their counts without building hidden cards.
      if (details.open) appendPage();
      details.ontoggle = () => {
        if (!details.isConnected) return;
        if (details.open) { this.closed.delete(key); if (!shown) appendPage(); }
        else this.closed.add(key);
      };
      parent.append(details);
    }
  }
}

/** Restore the same grouped card/control after a snapshot replaces the list DOM. */
export function captureLensFocus(parent: HTMLElement): (() => void) | undefined {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !parent.contains(active)) return;
  const group = active.closest<HTMLElement>('.lens-group')?.dataset.group;
  const card = active.closest<HTMLElement>('.lens-card');
  const source = card?.dataset.source;
  const identity = card?.dataset.id;
  const control = card ? [...card.querySelectorAll<HTMLElement>('button, summary')].indexOf(active) : -1;
  return () => {
    const groups = [...parent.querySelectorAll<HTMLDetailsElement>('.lens-group')];
    const container = groups.find(item => item.dataset.group === group);
    const cards = [...(container ?? parent).querySelectorAll<HTMLElement>('.lens-card')];
    const allCards = [...parent.querySelectorAll<HTMLElement>('.lens-card')];
    const target = source ? cards.find(item => item.dataset.source === source)
      ?? allCards.find(item => item.dataset.source === source)
      ?? allCards.find(item => item.dataset.id === identity) : undefined;
    let focus = target?.querySelectorAll<HTMLElement>('button, summary')[control] ?? container?.querySelector<HTMLElement>('summary');
    const closed = focus?.closest<HTMLDetailsElement>('details:not([open])');
    if (closed) focus = closed.querySelector<HTMLElement>('summary') ?? focus;
    (focus ?? document.querySelector<HTMLElement>('#lens-grouping'))?.focus();
  };
}
