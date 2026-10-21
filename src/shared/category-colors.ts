import type { IdCategory } from '../core/id-configuration';
import { appearance, type ThemeMode } from './appearance';
export const validCategoryColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function categoryAccent(category: IdCategory, mode: ThemeMode): string {
  const supplied = category.colors?.[mode];
  if (validCategoryColor(supplied)) return supplied.toLowerCase();
  const defaults = { requirement: { light: '#b8860b', dark: '#e3ba78' }, design: { light: '#176c63', dark: '#83d8c5' }, task: { light: '#366bb0', dark: '#8eb9ed' } };
  return category.role ? defaults[category.role][mode] : appearance(mode).colors.border;
}
const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
function mix(a: string, b: string, weight: number) {
  const first = rgb(a), second = rgb(b);
  return '#' + first.map((value, i) => Math.round(value * weight + second[i] * (1 - weight)).toString(16).padStart(2, '0')).join('');
}
function luminance(color: string) {
  const linear = rgb(color).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
export function contrastRatio(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
/** Preserve the chosen accent and use a theme tint with a readable foreground. */
export function categoryPalette(category: IdCategory, mode: ThemeMode) {
  const accent = categoryAccent(category, mode), background = mix(accent, appearance(mode).colors.surface, .22);
  const foreground = contrastRatio('#ffffff', background) > contrastRatio('#000000', background) ? '#ffffff' : '#000000';
  return { accent, background, foreground, hover: mix(foreground, background, .06) };
}
