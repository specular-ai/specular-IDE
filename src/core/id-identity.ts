/** Authored tokens stay unchanged; only lookup keys include their folder scope. */
export interface IdIdentity { id: string; scope?: string }
export function idKey(value: IdIdentity): string {
  return value.scope || value.id.startsWith('@') ? '@' + JSON.stringify([value.scope ?? '', value.id]) : value.id;
}
export function identityFromKey(key: string): IdIdentity {
  if (key.startsWith('@')) {
    try {
      const pair: unknown = JSON.parse(key.slice(1));
      if (Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string')) return { id: pair[1], ...(pair[0] ? { scope: pair[0] } : {}) };
    } catch { /* Legacy authored token. */ }
  }
  return { id: key };
}
export function idLabel(value: IdIdentity): string { return value.scope ? `${value.id} · ${value.scope}` : value.id; }
export function keyLabel(key: string): string { return idLabel(identityFromKey(key)); }
