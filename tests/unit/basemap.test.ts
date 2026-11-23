import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { basemaps, basemapStyleUrl, composeBasemap } from '../../src/infrastructure/basemap';
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
    expect(result.layers.map(layer => layer.id)).toEqual(['world-imagery', 'japan-imagery', 'us-imagery', 'poi']);
    expect(original.sources['world-imagery']).toBeUndefined();
  });
  it('limits public regional views to native zooms and bounded areas without credentials', () => {
    const result = composeBasemap('satellite', original);
    expect(result.sources['japan-imagery']).toMatchObject({ type: 'raster', minzoom: 14, maxzoom: 18, tileSize: 256,
      bounds: [122, 20, 154, 46], tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'] });
    expect(result.sources['us-imagery']).toMatchObject({ type: 'raster', minzoom: 14, maxzoom: 16, tileSize: 256, bounds: [-125, 24, -66, 50],
      tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'] });
    for (const id of ['japan-imagery', 'us-imagery']) {
      const source = result.sources[id]!;
      if (source.type !== 'raster') throw new Error('Expected raster');
      expect(source.attribution).toBeTruthy();
      expect(source.tiles?.join()).not.toMatch(/token=|key=|api[_-]?key/i);
    }
    expect(JSON.stringify(result.sources['japan-imagery'])).toContain('Axelspace');
    for (const id of ['standard', 'terrain', 'muted'] as const) {
      const other = composeBasemap(id, original);
      expect(other.sources['japan-imagery']).toBeUndefined(); expect(other.sources['us-imagery']).toBeUndefined();
    }
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

describe('additional backgrounds', () => {
  const transport: StyleSpecification = {
    ...original,
    layers: [
      { id: 'land', type: 'background' },
      { id: 'park', type: 'fill', source: 'names', 'source-layer': 'park', paint: { 'fill-color': '#d8e8c8' } },
      { id: 'road_major_rail', type: 'line', source: 'names', 'source-layer': 'transportation',
        filter: ['==', 'class', 'rail'], minzoom: 10, paint: { 'line-color': '#bbb', 'line-dasharray': [1, 2],
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 14, .4, 15, .75, 20, 2] } },
      { id: 'road_path_pedestrian', type: 'line', source: 'names', 'source-layer': 'transportation', minzoom: 14,
        filter: ['in', 'class', 'path', 'pedestrian'], paint: { 'line-width': 2, 'line-dasharray': [1, 1] } },
      { id: 'poi_transit', type: 'symbol', source: 'names', 'source-layer': 'poi', layout: { 'text-field': ['get', 'name'] } },
    ],
  };

  it('keeps four basic maps and places all three additions behind more', () => {
    expect(basemaps.filter(item => item.group === 'basic').map(item => item.id)).toEqual(['standard', 'satellite', 'terrain', 'muted']);
    expect(basemaps.filter(item => item.group === 'more').map(item => item.id)).toEqual(['rail', 'outdoor', 'dark']);
    expect(basemapStyleUrl('dark')).toBe('https://tiles.openfreemap.org/styles/dark');
    expect(basemapStyleUrl('rail')).toBe(basemapStyleUrl('standard'));
  });

  it('emphasizes existing rail output stops without moving zoom inside an expression or changing filters', () => {
    const before = structuredClone(transport), result = composeBasemap('rail', transport);
    const rail = result.layers.find(layer => layer.id === 'road_major_rail');
    if (rail?.type !== 'line') throw new Error('Expected rail line');
    expect(rail.paint?.['line-width']).toEqual(['interpolate', ['exponential', 1.4], ['zoom'], 14, .4 * 1.8, 15, .75 * 1.8, 20, 2 * 1.8]);
    expect(rail.filter).toEqual(['==', 'class', 'rail']); expect(rail.minzoom).toBe(10);
    expect(rail.paint?.['line-dasharray']).toEqual([1, 2]);
    expect(result.layers[3]).toEqual(transport.layers[3]);
    expect(result.sources).toEqual(transport.sources); expect(transport).toEqual(before);
  });

  it('adds the existing terrain source under paths and keeps travel data unchanged', () => {
    const result = composeBasemap('outdoor', transport);
    const path = result.layers.find(layer => layer.id === 'road_path_pedestrian');
    if (path?.type !== 'line') throw new Error('Expected path');
    expect(path.paint?.['line-width']).toBe(3); expect(path.paint?.['line-dasharray']).toEqual([1, 1]);
    expect(path.filter).toEqual(['in', 'class', 'path', 'pedestrian']); expect(path.minzoom).toBe(14);
    expect(result.sources['world-elevation']).toEqual(composeBasemap('terrain', original).sources['world-elevation']);
    expect(result.layers.findIndex(layer => layer.id === 'world-hillshade')).toBeLessThan(result.layers.findIndex(layer => layer.id === path.id));
  });
});
