import { Map, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);

type Point = { id: string; label: string; coordinates: [number, number] };
const points: Point[] = [
  { id: 'synthetic-a', label: '合成地点 A', coordinates: [139.7, 35.6] },
  { id: 'synthetic-b', label: '合成地点 B', coordinates: [139.8, 35.7] },
];
const style = { version: 8 as const, sources: {}, layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#e6eef3' } }] };
const mapElement = document.querySelector<HTMLElement>('#map')!;
const status = document.querySelector<HTMLElement>('#status')!;
const selection = document.querySelector<HTMLElement>('#selection')!;
const list = document.querySelector<HTMLElement>('#points')!;
for (const point of points) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = point.label;
  button.addEventListener('click', () => { selection.textContent = `${point.label} を選択`; });
  item.append(button);
  list.append(item);
}

const failed = new URLSearchParams(location.search).has('fail');
const demo = new URLSearchParams(location.search).has('demo');
try {
  const map = new Map({
    container: mapElement,
    style: failed ? '/spikes/p0-t08/missing-style.json' : demo ? 'https://demotiles.maplibre.org/style.json' : style,
    center: demo ? [0, 0] : [139.75, 35.65], zoom: demo ? 1 : 9,
    attributionControl: demo ? {} : false,
  });
  map.on('load', () => {
    map.addSource('synthetic-photos', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: points.map(point => ({ type: 'Feature', properties: { id: point.id }, geometry: { type: 'Point', coordinates: point.coordinates } })) },
    });
    map.addLayer({ id: 'synthetic-photo-points', type: 'circle', source: 'synthetic-photos', paint: { 'circle-radius': 10, 'circle-color': '#b34a3c' } });
    status.textContent = '合成地点を地図に表示しました';
    mapElement.dataset.state = 'loaded';
  });
  map.on('error', () => {
    status.textContent = '地図を利用できません。地点一覧から選択できます。';
    mapElement.dataset.state = 'unavailable';
  });
  (window as Window & { phase0Map?: Map }).phase0Map = map;
} catch {
  status.textContent = '地図を利用できません。地点一覧から選択できます。';
  mapElement.dataset.state = 'unavailable';
}
