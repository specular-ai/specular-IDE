export interface FontSizes { source: number; preview: number }

export const DEFAULT_FONT_SIZES: Readonly<FontSizes> = { source: 13, preview: 13 };
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 32;

export function validFontSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_FONT_SIZE && value <= MAX_FONT_SIZE;
}

/** Recover each preference independently so a bad field does not discard a valid one. */
export function parseFontSizes(value: unknown): FontSizes {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<FontSizes> : {};
  return {
    source: validFontSize(saved.source) ? saved.source : DEFAULT_FONT_SIZES.source,
    preview: validFontSize(saved.preview) ? saved.preview : DEFAULT_FONT_SIZES.preview,
  };
}
