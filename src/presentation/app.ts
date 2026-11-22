import { albumIcon } from './album-icons';
import { newTrip, type Photo, type Trip, type Visit } from '../domain/model';
import { sourceGpsDisplay } from '../domain/gps';
import { photoPoints, visitPoints } from '../domain/map';
import { formatOffset, manualGpsCorrection, manualTimeCorrection } from '../domain/corrections';
import { newVisit, reviseVisit } from '../domain/visits';
import { PhotoImporter, type ImportProgress } from '../application/import-photos';
import { LibraryDb, EditConflict, type RecoveryKind } from '../infrastructure/storage';
import { exportArchive, previewArchiveRestore, restoreArchive, streamArchive, verifyExportArchive } from '../infrastructure/archive';
import { PhotoMap, type CandidateSource } from './map';
import { createLayout } from './layout';
import { PhotoGrid } from './photo-grid';
import { emptyPhotoFilter, filterPhotos, isPhotoFilterActive, type PhotoFilter } from './photo-filter';
import { linkedPhotoDateRange, linkedVisitPhotos, visitFocusPhotoIds } from './visit-view';
import { VisitSummary } from './visit-summary';
import { ErrorNotice, storageErrorText } from './error-notice';
import { VisitPhotoEditor } from './visit-photo-editor';
import { PhotoAlbumEditor } from './photo-album-editor';
import { displayCaptureClock } from './date-display';
import { backupCapacityText, backupCapacitySummary } from './backup-capacity';
import { PhotoCorrectionDrafts, type CorrectionFields } from './photo-correction-draft';

const element = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`画面要素がありません: ${selector}`);
  return found;
};
const displayInternalName = (value: string) => value.replace(/^(photo|visit|trip)(?=を|から|へ)/, kind =>
  ({ photo: '写真', visit: 'アルバム', trip: '旅行' })[kind as 'photo' | 'visit' | 'trip'])
  .replaceAll('訪問記録', 'アルバム').replaceAll('Visit', 'アルバム');
const message = (error: unknown) => displayInternalName(storageErrorText(error));

export async function startApp(): Promise<void> {
  const layout = createLayout();
  const errors = new ErrorNotice();
  let hydrated = false;
  const workspaceReady = (ready: boolean) => {
    element('main').inert = !ready; element('.header-actions').inert = !ready; element('.trip-picker').inert = !ready;
    for (const selector of ['#header-add', '#header-manage', '#header-trips', '#trip-select']) element<HTMLButtonElement>(selector).disabled = !ready;
  };
  workspaceReady(false);
  const reloadGuide = (title: string, detail: string) => ({ title, detail, action: { label: '再読み込み', run: () => location.reload() } });
  let opened = false;
  const importStatus = element<HTMLElement>('#import-status');
  const archiveStatus = element<HTMLElement>('#archive-status');
  let db: LibraryDb;
  try {
    db = await LibraryDb.open(undefined, {
      onBlocked: () => errors.showDb('blocked', { title: 'ほかのPhoto Routeタブを閉じてください', detail: 'ほかのタブが保存領域を使用しています。閉じると読み込みを続行します。データは削除しません。' }),
      onVersionChange: () => {
        errors.clearDb('blocked'); errors.showDb('closed', reloadGuide('別のタブで保存領域が更新されました', '接続を閉じました。未保存の内容を確認してから再読み込みしてください。'));
        const disableWrites = () => {
          for (const control of document.querySelectorAll<HTMLButtonElement>('button[type="submit"], #header-add, #header-trips, #trip-management-select, #trip-management-create, #trip-trash, #trip-select, #visit-save, #vpe-save, #pae-save, #trash-commit, #trip-create-submit, #import-button, #restore-button, #restore-copy, #export-button, #stream-export-button, #trash-list button, form[aria-label="GPS補正"] button, form[aria-label="撮影日時補正"] button')) if (!control.disabled) control.disabled = true;
        };
        disableWrites(); new MutationObserver(disableWrites).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
      },
    });
    opened = true; errors.clearDb('blocked');
    const interrupted = (await db.listJobs()).filter(x => x.state === 'interrupted');
    if (interrupted.length) importStatus.textContent = `前回の取り込み${interrupted.length}件が中断されました。保存済み写真は一覧から確認できます。`;
  }
  catch (error) { errors.clearDb('blocked'); errors.showDb('open', reloadGuide(opened ? '保存済みデータを読み込めません' : '保存領域を開けません', `データを削除せず、ブラウザの保存領域設定・空き容量を確認してください。 ${message(error)}`)); return; }
  const tripSelect = element<HTMLSelectElement>('#trip-select');
  const tripName = element<HTMLInputElement>('#trip-name');
  const photoFiles = element<HTMLInputElement>('#photo-files');
  let capacityGeneration = 0;
  async function refreshBackupCapacity(): Promise<void> {
    const generation = ++capacityGeneration;
    const targets = ['#backup-capacity', '#import-backup-capacity', '#restore-backup-capacity'];
    try {
      const counts = await db.backupCounts();
      if (generation !== capacityGeneration) return;
      for (const selector of targets) {
        const files = selector === '#import-backup-capacity' ? photoFiles.files?.length ?? 0 : 0;
        element(`${selector} [data-capacity-summary]`).textContent = backupCapacitySummary(counts, files);
        element(`${selector} [data-capacity-detail]`).textContent = backupCapacityText(counts, files);
      }
    } catch {
      if (generation === capacityGeneration) for (const selector of targets) element(`${selector} [data-capacity-summary]`).textContent = '保存件数を確認できません。上限内か判断できないため、バックアップの保存結果を確認してください。通常保存64 MiB、直接保存256 MiBまでです。';
    }
  }
  element('#header-manage').addEventListener('click', () => { void refreshBackupCapacity(); });
  const importButton = element<HTMLButtonElement>('#import-button');
  const cancelButton = element<HTMLButtonElement>('#cancel-button');
  const duplicateOtherTrip = element<HTMLInputElement>('#duplicate-other-trip');
  const photoList = element<HTMLUListElement>('#photo-list');
  const photoSearch = element<HTMLInputElement>('#photo-search');
  const photoFrom = element<HTMLInputElement>('#photo-date-from');
  const photoTo = element<HTMLInputElement>('#photo-date-to');
  const photoGpsFilter = element<HTMLSelectElement>('#photo-gps-filter');
  const photoVisitFilter = element<HTMLSelectElement>('#photo-visit-filter');
  const photoFilterClear = element<HTMLButtonElement>('#photo-filter-clear');
  const photoFilterMore = element<HTMLDetailsElement>('#photo-filter-more');
  const photoFilterSummary = element<HTMLElement>('#photo-filter-more > summary');
  const photoSearchClear = element<HTMLButtonElement>('#photo-search-clear');
  const photoDateClear = element<HTMLButtonElement>('#photo-date-clear');
  const albumSearch = element<HTMLInputElement>('#album-search');
  const clearAlbumSearch = () => { albumSearch.value = ''; renderVisitList(); albumSearch.focus(); };
  const albumSearchClear = element<HTMLButtonElement>('#album-search-clear');
  albumSearchClear.addEventListener('click', clearAlbumSearch);
  const detail = element<HTMLElement>('#photo-detail');
  const resultList = element<HTMLUListElement>('#import-results');
  const mapChooser = element<HTMLElement>('#map-photo-chooser');
  const mapElement = element<HTMLElement>('#map');
  const markerList = element<HTMLUListElement>('#map-marker-list');
  const markerPrev = element<HTMLButtonElement>('#map-marker-prev');
  const markerNext = element<HTMLButtonElement>('#map-marker-next');
  const mapOptions = element<HTMLUListElement>('#map-photo-options');
  const mapPrev = element<HTMLButtonElement>('#map-choice-prev');
  const mapNext = element<HTMLButtonElement>('#map-choice-next');
  const visitStatus = element<HTMLElement>('#visit-status');
  const visitList = element<HTMLUListElement>('#visit-list');
  const visitOverview = element<HTMLElement>('#visit-summary');
  const visitAll = element<HTMLElement>('#visit-all-photos');
  const visitEditor = element<HTMLElement>('#visit-editor');
  const visitAllList = element<HTMLUListElement>('#visit-all-photo-list');
  const focusBanner = element<HTMLElement>('#visit-focus-banner');
  const visitForm = element<HTMLFormElement>('#visit-form');
  const visitLabel = element<HTMLInputElement>('#visit-label');
  const visitMapChooser = element<HTMLElement>('#visit-map-chooser');
  const visitMapOptions = element<HTMLUListElement>('#visit-map-options');
  const visitPrev = element<HTMLButtonElement>('#visit-choice-prev');
  const visitNext = element<HTMLButtonElement>('#visit-choice-next');
  const photoLayerToggle = element<HTMLInputElement>('#photos-layer-toggle');
  const visitLayerToggle = element<HTMLInputElement>('#visits-layer-toggle');
  const photoModeButton = element<HTMLButtonElement>('#map-mode-photo');
  const visitModeButton = element<HTMLButtonElement>('#map-mode-visits');
  const layerPreferenceKey = 'photo-route-map-layers-v1';
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(layerPreferenceKey) ?? 'null');
    if (saved && typeof saved === 'object' && 'photos' in saved && 'visits' in saved &&
      typeof saved.photos === 'boolean' && typeof saved.visits === 'boolean') {
      photoLayerToggle.checked = saved.photos; visitLayerToggle.checked = saved.visits;
    }
  } catch { /* Private mode or an invalid old preference keeps the safe default. */ }
  const recoveryStatus = element<HTMLElement>('#recovery-status');
  const trashList = element<HTMLUListElement>('#trash-list');
  const trashConfirm = element<HTMLElement>('#trash-confirm');
  const restoreConflict = element<HTMLElement>('#restore-conflict');
  const archiveFile = element<HTMLInputElement>('#archive-file');
  let importer: PhotoImporter | null = null;
  let photos: Photo[] = [];
  let trips: Trip[] = [];
  let visits: Visit[] = [];
  let albumIdsByPhoto = new Map<string, string[]>();
  let photoIdsByAlbum = new Map<string, Set<string>>();
  let linkedPhotoIds = new Set<string>();
  const noPhotoIds = new Set<string>();
  const albumPhotoIds = (albumId: string): ReadonlySet<string> => photoIdsByAlbum.get(albumId) ?? noPhotoIds;
  let displayedPhotos: Photo[] = [];
  let mapPhotos: Photo[] = [];
  let displayedVisits: Visit[] = [];
  let photoFilter: PhotoFilter = emptyPhotoFilter();
  let selectedPhotoId: string | null = null;
  let selectedVisitId: string | null = null;
  let visitView: 'summary' | 'all' | 'edit' | 'create' = 'summary';
  let returnToVisitId: string | null = null;
  let visitReturn: { id: string; view: 'summary' | 'all'; scroll: number } | null = null;
  let focusedVisitId: string | null = null;
  let detailGeneration = 0;
  let photoDetailMode: 'preview' | 'full' = 'preview';
  let photoAdvancedOpen = false;
  let draftPhotoId: string | null = null;
  let albumCreationTrip: string | null = null;
  let pendingAlbumCreation: Visit | null = null;
  let albumSaving = false, albumCreationUnknown = false;
  let justCreatedAlbum: string | null = null;
  const correctionDrafts = new PhotoCorrectionDrafts();
  const correctionExpected = new Map<string, Pick<Photo, 'gpsCorrection' | 'timeCorrection'>>();
  let expectedVisit: Visit | null = null;
  let albumEditGeneration = 0;
  let correctionNavigationApproved = false;
  let pendingCorrectionLeave: (() => void) | null = null;
  let discardPendingInputs: (() => void) | null = null;
  let correctionWrites = 0;
  const correctionLeave = document.createElement('dialog'); correctionLeave.id = 'photo-correction-leave';
  correctionLeave.setAttribute('aria-labelledby', 'correction-leave-title');
  correctionLeave.innerHTML = `<h2 id="correction-leave-title">写真の補正入力が未保存です</h2><p>入力を保持して移動できます。保存する場合は編集を続けてください。</p><div class="row"><button id="correction-leave-stay" type="button">編集を続ける</button><button id="correction-leave-keep" type="button">入力を保持して移動</button><button id="correction-leave-discard" type="button">入力を破棄して移動</button></div>`;
  document.body.append(correctionLeave);
  const requestCorrectionLeave = (proceed: () => void) => {
    if (correctionWrites) return;
    if (correctionNavigationApproved || !correctionDrafts.dirty(selectedPhotoId)) { proceed(); return; }
    element('#correction-leave-title').textContent = '写真の補正入力が未保存です';
    const id = selectedPhotoId; discardPendingInputs = () => { if (id) correctionDrafts.discard(id); };
    pendingCorrectionLeave = proceed;
    if (!correctionLeave.open) correctionLeave.showModal();
    element<HTMLButtonElement>('#correction-leave-stay').focus();
  };
  correctionLeave.addEventListener('cancel', event => { event.preventDefault(); pendingCorrectionLeave = null; correctionLeave.close(); });
  element('#correction-leave-stay').addEventListener('click', () => { pendingCorrectionLeave = null; correctionLeave.close(); });
  for (const action of ['keep', 'discard']) element(`#correction-leave-${action}`).addEventListener('click', () => {
    if (action === 'discard') discardPendingInputs?.(); discardPendingInputs = null;
    const proceed = pendingCorrectionLeave; pendingCorrectionLeave = null; correctionLeave.close();
    correctionNavigationApproved = true;
    try { proceed?.(); } finally { correctionNavigationApproved = false; }
  });
  type VisitFormValues = { label: string };
  const visitFormValues = (): VisitFormValues => ({
    label: visitLabel.value,
  });
  let savedVisitFormValues = visitFormValues();
  const sameVisitFormValues = (a: VisitFormValues, b: VisitFormValues) =>
    a.label === b.label;
  const hasUnsavedVisitInput = () =>
    draftPhotoId !== null || !sameVisitFormValues(visitFormValues(), savedVisitFormValues);
  const requestNameLeave = (proceed: () => void) => {
    if (!hasUnsavedVisitInput()) { proceed(); return; }
    element('#correction-leave-title').textContent = 'アルバム名が未保存です';
    discardPendingInputs = () => { visitLabel.value = savedVisitFormValues.label; draftPhotoId = null; };
    pendingCorrectionLeave = proceed;
    if (!correctionLeave.open) correctionLeave.showModal(); element<HTMLButtonElement>('#correction-leave-stay').focus();
  };
  const mayDiscardVisitInput = () =>
    !hasUnsavedVisitInput() || window.confirm('アルバムの未保存の入力があります。破棄して移動しますか？');
  window.addEventListener('beforeunload', event => {
    if (hasUnsavedVisitInput() || correctionDrafts.hasChanges || importer !== null || albumSaving || albumCreationUnknown) { event.preventDefault(); event.returnValue = ''; }
  });
  let activeTripId = tripSelect.value;
  let tripSelectionRender = Promise.resolve();
  let pendingTrash: { kind: RecoveryKind; id: string; label: string } | null = null;
  let pendingRestoreFile: File | null = null;
  let currentThumbUrl: string | null = null;
  const photoGrid = new PhotoGrid(photoList, element('#left-panel'), id => db.getThumbnail(id), id => choosePhoto(id));
  let mapPhotoGroup: { ids: Set<string>; tripId: string } | null = null;
  let regularPhotoScroll = 0;
  function updatePhotoGrid(): void {
    if (mapPhotoGroup && mapPhotoGroup.tripId !== tripSelect.value) mapPhotoGroup = null;
    const group = mapPhotoGroup;
    element('#map-photo-group').hidden = !group;
    document.body.dataset.mapPhotoGroup = String(Boolean(group));
    const groupPhotos = group ? photos.filter(photo => photo.tripId === group.tripId && !photo.deletedAt && group.ids.has(photo.id)) : null;
    if (groupPhotos) element('#map-photo-group-heading').textContent = `この地点の写真 ${groupPhotos.length}枚`;
    const active = isPhotoFilterActive(photoFilter);
    photoGrid.setPhotos(groupPhotos ?? displayedPhotos, group ? `map-group:${group.tripId}` : tripSelect.value || 'unclassified',
      active ? '検索条件に一致する写真がありません。' : tripSelect.value ? 'この旅行に写真はありません。' : '旅行未設定の写真はありません。');
    photoGrid.select(selectedPhotoId);
  }
  element('#map-photo-group-back').addEventListener('click', () => {
    mapPhotoGroup = null; updatePhotoGrid();
    requestAnimationFrame(() => { element('#left-panel').scrollTop = regularPhotoScroll; });
  });

  let visitListGeneration = 0;
  const visitListThumbUrls: string[] = [];
  const visitListThumbObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const cover = entry.target as HTMLElement;
      visitListThumbObserver.unobserve(cover);
      const thumbnailId = cover.dataset.thumbnailId;
      if (!thumbnailId) continue;
      const generation = visitListGeneration;
      void db.getThumbnail(thumbnailId).then(found => {
        if (generation !== visitListGeneration || !cover.isConnected) return;
        if (!found) { cover.textContent = '画像なし'; return; }
        const url = URL.createObjectURL(found.blob);
        visitListThumbUrls.push(url);
        const image = document.createElement('img'); image.src = url; image.alt = '';
        cover.replaceChildren(image);
      }).catch(() => { if (generation === visitListGeneration && cover.isConnected) cover.textContent = '画像なし'; });
    }
  }, { root: element('#left-panel'), rootMargin: '120px' });
  const rememberVisit = () => {
    returnToVisitId = selectedVisitId;
    visitReturn = selectedVisitId ? { id: selectedVisitId, view: visitView === 'all' ? 'all' : 'summary', scroll: element('#right-panel').scrollTop } : null;
  };
  const visitPhotoGrid = new PhotoGrid(visitAllList, element('#right-panel'), id => db.getThumbnail(id), id => choosePhoto(id, true));
  const visitSummary = new VisitSummary(visitOverview, id => db.getThumbnail(id), id => choosePhoto(id, true),
    () => showVisitAll(), () => startVisitFocus(), () => openVisitEdit(), () => openAlbumPhotos(), () => { const visit = visits.find(item => item.id === selectedVisitId); if (visit) stageTrash('visit', visit.id, visit.label); });
  const editorPhotoSummary = new VisitSummary(element('#visit-editor-preview'), id => db.getThumbnail(id), () => {}, () => {}, () => {}, () => {});
  const visitPhotoEditor = new VisitPhotoEditor(db, () => render(), () => {
    const id = selectedVisitId;
    if (id) {
      visitView = 'summary'; showVisit(id);
      element('#visit-summary').querySelector<HTMLButtonElement>('.visit-summary-actions button:last-child')?.focus();
    }
  });
  const photoAlbumEditor = new PhotoAlbumEditor(db, () => render());
  layout.onNavigate((proceed, leavesDetail) => {
    if (albumSaving || albumCreationUnknown) { visitStatus.textContent = albumSaving ? '保存中です。完了を待ってください。' : '保存結果を確認してから画面を閉じてください。'; return; }
    const next = () => {
      if (!leavesDetail) { proceed(); return; }
      if (element('#right-panel').dataset.view === 'visit') requestNameLeave(proceed); else requestCorrectionLeave(proceed);
    };
    if (photoAlbumEditor.isOpen) photoAlbumEditor.requestLeave(next); else visitPhotoEditor.requestLeave(next);
  });
  const emptyCandidates: CandidateSource = { count: 0, page: async () => [] };
  let candidateSource: CandidateSource = emptyCandidates;
  let candidatePage = 0;
  let candidateGeneration = 0;
  let visitCandidateSource: CandidateSource = emptyCandidates;
  let visitCandidatePage = 0;
  let visitCandidateGeneration = 0;
  let candidateThumbUrls: string[] = [];
  type MarkerEntry = { kind: 'photo' | 'visit'; id: string; label: string };
  let markerEntries: MarkerEntry[] = [];
  let markerPage = 0;
  const syncMarkerSelection = () => {
    for (const button of markerList.querySelectorAll<HTMLButtonElement>('button[data-marker-id]')) {
      button.setAttribute('aria-pressed', String(button.dataset.markerId === (button.dataset.markerKind === 'photo' ? selectedPhotoId : selectedVisitId)));
    }
  };
  const renderMarkerIndex = () => {
    const pageSize = 100;
    markerPage = Math.min(markerPage, Math.max(0, Math.ceil(markerEntries.length / pageSize) - 1));
    const visible = markerEntries.slice(markerPage * pageSize, (markerPage + 1) * pageSize);
    element('#map-marker-count').textContent = markerEntries.length ? `${markerEntries.length}地点中 ${markerPage * pageSize + 1}〜${markerPage * pageSize + visible.length}地点` : '表示できる地点はありません';
    markerList.replaceChildren();
    for (const entry of visible) {
      const item = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
      button.textContent = entry.label; button.dataset.markerId = entry.id; button.dataset.markerKind = entry.kind;
      button.addEventListener('click', () => { layout.closeManagement(); if (entry.kind === 'photo') choosePhoto(entry.id); else showVisit(entry.id); });
      item.append(button); markerList.append(item);
    }
    syncMarkerSelection();
    markerPrev.disabled = markerPage === 0; markerNext.disabled = (markerPage + 1) * pageSize >= markerEntries.length;
  };
  const revealMarkerSelection = (kind: MarkerEntry['kind'], id: string) => {
    const index = markerEntries.findIndex(entry => entry.kind === kind && entry.id === id);
    if (index >= 0 && Math.floor(index / 100) !== markerPage) { markerPage = Math.floor(index / 100); renderMarkerIndex(); }
    else syncMarkerSelection();
  };
  const refreshMarkerIndex = () => {
    const tripId = tripSelect.value || null;
    const shownPhotos = mapPhotos.filter(photo => photo.tripId === tripId && !photo.deletedAt);
    const shownVisits = visits.filter(visit => visit.tripId === tripId && !visit.deletedAt);
    const photoIds = focusedVisitId || photoLayerToggle.checked ? new Set(photoPoints(shownPhotos).features.map(point => point.id)) : new Set<string>();
    const visitIds = !focusedVisitId && visitLayerToggle.checked ? new Set(visitPoints(shownVisits).features.map(point => point.id)) : new Set<string>();
    markerEntries = [
      ...shownPhotos.filter(photo => photoIds.has(photo.id)).map(photo => ({ kind: 'photo' as const, id: photo.id, label: `写真: ${photo.originalFilename}${sourceGpsDisplay(photo.sourceGps).state === 'reference' && !photo.gpsCorrection ? '（測地系不明の参考位置）' : ''}` })),
      ...shownVisits.filter(visit => visitIds.has(visit.id)).map(visit => ({ kind: 'visit' as const, id: visit.id, label: `アルバム: ${visit.label}` })),
    ];
    renderMarkerIndex();
  };
  markerPrev.addEventListener('click', () => { markerPage--; renderMarkerIndex(); markerList.querySelector('button')?.focus(); });
  markerNext.addEventListener('click', () => { markerPage++; renderMarkerIndex(); markerList.querySelector('button')?.focus(); });
  const clearCandidateThumbs = () => { for (const url of candidateThumbUrls) URL.revokeObjectURL(url); candidateThumbUrls = []; };
  const renderCandidates = async () => {
    const pageSize = 100, start = candidatePage * pageSize;
    const generation = ++candidateGeneration;
    clearCandidateThumbs(); mapOptions.replaceChildren();
    element('#map-choice-count').textContent = `${candidateSource.count}件中 ${start + 1}〜${Math.min(start + pageSize, candidateSource.count)}件`;
    mapPrev.disabled = candidatePage === 0;
    mapNext.disabled = start + pageSize >= candidateSource.count;
    const loading = document.createElement('li'); loading.textContent = '候補を読み込み中'; mapOptions.append(loading);
    let visible: string[];
    try { visible = await candidateSource.page(start, pageSize); }
    catch { if (generation === candidateGeneration) loading.textContent = '候補を開けません。写真一覧から選択できます。'; return; }
    if (generation !== candidateGeneration || mapChooser.hidden) return;
    mapOptions.replaceChildren();
    for (const [index, id] of visible.entries()) {
      const photo = photos.find(item => item.id === id);
      if (!photo) continue;
      const item = document.createElement('li');
      const button = document.createElement('button'); button.type = 'button'; button.textContent = photo.originalFilename;
      button.className = 'map-photo-option';
      if (photo.thumbnailId && index < 24) {
        void db.getThumbnail(photo.thumbnailId).then(thumbnail => {
          if (!thumbnail || generation !== candidateGeneration || !button.isConnected || mapChooser.hidden) return;
          const image = document.createElement('img'); image.alt = ''; image.src = URL.createObjectURL(thumbnail.blob);
          candidateThumbUrls.push(image.src); button.prepend(image);
        }).catch(() => {});
      }
      button.addEventListener('click', () => { void showDetail(id); }); item.append(button); mapOptions.append(item);
    }
    mapOptions.querySelector('button')?.focus();
  };
  const renderVisitCandidates = async () => {
    const pageSize = 100, start = visitCandidatePage * pageSize;
    const generation = ++visitCandidateGeneration;
    visitMapOptions.replaceChildren();
    element('#visit-choice-count').textContent = `${visitCandidateSource.count}件中 ${start + 1}〜${Math.min(start + pageSize, visitCandidateSource.count)}件`;
    visitPrev.disabled = visitCandidatePage === 0;
    visitNext.disabled = start + pageSize >= visitCandidateSource.count;
    const loading = document.createElement('li'); loading.textContent = '候補を読み込み中'; visitMapOptions.append(loading);
    let visible: string[];
    try { visible = await visitCandidateSource.page(start, pageSize); }
    catch { if (generation === visitCandidateGeneration) loading.textContent = '候補を開けません。アルバム一覧から選択できます。'; return; }
    if (generation !== visitCandidateGeneration || visitMapChooser.hidden) return;
    visitMapOptions.replaceChildren();
    for (const id of visible) {
      const visit = visits.find(item => item.id === id);
      if (!visit) continue;
      const item = document.createElement('li'); const button = document.createElement('button');
      button.type = 'button'; button.textContent = `${visit.label} — ${visit.createdAt}`;
      button.addEventListener('click', () => showVisit(visit.id)); item.append(button); visitMapOptions.append(item);
    }
    visitMapOptions.querySelector('button')?.focus();
  };
  const map = new PhotoMap(mapElement, element('#map-status'), ({ photos: photoCandidates, visits: visitCandidates, kind }) => {
    candidateSource = photoCandidates;
    visitCandidateSource = visitCandidates;
    if (photoCandidates.count === 1 && visitCandidates.count === 0) {
      const generation = ++candidateGeneration;
      void photoCandidates.page(0, 1).then(ids => { if (generation === candidateGeneration && ids[0]) choosePhoto(ids[0]); }).catch(() => {});
      return;
    }
    if (visitCandidates.count === 1 && photoCandidates.count === 0) {
      const generation = ++visitCandidateGeneration;
      void visitCandidates.page(0, 1).then(ids => { if (generation === visitCandidateGeneration && ids[0]) showVisit(ids[0]); }).catch(() => {});
      return;
    }
    if (photoCandidates.count) {
      candidatePage = 0;
      mapChooser.dataset.kind = kind;
      element('#map-choice-heading').textContent = kind === 'cluster' ? 'クラスタ内の写真を選択' : '重なった地点の写真を選択';
      mapChooser.hidden = false; void renderCandidates();
    } else { ++candidateGeneration; mapChooser.hidden = true; clearCandidateThumbs(); }
    visitCandidatePage = 0;
    visitMapChooser.hidden = visitCandidates.count === 0;
    if (visitCandidates.count) void renderVisitCandidates(); else ++visitCandidateGeneration;
  }, () => {}, () => {
  }, zoom => { element('#map-zoom-level').textContent = `ズーム: ${zoom.toFixed(1)}`; }, id => db.getThumbnail(id));
  map.onPhotoGroup(ids => layout.requestNavigation(() => {
    if (!mapPhotoGroup) regularPhotoScroll = element('#left-panel').scrollTop;
    mapPhotoGroup = { ids: new Set(ids), tripId: tripSelect.value };
    layout.openPhotoList(); updatePhotoGrid(); element('#left-panel').scrollTop = 0; element('#map-photo-group-back').focus();
  }, true));
  map.onFault(fault => errors.showMap(fault));
  layout.onViewportChange(insets => map.setViewportPadding(insets));
  map.setViewportInsetsProvider(layout.mapViewportInsets);
  const clearPhotoSelection = () => {
    ++detailGeneration; selectedPhotoId = null; photoGrid.select(null); map.selectPhoto(null); clearThumb();
    returnToVisitId = null; visitReturn = null;
  };
  map.onBackgroundClick(() => {
    if (photoAlbumEditor.isOpen || visitPhotoEditor.isOpen || correctionLeave.open || correctionWrites
      || element<HTMLDialogElement>('#management-panel').open || element<HTMLDialogElement>('#photo-import-dialog').open) return;
    if (!visitMapChooser.hidden) { visitMapChooser.hidden = true; return; }
    if (!mapChooser.hidden) { ++candidateGeneration; mapChooser.hidden = true; clearCandidateThumbs(); return; }
    if (layout.isDetailOpen()) {
      if (element('#right-panel').dataset.view === 'photo') {
        if (correctionDrafts.dirty(selectedPhotoId) || photoDetailMode === 'full' && photoAdvancedOpen) return;
        clearPhotoSelection();
      } else if (visitView === 'edit' || visitView === 'create') return;
      else map.selectVisit(null);
      layout.closeRight(); return;
    }
    layout.closeLeft();
  });
  map.setLayerVisibility(photoLayerToggle.checked, visitLayerToggle.checked);
  const syncMapMode = () => {
    const photoMode = photoLayerToggle.checked && !visitLayerToggle.checked;
    const visitMode = visitLayerToggle.checked && !photoLayerToggle.checked;
    photoModeButton.setAttribute('aria-pressed', String(photoMode));
    visitModeButton.setAttribute('aria-pressed', String(visitMode));
    const custom = element('#map-mode-custom-status'); custom.hidden = photoMode || visitMode;
    custom.textContent = photoLayerToggle.checked ? '写真とアルバムを重ねて表示中' : '地図の地点を非表示中';
  };
  const updateLayers = () => {
    if (focusedVisitId) endVisitFocus(false);
    map.setLayerVisibility(photoLayerToggle.checked, visitLayerToggle.checked);
    syncMapMode();
    try { localStorage.setItem(layerPreferenceKey, JSON.stringify({ photos: photoLayerToggle.checked, visits: visitLayerToggle.checked })); }
    catch { /* The current tab still keeps the chosen layers. */ }
    if (!photoLayerToggle.checked) { mapChooser.hidden = true; clearCandidateThumbs(); }
    if (!visitLayerToggle.checked) visitMapChooser.hidden = true;
    markerPage = 0; refreshMarkerIndex();
  };
  photoLayerToggle.addEventListener('change', updateLayers);
  visitLayerToggle.addEventListener('change', updateLayers);
  syncMapMode();
  photoModeButton.addEventListener('click', () => { photoLayerToggle.checked = true; visitLayerToggle.checked = false; updateLayers(); });
  visitModeButton.addEventListener('click', () => { photoLayerToggle.checked = false; visitLayerToggle.checked = true; updateLayers(); });
  const refreshPhotoPresentation = (refit: boolean) => {
    const tripId = tripSelect.value || null;
    const all = photos.filter(photo => photo.tripId === tripId && !photo.deletedAt);
    displayedPhotos = filterPhotos(all, photoFilter, linkedPhotoIds, albumIdsByPhoto);
    mapPhotos = displayedPhotos;
    const focused = focusedVisitId;
    if (focused) {
      const focusedIds = albumPhotoIds(focused);
      mapPhotos = all.filter(photo => focusedIds.has(photo.id));
      const name = visits.find(visit => visit.id === focused)?.label ?? '';
      element('#visit-focus-message').textContent = `アルバム：${name}`;
      element('#visit-focus-empty').hidden = photoPoints(mapPhotos).features.length > 0;
    }
    displayedVisits = visits.filter(visit => visit.tripId === tripId && !visit.deletedAt);
    const active = isPhotoFilterActive(photoFilter);
    element('#photo-count').textContent = active ? `写真 ${displayedPhotos.length}枚 / 全${all.length}枚` : `写真 ${all.length}枚`;
    photoFilterClear.disabled = !active;
    photoSearchClear.hidden = photoSearch.value.length === 0;
    photoDateClear.disabled = !photoFilter.fromDay && !photoFilter.toDay;
    const conditionCount = Number(Boolean(photoFilter.fromDay || photoFilter.toDay)) + Number(photoFilter.gps !== 'all') + Number(photoFilter.visit !== 'all');
    const badge = element('#photo-filter-badge'); badge.hidden = conditionCount === 0; badge.textContent = String(conditionCount);
    photoFilterSummary.dataset.active = String(conditionCount > 0);
    photoFilterSummary.setAttribute('aria-label', conditionCount ? `日付・位置・アルバムで絞り込む（追加条件${conditionCount}件）` : '日付・位置・アルバムで絞り込む');
    element('#photo-empty-clear').hidden = !active || displayedPhotos.length !== 0 || photoFilterMore.open;
    updatePhotoGrid();
    mapChooser.hidden = true; clearCandidateThumbs(); visitMapChooser.hidden = true;
    map.setFilterContext(!focusedVisitId && active, displayedPhotos.length);
    map.update(mapPhotos, displayedVisits, refit && !focusedVisitId);
    refreshMarkerIndex();
  };
  function startVisitFocus(): void {
    const visit = visits.find(item => item.id === selectedVisitId && !item.deletedAt);
    if (!visit) return;
    const linked = linkedVisitPhotos(photos, visit, albumPhotoIds(visit.id));
    const focus = visitFocusPhotoIds(linked);
    focusedVisitId = visit.id;
    map.setFocusedPhotoIds([], false);
    map.setLayerVisibility(true, false, false);
    if (matchMedia('(max-width: 700px)').matches) layout.selectTab('map');
    else layout.closeRight();
    refreshPhotoPresentation(false);
    focusBanner.hidden = false;
    map.fitPhotoIds(focus.all);
  }
  function endVisitFocus(returnToSummary: boolean): void {
    const visitId = focusedVisitId;
    if (!visitId) return;
    focusedVisitId = null; focusBanner.hidden = true;
    map.setFocusedPhotoIds([], false);
    map.setLayerVisibility(photoLayerToggle.checked, visitLayerToggle.checked, false);
    refreshPhotoPresentation(false);
    if (returnToSummary && visits.some(visit => visit.id === visitId && !visit.deletedAt)) {
      if (matchMedia('(max-width: 700px)').matches) layout.selectTab('visits');
      visitView = 'summary'; showVisit(visitId);
    }
  }
  element<HTMLButtonElement>('#visit-focus-exit').addEventListener('click', () => { endVisitFocus(false); mapElement.focus(); });
  const applyPhotoFilter = () => {
    photoFilter = { filename: photoSearch.value, fromDay: photoFrom.value, toDay: photoTo.value,
      gps: photoGpsFilter.value as PhotoFilter['gps'], visit: photoVisitFilter.value as PhotoFilter['visit'] };
    markerPage = 0;
    refreshPhotoPresentation(false);
  };
  photoSearch.addEventListener('input', applyPhotoFilter);
  albumSearch.addEventListener('input', renderVisitList);
  for (const field of [photoFrom, photoTo, photoGpsFilter, photoVisitFilter]) field.addEventListener('change', applyPhotoFilter);
  photoFilterClear.addEventListener('click', () => {
    photoSearch.value = ''; photoFrom.value = ''; photoTo.value = ''; photoGpsFilter.value = 'all'; photoVisitFilter.value = 'all';
    applyPhotoFilter(); photoSearch.focus();
  });
  photoSearchClear.addEventListener('click', () => { photoSearch.value = ''; applyPhotoFilter(); photoSearch.focus(); });
  photoDateClear.addEventListener('click', () => { photoFrom.value = ''; photoTo.value = ''; applyPhotoFilter(); photoFrom.focus(); });
  photoFilterMore.addEventListener('toggle', () => {
    element('#photo-empty-clear').hidden = !isPhotoFilterActive(photoFilter) || displayedPhotos.length !== 0 || photoFilterMore.open;
  });
  element('#photo-empty-clear').addEventListener('click', () => { photoFilterMore.open = true; photoFilterSummary.focus(); });
  element<HTMLButtonElement>('#map-zoom-in').addEventListener('click', () => map.zoomBy(1));
  element<HTMLButtonElement>('#map-zoom-out').addEventListener('click', () => map.zoomBy(-1));
  element<HTMLButtonElement>('#map-fit').addEventListener('click', () => { layout.closeManagement(); map.fitVisible(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const hadChooser = !mapChooser.hidden || !visitMapChooser.hidden;
    map.setVisitCreationMode(false); mapChooser.hidden = true; visitMapChooser.hidden = true; clearCandidateThumbs();
    if (hadChooser) mapElement.focus();
  });
  mapElement.addEventListener('keydown', event => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); map.zoomBy(1); }
    if (event.key === '-') { event.preventDefault(); map.zoomBy(-1); }
  });
  mapPrev.addEventListener('click', () => { candidatePage--; renderCandidates(); });
  mapNext.addEventListener('click', () => { candidatePage++; renderCandidates(); });
  visitPrev.addEventListener('click', () => { visitCandidatePage--; renderVisitCandidates(); });
  visitNext.addEventListener('click', () => { visitCandidatePage++; renderVisitCandidates(); });
  element<HTMLButtonElement>('#map-choice-close').addEventListener('click', () => { mapChooser.hidden = true; clearCandidateThumbs(); mapElement.focus(); });
  element<HTMLButtonElement>('#visit-map-close').addEventListener('click', () => { visitMapChooser.hidden = true; mapElement.focus(); });
  const clearThumb = () => { if (currentThumbUrl) URL.revokeObjectURL(currentThumbUrl); currentThumbUrl = null; };

  function stageTrash(kind: RecoveryKind, id: string, label: string): void {
    pendingTrash = { kind, id, label };
    const affected = kind === 'trip' ? `所属する写真${photos.filter(photo => photo.tripId === id && !photo.deletedAt).length}件とアルバム${visits.filter(visit => visit.tripId === id && !visit.deletedAt).length}件も表示から隠れます。復元すると再表示されます。`
      : kind === 'visit' ? `所属する写真${photos.filter(photo => albumPhotoIds(id).has(photo.id) && !photo.deletedAt).length}件は残り、アルバムとの関係も保持されます。` : 'サムネイルとアルバムとの関係を保持します。';
    element('#trash-confirm-text').textContent = `${kind === 'photo' ? '写真本体' : ''}「${label}」をごみ箱へ移動します。${affected}端末内スナップショットは外部バックアップではありません。必要なら先にZIPを書き出してください。`;
    trashConfirm.hidden = false;
    layout.openManagement('recovery');
    element<HTMLButtonElement>('#trash-commit').focus();
  }

  async function renderRecovery(): Promise<void> {
    trashList.replaceChildren();
    const deleted = [
      ...trips.filter(item => item.deletedAt).map(item => ({ kind: 'trip' as const, id: item.id, label: `旅行: ${item.name}` })),
      ...visits.filter(item => item.deletedAt).map(item => ({ kind: 'visit' as const, id: item.id, label: `アルバム: ${item.label}` })),
      ...photos.filter(item => item.deletedAt).map(item => ({ kind: 'photo' as const, id: item.id, label: `写真: ${item.originalFilename}` })),
    ];
    element('#trash-count').textContent = `${deleted.length}件`;
    element('#trash-empty').hidden = deleted.length > 0;
    const trashSection = element<HTMLDetailsElement>('#trash-section');
    trashSection.hidden = deleted.length === 0;
    if (!deleted.length) trashSection.open = false;
    if (!deleted.length) { const item = document.createElement('li'); item.textContent = 'ごみ箱は空です'; trashList.append(item); }
    for (const item of deleted) {
      const row = document.createElement('li'); const button = document.createElement('button');
      button.type = 'button'; button.textContent = `${item.label}を復元`;
      button.addEventListener('click', () => { void db.restoreFromTrash(item.kind, item.id).then(async () => { recoveryStatus.textContent = `${item.label}を復元しました`; await render(); }).catch(error => { recoveryStatus.textContent = `復元できません: ${message(error)}`; }); });
      row.append(button); trashList.append(row);
    }
  }

  element<HTMLButtonElement>('#trash-commit').addEventListener('click', () => {
    if (!pendingTrash) return;
    const target = pendingTrash;
    if ((target.kind === 'visit' && target.id === selectedVisitId || target.kind === 'trip' && target.id === activeTripId) && !mayDiscardVisitInput()) return;
    const button = element<HTMLButtonElement>('#trash-commit'); button.disabled = true;
    let committed = false;
    void db.moveToTrash(target.kind, target.id).then(async () => {
      committed = true;
      pendingTrash = null; trashConfirm.hidden = true;
      if (target.kind === 'visit' && target.id === selectedVisitId || target.kind === 'trip' && target.id === activeTripId) resetVisitForm();
      if (target.kind === 'photo') selectedPhotoId = null;
      recoveryStatus.textContent = `${target.label}をごみ箱へ移動しました。ごみ箱から復元できます。`;
      await render();
      if (target.kind === 'photo' || target.kind === 'visit') {
        layout.closeManagement();
      } else {
        element<HTMLDetailsElement>('#trash-section').open = true;
        element('#recovery-heading').closest('section')?.scrollIntoView({ block: 'start' });
      }
    }).catch(async error => {
      pendingTrash = null; trashConfirm.hidden = true;
      recoveryStatus.textContent = committed
        ? `移動は確定しましたが、表示を更新できません: ${message(error)}。保存は再送せず、ごみ箱を確認してください。`
        : `ごみ箱への移動結果を確認できません: ${message(error)}。保存は再送せず、ごみ箱を確認してください。`;
      if (!committed) {
        try { await render(); } catch { /* The read error banner provides the existing safe retry. */ }
      }
    }).finally(() => { button.disabled = false; });
  });
  element<HTMLButtonElement>('#trash-cancel').addEventListener('click', () => { pendingTrash = null; trashConfirm.hidden = true; recoveryStatus.textContent = '移動をキャンセルしました'; });


  function resetVisitForm(): void {
    selectedVisitId = null; draftPhotoId = null; expectedVisit = null; albumEditGeneration++; visitStatus.replaceChildren();
    albumCreationTrip = null; pendingAlbumCreation = null; justCreatedAlbum = null;
    visitView = 'summary'; returnToVisitId = null; visitReturn = null;
    visitSummary.clear(); visitPhotoGrid.setPhotos([], 'no-visit');
    editorPhotoSummary.clear();
    visitOverview.hidden = true; visitAll.hidden = true; visitEditor.hidden = true;
    map.setVisitCreationMode(false); map.selectVisit(null);
    visitForm.reset();
    savedVisitFormValues = visitFormValues();
    element('#visit-form-heading').textContent = '新規アルバム';
    element('#visit-form-source').textContent = '';
    element('#visit-linked-photos').replaceChildren();
    for (const button of visitList.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', 'false');
  }

  function setVisitPanelMode(): void {
    element('#right-panel').dataset.visitMode = visitView;
    visitOverview.hidden = visitView !== 'summary';
    visitAll.hidden = visitView !== 'all';
    visitEditor.hidden = visitView !== 'edit' && visitView !== 'create';
    element<HTMLButtonElement>('#visit-photo-edit-open').hidden = visitView === 'create';
    element<HTMLButtonElement>('#visit-edit-back').hidden = false;
    updateAlbumFormControls();
    if (visitView !== 'all') visitPhotoGrid.setPhotos([], 'no-visit');
    element('#visit-detail-panel > h2').textContent = visitView === 'edit' || visitView === 'create' ? 'アルバムの編集' : 'アルバム';
    if (element('#right-panel').dataset.view === 'visit') element('#right-panel .panel-top strong').textContent = visitView === 'create' ? '新規アルバム' : visitView === 'edit' ? 'アルバムを編集' : 'アルバム';
  }

  function showVisitAll(): void {
    const visit = visits.find(item => item.id === selectedVisitId && !item.deletedAt);
    if (!visit) return;
    visitView = 'all'; setVisitPanelMode();
    element('#visit-all-heading').textContent = visit.label;
    const linked = linkedVisitPhotos(photos, visit, albumPhotoIds(visit.id));
    element('#visit-all-count').textContent = `${linked.length}枚`;
    visitPhotoGrid.setPhotos(linked, `visit:${visit.id}`, 'このアルバムに写真はありません');
    element('#right-panel').scrollTop = 0;
    requestAnimationFrame(() => { if (visitView === 'all') element('#right-panel').scrollTop = 0; });
  }

  function openVisitEdit(): void {
    if (!selectedVisitId) return;
    albumEditGeneration++; visitStatus.replaceChildren();
    visitView = 'edit'; showVisit(selectedVisitId, false); setVisitPanelMode();
    layout.prepareVisitEditor();
    element('#right-panel').scrollTop = 0;
    visitLabel.focus();
  }

  function openAlbumPhotos(): void {
    if (hasUnsavedVisitInput()) { visitStatus.textContent = 'アルバム名を保存するか、概要へ戻ってから写真を選択してください。'; return; }
    const selected = selectedVisitId;
    if (!selected) return;
    void Promise.all([db.getTrip(tripSelect.value), db.listVisits(), db.listPhotos(), db.listPhotoAlbumLinks()])
      .then(([trip, latestVisits, latestPhotos, links]) => {
        const visit = latestVisits.find(item => item.id === selected && !item.deletedAt);
        if (!trip || trip.deletedAt || !visit || visit.tripId !== trip.id || selectedVisitId !== selected || tripSelect.value !== trip.id)
          throw new Error('旅行またはアルバムを確認できません。画面を更新してから再試行してください');
        layout.prepareVisitEditor();
        visitPhotoEditor.open(visit, trip, latestPhotos, latestVisits, links, justCreatedAlbum === visit.id);
      }).catch(error => { visitStatus.textContent = `写真の編集を開けません: ${message(error)}`; });
  }
  element<HTMLButtonElement>('#visit-photo-edit-open').addEventListener('click', openAlbumPhotos);

  element<HTMLButtonElement>('#visit-all-back').addEventListener('click', () => {
    if (!selectedVisitId) return;
    visitView = 'summary'; showVisit(selectedVisitId, false); element('#right-panel').scrollTop = 0;
  });
  element<HTMLButtonElement>('#visit-edit-back').addEventListener('click', () => {
    if (albumSaving || albumCreationUnknown) return;
    if (visitView === 'create') {
      if (!mayDiscardVisitInput()) return;
      resetVisitForm(); layout.closeRight(); return;
    }
    if (!selectedVisitId || !mayDiscardVisitInput()) return;
    visitView = 'summary'; showVisit(selectedVisitId, false); element('#right-panel').scrollTop = 0;
  });
  layout.onRightClose(() => {
    if (element('#right-panel').dataset.view === 'photo') clearPhotoSelection(); else map.selectVisit(null);
    return false;
  });

  function showVisit(id: string, reveal = true): void {
    if (reveal && (albumSaving || albumCreationUnknown)) { visitStatus.textContent = '保存状態を確認してからアルバムを切り替えてください。'; return; }
    if (reveal && correctionWrites) return;
    const visit = visits.find(item => item.id === id && !item.deletedAt);
    if (!visit) return;
    if (photoAlbumEditor.isOpen && reveal) { photoAlbumEditor.requestLeave(() => showVisit(id, reveal)); return; }
    if (visitPhotoEditor.isOpen && id !== selectedVisitId) { visitPhotoEditor.requestLeave(() => showVisit(id, reveal)); return; }
    if (reveal && !correctionNavigationApproved && correctionDrafts.dirty(selectedPhotoId)) { requestCorrectionLeave(() => showVisit(id, reveal)); return; }
    if (id !== selectedVisitId && !mayDiscardVisitInput()) return;
    if (focusedVisitId && focusedVisitId !== id) endVisitFocus(false);
    if (id !== selectedVisitId) { returnToVisitId = null; albumEditGeneration++; visitStatus.replaceChildren(); }
    if (id !== selectedVisitId || reveal && (visitView === 'all' || visitView === 'edit' && !hasUnsavedVisitInput())) visitView = 'summary';
    ++visitCandidateGeneration; ++candidateGeneration;
    if (reveal) layout.openDetail('visit', id !== selectedVisitId);
    if (element('#right-panel').dataset.view === 'visit') element('#right-panel .panel-top strong').textContent = 'アルバム';
    const keepUnsavedInput = visitView === 'edit' && id === selectedVisitId && hasUnsavedVisitInput();
    selectedVisitId = id; draftPhotoId = null;
    revealMarkerSelection('visit', id);
    map.setVisitCreationMode(false); map.selectVisit(id);
    visitMapChooser.hidden = true; mapChooser.hidden = true; clearCandidateThumbs();
    element('#visit-form-heading').textContent = 'アルバムを編集';
    element('#visit-form-source').textContent = '';
    if (!keepUnsavedInput) {
      visitLabel.value = visit.label;
      expectedVisit = visit;
      savedVisitFormValues = visitFormValues();
    }
    for (const button of visitList.querySelectorAll<HTMLButtonElement>('button[data-visit-id]')) button.setAttribute('aria-pressed', String(button.dataset.visitId === id));
    const linked = linkedVisitPhotos(photos, visit, albumPhotoIds(visit.id));
    setVisitPanelMode();
    if (visitView === 'summary') visitSummary.render(visit, linked);
    if (visitView === 'edit') editorPhotoSummary.render(visit, linked, true); else editorPhotoSummary.clear();
    if (visitView === 'all') {
      element('#visit-all-heading').textContent = visit.label;
      element('#visit-all-count').textContent = `${linked.length}枚`;
      visitPhotoGrid.setPhotos(linked, `visit:${visit.id}`, 'このアルバムに写真はありません');
    }
    const list = element<HTMLUListElement>('#visit-linked-photos'); list.replaceChildren();
    if (visitView !== 'edit' && visitView !== 'create') return;
    const item = document.createElement('li'); item.textContent = linked.length
      ? `写真 ${linked.length}枚`
      : '写真はまだありません。';
    list.append(item);
  }

  function choosePhoto(id: string, fromVisit = false): void {
    layout.requestNavigation(() => {
      if (selectedPhotoId === id && layout.isDetailOpen() && element('#right-panel').dataset.view === 'photo') {
        clearPhotoSelection(); layout.closeRight(); return;
      }
      if (focusedVisitId && !albumPhotoIds(focusedVisitId).has(id)) endVisitFocus(false);
      if (fromVisit) rememberVisit();
      // Let the panel's ResizeObserver publish the mobile control offsets before
      // the one-shot visibility check. Closing/resizing alone never pans the map.
      void showDetail(id, true, fromVisit).then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        if (selectedPhotoId === id && layout.isDetailOpen()) map.revealPhoto(id);
      })));
    }, true);
  }

  async function showDetail(id: string, reveal = true, fromVisit = false): Promise<void> {
    if (reveal && (albumSaving || albumCreationUnknown)) { visitStatus.textContent = '保存状態を確認してから写真を開いてください。'; return; }
    if (reveal && correctionWrites) return;
    const photo = photos.find(x => x.id === id);
    if (!photo) return;
    if (photoAlbumEditor.isOpen && reveal) { photoAlbumEditor.requestLeave(() => { void showDetail(id, reveal, fromVisit); }); return; }
    if (visitPhotoEditor.isOpen && reveal) { visitPhotoEditor.requestLeave(() => { void showDetail(id, reveal, fromVisit); }); return; }
    if (reveal && !correctionNavigationApproved && correctionDrafts.dirty(selectedPhotoId)) { requestCorrectionLeave(() => { void showDetail(id, reveal, fromVisit); }); return; }
    if (reveal && !fromVisit) { returnToVisitId = null; visitReturn = null; }
    ++candidateGeneration; ++visitCandidateGeneration;
    if (reveal) { photoDetailMode = 'preview'; photoAdvancedOpen = false; }
    document.body.dataset.photoMode = photoDetailMode;
    if (reveal) layout.openDetail('photo', id !== selectedPhotoId);
    if (element('#right-panel').dataset.view === 'photo') element('#right-panel .panel-top strong').textContent = photoDetailMode === 'preview' ? '写真プレビュー' : '写真の詳細';
    const generation = ++detailGeneration;
    selectedPhotoId = id;
    revealMarkerSelection('photo', id);
    mapChooser.hidden = true; clearCandidateThumbs();
    map.selectPhoto(id);
    photoGrid.select(id);
    clearThumb(); detail.replaceChildren();
    const title = document.createElement('h3'); title.textContent = photo.originalFilename;
    if (photo.thumbnailId) {
      let thumbnail: Awaited<ReturnType<typeof db.getThumbnail>>;
      try { thumbnail = await db.getThumbnail(photo.thumbnailId); }
      catch { thumbnail = undefined; }
      if (generation !== detailGeneration || selectedPhotoId !== id) return;
      if (thumbnail) {
        const image = document.createElement('img'); image.alt = `${photo.originalFilename} のサムネイル`;
        image.title = '保存済みサムネイル（原本写真ではありません）';
        currentThumbUrl = URL.createObjectURL(thumbnail.blob); image.src = currentThumbUrl; detail.append(image);
      }
    }
    if (!currentThumbUrl) {
      const placeholder = document.createElement('p'); placeholder.className = 'placeholder';
      placeholder.textContent = 'サムネイルなし。再生成には原本写真を再選択する必要があります。'; detail.append(placeholder);
    }
    detail.append(title);
    const previousExpected = correctionExpected.get(photo.id);
    correctionExpected.set(photo.id, {
      gpsCorrection: previousExpected && correctionDrafts.dirtyFields(photo.id, ['latitude', 'longitude']) ? previousExpected.gpsCorrection : photo.gpsCorrection,
      timeCorrection: previousExpected && correctionDrafts.dirtyFields(photo.id, ['clock', 'offset']) ? previousExpected.timeCorrection : photo.timeCorrection,
    });
    const correctionValues = correctionDrafts.read(photo.id, {
      latitude: photo.gpsCorrection ? String(photo.gpsCorrection.value.latitude) : '',
      longitude: photo.gpsCorrection ? String(photo.gpsCorrection.value.longitude) : '',
      clock: photo.timeCorrection?.correctedLocalClock ?? '', offset: formatOffset(photo.timeCorrection?.correctedOffsetMinutes ?? null),
    });
    const draftStatus = document.createElement('p'); draftStatus.className = 'hint photo-correction-draft-status'; draftStatus.setAttribute('role', 'status');
    const refreshDraftStatus = () => { draftStatus.textContent = correctionDrafts.dirty(photo.id) ? '未保存の補正入力があります。詳細情報・編集で保存できます。' : ''; };
    refreshDraftStatus(); detail.append(draftStatus);
    const gps = sourceGpsDisplay(photo.sourceGps);
    const displayClock = photo.timeCorrection?.correctedLocalClock ?? photo.sourceTime.localClock;
    const displayOffset = photo.timeCorrection ? photo.timeCorrection.correctedOffsetMinutes : photo.sourceTime.offsetMinutes;
    const summary = document.createElement('div'); summary.className = 'photo-summary';
    const shownClock = displayCaptureClock(displayClock);
    const date = document.createElement('p'); date.textContent = shownClock ? `${shownClock}${displayOffset === null ? '（時差不明）' : ''}${photo.timeCorrection ? '（手動補正）' : ''}` : '撮影日時不明';
    const location = document.createElement('p');
    location.textContent = photoDetailMode === 'preview'
      ? photo.gpsCorrection ? 'GPS位置（補正）' : gps.state === 'reference' ? '参考位置' : gps.point ? 'GPS位置' : '位置情報なし'
      : photo.gpsCorrection ? '手動補正したWGS84位置' : gps.state === 'reference' ? '測地系不明の参考位置' : gps.point ? '位置情報あり' : gps.locationLabel;
    const albumIds = albumIdsByPhoto.get(photo.id) ?? [];
    const albumNames = [...albumIds].sort((a, b) => {
      const first = visits.find(visit => visit.id === a);
      const second = visits.find(visit => visit.id === b);
      return Number(Boolean(first?.deletedAt)) - Number(Boolean(second?.deletedAt))
        || (first?.label ?? a).localeCompare(second?.label ?? b);
    }).map(albumId => {
      const album = visits.find(visit => visit.id === albumId);
      return album ? `${album.label}${album.deletedAt ? '（ごみ箱）' : ''}` : '確認できないアルバム';
    });
    const albums = document.createElement('p'); albums.className = 'photo-albums';
    albums.textContent = albumNames.length
      ? `アルバム: ${albumNames.slice(0, 2).join('、')}${albumNames.length > 2 ? `、ほか${albumNames.length - 2}件` : ''}`
      : 'アルバム未所属';
    summary.append(date, location, albums);
    if (photoDetailMode === 'full' && photo.tripId && !photo.deletedAt) {
      const editAlbums = document.createElement('button'); editAlbums.id = 'photo-album-edit-open'; editAlbums.type = 'button'; editAlbums.textContent = 'アルバムを編集';
      editAlbums.addEventListener('click', () => {
        const selected = selectedPhotoId;
        if (!selected) return;
        void Promise.all([db.getTrip(photo.tripId!), db.listPhotos(), db.listVisits(), db.listPhotoAlbumLinks()])
          .then(([trip, latestPhotos, latestAlbums, links]) => {
            const latest = latestPhotos.find(item => item.id === selected && !item.deletedAt);
            if (!latest || !trip || trip.deletedAt || latest.tripId !== trip.id || selectedPhotoId !== selected || tripSelect.value !== trip.id)
              throw new Error('写真または旅行を確認できません。画面を更新してから再試行してください');
            photoAlbumEditor.open(latest, trip, latestAlbums, links, latestPhotos);
          }).catch(error => { editAlbums.insertAdjacentText('afterend', ` 編集画面を開けません: ${message(error)}`); });
      });
      summary.append(editAlbums);
    }
    detail.append(summary);
    const actions = document.createElement('div'); actions.className = 'photo-actions';
    if (returnToVisitId) {
      const back = document.createElement('button'); back.type = 'button'; albumIcon(back, 'back', 'アルバムへ戻る');
      back.addEventListener('click', () => requestCorrectionLeave(() => {
        const context = visitReturn, visitId = returnToVisitId; clearPhotoSelection();
        if (visitId) {
          visitView = context?.view ?? 'summary'; showVisit(visitId, false); layout.openDetail('visit');
          requestAnimationFrame(() => { element('#right-panel').scrollTop = context?.scroll ?? 0; });
        }
      }));
      actions.append(back);
    }
    const canFocus = Boolean(photo.gpsCorrection || gps.point);
    if (canFocus) {
      const focus = document.createElement('button'); focus.type = 'button'; albumIcon(focus, 'map', '地図で見る');
      focus.addEventListener('click', () => {
        if (matchMedia('(max-width: 700px)').matches) { layout.selectTab('map'); layout.openDetail('photo'); }
        map.focusPhoto(id);
      });
      actions.append(focus);
    }
    if (photoDetailMode === 'full' && !photo.deletedAt) {
      const trash = document.createElement('button'); trash.type = 'button'; trash.className = 'photo-trash';
      albumIcon(trash, 'trash', '写真をごみ箱へ移動');
      trash.addEventListener('click', () => layout.requestNavigation(() => stageTrash('photo', photo.id, photo.originalFilename), true));
      actions.append(trash);
    }
    const mode = document.createElement('button'); mode.type = 'button';
    mode.textContent = photoDetailMode === 'preview' ? '詳細を見る' : 'プレビューに戻る';
    if (photoDetailMode === 'full') albumIcon(mode, 'photos', 'プレビューに戻る');
    const changePhotoMode = () => {
      photoDetailMode = photoDetailMode === 'preview' ? 'full' : 'preview';
      element('#right-panel').scrollTop = 0;
      void showDetail(id, false);
    };
    mode.addEventListener('click', () => photoDetailMode === 'full' ? requestCorrectionLeave(changePhotoMode) : changePhotoMode());
    actions.prepend(mode); detail.append(actions);
    if (photoDetailMode === 'preview') return;
    const advanced = document.createElement('details'); advanced.id = 'photo-advanced'; advanced.open = photoAdvancedOpen;
    const advancedHeading = document.createElement('summary'); advancedHeading.textContent = '詳細情報・編集'; advanced.append(advancedHeading);
    advanced.addEventListener('toggle', () => { if (advanced.isConnected && selectedPhotoId === id) photoAdvancedOpen = advanced.open; });
    detail.append(advanced);
    const lines = [
      `撮影日時: ${photo.sourceTime.rawDateTimeOriginal ?? '不明'}`,
      `時差: ${photo.sourceTime.rawOffsetTimeOriginal ?? '不明'} (${photo.sourceTime.status})`,
      `UTC: ${photo.sourceTime.capturedAtUtc ?? '確定できません'}`,
      `GPS: ${gps.point ? `${gps.point.latitude}, ${gps.point.longitude}` : '地図に表示できません'} (${gps.locationLabel})`,
      `表示位置: ${photo.gpsCorrection ? `${photo.gpsCorrection.value.latitude}, ${photo.gpsCorrection.value.longitude}（手動WGS84補正）` : '元GPSを使用'}`,
      `手動撮影日時: ${photo.timeCorrection?.correctedLocalClock ?? 'なし'}${photo.timeCorrection ? ` / 時差 ${formatOffset(photo.timeCorrection.correctedOffsetMinutes) || '不明'} / UTC ${photo.timeCorrection.correctedUtc ?? '未確定'}` : ''}`,
      `GPS水平誤差: ${photo.sourceGps.horizontalErrorMeters ?? '不明'}${photo.sourceGps.horizontalErrorMeters === null ? '' : ' m'}`,
      `測地系: ${gps.datumLabel}`,
      `元Exif方向値: ${photo.sourceOrientation ?? '不明'}`,
      `サムネイル: ${photo.thumbnailState}`,
      ...gps.issues, ...photo.sourceTime.issues, ...photo.metadataIssues,
    ];
    const list = document.createElement('ul');
    for (const line of lines) { const item = document.createElement('li'); item.textContent = line; list.append(item); }
    if (albumNames.length > 2) {
      const allAlbums = document.createElement('p'); allAlbums.textContent = `所属するアルバム: ${albumNames.join('、')}`;
      advanced.append(allAlbums);
    }
    const correction = document.createElement('section'); correction.setAttribute('aria-label', '写真の手動補正');
    const correctionHeading = document.createElement('h4'); correctionHeading.textContent = '手動補正'; correction.append(correctionHeading);
    const hint = document.createElement('p'); hint.textContent = '元Exifは変更しません。緯度・経度は入力したWGS84座標として扱います。時差が不明なら空欄にし、UTCを確定しません。'; correction.append(hint);
    const input = (id: string, labelText: string, key: keyof CorrectionFields) => {
      const label = document.createElement('label'); label.htmlFor = id; label.textContent = labelText;
      const field = document.createElement('input'); field.id = id; field.value = correctionValues[key];
      field.addEventListener('input', () => { correctionDrafts.change(photo.id, key, field.value); refreshDraftStatus(); });
      return { label, field };
    };
    const gpsForm = document.createElement('form'); gpsForm.setAttribute('aria-label', 'GPS補正');
    const lat = input('gps-correction-latitude', '補正緯度（WGS84）', 'latitude');
    const lon = input('gps-correction-longitude', '補正経度（WGS84）', 'longitude');
    const gpsSave = document.createElement('button'); gpsSave.type = 'submit'; gpsSave.textContent = 'GPS補正を保存';
    const gpsRevert = document.createElement('button'); gpsRevert.type = 'button'; gpsRevert.textContent = 'GPS補正を解除'; gpsRevert.disabled = !photo.gpsCorrection;
    const gpsStatus = document.createElement('p'); gpsStatus.setAttribute('role', 'status');
    const gpsActions = document.createElement('div'); gpsActions.className = 'photo-correction-actions'; gpsActions.append(gpsSave, gpsRevert);
    gpsForm.append(lat.label, lat.field, lon.label, lon.field, gpsActions, gpsStatus);
    const showCorrectionConflict = (status: HTMLElement, kind: 'gpsCorrection' | 'timeCorrection') => {
      const active = () => selectedPhotoId === photo.id && status.isConnected;
      const check = document.createElement('button'); check.type = 'button'; check.textContent = '最新状態を確認';
      check.addEventListener('click', () => {
        if (!active() || check.getAttribute('aria-busy') === 'true') return;
        check.setAttribute('aria-busy', 'true');
        void db.listPhotos().then(all => {
          if (!active()) return;
          const restoreFocus = document.activeElement === check;
          const latest = all.find(item => item.id === photo.id && !item.deletedAt);
          if (!latest) throw new Error('写真が見つかりません');
          const current = kind === 'gpsCorrection' ? latest.gpsCorrection ? `${latest.gpsCorrection.value.latitude}, ${latest.gpsCorrection.value.longitude}` : '補正なし（元GPSを使用）'
            : latest.timeCorrection ? `${latest.timeCorrection.correctedLocalClock} / 時差 ${formatOffset(latest.timeCorrection.correctedOffsetMinutes) || '不明'}` : '補正なし（元日時を使用）';
          status.textContent = `最新の保存値: ${current}。現在の入力は未保存のまま保持しています。`;
          const accept = document.createElement('button'); accept.type = 'button'; accept.textContent = 'この保存値を基準に編集を続ける';
          accept.addEventListener('click', () => {
            if (!active()) return;
            const restoreInputFocus = document.activeElement === accept;
            const expected = correctionExpected.get(photo.id)!;
            correctionExpected.set(photo.id, { ...expected, [kind]: latest[kind] });
            status.textContent = '最新の保存値を基準にしました。入力を確認・編集してから保存してください。';
            if (restoreInputFocus) (kind === 'gpsCorrection' ? lat.field : clock.field).focus({ preventScroll: true });
          });
          status.append(accept); if (restoreFocus) accept.focus({ preventScroll: true });
        }).catch(error => {
          if (!active()) return;
          const restoreFocus = document.activeElement === check;
          status.textContent = `最新状態を確認できません: ${message(error)}`; status.append(check); check.removeAttribute('aria-busy');
          if (restoreFocus) check.focus({ preventScroll: true });
        });
      });
      status.append(check);
    };
    const writeCorrection = async (change: { gpsCorrection: Photo['gpsCorrection'] } | { timeCorrection: Photo['timeCorrection'] }, submitted: Partial<CorrectionFields>, persisted: Partial<CorrectionFields>, status: HTMLElement) => {
      const kind = 'gpsCorrection' in change ? 'gpsCorrection' : 'timeCorrection';
      const expected = correctionExpected.get(photo.id)!;
      let saved = false;
      try {
        await db.updatePhotoCorrection(photo.id, change, kind === 'gpsCorrection' ? { gpsCorrection: expected.gpsCorrection } : { timeCorrection: expected.timeCorrection });
        saved = true;
        correctionDrafts.saved(photo.id, submitted, persisted);
        correctionExpected.set(photo.id, { ...expected, ...change });
        await render();
      } catch (error) {
        status.textContent = saved ? `補正は保存済みです。表示を更新できません: ${message(error)}。保存を繰り返さず、一覧から保存内容を確認してください。`
          : `補正を保存できません: ${message(error)}`;
        if (error instanceof EditConflict) showCorrectionConflict(status, kind);
      }
    };
    gpsForm.addEventListener('submit', event => {
      event.preventDefault(); if (correctionWrites) return;
      const submitted = { latitude: lat.field.value, longitude: lon.field.value };
      correctionWrites++; gpsSave.disabled = true;
      void (async () => {
        try {
          if (!submitted.latitude.trim() || !submitted.longitude.trim()) throw new Error('緯度・経度の両方を入力してください');
          const gpsCorrection = manualGpsCorrection(Number(submitted.latitude), Number(submitted.longitude));
          await writeCorrection({ gpsCorrection }, submitted, { latitude: String(gpsCorrection.value.latitude), longitude: String(gpsCorrection.value.longitude) }, gpsStatus);
        } catch (error) { gpsStatus.textContent = `GPS補正を保存できません: ${message(error)}`; }
        finally { correctionWrites--; gpsSave.disabled = false; }
      })();
    });
    gpsRevert.addEventListener('click', () => {
      if (correctionWrites) return; correctionWrites++; gpsRevert.disabled = true;
      void writeCorrection({ gpsCorrection: null }, { latitude: lat.field.value, longitude: lon.field.value }, { latitude: '', longitude: '' }, gpsStatus)
        .finally(() => { correctionWrites--; gpsRevert.disabled = !photo.gpsCorrection; });
    });
    const timeForm = document.createElement('form'); timeForm.setAttribute('aria-label', '撮影日時補正');
    const clock = input('time-correction-clock', '補正撮影日時（YYYY:MM:DD HH:mm:ss）', 'clock');
    const offset = input('time-correction-offset', '明示した時差（例 +09:00、任意）', 'offset');
    const timeSave = document.createElement('button'); timeSave.type = 'submit'; timeSave.textContent = '撮影日時補正を保存';
    const timeRevert = document.createElement('button'); timeRevert.type = 'button'; timeRevert.textContent = '撮影日時補正を解除'; timeRevert.disabled = !photo.timeCorrection;
    const timeStatus = document.createElement('p'); timeStatus.setAttribute('role', 'status');
    const timeActions = document.createElement('div'); timeActions.className = 'photo-correction-actions'; timeActions.append(timeSave, timeRevert);
    timeForm.append(clock.label, clock.field, offset.label, offset.field, timeActions, timeStatus);
    timeForm.addEventListener('submit', event => {
      event.preventDefault(); if (correctionWrites) return;
      const submitted = { clock: clock.field.value, offset: offset.field.value };
      correctionWrites++; timeSave.disabled = true;
      void (async () => {
        try {
          const timeCorrection = manualTimeCorrection(submitted.clock.trim(), submitted.offset.trim());
          await writeCorrection({ timeCorrection }, submitted, { clock: timeCorrection.correctedLocalClock ?? '', offset: formatOffset(timeCorrection.correctedOffsetMinutes) }, timeStatus);
        } catch (error) { timeStatus.textContent = `撮影日時補正を保存できません: ${message(error)}`; }
        finally { correctionWrites--; timeSave.disabled = false; }
      })();
    });
    timeRevert.addEventListener('click', () => {
      if (correctionWrites) return; correctionWrites++; timeRevert.disabled = true;
      void writeCorrection({ timeCorrection: null }, { clock: clock.field.value, offset: offset.field.value }, { clock: '', offset: '' }, timeStatus)
        .finally(() => { correctionWrites--; timeRevert.disabled = !photo.timeCorrection; });
    });
    correction.append(gpsForm, timeForm); advanced.append(correction);
    const sourceHeading = document.createElement('h4'); sourceHeading.textContent = '元のExif・保存情報'; advanced.append(sourceHeading, list);
  }

  function renderVisitList(): void {
    const currentTrip = tripSelect.value || null;
    const allVisits = visits.filter(visit => visit.tripId === currentTrip && !visit.deletedAt);
    const term = albumSearch.value.trim().normalize('NFKC').toLocaleLowerCase();
    albumSearchClear.hidden = albumSearch.value.length === 0;
    const shownVisits = allVisits.filter(visit => !term || visit.label.normalize('NFKC').toLocaleLowerCase().includes(term));
    const shownById = new Map(photos.filter(photo => photo.tripId === currentTrip && !photo.deletedAt).map(photo => [photo.id, photo]));
    ++visitListGeneration;
    visitListThumbObserver.disconnect();
    for (const url of visitListThumbUrls) URL.revokeObjectURL(url);
    visitListThumbUrls.length = 0;
    visitList.replaceChildren();
    element('#visit-count').textContent = term ? `${shownVisits.length}件 / 全${allVisits.length}件` : `${allVisits.length}件`;
    if (!shownVisits.length) {
      const empty = document.createElement('li'); empty.className = 'empty-state';
      empty.textContent = term ? '一致するアルバムがありません' : currentTrip ? 'アルバムはまだありません。写真なしでも作成できます。' : '旅行を選ぶとアルバムを作成できます。';
      visitList.append(empty);
    }
    for (const visit of [...shownVisits].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))) {
      const linked = linkedVisitPhotos([...albumPhotoIds(visit.id)].flatMap(id => shownById.has(id) ? [shownById.get(id)!] : []), visit, albumPhotoIds(visit.id));
      const range = linkedPhotoDateRange(linked);
      const item = document.createElement('li'); const button = document.createElement('button'); button.type = 'button'; button.className = 'visit-list-card';
      const cover = document.createElement('span'); cover.className = 'visit-list-cover';
      const featured = linked.find(photo => photo.thumbnailId);
      cover.textContent = featured ? '読み込み中' : linked.length ? '画像なし' : '写真なし';
      if (featured?.thumbnailId) { cover.dataset.thumbnailId = featured.thumbnailId; visitListThumbObserver.observe(cover); }
      const copy = document.createElement('span'); copy.className = 'visit-list-copy';
      const name = document.createElement('span'); name.className = 'visit-list-name'; name.textContent = visit.label;
      const meta = document.createElement('span'); meta.className = 'visit-list-meta';
      meta.textContent = `写真${linked.length}枚`;
      copy.append(name, meta);
      if (range) { const captured = document.createElement('span'); captured.className = 'visit-list-captured'; captured.textContent = `撮影 ${range}`; copy.append(captured); }
      button.append(cover, copy);
      button.dataset.visitId = visit.id; button.setAttribute('aria-pressed', String(visit.id === selectedVisitId));
      button.addEventListener('click', () => showVisit(visit.id)); item.append(button); visitList.append(item);
    }
  }

  async function render(): Promise<void> {
    try {
      await renderLibrary(); void refreshBackupCapacity(); errors.clearDb('read'); hydrated = true; workspaceReady(true);
    } catch (error) {
      if (!hydrated) workspaceReady(false);
      errors.showDb('read', { title: '保存済みデータを読み込めません', detail: `現在表示できるデータは残しています。保存を再送せず、読み込みだけ再試行します。 ${message(error)}`,
        action: { label: '再試行', allowed: () => !(albumSaving || albumCreationUnknown || correctionWrites || correctionDrafts.hasChanges || hasUnsavedVisitInput() || photoAlbumEditor.isOpen || visitPhotoEditor.isOpen),
          run: () => { void render().catch(() => {}); } } });
      throw error;
    }
  }
  async function renderLibrary(): Promise<void> {
    const selected = tripSelect.value;
    const [nextTrips, nextPhotos, nextVisits] = await Promise.all([db.listTrips(), db.listPhotos(), db.listVisits()]);
    const grouped = await db.albumIdsForPhotos(nextPhotos.map(photo => photo.id));
    [trips, photos, visits] = [nextTrips, nextPhotos, nextVisits];
    albumIdsByPhoto = new Map(); photoIdsByAlbum = new Map(); linkedPhotoIds = new Set();
    for (const [photoId, albumIds] of Object.entries(grouped)) {
      if (!albumIds.length) continue;
      albumIdsByPhoto.set(photoId, albumIds);
      linkedPhotoIds.add(photoId);
      for (const albumId of albumIds) {
        const group = photoIdsByAlbum.get(albumId) ?? new Set<string>();
        group.add(photoId); photoIdsByAlbum.set(albumId, group);
      }
    }
    const unsetCount = photos.filter(photo => photo.tripId === null && !photo.deletedAt).length;
    const unset = new Option(unsetCount ? `旅行未設定の写真（${unsetCount}枚）` : '旅行を選択', '');
    unset.disabled = unsetCount === 0;
    tripSelect.replaceChildren(unset, ...trips.filter(x => !x.deletedAt).map(x => new Option(x.name, x.id)), new Option('＋ 新しい旅行を作成', '__create-trip__'));
    tripSelect.value = trips.some(x => x.id === selected) ? selected : '';
    const currentTrip = tripSelect.value || null;
    activeTripId = tripSelect.value;
    element<HTMLButtonElement>('#trip-trash').disabled = !currentTrip; layout.refreshTrips();
    const shown = photos.filter(x => x.tripId === currentTrip && !x.deletedAt);
    const shownVisits = visits.filter(x => x.tripId === currentTrip && !x.deletedAt);
    const duplicateNames = new Map<string, string[]>();
    for (const visit of shownVisits) duplicateNames.set(visit.label, [...(duplicateNames.get(visit.label) ?? []), visit.id]);
    for (const ids of duplicateNames.values()) ids.sort();
    photoVisitFilter.replaceChildren(new Option('すべてのアルバム', 'all'), new Option('所属あり（ごみ箱内を含む）', 'linked'), new Option('アルバム未所属', 'unlinked'),
      ...[...shownVisits].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).map(visit => {
        const duplicates = duplicateNames.get(visit.label)!;
        return new Option(duplicates.length > 1 ? `${visit.label}（${duplicates.indexOf(visit.id) + 1}）` : visit.label, `album:${visit.id}`);
      }));
    const validAlbumFilter = [...photoVisitFilter.options].some(option => option.value === photoFilter.visit) ? photoFilter.visit : 'all';
    photoVisitFilter.value = validAlbumFilter; photoFilter = { ...photoFilter, visit: validAlbumFilter };
    if (focusedVisitId && !shownVisits.some(visit => visit.id === focusedVisitId)) {
      focusedVisitId = null; focusBanner.hidden = true;
      map.setFocusedPhotoIds([], false);
      map.setLayerVisibility(photoLayerToggle.checked, visitLayerToggle.checked, false);
    }
    element<HTMLButtonElement>('#visit-create-from-list').disabled = !currentTrip;
    updateAlbumFormControls();
    refreshPhotoPresentation(true);
    renderVisitList();
    if (selectedVisitId && shownVisits.some(visit => visit.id === selectedVisitId)) showVisit(selectedVisitId, false);
    else if (!hasUnsavedVisitInput()) resetVisitForm();
    if (selectedPhotoId && shown.some(x => x.id === selectedPhotoId)) await showDetail(selectedPhotoId, false);
    else { ++detailGeneration; selectedPhotoId = null; photoGrid.select(null); map.selectPhoto(null); clearThumb(); detail.textContent = '一覧から写真を選んでください。'; if (layout.isDetailOpen() && !selectedVisitId && !hasUnsavedVisitInput()) layout.closeRight(); }
    await renderRecovery();
  }

  const tripForm = element<HTMLFormElement>('#trip-form');
  const tripCreateStatus = element('#trip-create-status');
  const tripCreateSubmit = element<HTMLButtonElement>('#trip-create-submit');
  const tripCreateCancel = element<HTMLButtonElement>('#trip-create-cancel');
  const importTripChoice = element<HTMLSelectElement>('#import-trip-choice');
  let pendingTrip: Trip | null = null;
  let tripCreation: 'idle' | 'saving' | 'unknown' | 'saved' = 'idle';
  const tripCreateUi = () => {
    tripName.disabled = tripCreation !== 'idle';
    tripCreateSubmit.disabled = tripCreation === 'saving';
    tripCreateCancel.disabled = tripCreation === 'saving' || tripCreation === 'unknown';
    tripCreateCancel.textContent = tripCreation === 'saved' ? '閉じる' : 'キャンセル';
    tripCreateSubmit.textContent = tripCreation === 'saving' ? '作成しています…' : tripCreation === 'unknown' ? '保存状態を確認' : tripCreation === 'saved' ? layout.tripCreateForImport() ? '写真を追加' : '完了' : '作成';
    tripCreateSubmit.setAttribute('aria-busy', String(tripCreation === 'saving'));
  };
  layout.onTripCreateOpening(() => { pendingTrip = null; tripCreation = 'idle'; tripForm.reset(); tripCreateStatus.textContent = ''; tripCreateUi(); });
  layout.onTripCreateClosing(() => tripCreation !== 'saving' && tripCreation !== 'unknown');
  layout.onImportRequest(() => {
    void refreshBackupCapacity();
    if (!trips.some(trip => !trip.deletedAt)) { layout.openTripCreate(true); return false; }
    if (!trips.some(trip => trip.id === tripSelect.value && !trip.deletedAt)) { showImportTripChoice(); return true; }
    importPhase(photoFiles.files?.length ? 'selected' : 'empty');
    return true;
  });
  const showImportTripChoice = () => {
    importTripChoice.replaceChildren(new Option('旅行を選択', ''), ...trips.filter(trip => !trip.deletedAt).map(trip => new Option(trip.name, trip.id)));
    importPhase('required');
  };
  element('#import-trip-create').addEventListener('click', () => layout.openTripCreate(true));
  importTripChoice.addEventListener('change', () => {
    const id = importTripChoice.value;
    if (!id) return;
    layout.closeImport(); tripSelect.value = id; tripSelect.dispatchEvent(new Event('change'));
    void tripSelectionRender.then(() => { if (tripSelect.value === id) layout.openImport(); }).catch(() => {});
  });
  const confirmCreatedTrip = async (trip: Trip) => {
    const current = await db.getTrip(trip.id);
    if (!current) return false;
    if (JSON.stringify(current) !== JSON.stringify(trip)) throw new Error('作成した旅行と保存内容が一致しません。保存状態を確認してください');
    await render(); tripSelect.value = trip.id; tripSelect.dispatchEvent(new Event('change')); await tripSelectionRender;
    tripCreation = 'saved'; tripCreateStatus.textContent = `旅行「${trip.name}」を作成しました。`; tripCreateUi(); tripCreateSubmit.focus();
    return true;
  };
  tripName.addEventListener('input', () => { if (tripCreation === 'idle') pendingTrip = null; });
  tripForm.addEventListener('submit', event => {
    event.preventDefault();
    if (tripCreation === 'saving') return;
    void (async () => {
      if (tripCreation === 'saved') {
        const resume = layout.tripCreateForImport();
        if (resume && tripSelect.value !== pendingTrip?.id) { tripCreateStatus.textContent = '旅行は作成済みです。追加先の旅行を選択してから写真を追加してください。'; return; }
        layout.closeTripCreate(); if (resume) layout.openImport(); return;
      }
      const checking = tripCreation === 'unknown';
      try {
        pendingTrip ??= newTrip(tripName.value);
        tripCreation = 'saving'; tripCreateUi();
        if (!checking) await db.createTrip(pendingTrip);
        if (!await confirmCreatedTrip(pendingTrip)) { tripCreation = 'idle'; tripCreateStatus.textContent = '旅行は保存されていません。名前を確認して再試行してください。'; }
      } catch (error) {
        try {
          if (!pendingTrip || !await confirmCreatedTrip(pendingTrip)) { tripCreation = 'idle'; tripCreateStatus.textContent = `旅行を作成できません: ${message(error)}。再試行できます。`; }
        } catch { tripCreation = 'unknown'; tripCreateStatus.textContent = '保存結果を確認できません。新しい旅行を重複作成せず、保存状態を確認してください。'; }
      } finally { tripCreateUi(); }
    })();
  });
  tripSelect.addEventListener('change', () => {
    if (albumSaving || albumCreationUnknown) { tripSelect.value = activeTripId; visitStatus.textContent = '保存状態を確認してから旅行を切り替えてください。'; return; }
    if (tripSelect.value === '__create-trip__') { tripSelect.value = activeTripId; layout.openTripCreate(); return; }
    if (!correctionNavigationApproved && correctionDrafts.dirty(selectedPhotoId)) {
      const next = tripSelect.value; tripSelect.value = activeTripId;
      requestCorrectionLeave(() => { tripSelect.value = next; tripSelect.dispatchEvent(new Event('change')); }); return;
    }
    if (photoAlbumEditor.isOpen) {
      const next = tripSelect.value; tripSelect.value = activeTripId;
      photoAlbumEditor.requestLeave(() => { tripSelect.value = next; tripSelect.dispatchEvent(new Event('change')); }); return;
    }
    if (visitPhotoEditor.isOpen) {
      const next = tripSelect.value; tripSelect.value = activeTripId;
      visitPhotoEditor.requestLeave(() => { tripSelect.value = next; tripSelect.dispatchEvent(new Event('change')); }); return;
    }
    if (!mayDiscardVisitInput()) { tripSelect.value = activeTripId; return; }
    if (focusedVisitId) endVisitFocus(false);
    selectedPhotoId = null; markerPage = 0; element<HTMLInputElement>('#album-search').value = ''; resetVisitForm(); tripSelectionRender = render(); void tripSelectionRender.catch(() => {});
  });
  element<HTMLButtonElement>('#trip-trash').addEventListener('click', () => {
    const trip = trips.find(item => item.id === tripSelect.value);
    if (trip) stageTrash('trip', trip.id, trip.name);
  });
  element<HTMLButtonElement>('#visit-create-from-list').addEventListener('click', () => {
    if (albumSaving || albumCreationUnknown || !trips.some(trip => trip.id === tripSelect.value && !trip.deletedAt)) return;
    if (!mayDiscardVisitInput()) return;
    resetVisitForm(); albumCreationTrip = tripSelect.value; visitView = 'create'; setVisitPanelMode(); layout.openDetail('visit', true);
    element('#visit-form-source').textContent = `旅行：${trips.find(trip => trip.id === albumCreationTrip)?.name ?? ''}`;
    visitStatus.textContent = ''; visitLabel.focus();
  });
  function updateAlbumFormControls(): void {
    visitLabel.disabled = albumSaving || albumCreationUnknown;
    const save = element<HTMLButtonElement>('#visit-save');
    save.disabled = albumSaving || !tripSelect.value;
    save.textContent = albumSaving ? '保存中…' : albumCreationUnknown ? '保存状態を確認' : visitView === 'create' ? '作成' : '保存';
    element<HTMLButtonElement>('#visit-edit-back').disabled = albumSaving || albumCreationUnknown;
  }
  visitForm.addEventListener('submit', event => {
    event.preventDefault();
    if (albumSaving) return;
    void (async () => {
      let saved = false;
      try {
        const tripId = selectedVisitId ? tripSelect.value : albumCreationTrip;
        if (!tripId) throw new Error('先に旅行を選んでください');
        if (tripId !== tripSelect.value) throw new Error('作成を開始した旅行を確認してください');
        albumSaving = true; updateAlbumFormControls();
        const submittedFormValues = visitFormValues();
        const values = { label: visitLabel.value, point: selectedVisitId ? visits.find(visit => visit.id === selectedVisitId)?.representativeLocation ?? null : null, startAtUtc: selectedVisitId ? visits.find(visit => visit.id === selectedVisitId)?.userStartAtUtc ?? null : null, endAtUtc: selectedVisitId ? visits.find(visit => visit.id === selectedVisitId)?.userEndAtUtc ?? null : null };
        if (selectedVisitId) {
          const previous = expectedVisit?.id === selectedVisitId ? expectedVisit : null;
          if (!previous) throw new Error('アルバムが見つかりません');
          await db.updateVisit(reviseVisit(previous, { ...values, point: previous.representativeLocation, startAtUtc: previous.userStartAtUtc, endAtUtc: previous.userEndAtUtc }), previous);
          saved = true;
          savedVisitFormValues = submittedFormValues;
          visitStatus.textContent = 'アルバムを保存しました';
          visitView = 'summary';
        } else {
          if (!albumCreationUnknown) pendingAlbumCreation = newVisit(tripId, values.label);
          const visit = pendingAlbumCreation!;
          try {
            if (!albumCreationUnknown) await db.createVisit(visit, []);
            const current = (await db.listVisits()).find(album => album.id === visit.id);
            if (!current || JSON.stringify(current) !== JSON.stringify(visit)) throw new Error('作成結果を確認できません');
          } catch (error) {
            try {
              const current = (await db.listVisits()).find(album => album.id === visit.id);
              if (!current) { albumCreationUnknown = false; throw error; }
              if (JSON.stringify(current) !== JSON.stringify(visit)) throw new Error('保存内容が異なります', { cause: error });
            } catch (lookupError) {
              if (lookupError === error && !albumCreationUnknown) throw error;
              albumCreationUnknown = true; throw new Error('保存結果が不明です。新規作成を繰り返さず、保存状態を確認してください', { cause: lookupError });
            }
          }
          albumCreationUnknown = false; justCreatedAlbum = visit.id;
          selectedVisitId = visit.id; draftPhotoId = null;
          saved = true;
          savedVisitFormValues = submittedFormValues;
          visitStatus.textContent = '';
          visitView = 'summary';
        }
        await render();
      } catch (error) {
        visitStatus.textContent = saved ? `アルバムは保存済みです。表示を更新できません: ${message(error)}。保存を繰り返さず、保存内容を確認してください。` : `アルバムを保存できません: ${message(error)}`;
        if (error instanceof EditConflict) {
          const id = selectedVisitId, generation = albumEditGeneration;
          const active = () => selectedVisitId === id && visitView === 'edit' && generation === albumEditGeneration;
          const check = document.createElement('button'); check.type = 'button'; check.textContent = '最新状態を確認';
          check.addEventListener('click', () => {
            if (!active() || check.getAttribute('aria-busy') === 'true') return;
            check.setAttribute('aria-busy', 'true');
            void db.listVisits().then(all => {
              if (!active()) return;
              const restoreFocus = document.activeElement === check;
              const latest = all.find(item => item.id === id && !item.deletedAt);
              if (!latest) throw new Error('アルバムが見つかりません');
              visitStatus.textContent = `最新の保存名: ${latest.label}。入力は未保存のまま保持しています。`;
              const accept = document.createElement('button'); accept.type = 'button'; accept.textContent = 'この保存値を基準に編集を続ける';
              accept.addEventListener('click', () => {
                if (!active()) return;
                const restoreInputFocus = document.activeElement === accept;
                expectedVisit = latest; savedVisitFormValues = { label: latest.label }; visitStatus.textContent = '最新の保存値を基準にしました。入力を確認・編集してから保存してください。';
                if (restoreInputFocus) visitLabel.focus({ preventScroll: true });
              });
              visitStatus.append(accept); if (restoreFocus) accept.focus({ preventScroll: true });
            }).catch(lookupError => {
              if (!active()) return;
              const restoreFocus = document.activeElement === check;
              visitStatus.textContent = `最新状態を確認できません: ${message(lookupError)}`; visitStatus.append(check); check.removeAttribute('aria-busy');
              if (restoreFocus) check.focus({ preventScroll: true });
            });
          });
          visitStatus.append(check);
        }
      }
      finally { albumSaving = false; updateAlbumFormControls(); }
    })();
  });
  const importDialog = element<HTMLDialogElement>('#photo-import-dialog');
  const importProgress = element<HTMLProgressElement>('#import-progress');
  const importOptions = element<HTMLDetailsElement>('#import-options');
  const importResultDetails = element<HTMLDetailsElement>('#import-result-details');
  const importAgain = element<HTMLButtonElement>('#import-again');
  const importPhase = (phase: 'empty' | 'selected' | 'running' | 'done' | 'error' | 'required') => {
    importDialog.dataset.importState = phase;
    const choosing = phase === 'empty' || phase === 'selected';
    element('#import-selection').hidden = !choosing;
    importOptions.hidden = !choosing;
    importButton.hidden = !choosing; importButton.disabled = phase !== 'selected';
    importProgress.hidden = phase !== 'running';
    element('#import-running-note').hidden = phase !== 'running';
    cancelButton.hidden = phase !== 'running'; cancelButton.disabled = phase !== 'running';
    photoFiles.disabled = phase === 'running'; duplicateOtherTrip.disabled = phase === 'running';
    element('#import-trip-required').hidden = phase !== 'required';
    importAgain.hidden = choosing || phase === 'running' || phase === 'required';
    element('#import-done').hidden = choosing || phase === 'running' || phase === 'required';
    if (importDialog.open && !choosing) (phase === 'running' ? cancelButton : phase === 'required' ? importTripChoice : element('#import-done')).focus();
  };
  importPhase('empty');
  photoFiles.addEventListener('change', () => {
    void refreshBackupCapacity();
    if (importer) return;
    const files = Array.from(photoFiles.files ?? []);
    element('#import-selection-count').textContent = files.length ? `${files.length}枚選択` : '写真未選択';
    const filename = element('#import-selection-name');
    filename.textContent = files.length === 1 ? files[0]!.name : ''; filename.hidden = files.length !== 1;
    importStatus.textContent = ''; resultList.replaceChildren();
    importResultDetails.hidden = true; importResultDetails.open = false;
    importPhase(files.length ? 'selected' : 'empty');
    if (!trips.some(trip => trip.id === tripSelect.value && !trip.deletedAt)) showImportTripChoice();
    layout.setImportState(false, '', tripSelect.selectedOptions[0]?.textContent ?? '未分類', false);
  });
  importAgain.addEventListener('click', () => photoFiles.click());
  cancelButton.addEventListener('click', () => { importer?.cancel(); cancelButton.disabled = true; cancelButton.textContent = '中断しています…'; });
  importButton.addEventListener('click', () => {
    const files = Array.from(photoFiles.files ?? []);
    if (importer || !files.length) return;
    if (!trips.some(trip => trip.id === tripSelect.value && !trip.deletedAt)) { showImportTripChoice(); return; }
    importPhase('running'); cancelButton.textContent = '中断'; resultList.replaceChildren();
    importOptions.open = false; importResultDetails.hidden = true; importResultDetails.open = false;
    importProgress.removeAttribute('value');
    importer = new PhotoImporter(db);
    const importTripId = tripSelect.value || null;
    const importTarget = tripSelect.selectedOptions[0]?.textContent ?? '未分類';
    let lastImportMessage = '開始しています';
    importStatus.textContent = '取り込みを開始しています…';
    layout.setImportState(true, lastImportMessage, importTarget);
    const counts: Record<ImportProgress['outcomes'][number]['state'], number> = { imported: 0, partial: 0, 'skipped-duplicate': 0, failed: 0, cancelled: 0 };
    let renderedOutcomes = 0;
    const update = (progress: ImportProgress) => {
      for (const outcome of progress.outcomes.slice(renderedOutcomes)) {
        counts[outcome.state]++;
        const label = { imported: '追加', partial: '写真情報のみ追加', 'skipped-duplicate': '重複スキップ', failed: '失敗', cancelled: '中断' }[outcome.state];
        const item = document.createElement('li'); item.textContent = `${outcome.filename}: ${label}${outcome.reason ? ` — ${outcome.reason}` : ''}`; resultList.append(item);
      }
      renderedOutcomes = progress.outcomes.length;
      importProgress.max = Math.max(1, progress.job.total); importProgress.value = progress.job.processed;
      importStatus.textContent = `${progress.job.processed}/${progress.job.total}枚を処理・残り ${progress.job.total - progress.job.processed}枚`;
      lastImportMessage = `${progress.job.processed}/${progress.job.total}枚`;
      layout.setImportState(true, lastImportMessage, importTarget);
    };
    void refreshBackupCapacity();
    void importer.importFiles(files, importTripId, update, { allowDuplicateAcrossTrips: duplicateOtherTrip.checked })
      .then(async report => {
        update(report); await render();
        importPhase(counts.failed ? 'error' : 'done');
        importStatus.textContent = `${report.job.state === 'cancelled' ? '取り込みを中断しました' : counts.failed ? '一部の写真を取り込めませんでした' : '取り込みが完了しました'}。追加 ${counts.imported + counts.partial}枚・重複スキップ ${counts['skipped-duplicate']}枚・失敗 ${counts.failed}枚` +
          (counts.partial ? `。うち${counts.partial}枚は写真情報のみ（サムネイルなし）` : '') +
          (counts.cancelled ? `・中断 ${counts.cancelled}枚。保存済みの写真は残っています` : '') +
          (counts.failed ? '。ファイル別の結果を確認し、失敗した写真を選び直してください' : '');
      })
      .catch(error => {
        importPhase('error');
        importStatus.textContent = `取り込みを完了できません: ${message(error)}。保存済みの写真を一覧で確認してから、必要な写真を選び直してください。`;
      })
      .finally(() => {
        cancelButton.disabled = true; importer = null; photoFiles.value = '';
        importResultDetails.hidden = resultList.childElementCount === 0;
        layout.setImportState(false, lastImportMessage, importTarget);
      });
  });
  const exportButton = element<HTMLButtonElement>('#export-button');
  const streamExportButton = element<HTMLButtonElement>('#stream-export-button');
  const archiveCancel = element<HTMLButtonElement>('#archive-cancel');
  const restoreButton = element<HTMLButtonElement>('#restore-button');
  const archiveFileSummary = element<HTMLElement>('#archive-file-summary');
  const showBackupStatus = () => { element('#archive-heading').after(archiveStatus); archiveStatus.after(archiveCancel); };
  const showRestoreStatus = () => {
    const group = element('#restore-group'); group.insertBefore(archiveStatus, group.children.item(1));
    archiveStatus.after(archiveCancel);
  };
  type SavePicker = (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FileSystemFileHandle>;
  const savePicker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker?.bind(window);
  streamExportButton.hidden = !savePicker;
  if (!savePicker) element('#stream-availability').textContent = 'このブラウザでは利用できません。通常の保存は64 MiBまでです。';
  let archiveAbort: AbortController | null = null;
  const beginArchiveWork = () => {
    const controller = new AbortController(); archiveAbort = controller;
    exportButton.disabled = true; streamExportButton.disabled = true; restoreButton.disabled = true;
    archiveCancel.hidden = false; archiveCancel.disabled = false;
    return controller;
  };
  const endArchiveWork = () => {
    archiveAbort = null; exportButton.disabled = false; streamExportButton.disabled = false;
    restoreButton.disabled = !archiveFile.files?.length; archiveCancel.disabled = true; archiveCancel.hidden = true;
  };
  archiveCancel.addEventListener('click', () => { archiveAbort?.abort(); archiveStatus.textContent = 'ZIP処理を中断しています。既存データは変更しません。'; });
  const archiveError = (error: unknown, action: string) => error instanceof DOMException && error.name === 'AbortError'
    ? 'ZIP処理を中断しました。既存データは変更していません。' : `${action}: ${message(error)}`;
  const backupName = () => `photo-route-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.zip`;
  exportButton.addEventListener('click', () => {
    showBackupStatus();
    const controller = beginArchiveWork(); archiveStatus.textContent = 'アーカイブを作成しています';
    void db.snapshot().then(async snapshot => { const blob = await exportArchive(snapshot, { signal: controller.signal }); await verifyExportArchive(snapshot, blob, controller.signal); return blob; }).then(blob => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = backupName();
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      archiveStatus.textContent = `ZIPの内容を再検証し、書き出しを開始しました（${blob.size} bytes）。実際に保存されたかはアプリでは確認できません。保存先を確認してください。`;
    }).catch(error => { archiveStatus.textContent = archiveError(error, '書き出し失敗'); }).finally(endArchiveWork);
  });
  streamExportButton.addEventListener('click', () => {
    showBackupStatus();
    if (!savePicker) return;
    // The picker must be opened in the user gesture, before reading IndexedDB.
    let pick: Promise<FileSystemFileHandle>;
    try { pick = savePicker({ suggestedName: backupName(), types: [{ description: 'Photo Route ZIP', accept: { 'application/zip': ['.zip'] } }] }); }
    catch (error) { archiveStatus.textContent = archiveError(error, '保存先を選べません'); return; }
    const controller = beginArchiveWork(); archiveStatus.textContent = '保存先を選択し、ZIPを順に書き込みます。';
    void pick.then(async handle => {
      let writable: FileSystemWritableFileStream | null = null;
      try {
        const snapshot = await db.snapshot();
        if (controller.signal.aborted) throw new DOMException('処理を中断しました', 'AbortError');
        writable = await handle.createWritable();
        const written = await streamArchive(snapshot, writable, { signal: controller.signal });
        writable = null;
        archiveStatus.textContent = '保存したZIPの内容を再検証しています。';
        await verifyExportArchive(snapshot, await handle.getFile(), controller.signal);
        archiveStatus.textContent = `ZIPを端末へ保存して内容を再検証しました（${written} bytes）。保存先でファイルを確認してください。`;
      } catch (error) { await writable?.abort().catch(() => undefined); throw error; }
    }).catch(error => { archiveStatus.textContent = archiveError(error, '直接保存に失敗'); }).finally(endArchiveWork);
  });
  restoreButton.addEventListener('click', () => {
    showRestoreStatus();
    const file = archiveFile.files?.[0];
    if (!file) { archiveStatus.textContent = 'ZIPアーカイブを選んでください'; return; }
    pendingRestoreFile = null; restoreConflict.hidden = true;
    const controller = beginArchiveWork(); archiveStatus.textContent = 'ZIPを検証しています。既存データは確認前に変更しません。';
    void refreshBackupCapacity().then(() => previewArchiveRestore(db, file, controller.signal)).then(async preview => {
      if (preview.conflictingTrips || preview.conflictingUnclassifiedPhotos) {
        pendingRestoreFile = file;
        element('#restore-preview').textContent = `旅行${preview.conflictingTrips}件・未分類写真${preview.conflictingUnclassifiedPhotos}件が競合します。別コピーを選ぶと新しいIDで追加し、既存データは変更しません。`;
        archiveStatus.textContent = `${preview.conflictingTrips ? '同じIDの旅行に異なる内容があります。' : '未分類写真のID衝突があります。'}既存データは変更しません。別コピーかキャンセルを選んでください。`;
        restoreConflict.hidden = false;
        return;
      }
      const result = await restoreArchive(db, file, 'reject-conflicts', controller.signal);
      archiveStatus.textContent = result.state === 'skipped-identical' ? '同一内容のため復元をスキップしました' : `${result.trips}件の旅行と${result.photos}件の写真を復元しました`;
      await render();
    }).catch(error => { archiveStatus.textContent = archiveError(error, '復元を拒否しました'); }).finally(endArchiveWork);
  });
  archiveFile.addEventListener('change', () => {
    void refreshBackupCapacity();
    pendingRestoreFile = null; restoreConflict.hidden = true;
    const file = archiveFile.files?.[0];
    archiveFileSummary.textContent = file ? `選択中: ${file.name}（${file.size.toLocaleString('ja-JP')} bytes）` : 'ZIPが選択されていません。';
    archiveFileSummary.hidden = !file;
    restoreButton.disabled = !file || archiveAbort !== null;
  });
  element<HTMLButtonElement>('#restore-cancel').addEventListener('click', () => { pendingRestoreFile = null; restoreConflict.hidden = true; archiveStatus.textContent = '復元をキャンセルしました。既存データは変更していません。'; });
  element<HTMLButtonElement>('#restore-copy').addEventListener('click', () => {
    showRestoreStatus();
    const file = pendingRestoreFile;
    if (!file) return;
    const button = element<HTMLButtonElement>('#restore-copy'); button.disabled = true;
    const controller = beginArchiveWork();
    void restoreArchive(db, file, 'copy-conflicts', controller.signal).then(async result => {
      archiveStatus.textContent = result.state === 'skipped-identical' ? '同一内容のため復元をスキップしました' : `別コピーを含む旅行${result.trips}件・写真${result.photos}件を復元しました。既存データは変更していません。`;
      pendingRestoreFile = null; restoreConflict.hidden = true; await render();
    }).catch(error => { archiveStatus.textContent = archiveError(error, '別コピーを復元できません'); }).finally(() => { button.disabled = false; endArchiveWork(); });
  });
  try { await render(); }
  catch (error) { importStatus.textContent = `保存済みデータを読み込めません: ${message(error)}`; }
}
