import { DEFAULT_STATUS_SITES, type StatusSites } from './status-sites';
import type { StatusPalette } from './statuses';

const statusKey = (value: string) => value.trim().toLowerCase();
import type { IdCategory, IdConfiguration } from './id-configuration';

export interface StatusExtractionLane {
  scope: 'baseline' | 'status';
  sites: StatusSites;
  status?: string;
}

export interface StatusCandidate<T = unknown> {
  value: string;
  evidence: T;
}

export interface ResolvedStatusCandidate<T = unknown> extends StatusCandidate<T> {
  display: string;
  scope: 'baseline' | 'status';
  status?: string;
}

function matches(value: string, palette: StatusPalette) {
  const rules = palette.rules ?? [{ mode: 'exact' as const, value: palette.name }];
  return rules.some(rule => rule.mode === 'regex'
    ? new RegExp(rule.value, 'iu').test(value.trim())
    : rule.mode === 'exact'
      ? statusKey(value) === statusKey(rule.value)
      : statusKey(value).startsWith(statusKey(rule.value)));
}

export function matchingStatusNames(value: string, palettes: StatusPalette[]) {
  return palettes.filter(palette => matches(value, palette)).map(palette => palette.name);
}

export function statusExtractionLanes(configuration: IdConfiguration, category?: IdCategory): StatusExtractionLane[] {
  const baseline = category?.statusSites ?? configuration.statusSites ?? DEFAULT_STATUS_SITES;
  return [{ scope: 'baseline', sites: baseline }, ...(configuration.statuses ?? [])
    .filter(status => status.statusSites)
    .map(status => ({ scope: 'status' as const, status: status.name, sites: status.statusSites! }))];
}

/** Resolve already-extracted candidates. Extraction itself remains in the bounded analysis worker. */
export function resolveStatusCandidates<T>(baseline: StatusCandidate<T>[], local: Map<string, StatusCandidate<T>[]>, palettes: StatusPalette[]) {
  const overridden = new Set(palettes.filter(status => status.statusSites).map(status => statusKey(status.name)));
  const resolve = (candidate: StatusCandidate<T>) => {
    const names = matchingStatusNames(candidate.value, palettes);
    if (names.length > 1) throw new Error(`Ambiguous status mapping for "${candidate.value}": ${names.join(', ')}. Adjust the matching rules before Apply.`);
    return { names, display: names[0] ?? candidate.value };
  };
  const resolved: ResolvedStatusCandidate<T>[] = [];
  for (const candidate of baseline) {
    const { names, display } = resolve(candidate);
    if (names.length === 1 && overridden.has(statusKey(names[0]))) continue;
    resolved.push({ ...candidate, display, scope: 'baseline' });
  }
  for (const status of palettes.filter(item => item.statusSites)) {
    for (const candidate of local.get(status.name) ?? []) {
      const { names, display } = resolve(candidate);
      if (names.length === 1 && statusKey(names[0]) === statusKey(status.name)) resolved.push({ ...candidate, display, scope: 'status', status: status.name });
    }
  }
  const distinct = new Set(resolved.map(candidate => statusKey(candidate.display))).size;
  return { state: distinct === 0 ? 'none' as const : distinct > 1 ? 'conflict' as const : 'authored' as const, candidates: resolved };
}
