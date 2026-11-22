import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { basemapStyleUrl, composeBasemap } from '../../src/infrastructure/basemap';
import { worldBounds } from '../../src/presentation/map-bounds';

const original: StyleSpecification = {
  version: 8, center: [140, 35], zoom: 8, bearing: 20, pitch: 10,
  sources: { names: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: 'OSM' } },
  layers: [
    { id: 'land', type: 'background' },
    { id: 'roads', type: 'line', source: 'names', 'source-layer': 'transportation' },
    { id: 'poi', type: 'symbol', source: 'names', 'source-layer': 'poi', layout: { 'text-field': ['get', 'name'] } },
  ],
};

describe('free world backgrounds', () => {
  it('uses the existing host for standard and muted, preserving the input', () => {
    expect(basemapStyleUrl('standard')).toBe('https://tiles.openfreemap.org/styles/liberty');
    expect(basemapStyleUrl('muted')).toBe('https://tiles.openfreemap.org/styles/positron');
    const result = composeBasemap('standard', original);
    expect(result.layers).toEqual(original.layers);
    expect(result.center).toBeUndefined(); expect(result.zoom).toBeUndefined();
    expect(result.pitch).toBeUndefined(); expect(result.bearing).toBeUndefined();
    expect(original.center).toEqual([140, 35]);
  });
  it('pins the unrestricted 2016 imagery and retains independent name attribution', () => {
    const result = composeBasemap('satellite', original);
    expect(result.sources['world-imagery']).toMatchObject({ type: 'raster', maxzoom: 14,
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'] });
    const imagery = result.sources['world-imagery']!;
    expect(imagery.type).toBe('raster');
    if (imagery.type !== 'raster') throw new Error('Expected imagery source');
    expect(imagery.attribution).toContain('2016');
    expect(imagery.attribution).toContain('by/4.0');
    expect(result.sources.names).toEqual(original.sources.names);
    expect(result.layers.map(layer => layer.id)).toEqual(['world-imagery', 'poi']);
    expect(original.sources['world-imagery']).toBeUndefined();
  });
  it('composes 2D terrain beneath roads and names with a global zoom budget', () => {
    const result = composeBasemap('terrain', original);
    expect(result.sources['world-elevation']).toMatchObject({ type: 'raster-dem', encoding: 'terrarium', tileSize: 512, maxzoom: 12 });
    expect(result.layers.map(layer => layer.id)).toEqual(['land', 'world-hillshade', 'roads', 'poi']);
    expect(result.terrain).toBeUndefined();
    expect(result.sources['world-imagery']).toBeUndefined();
  });
});

describe('world fit bounds', () => {
  it('fits islands across the date line using the short arc without changing coordinates', () => {
    const coordinates: [number, number][] = [[179, -20], [-179, -21]];
    expect(worldBounds(coordinates)).toEqual([[179, -21], [181, -20]]);
    expect(coordinates).toEqual([[179, -20], [-179, -21]]);
  });
  it('handles Europe, the Americas, repeated meridians and the Greenwich crossing', () => {
    expect(worldBounds([[7, 44], [10, 48]])).toEqual([[7, 44], [10, 48]]);
    expect(worldBounds([[-123, -10], [-70, -30]])).toEqual([[-123, -30], [-70, -10]]);
    expect(worldBounds([[-1, 0], [1, 1]])).toEqual([[-1, 0], [1, 1]]);
    expect(worldBounds([[180, 1], [-180, 5]])).toEqual([[180, 1], [180, 5]]);
  });
});
