import type { MapInsets } from './map-viewport';

type Point = { x: number; y: number };
const TARGET = 48, GAP = 8, MARGIN = 8;

/** Transient screen positions only. Reserve full target rectangles and focus room. */
export function spiderLayout(count: number, origin: Point, width: number, height: number, insets: MapInsets): { center: Point; points: Point[] } | null {
  if (count < 2 || count > 12) return null;
  const inner: Point[] = count >= 10
    ? [{ x: -28, y: -28 }, { x: 28, y: -28 }, { x: -28, y: 28 }, { x: 28, y: 28 }]
    : count >= 7 ? [{ x: 0, y: 0 }] : [];
  const outerCount = count - inner.length;
  // Grow only until the rectangular targets have a gap, not merely their centers.
  for (let radius = 56; radius <= 200; radius += 2) {
    const points = [...inner, ...Array.from({ length: outerCount }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / outerCount;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    })];
    if (points.some((a, index) => points.slice(index + 1).some(b => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) < TARGET + GAP - .001))) continue;
    const left = Math.min(...points.map(p => p.x)) - TARGET / 2 - MARGIN;
    const right = Math.max(...points.map(p => p.x)) + TARGET / 2 + MARGIN;
    const top = Math.min(...points.map(p => p.y)) - TARGET / 2 - MARGIN;
    const bottom = Math.max(...points.map(p => p.y)) + TARGET / 2 + MARGIN;
    if (width - insets.left - insets.right < right - left || height - insets.top - insets.bottom < bottom - top) return null;
    const center = { x: Math.max(insets.left - left, Math.min(width - insets.right - right, origin.x)),
      y: Math.max(insets.top - top, Math.min(height - insets.bottom - bottom, origin.y)) };
    return { center, points: points.map(p => ({ x: center.x + p.x, y: center.y + p.y })) };
  }
  return null;
}
