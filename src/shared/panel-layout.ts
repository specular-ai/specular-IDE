/** Saved widths of the resizable panels. A field is absent while its panel uses the default. */
export interface PanelLayout { explorerWidth?: number; lensWidth?: number; sourceRatio?: number; sourceHidden?: true }

export const MIN_SIDE_PANEL_WIDTH = 160;
export const MAX_SIDE_PANEL_WIDTH = 4000;

export function validSidePanelWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_SIDE_PANEL_WIDTH && value <= MAX_SIDE_PANEL_WIDTH;
}

export function validSourceRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Recover each field independently so a bad one does not discard the others. */
export function parsePanelLayout(value: unknown): PanelLayout {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const layout: PanelLayout = {};
  if (validSidePanelWidth(saved.explorerWidth)) layout.explorerWidth = saved.explorerWidth;
  if (validSidePanelWidth(saved.lensWidth)) layout.lensWidth = saved.lensWidth;
  if (validSourceRatio(saved.sourceRatio)) layout.sourceRatio = saved.sourceRatio;
  if (saved.sourceHidden === true) layout.sourceHidden = true;
  return layout;
}
