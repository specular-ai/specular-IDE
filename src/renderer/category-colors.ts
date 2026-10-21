import type { IdCategory } from '../core/id-configuration';
import { categoryPalette } from '../shared/category-colors';
export function styleCategoryCard(card: HTMLElement, category: IdCategory) {
  card.classList.add('category-card'); card.dataset.category = category.key;
  for (const mode of ['light', 'dark'] as const) for (const [name, value] of Object.entries(categoryPalette(category, mode))) card.style.setProperty(`--category-${mode}-${name}`, value);
}
