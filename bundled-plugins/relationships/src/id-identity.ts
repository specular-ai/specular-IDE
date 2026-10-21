/** Public keys are opaque. Labels come from the authored token and optional scope metadata. */
const identities = new Map<string, { id: string; scope?: string }>();
export function setIdentities(values: readonly { id: string; key?: string; scope?: string }[]) {
  identities.clear();
  for (const value of values) identities.set(value.key ?? value.id, { id: value.id, ...(value.scope ? { scope: value.scope } : {}) });
}
export function identityFromKey(key: string) { return identities.get(key) ?? { id: key }; }
export function keyLabel(key: string) {
  const value = identityFromKey(key);
  return value.scope ? `${value.id} · ${value.scope}` : value.id;
}
