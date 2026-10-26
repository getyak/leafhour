export function placeSelectionMenu(anchor, menu, bounds) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const left = clamp((anchor.left + anchor.right - menu.width) / 2, bounds.left, bounds.right - menu.width);
  const above = anchor.top - menu.height - 10;
  const below = anchor.bottom + 10;
  if (above >= bounds.top) return { left, top: above, placement: 'above' };
  if (below + menu.height <= bounds.bottom) return { left, top: below, placement: 'below' };
  return { left, top: clamp(below, bounds.top, bounds.bottom - menu.height), placement: 'edge' };
}
