import type { StyleSpecification } from 'maplibre-gl';

/** O-03 is open: this local style makes no tile/style/font request and is not a provider choice. */
export type BasemapConfig = { style: StyleSpecification | string; attribution: string | null; externalRequests: boolean };
export const localBlankBasemap: BasemapConfig = {
  style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9f0ef' } }] },
  attribution: null,
  externalRequests: false,
};

/** Approved default for the local UI package; replaceable provider adapter. */
export const openFreeMapTrial: BasemapConfig = {
  style: 'https://tiles.openfreemap.org/styles/liberty',
  attribution: null,
  externalRequests: true,
};

export type BasemapId = 'standard' | 'satellite' | 'terrain' | 'muted';
export const basemaps: { id: BasemapId; label: string; description: string }[] = [
  { id: 'standard', label: '標準', description: '地名・駅・施設を表示。掲載内容は地域と縮尺によります。' },
  { id: 'satellite', label: '航空・衛星写真', description: '世界の衛星写真（EOX・2016年、約10m級）。古い画像で、建物の細部は分かりません。' },
  { id: 'terrain', label: '地形', description: '標高データの陰影で山や谷を表示。精度は地域によって異なります。' },
  { id: 'muted', label: '淡色', description: '写真の分布が見やすい、控えめな地図です。' },
];

export function basemapStyleUrl(id: BasemapId): string {
  return `https://tiles.openfreemap.org/styles/${id === 'muted' ? 'positron' : 'liberty'}`;
}

/** Compose display-only backgrounds; app photo/album sources are installed separately. */
export function composeBasemap(id: BasemapId, input: StyleSpecification): StyleSpecification {
  const style = structuredClone(input);
  if (id === 'satellite') {
    style.sources['world-imagery'] = {
      type: 'raster', tileSize: 256, minzoom: 0, maxzoom: 14,
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
      attribution: '<a href="https://cloudless.eox.at">EOxCloudless</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016) · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
    };
    // Keep vector names/POIs above imagery. Retain their source attribution too.
    style.layers = [{ id: 'world-imagery', type: 'raster', source: 'world-imagery', paint: { 'raster-fade-duration': 0 } },
      ...style.layers.filter(layer => layer.type === 'symbol')];
  } else if (id === 'terrain') {
    style.sources['world-elevation'] = {
      type: 'raster-dem', tileSize: 512, maxzoom: 12, encoding: 'terrarium',
      tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
      attribution: '<a href="https://mapterhorn.com/attribution/">© Mapterhorn</a>',
    };
    const index = style.layers.findIndex(layer => layer.type === 'line' || layer.type === 'symbol');
    style.layers.splice(index < 0 ? style.layers.length : index, 0, {
      id: 'world-hillshade', type: 'hillshade', source: 'world-elevation',
      paint: { 'hillshade-exaggeration': .5, 'hillshade-shadow-color': '#473e35', 'hillshade-highlight-color': '#fffef2' },
    });
  }
  // Camera values in a remote style must never reset the user's current view.
  delete style.center; delete style.zoom; delete style.bearing; delete style.pitch;
  return style;
}

export async function loadBasemapStyle(id: BasemapId, signal: AbortSignal): Promise<StyleSpecification> {
  const response = await fetch(basemapStyleUrl(id), { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('地図の表示設定を取得できません。');
  const style: StyleSpecification = await response.json();
  if (style.version !== 8 || !style.sources || !Array.isArray(style.layers)) throw new Error('地図の表示設定が不正です。');
  return composeBasemap(id, style);
}
