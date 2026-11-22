export type MapInsets = { top: number; right: number; bottom: number; left: number };
type Rect = { left: number; right: number; top: number; bottom: number };
const area = (rect: Rect) => Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);

/** Read overlay geometry without changing layout or the camera. */
export function mapViewportInsets(container: HTMLElement): MapInsets {
  const map = container.getBoundingClientRect();
  const rect = (element: Element | null, panel = false): Rect | null => {
    if (!element) return null;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    // Open panels animate from outside the viewport. Fit to their final occupied
    // space even when an explicit camera action arrives during that transition.
    const transform = panel ? new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform) : null;
    const x = transform?.m41 ?? 0, y = transform?.m42 ?? 0;
    return { left: bounds.left - map.left - x, right: bounds.right - map.left - x,
      top: bounds.top - map.top - y, bottom: bounds.bottom - map.top - y };
  };
  const body = document.body.dataset, mobile = matchMedia('(max-width: 700px)').matches;
  const base: Rect = { left: 0, right: map.width, top: 0, bottom: map.height };
  const header = rect(document.querySelector('header'));
  if (header) base.top = Math.max(base.top, header.bottom);
  const tabs = rect(document.getElementById('mobile-tabs'));
  if (tabs) base.bottom = Math.min(base.bottom, tabs.top);
  if (!mobile && body.leftOpen === 'true') {
    const left = rect(document.getElementById('left-panel'), true);
    if (left) base.left = Math.max(base.left, left.right);
  }
  if (body.rightOpen === 'true') {
    const right = rect(document.getElementById('right-panel'), true);
    if (right) {
      if (mobile) base.bottom = Math.min(base.bottom, right.top);
      else base.right = Math.min(base.right, right.left);
    }
  }
  // Keep a rectangular viewing area clear of the actual controls, rather than
  // reserving an entire side for a small corner button on a narrow screen.
  let candidates = [base];
  for (const element of document.querySelectorAll('#map-tools, #basemap-control, #basemap-panel, #map-navigation, #drawer-toggle, #visit-focus-banner, #import-task, .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-bottom-left')) {
    const obstacle = rect(element);
    if (!obstacle) continue;
    candidates = candidates.flatMap(current => {
      if (obstacle.left >= current.right || obstacle.right <= current.left || obstacle.top >= current.bottom || obstacle.bottom <= current.top) return [current];
      return [
        { ...current, bottom: obstacle.top }, { ...current, top: obstacle.bottom },
        { ...current, right: obstacle.left }, { ...current, left: obstacle.right },
      ].filter(part => area(part) > 0);
    });
  }
  const visible = candidates.reduce<Rect | null>((best, current) => !best || area(current) > area(best) ? current : best, null);
  // No usable map space (for example a full-height mobile editor): a fit is a no-op.
  if (!visible || area(visible) === 0) return { left: map.width / 2, right: map.width / 2, top: map.height / 2, bottom: map.height / 2 };
  return { left: Math.max(0, visible.left), right: Math.max(0, map.width - visible.right),
    top: Math.max(0, visible.top), bottom: Math.max(0, map.height - visible.bottom) };
}
