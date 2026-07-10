export const inspectorCompactWidth = 380;
export const inspectorDetailWidth = 520;
export const inspectorMinimumWidth = 340;
export const inspectorMaximumWidth = 720;
export const inspectorDetailThreshold = 460;

export function clampInspectorWidth(width: number, viewportWidth: number) {
  const availableWidth = Math.max(inspectorMinimumWidth, viewportWidth - 80);
  const maximumWidth = Math.min(inspectorMaximumWidth, availableWidth);

  return Math.round(Math.min(Math.max(width, inspectorMinimumWidth), maximumWidth));
}

export function isInspectorDetailWidth(width: number) {
  return width >= inspectorDetailThreshold;
}
