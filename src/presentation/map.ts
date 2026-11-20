import { Map, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { photoPoints, visitPoints, type PointFeature } from '../domain/map';
import type { Photo, Thumbnail, Visit } from '../domain/model';
import { localBlankBasemap, openFreeMapTrial, type BasemapConfig } from '../infrastructure/basemap';
import { clusterCandidateSource, type CandidateSource } from './map-candidates';
import type { MapInsets } from './map-viewport';
import { spiderLayout } from './map-spider-layout';
import type { ErrorGuide } from './error-notice';

setWorkerUrl(workerUrl);
export type { CandidateSource } from './map-candidates';
export type MapCandidates = { photos: CandidateSource; visits: CandidateSource; kind: 'cluster' | 'overlap' };

export class PhotoMap {
  private readonly map: Map | null = null;
  private loaded = false;
  private failed = false;
  private photos: Photo[] = [];
  private visits: Visit[] = [];
  private photoFeatures: PointFeature[] = [];
  private photoFeatureById = new globalThis.Map<string, PointFeature>();
  private visitFeatures: PointFeature[] = [];
  private sourceRevision = 0;
  private filterActive = false;
  private filteredPhotoCount = 0;
  private selectedId: string | null = null;
  private selectedClusterId: number | null = null;
  private selectedClusterRequest = 0;
  private selectedClusterKey = '';
  private selectedVisitId: string | null = null;
  private viewportKey: string | null = null;
  private basemapEnabled = false;
  private basemapError = false;
  private showPhotos = true;
  private showVisits = false;
  private focusedPhotoIds = new Set<string>();
  private creatingVisit = false;
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private viewportInsets: (() => MapInsets) | null = null;
  private thumbMarkers = new globalThis.Map<string, { marker: Marker; url: string | null; element: HTMLElement; coordKey: string }>();
  private thumbGeneration = 0;
  private thumbQueue: { id: string; thumbnailId: string; generation: number }[] = [];
  private thumbLoading = 0;
  private backgroundClick: (() => void) | null = null;
  private fault: ErrorGuide | null = null;
  private faultListener: ((fault: ErrorGuide | null) => void) | null = null;
  private tileErrors = new Set<string>();
  private tileErrorTimer: ReturnType<typeof setTimeout> | null = null;
  private interaction = 0;
  private spiderMarkers: Marker[] = [];
  private spiderUrls: string[] = [];
  private spiderGeneration = 0;
  private spiderCoordKeys = new Set<string>();
  private photoGroup: ((ids: string[]) => void) | null = null;

  constructor(element: HTMLElement, private readonly status: HTMLElement, private readonly onCandidates: (selection: MapCandidates) => void, private readonly onBasemapState: (enabled: boolean) => void = () => {}, private readonly onMapPoint: (point: { longitude: number; latitude: number }) => void = () => {}, private readonly onZoomChange: (zoom: number) => void = () => {}, private readonly thumbnail: (id: string) => Promise<Thumbnail | undefined> = async () => undefined, config: BasemapConfig = openFreeMapTrial) {
    this.basemapEnabled = config.externalRequests;
    try {
      const map = new Map({ container: element, style: config.style, center: [0, 0], zoom: 1, attributionControl: {} });
      this.map = map;
      let press: { x: number; y: number; moved: boolean; multi: boolean } | null = null;
      let blockedUntil = 0;
      let pendingEmpty: ReturnType<typeof setTimeout> | null = null;
      const cancelEmpty = () => { if (pendingEmpty !== null) clearTimeout(pendingEmpty); pendingEmpty = null; };
      // A deferred blank click must never dismiss a view opened by a newer action.
      document.addEventListener('pointerdown', cancelEmpty, { capture: true });
      document.addEventListener('keydown', cancelEmpty, { capture: true });
      const blockGesture = () => { cancelEmpty(); this.clearSpider(); blockedUntil = Date.now() + 450; if (press) press.moved = true; };
      element.addEventListener('pointerdown', event => {
        cancelEmpty();
        if (!event.isPrimary || event.button !== 0) { if (press) press.multi = true; blockedUntil = Date.now() + 450; return; }
        press = { x: event.clientX, y: event.clientY, moved: false, multi: false };
      });
      element.addEventListener('pointermove', event => {
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press.moved = true;
      });
      element.addEventListener('pointercancel', blockGesture);
      element.addEventListener('wheel', blockGesture, { passive: true });
      element.addEventListener('dblclick', blockGesture);
      map.on('dragstart', blockGesture); map.on('zoomstart', () => { cancelEmpty(); this.clearSpider(); });
      map.on('movestart', () => this.clearSpider()); map.on('resize', () => this.clearSpider());
      map.on('movestart', () => { ++this.selectedClusterRequest; this.selectedClusterKey = ''; this.selectCluster(null); });
      element.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.spiderMarkers.length) { event.preventDefault(); event.stopPropagation(); this.clearSpider(); }
      });
      const attribution = element.querySelector('.maplibregl-ctrl-bottom-right');
      if (attribution) new ResizeObserver(() => {
        document.body.style.setProperty('--map-attribution-height', `${Math.ceil(attribution.getBoundingClientRect().height)}px`);
      }).observe(attribution);
      map.on('zoomend', () => this.onZoomChange(map.getZoom()));
      map.on('idle', () => this.syncThumbnailMarkers());
      map.on('idle', () => this.refreshSelectedCluster());
      map.on('moveend', () => this.syncThumbnailMarkers());
      map.on('style.load', () => {
        if (this.basemapEnabled) { this.basemapError = false; this.reportFault(null); }
        if (!this.loaded || map.getSource('photos')) return;
        this.installLayers();
        this.update(this.photos, this.visits, false);
      });
      map.on('load', () => {
        if (!map.getSource('photos')) this.installLayers();
        this.loaded = true;
        this.onZoomChange(map.getZoom());
        map.on('click', event => {
          if (this.creatingVisit) {
            this.creatingVisit = false;
            map.getCanvas().style.cursor = '';
            this.onMapPoint({ longitude: event.lngLat.lng, latitude: event.lngLat.lat });
            return;
          }
          const pureClick = event.originalEvent.target === map.getCanvas() && press && !press.moved && !press.multi
            && Date.now() >= blockedUntil && (!(event.originalEvent instanceof MouseEvent) || event.originalEvent.detail === 1);
          void this.selectAt(event.point.x, event.point.y, pureClick ? () => {
            cancelEmpty();
            pendingEmpty = setTimeout(() => { pendingEmpty = null; if (!map.isMoving()) this.backgroundClick?.(); }, 400);
          } : undefined);
        });
        this.update(this.photos, this.visits);
      });
      map.on('error', event => {
        if (this.basemapEnabled) {
          const context = event as typeof event & { sourceId?: string; tile?: { tileID?: { key?: string } } };
          if (context.sourceId === 'photos' || context.sourceId === 'visits') return;
          if (!context.sourceId && !context.tile && map.isStyleLoaded()) return;
          if (context.tile || context.sourceId && map.isStyleLoaded()) {
            this.tileErrors.add(context.tile?.tileID?.key ?? context.sourceId ?? 'tile');
            if (this.tileErrorTimer === null) this.tileErrorTimer = setTimeout(() => {
              this.tileErrorTimer = null;
              if (this.tileErrors.size >= 3 && !this.hasBackgroundContent()) this.reportFault(this.basemapGuide('複数の地図タイルを取得できません。通信状態を確認してください。'));
              this.tileErrors.clear();
            }, 1500);
            return;
          }
          this.basemapEnabled = false;
          this.basemapError = true;
          this.onBasemapState(false);
          map.setStyle(localBlankBasemap.style);
          this.reportFault(this.basemapGuide(event.error.message));
          this.updateStatus();
        } else if (!this.loaded) {
          this.failed = true;
          this.status.textContent = '地図を利用できません。写真一覧と書き出しは使えます。';
          this.reportFault(this.initializationGuide(event.error.message));
        }
      });
      window.addEventListener('offline', () => {
        if (this.basemapEnabled && !this.hasBackgroundContent()) this.reportFault(this.basemapGuide('通信が切断されています。接続を戻してから再試行してください。'));
      });
    } catch (error) {
      this.failed = true; this.status.textContent = '地図を利用できません。写真一覧と書き出しは使えます。';
      this.reportFault(this.initializationGuide(error instanceof Error ? error.message : String(error)));
    }
  }

  onFault(listener: (fault: ErrorGuide | null) => void): void { this.faultListener = listener; listener(this.fault); }
  private reportFault(fault: ErrorGuide | null): void { this.fault = fault; this.faultListener?.(fault); }
  private initializationGuide(detail: string): ErrorGuide {
    return { title: '地図を起動できませんでした', detail: `写真・アルバム一覧は使えます。未保存の内容を確認してから再読み込みしてください。 ${detail}`,
      action: { label: '再読み込み', run: () => location.reload() } };
  }
  private basemapGuide(detail: string): ErrorGuide {
    return { title: '地図を読み込めませんでした', detail: `写真・アルバム一覧は使えます。写真の位置や選択は変更しません。 ${detail}`,
      action: { label: '再試行', run: () => this.retryBasemap() } };
  }
  private hasBackgroundContent(): boolean {
    try { return Boolean(this.map?.queryRenderedFeatures().some(feature => feature.source !== 'photos' && feature.source !== 'visits')); }
    catch { return false; }
  }
  private retryBasemap(): void {
    if (!this.map || this.failed) return;
    this.tileErrors.clear(); this.basemapEnabled = true; this.basemapError = false; this.reportFault(null);
    try { this.map.setStyle(openFreeMapTrial.style, { diff: false }); }
    catch (error) { this.basemapEnabled = false; this.basemapError = true; this.reportFault(this.basemapGuide(String(error))); }
  }

  onBackgroundClick(handler: () => void): void { this.backgroundClick = handler; }
  onPhotoGroup(handler: (ids: string[]) => void): void { this.photoGroup = handler; }

  private installLayers(): void {
    const map = this.map;
    if (!map) return;
    map.addSource('photos', { type: 'geojson', data: photoPoints([]), cluster: true, clusterRadius: 40, clusterMaxZoom: 16,
      clusterProperties: { referenceCount: ['+', ['case', ['==', ['get', 'gpsState'], 'datum-unknown-reference'], 1, 0]] } });
    map.addSource('visits', { type: 'geojson', data: visitPoints([]), cluster: true, clusterRadius: 40, clusterMaxZoom: 16 });
    map.addLayer({ id: 'photo-clusters', type: 'circle', source: 'photos', filter: ['has', 'point_count'],
      paint: { 'circle-radius': ['step', ['get', 'point_count'], 17, 10, 22, 100, 28], 'circle-color': ['case', ['>', ['get', 'referenceCount'], 0], '#a16810', '#327f86'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'photo-cluster-count', type: 'symbol', source: 'photos', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13 }, paint: { 'text-color': '#fff' } });
    map.addLayer({ id: 'photo-cluster-selected', type: 'circle', source: 'photos', filter: ['==', ['get', 'cluster_id'], -1],
      paint: { 'circle-radius': ['step', ['get', 'point_count'], 21, 10, 26, 100, 32], 'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#236e5b', 'circle-stroke-opacity': .7, 'circle-stroke-width': 3 } });
    map.addLayer({ id: 'photo-points', type: 'circle', source: 'photos', filter: ['!', ['has', 'point_count']],
      paint: { 'circle-radius': 9, 'circle-color': ['match', ['get', 'gpsState'], 'datum-unknown-reference', '#b57817', '#c84f3b'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'photo-visit-focus', type: 'circle', source: 'photos', filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'visitFocus'], true]],
      paint: { 'circle-radius': 19, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#a8d7b9', 'circle-stroke-opacity': .7, 'circle-stroke-width': 5 } });
    map.addLayer({ id: 'photo-selected', type: 'circle', source: 'photos', filter: ['==', ['get', 'id'], this.selectedId ?? ''],
      paint: { 'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#173d42', 'circle-stroke-width': 3 } });
    map.addLayer({ id: 'visit-clusters', type: 'circle', source: 'visits', filter: ['has', 'point_count'],
      paint: { 'circle-radius': ['step', ['get', 'point_count'], 18, 10, 23, 100, 29], 'circle-color': '#315f9b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'visit-cluster-count', type: 'symbol', source: 'visits', filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13 }, paint: { 'text-color': '#fff' } });
    map.addLayer({ id: 'visit-points', type: 'circle', source: 'visits', filter: ['!', ['has', 'point_count']],
      paint: { 'circle-radius': 14, 'circle-color': '#315f9b', 'circle-opacity': 0, 'circle-stroke-color': '#fff', 'circle-stroke-opacity': 0, 'circle-stroke-width': 2 } });
    if (!map.hasImage('visit-pin')) {
      const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 48;
      const context = canvas.getContext('2d');
      if (context) {
        context.beginPath(); context.moveTo(20, 45); context.bezierCurveTo(13, 33, 5, 25, 5, 17);
        context.arc(20, 17, 15, Math.PI, 0); context.bezierCurveTo(35, 25, 27, 33, 20, 45);
        context.fillStyle = '#a36a3c'; context.fill(); context.lineWidth = 3; context.strokeStyle = '#fff'; context.stroke();
        context.beginPath(); context.arc(20, 17, 5, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill();
        map.addImage('visit-pin', context.getImageData(0, 0, 40, 48));
      }
    }
    map.addLayer({ id: 'visit-pin-symbol', type: 'symbol', source: 'visits', filter: ['!', ['has', 'point_count']],
      layout: { 'icon-image': 'visit-pin', 'icon-size': .72, 'icon-anchor': 'bottom', 'icon-allow-overlap': true } });
    map.addLayer({ id: 'visit-selected', type: 'circle', source: 'visits', filter: ['==', ['get', 'id'], this.selectedVisitId ?? ''],
      paint: { 'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#173d42', 'circle-stroke-width': 3 } });
    this.applyVisibility();
  }

  private applyVisibility(): void {
    if (!this.map) return;
    for (const id of ['photo-clusters', 'photo-cluster-count', 'photo-cluster-selected', 'photo-points', 'photo-visit-focus', 'photo-selected']) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', this.showPhotos ? 'visible' : 'none');
    }
    for (const id of ['visit-clusters', 'visit-cluster-count', 'visit-points', 'visit-pin-symbol', 'visit-selected']) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', this.showVisits ? 'visible' : 'none');
    }
  }

  setLayerVisibility(photos: boolean, visits: boolean, refit = true): void {
    this.showPhotos = photos;
    this.showVisits = visits;
    this.applyVisibility();
    this.syncThumbnailMarkers();
    this.viewportKey = null;
    this.update(this.photos, this.visits, refit);
  }

  setVisitCreationMode(enabled: boolean): void {
    this.creatingVisit = enabled;
    if (this.map) this.map.getCanvas().style.cursor = enabled ? 'crosshair' : '';
  }

  selectPhoto(id: string | null): void {
    if (id !== this.selectedId) { ++this.selectedClusterRequest; this.selectedClusterKey = ''; this.selectCluster(null); }
    this.selectedId = id;
    if (this.map?.getLayer('photo-selected')) this.map.setFilter('photo-selected', ['==', ['get', 'id'], id ?? '']);
    const selected = this.photoFeatureById.get(id ?? '')?.geometry.coordinates.join(',');
    for (const entry of this.thumbMarkers.values()) entry.element.classList.toggle('is-selected', Boolean(selected && entry.coordKey === selected));
    for (const marker of this.spiderMarkers) marker.getElement().classList.toggle('is-selected', marker.getElement().dataset.photoId === id);
    this.refreshSelectedCluster();
  }
  /** Selection respects the user's zoom and moves only an obscured/offscreen point. */
  revealPhoto(id: string): boolean {
    const map = this.map, point = this.photoFeatureById.get(id);
    if (!map || !point || this.selectedId !== id) return false;
    const insets = this.viewportInsets?.() ?? this.insets, container = map.getContainer();
    const width = container.clientWidth - insets.left - insets.right;
    const height = container.clientHeight - insets.top - insets.bottom;
    if (width < 64 || height < 64) return false;
    const margin = Math.min(40, width / 4, height / 4), position = map.project(point.geometry.coordinates);
    const x = Math.max(insets.left + margin, Math.min(container.clientWidth - insets.right - margin, position.x));
    const y = Math.max(insets.top + margin, Math.min(container.clientHeight - insets.bottom - margin, position.y));
    if (Math.abs(position.x - x) > 1 || Math.abs(position.y - y) > 1) map.panBy([position.x - x, position.y - y], { duration: 0 });
    return true;
  }
  focusPhoto(id: string): boolean {
    const point = id ? photoPoints(this.photos).features.find(feature => feature.id === id) : null;
    if (!point || !this.map) return false;
    return this.fitCoordinates([point.geometry.coordinates], 15);
  }

  private selectCluster(id: number | null): void {
    if (this.selectedClusterId === id) return;
    this.selectedClusterId = id;
    if (this.map?.getLayer('photo-cluster-selected')) this.map.setFilter('photo-cluster-selected', ['==', ['get', 'cluster_id'], id ?? -1]);
  }

  /** Highlight only after the current rendered cluster's leaves prove membership.
   * Bounded lookup is optional presentation work: unknown membership has no ring.
   * It never changes the camera, so a delayed response cannot move an old selection.
   */
  private refreshSelectedCluster(): void {
    const map = this.map, id = this.selectedId;
    if (!map || !id || !this.showPhotos || !map.getSource('photos') || !map.isSourceLoaded('photos')) return;
    const key = `${id}|${this.sourceRevision}|${map.getZoom()}|${map.getCenter().toArray()}|${map.getContainer().clientWidth}|${map.getContainer().clientHeight}`;
    if (key === this.selectedClusterKey) return;
    this.selectedClusterKey = key;
    const request = ++this.selectedClusterRequest, revision = this.sourceRevision;
    this.selectCluster(null);
    const current = () => request === this.selectedClusterRequest && id === this.selectedId && revision === this.sourceRevision;
    const source = map.getSource('photos') as GeoJSONSource;
    const clusters = new globalThis.Map<number, number>();
    for (const feature of map.queryRenderedFeatures({ layers: ['photo-clusters'] })) {
      if (typeof feature.properties.cluster_id === 'number') clusters.set(feature.properties.cluster_id, Number(feature.properties.point_count));
    }
    void (async () => {
      let remaining = 1000;
      for (const [clusterId, count] of clusters) {
        for (let offset = 0; offset < count && remaining > 0; offset += 100) {
          if (!current()) return;
          const limit = Math.min(100, remaining); remaining -= limit;
          const leaves = await source.getClusterLeaves(clusterId, limit, offset);
          if (!current()) return;
          if (leaves.some(leaf => leaf.properties?.id === id)) { this.selectCluster(clusterId); return; }
        }
      }
    })().catch(() => { /* A stale/unavailable cluster is not guessed. Preview stays usable. */ });
  }

  selectVisit(id: string | null): void {
    this.selectedVisitId = id;
    if (this.map?.getLayer('visit-selected')) this.map.setFilter('visit-selected', ['==', ['get', 'id'], id ?? '']);
  }

  setFocusedPhotoIds(ids: Iterable<string>, refresh = true): void {
    this.focusedPhotoIds = new Set(ids);
    if (refresh) this.update(this.photos, this.visits, false);
  }

  fitPhotoIds(ids: string[]): boolean {
    const coordinates = ids.flatMap(id => { const point = this.photoFeatureById.get(id); return point ? [point.geometry.coordinates] : []; });
    if (!coordinates.length) return false;
    if (coordinates.every(point => point[0] === coordinates[0]![0] && point[1] === coordinates[0]![1]) && this.map) {
      return this.fitCoordinates(coordinates, Math.max(17, this.map.getZoom()));
    }
    return this.fitCoordinates(coordinates);
  }

  zoomBy(delta: number): void {
    if (!this.map) return;
    this.map.zoomTo(Math.max(0, Math.min(20, this.map.getZoom() + delta)), { duration: 0 });
    this.onZoomChange(this.map.getZoom());
  }
  fitVisible(): void { this.viewportKey = null; this.update(this.photos, this.visits); }
  setViewportInsetsProvider(provider: () => MapInsets): void { this.viewportInsets = provider; }
  setViewportPadding(insets: { top: number; right: number; bottom: number; left: number }): void {
    if (Object.keys(insets).every(key => insets[key as keyof typeof insets] === this.insets[key as keyof typeof insets])) return;
    this.insets = insets;
    // Drawer visibility does not move the camera. Insets are applied only by explicit fitting.
  }

  private async selectAt(x: number, y: number, onEmpty?: () => void): Promise<void> {
    const map = this.map;
    if (!map) return;
    const interaction = ++this.interaction;
    const layers = ['photo-clusters', 'photo-points', 'visit-clusters', 'visit-points'].filter(id => map.getLayer(id));
    if (!layers.length) return;
    const hits = map.queryRenderedFeatures([[x - 9, y - 9], [x + 9, y + 9]], { layers });
    const visible = hits.filter(hit => (hit.source === 'photos' && this.showPhotos) || (hit.source === 'visits' && this.showVisits));
    if (!visible.length) { if (this.spiderMarkers.length) this.clearSpider(); else onEmpty?.(); return; }
    const first = visible.find(hit => hit.geometry.type === 'Point');
    if (!first || first.geometry.type !== 'Point') return;
    const center = map.project(first.geometry.coordinates as [number, number]);
    const closeToCenter = (coordinates: [number, number]) => {
      const screen = map.project(coordinates);
      return Math.hypot(screen.x - center.x, screen.y - center.y) <= 22;
    };
    const photoCluster = visible.find(hit => hit.layer.id === 'photo-clusters');
    const visitCluster = visible.find(hit => hit.layer.id === 'visit-clusters');
    const revision = this.sourceRevision;
    const cluster = photoCluster ?? visitCluster;
    if (cluster && cluster.geometry.type === 'Point') {
      try {
        const source = map.getSource(photoCluster ? 'photos' : 'visits') as GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(Number(cluster.properties.cluster_id));
        if (interaction !== this.interaction || revision !== this.sourceRevision) return;
        this.clearSpider();
        this.fitCoordinates([cluster.geometry.coordinates as [number, number]], Math.min(20, Math.max(map.getZoom() + 1, zoom)));
      } catch { this.status.textContent = '拡大できません。写真・アルバム一覧から選択できます。'; }
      return;
    }
    const clusterSource = (hit: typeof photoCluster, sourceId: string): CandidateSource => {
      const clusterId = hit?.properties?.cluster_id, count = hit?.properties?.point_count;
      const source = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (!source || typeof clusterId !== 'number' || typeof count !== 'number') return { count: 0, page: async () => [] };
      return clusterCandidateSource(source, clusterId, count, () => revision === this.sourceRevision);
    };
    const nearbySource = (features: PointFeature[]): CandidateSource => {
      // Freeze the hit set before fitting the camera; screen coordinates change after a fit.
      const ids = features.filter(feature => closeToCenter(feature.geometry.coordinates)).map(feature => feature.id);
      return { count: ids.length, page: async (offset, limit) => revision === this.sourceRevision ? ids.slice(offset, offset + limit) : [] };
    };
    try {
      const empty: CandidateSource = { count: 0, page: async () => [] };
      const photos = !this.showPhotos ? empty : photoCluster ? clusterSource(photoCluster, 'photos') : nearbySource(this.photoFeatures);
      const visits = !this.showVisits ? empty : visitCluster ? clusterSource(visitCluster, 'visits') : nearbySource(this.visitFeatures);
      if (photos.count > 1) {
        await this.showSpider(photos, first.geometry.coordinates as [number, number]); return;
      }
      if (photos.count || visits.count) this.onCandidates({ photos, visits, kind: photoCluster || visitCluster ? 'cluster' : 'overlap' });
    } catch { this.status.textContent = '地図の候補を開けません。写真・アルバム一覧から選択できます。'; }
  }

  private clearSpider(): void {
    ++this.spiderGeneration;
    for (const marker of this.spiderMarkers) marker.remove();
    for (const url of this.spiderUrls) URL.revokeObjectURL(url);
    this.spiderMarkers = []; this.spiderUrls = [];
    this.spiderCoordKeys.clear();
    for (const entry of this.thumbMarkers.values()) entry.element.classList.remove('is-expanded');
  }

  /** Screen offsets are transient; source coordinates and clustering stay intact. */
  private async showSpider(source: CandidateSource, center: [number, number]): Promise<void> {
    const map = this.map; if (!map) return;
    this.clearSpider();
    const generation = this.spiderGeneration, revision = this.sourceRevision;
    const ids = await source.page(0, source.count);
    if (generation !== this.spiderGeneration || revision !== this.sourceRevision || !ids.length) return;
    const insets = this.viewportInsets?.() ?? this.insets;
    const width = map.getContainer().clientWidth, height = map.getContainer().clientHeight;
    const origin = map.project(center);
    const layout = spiderLayout(ids.length, origin, width, height, insets);
    if (!layout) {
      this.photoGroup?.(ids); return;
    }
    // Rendered tile coordinates are quantized. Match source thumbnails through
    // the actual photo IDs/coordinates, not equality with the rendered hit point.
    this.spiderCoordKeys = new Set(ids.flatMap(id => {
      const photo = this.photoFeatureById.get(id); return photo ? [photo.geometry.coordinates.join(',')] : [];
    }));
    for (const entry of this.thumbMarkers.values()) entry.element.classList.toggle('is-expanded', this.spiderCoordKeys.has(entry.coordKey));
    const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    lines.setAttribute('width', '1'); lines.setAttribute('height', '1'); lines.classList.add('map-spider-lines'); lines.setAttribute('aria-hidden', 'true');
    const lineRoot = document.createElement('span'); lineRoot.className = 'map-spider-root'; lineRoot.append(lines);
    this.spiderMarkers.push(new Marker({ element: lineRoot, anchor: 'top-left' }).setLngLat(center).addTo(map));
    const hub = { x: layout.center.x - origin.x, y: layout.center.y - origin.y };
    const connect = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(from.x)); line.setAttribute('y1', String(from.y));
      line.setAttribute('x2', String(to.x)); line.setAttribute('y2', String(to.y)); lines.append(line);
    };
    // One trunk to the shifted hub avoids a fan of long lines from the screen edge.
    if (Math.hypot(hub.x, hub.y) > 1) connect({ x: 0, y: 0 }, hub);
    const single = (id: string): CandidateSource => ({ count: 1, page: async () => [id] });
    const empty: CandidateSource = { count: 0, page: async () => [] };
    const buttons: { button: HTMLButtonElement; thumbnailId: string }[] = [];
    for (const [index, id] of ids.entries()) {
      const photo = this.photos.find(item => item.id === id); if (!photo) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'map-spider-photo';
      button.dataset.photoId = id; button.setAttribute('aria-label', photo.originalFilename); button.title = photo.originalFilename;
      button.textContent = String(index + 1);
      button.addEventListener('click', event => {
        event.stopPropagation(); this.onCandidates({ photos: single(id), visits: empty, kind: 'overlap' }); this.clearSpider();
      });
      const point = layout.points[index]!;
      const dx = point.x - origin.x, dy = point.y - origin.y;
      connect(hub, { x: dx, y: dy });
      this.spiderMarkers.push(new Marker({ element: button, anchor: 'center', offset: [dx, dy] }).setLngLat(center).addTo(map));
      if (photo.thumbnailId) buttons.push({ button, thumbnailId: photo.thumbnailId });
    }
    this.spiderMarkers.find(marker => marker.getElement() instanceof HTMLButtonElement)?.getElement().focus({ preventScroll: true });
    // Bounded, sequential thumbnail loads; URLs are released on every dismissal.
    for (const { button, thumbnailId } of buttons) {
      try {
        const thumbnail = await this.thumbnail(thumbnailId);
        if (generation !== this.spiderGeneration) return;
        if (thumbnail) {
          const url = URL.createObjectURL(thumbnail.blob); this.spiderUrls.push(url);
          const img = document.createElement('img'); img.src = url; img.alt = ''; button.replaceChildren(img);
        }
      } catch { /* Numbered, named buttons remain usable without thumbnails. */ }
    }
  }

  setBasemap(enabled: boolean): void {
    if (!this.map || this.failed || this.basemapEnabled === enabled) return;
    this.basemapEnabled = enabled;
    this.basemapError = false;
    this.reportFault(null);
    this.status.textContent = enabled ? 'OpenFreeMapの背景地図を読み込んでいます。' : '背景地図をオフにしました。';
    try { this.map.setStyle(enabled ? openFreeMapTrial.style : localBlankBasemap.style); }
    catch {
      this.basemapEnabled = false;
      this.basemapError = true;
      this.onBasemapState(false);
      this.map.setStyle(localBlankBasemap.style);
      this.reportFault(this.basemapGuide('背景地図のスタイルを読み込めません。'));
      this.updateStatus();
    }
  }

  private updateStatus(): void {
    if (this.failed) return;
    const hasReference = photoPoints(this.photos).features.some(feature => feature.properties.gpsState === 'datum-unknown-reference');
    const location = hasReference ? '黄土色のマーカーやクラスタは測地系不明の参考位置を含みます。' : '';
    const basemap = this.basemapError ? ''
      : this.basemapEnabled ? '' : '背景地図なしで表示しています。';
    const search = this.filterActive ? this.filteredPhotoCount === 0 ? ''
      : this.photoFeatures.length === 0 ? '一致した写真に表示できる位置がありません。写真一覧には残ります。' : '' : '';
    this.status.textContent = `${search}${location}${basemap}`;
  }

  setFilterContext(active: boolean, count: number): void { this.filterActive = active; this.filteredPhotoCount = count; this.updateStatus(); }

  update(photos: Photo[], visits: Visit[], refit = true): void {
    this.clearSpider();
    this.photos = photos; this.visits = visits;
    this.clearThumbnailMarkers();
    const map = this.map;
    if (!this.loaded || !map) return;
    if (!map.getSource('photos') || !map.getSource('visits')) return;
    const points = photoPoints(photos);
    if (this.focusedPhotoIds.size) {
      const counts = new globalThis.Map<string, { total: number; focused: number }>();
      for (const feature of points.features) {
        const key = feature.geometry.coordinates.join(','), entry = counts.get(key) ?? { total: 0, focused: 0 };
        entry.total++; if (this.focusedPhotoIds.has(feature.id)) entry.focused++;
        counts.set(key, entry);
      }
      for (const feature of points.features) {
        const entry = counts.get(feature.geometry.coordinates.join(','))!;
        if (entry.total === entry.focused) feature.properties.visitFocus = true;
      }
    }
    const visitCollection = visitPoints(visits);
    this.photoFeatures = points.features; this.photoFeatureById = new globalThis.Map(points.features.map(feature => [feature.id, feature]));
    this.visitFeatures = visitCollection.features;
    this.sourceRevision++;
    ++this.selectedClusterRequest; this.selectedClusterKey = ''; this.selectCluster(null);
    (map.getSource('photos') as GeoJSONSource).setData(points);
    (map.getSource('visits') as GeoJSONSource).setData(visitCollection);
    this.updateStatus();
    if (!refit) return;
    const coordinates = [
      ...(this.showPhotos ? points.features.map(point => point.geometry.coordinates) : []),
      ...(this.showVisits ? visitCollection.features.map(point => point.geometry.coordinates) : []),
    ];
    const key = coordinates.map(point => point.join(',')).join('|');
    if (key === this.viewportKey) return;
    this.viewportKey = key;
    this.fitCoordinates(coordinates);
  }

  private fitCoordinates(coordinates: [number, number][], singleZoom = 15): boolean {
    const map = this.map;
    if (!map || !coordinates.length) return false;
    const insets = this.viewportInsets?.() ?? this.insets;
    const width = map.getContainer().clientWidth - insets.left - insets.right;
    const height = map.getContainer().clientHeight - insets.top - insets.bottom;
    if (width < 48 || height < 48) return false;
    const margin = Math.min(40, width / 4, height / 4);
    const padding = { top: insets.top + margin, right: insets.right + margin, bottom: insets.bottom + margin, left: insets.left + margin };
    if (coordinates.every(point => point[0] === coordinates[0]![0] && point[1] === coordinates[0]![1])) {
      // A one-shot offset leaves MapLibre's persistent padding unchanged, so
      // later manual pans/zooms and panel closures retain the user's camera.
      map.easeTo({ center: coordinates[0]!, zoom: singleZoom, duration: 0,
        offset: [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2] });
    } else {
      const west = Math.min(...coordinates.map(point => point[0]));
      const east = Math.max(...coordinates.map(point => point[0]));
      const south = Math.min(...coordinates.map(point => point[1]));
      const north = Math.max(...coordinates.map(point => point[1]));
      map.fitBounds([[west, south], [east, north]], { padding, maxZoom: 17, duration: 0 });
    }
    this.onZoomChange(map.getZoom());
    return coordinates.length > 0;
  }

  private clearThumbnailMarkers(): void {
    ++this.thumbGeneration;
    this.thumbQueue = [];
    for (const entry of this.thumbMarkers.values()) {
      entry.marker.remove();
      if (entry.url) URL.revokeObjectURL(entry.url);
    }
    this.thumbMarkers.clear();
  }

  private syncThumbnailMarkers(): void {
    const map = this.map;
    if (!map || !this.loaded || !map.getLayer('photo-points') || !this.showPhotos || map.getZoom() < 10) {
      this.clearThumbnailMarkers(); return;
    }
    const seen = new Set<string>();
    const visible = map.queryRenderedFeatures({ layers: ['photo-points'] });
    const wanted: { id: string; coordinates: [number, number]; coordKey: string; reference: boolean; count: number; focused: number }[] = [];
    const byCoordinates = new globalThis.Map<string, typeof wanted[number]>();
    for (const feature of visible) {
      const id = feature.properties?.id;
      if (typeof id !== 'string' || seen.has(id) || feature.geometry.type !== 'Point') continue;
      seen.add(id);
      const original = this.photoFeatureById.get(id);
      if (!original) continue;
      const coordinates = original.geometry.coordinates;
      const coordKey = coordinates.join(',');
      const existing = byCoordinates.get(coordKey);
      if (existing) { existing.count++; if (this.focusedPhotoIds.has(id)) existing.focused++; continue; }
      if (wanted.length < 64) {
        const item = { id, coordinates, coordKey, reference: feature.properties?.gpsState === 'datum-unknown-reference', count: 1,
          focused: this.focusedPhotoIds.has(id) ? 1 : 0 };
        wanted.push(item); byCoordinates.set(coordKey, item);
      }
    }
    const wantedIds = new Set(wanted.map(item => item.id));
    for (const [id, entry] of this.thumbMarkers) {
      if (wantedIds.has(id)) continue;
      entry.marker.remove(); if (entry.url) URL.revokeObjectURL(entry.url);
      this.thumbMarkers.delete(id);
    }
    const generation = this.thumbGeneration;
    const selected = this.photoFeatureById.get(this.selectedId ?? '')?.geometry.coordinates.join(',');
    for (const item of wanted) {
      const existing = this.thumbMarkers.get(item.id);
      if (existing) {
        existing.element.classList.toggle('is-expanded', this.spiderCoordKeys.has(item.coordKey));
        existing.element.classList.toggle('is-visit-focused', item.focused > 0 && item.focused === item.count);
        existing.element.querySelector('.map-photo-thumb-count')?.replaceChildren(String(item.count)); continue;
      }
      const element = document.createElement('span'); element.className = `map-photo-thumb${item.reference ? ' is-reference' : ''}${item.coordKey === selected ? ' is-selected' : ''}${item.focused > 0 && item.focused === item.count ? ' is-visit-focused' : ''}`;
      element.setAttribute('aria-hidden', 'true'); element.style.pointerEvents = 'none';
      element.classList.toggle('is-expanded', this.spiderCoordKeys.has(item.coordKey));
      const clip = document.createElement('span'); clip.className = 'map-photo-thumb-clip'; element.append(clip);
      const fallback = document.createElement('span'); fallback.className = 'map-photo-thumb-fallback'; fallback.textContent = '📷'; clip.append(fallback);
      if (item.count > 1) { const badge = document.createElement('span'); badge.className = 'map-photo-thumb-count'; badge.textContent = String(item.count); element.append(badge); }
      const marker = new Marker({ element, anchor: 'center' }).setLngLat(item.coordinates).addTo(map);
      const entry = { marker, url: null as string | null, element, coordKey: item.coordKey };
      this.thumbMarkers.set(item.id, entry);
      const thumbnailId = this.photos.find(photo => photo.id === item.id)?.thumbnailId;
      if (!thumbnailId) continue;
      this.thumbQueue.push({ id: item.id, thumbnailId, generation });
    }
    this.loadThumbnailQueue();
  }

  private loadThumbnailQueue(): void {
    while (this.thumbLoading < 4 && this.thumbQueue.length) {
      const task = this.thumbQueue.shift()!;
      const entry = this.thumbMarkers.get(task.id);
      if (!entry || task.generation !== this.thumbGeneration) continue;
      this.thumbLoading++;
      void this.thumbnail(task.thumbnailId).then(thumb => {
        if (!thumb || task.generation !== this.thumbGeneration || this.thumbMarkers.get(task.id) !== entry) return;
        const url = URL.createObjectURL(thumb.blob);
        entry.url = url; entry.element.querySelector('.map-photo-thumb-fallback')?.remove();
        const image = document.createElement('img'); image.alt = ''; image.src = url; entry.element.querySelector('.map-photo-thumb-clip')?.prepend(image);
      }).catch(() => {}).finally(() => { this.thumbLoading--; this.loadThumbnailQueue(); });
    }
  }
}
