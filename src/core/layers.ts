/**
 * Increment 100b (DD-065): traceability layers for Focus and the Relationships list.
 * A project may configure them; otherwise they come from the categories' roles (100a).
 */
export interface TraceLayer { name: string; categories: string[] }

export const MAX_LAYERS = 8;
/** The default layers, in order, and the role whose categories fill each. */
export const ROLE_LAYERS = [
  { name: 'Requirements', role: 'requirement' },
  { name: 'Design decisions', role: 'design' },
  { name: 'Implementation tasks', role: 'task' },
] as const;

interface LayeredConfiguration { categories: readonly { key: string; role?: string }[]; layers?: readonly TraceLayer[] }

/** The configured layers, or the role layers that have categories. */
export function effectiveLayers(configuration: LayeredConfiguration): TraceLayer[] {
  if (configuration.layers?.length) return configuration.layers.map(layer => ({ name: layer.name, categories: [...layer.categories] }));
  return ROLE_LAYERS.map(layer => ({ name: layer.name, categories: configuration.categories.filter(category => category.role === layer.role).map(category => category.key) }))
    .filter(layer => layer.categories.length);
}

/** Validates configured layers against the configuration's category keys. */
export function validateLayers(input: unknown, categoryKeys: readonly string[]): TraceLayer[] {
  if (!Array.isArray(input) || !input.length || input.length > MAX_LAYERS) throw new Error(`layers needs 1-${MAX_LAYERS} entries, each a name and its categories.`);
  const names = new Set<string>(), placed = new Map<string, string>();
  return input.map((entry, index) => {
    const value = entry as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'name' && key !== 'categories')) throw new Error(`Layer ${index + 1} needs only a name and categories.`);
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 64) throw new Error(`Layer ${index + 1} needs a name of 1-64 characters.`);
    const name = value.name.trim();
    if (names.has(name.toLowerCase())) throw new Error(`Layer names must be unique: ${name}.`);
    names.add(name.toLowerCase());
    if (!Array.isArray(value.categories) || !value.categories.length || value.categories.some(key => typeof key !== 'string')) throw new Error(`Layer ${name} needs at least one category.`);
    for (const key of value.categories as string[]) {
      if (!categoryKeys.includes(key)) throw new Error(`Layer ${name} names a category that is not configured.`);
      const other = placed.get(key);
      if (other !== undefined) throw new Error(other === name ? `Layer ${name} lists a category twice.` : `A category can be in only one layer (${other} and ${name}).`);
      placed.set(key, name);
    }
    return { name, categories: [...value.categories as string[]] };
  });
}

/** Layers without the given categories; empty layers are dropped, and no layers remain as undefined. */
export function layersWithout(layers: readonly TraceLayer[] | undefined, removed: Iterable<string>): TraceLayer[] | undefined {
  if (!layers) return undefined;
  const gone = new Set(removed);
  const kept = layers.map(layer => ({ name: layer.name, categories: layer.categories.filter(key => !gone.has(key)) })).filter(layer => layer.categories.length);
  return kept.length ? kept : undefined;
}
