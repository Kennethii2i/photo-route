/** Smallest longitude arc; display bounds may cross 180°, stored coordinates never change. */
export function worldBounds(coordinates: [number, number][]): [[number, number], [number, number]] {
  const longitude = coordinates.map(point => ((point[0] % 360) + 360) % 360).sort((a, b) => a - b);
  let gap = -1, start = 0;
  for (let i = 0; i < longitude.length; i++) {
    const next = longitude[(i + 1) % longitude.length]! + (i === longitude.length - 1 ? 360 : 0);
    if (next - longitude[i]! > gap) { gap = next - longitude[i]!; start = (i + 1) % longitude.length; }
  }
  let west = longitude[start]!, east = west + 360 - gap;
  if (west > 180) { west -= 360; east -= 360; }
  return [[west, Math.min(...coordinates.map(point => point[1]))], [east, Math.max(...coordinates.map(point => point[1]))]];
}
