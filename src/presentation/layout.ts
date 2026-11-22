import { albumIcon, iconMarkup } from './album-icons';
import { mapViewportInsets } from './map-viewport';

type LeftView = 'photos' | 'visits';
type MobileTab = 'map' | 'photos' | 'visits';
type DetailView = 'photo' | 'visit';

const byId = (id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`画面要素がありません: ${id}`);
  return found;
};
const button = (id: string, label: string, onClick: () => void) => {
  const item = document.createElement('button'); item.id = id; item.type = 'button'; item.textContent = label;
  item.addEventListener('click', onClick); return item;
};

export function createLayout() {
  const header = document.querySelector('header')!, main = document.querySelector('main')!;
  const trip = byId('trip-heading').closest('section')!;
  const importing = byId('import-heading').closest('section')!;
  const mapPanel = byId('map-heading').closest('section')!;
  const photos = byId('photos-heading').closest('section')!;
  const photoDetail = byId('detail-heading').closest('section')!;
  const visits = byId('visits-heading').closest('section')!;
  const recovery = byId('recovery-heading').closest('section')!;
  const archive = byId('archive-heading').closest('section')!;
  const restore = byId('restore-group');
  recovery.id = 'recovery-panel'; archive.id = 'backup-panel';
  const visitStatus = byId('visit-status'), visitForm = byId('visit-form');
  const linked = byId('visit-linked-photos'), linkedHeading = linked.previousElementSibling!;
  trip.id = 'trip-panel'; importing.id = 'import-panel'; photos.id = 'photos-panel';
  visits.id = 'visits-panel'; photoDetail.id = 'photo-detail-panel';

  const brand = header.querySelector('h1')!;
  const tripLabel = byId('trip-select').previousElementSibling!;
  const tripSelect = byId('trip-select');
  tripLabel.textContent = '旅行'; tripLabel.classList.add('sr-only');
  tripSelect.setAttribute('aria-label', '旅行（表示・写真の追加先）');
  const tripPicker = document.createElement('div'); tripPicker.className = 'trip-picker'; tripPicker.append(tripLabel, tripSelect);
  let leftOpen = !matchMedia('(max-width: 1100px)').matches;
  let rightOpen = false;
  let managementOpen = false;
  let leftView: LeftView = 'photos';
  const listScroll = { photos: 0, visits: 0 };
  let mobileTab: MobileTab = 'map';
  let detailView: DetailView = 'photo';
  const detailScroll = { photo: 0, visit: 0 };
  let viewportChange: ((insets: { top: number; right: number; bottom: number; left: number }) => void) | null = null;
  let rightCloseHandler: (() => boolean) | null = null;
  let navigationHandler: ((proceed: () => void, leavesDetail: boolean) => void) | null = null;
  const navigate = (proceed: () => void, leavesDetail = false) => navigationHandler ? navigationHandler(proceed, leavesDetail) : proceed();
  const left = document.createElement('aside'); left.id = 'left-panel'; left.setAttribute('aria-label', '写真とアルバム');
  const right = document.createElement('aside'); right.id = 'right-panel'; right.setAttribute('aria-label', '詳細');
  const manage = document.createElement('dialog'); manage.id = 'management-panel'; manage.setAttribute('aria-labelledby', 'management-heading');
  const importDialog = document.createElement('dialog'); importDialog.id = 'photo-import-dialog'; importDialog.setAttribute('aria-labelledby', 'photo-import-heading');
  const tripManagement = document.createElement('dialog'); tripManagement.id = 'trip-management'; tripManagement.setAttribute('aria-labelledby', 'trip-management-heading');
  const tripManagementSelect = document.createElement('select'); tripManagementSelect.id = 'trip-management-select'; tripManagementSelect.size = 5; tripManagementSelect.setAttribute('aria-label', '旅行一覧');
  const refreshTrips = () => { tripManagementSelect.replaceChildren(...[...(tripSelect as HTMLSelectElement).options].filter(option => option.value !== '__create-trip__').map(option => option.cloneNode(true))); tripManagementSelect.value = (tripSelect as HTMLSelectElement).value; };
  const closeTrips = () => { tripManagement.close(); byId('header-trips').focus(); };
  const openTrips = () => navigate(() => { if (managementOpen) closeManagement(); refreshTrips(); tripManagement.showModal(); tripManagementSelect.focus(); }, true);
  tripManagementSelect.addEventListener('change', () => { (tripSelect as HTMLSelectElement).value = tripManagementSelect.value; tripSelect.dispatchEvent(new Event('change')); tripManagementSelect.value = (tripSelect as HTMLSelectElement).value; });
  const tripDialog = document.createElement('dialog'); tripDialog.id = 'trip-create-dialog'; tripDialog.setAttribute('aria-labelledby', 'trip-create-heading');
  let tripCreateForImport = false;
  let tripReturnFocus: HTMLElement | null = null;
  let importRequest: (() => boolean) | null = null;
  let tripCreateOpening: (() => void) | null = null;
  let tripCreateClosing: (() => boolean) | null = null;
  const closeTripCreate = () => {
    if (tripCreateClosing?.() === false) return;
    tripDialog.close(); tripReturnFocus?.focus(); tripReturnFocus = null;
  };
  const openTripCreate = (resumeImport = false) => navigate(() => {
    if (tripDialog.open) return;
    if (tripManagement.open) tripManagement.close();
    tripReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    tripCreateForImport = resumeImport;
    if (importDialog.open) closeImport();
    if (managementOpen) closeManagement();
    tripCreateOpening?.(); tripDialog.showModal(); byId('trip-name').focus();
  }, true);
  let importRunning = false, importHasResult = false, importResultSeen = false, importTargetLabel = '', importMessage = '';
  let importReturnFocus: HTMLElement | null = null;
  const importTask = button('import-task', '写真取り込みに戻る', () => openImport()); importTask.hidden = true;
  const refreshImportTask = () => {
    importTask.hidden = importDialog.open || !importRunning && (!importHasResult || importResultSeen);
    importTask.textContent = importRunning ? `写真取り込み中 · ${importMessage} · 表示` : '写真取り込みの結果を見る';
    byId('header-add').setAttribute('data-import-running', String(importRunning));
  };
  const closeImport = () => { if (!importRunning && importHasResult) importResultSeen = true; importDialog.close(); refreshImportTask(); importReturnFocus?.focus(); importReturnFocus = null; };
  function openImport(): void {
    navigate(() => {
      if (!importRunning && !importHasResult && importRequest?.() === false) return;
      if (managementOpen) closeManagement();
      importReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!importRunning && !importHasResult) importTargetLabel = (tripSelect as HTMLSelectElement).selectedOptions[0]?.textContent ?? '未分類';
      byId('photo-import-trip').textContent = importDialog.dataset.importState === 'required' ? '写真は旅行に保存します' : `取り込み先：${importTargetLabel}`;
      if (!importDialog.open) importDialog.showModal(); refreshImportTask();
      byId('import-close').focus();
    });
  }
  const bottom = document.createElement('nav'); bottom.id = 'mobile-tabs'; bottom.setAttribute('aria-label', '画面切替');
  const drawerToggle = button('drawer-toggle', '‹', () => navigate(() => { leftOpen = !leftOpen; setState(); }));
  drawerToggle.setAttribute('aria-controls', 'left-panel');
  const setState = () => {
    const mobile = matchMedia('(max-width: 700px)').matches;
    document.body.dataset.leftOpen = String(leftOpen);
    document.body.dataset.rightOpen = String(rightOpen);
    document.body.dataset.managementOpen = String(managementOpen);
    document.body.dataset.mobileTab = mobileTab;
    document.body.dataset.detailView = detailView;
    left.dataset.view = leftView;
    right.dataset.view = detailView;
    left.inert = managementOpen || (mobile ? mobileTab !== leftView : !leftOpen);
    right.inert = managementOpen || !rightOpen;
    manage.inert = !managementOpen;
    mapPanel.inert = managementOpen || (mobile && mobileTab !== 'map');
    if (managementOpen && !manage.open) manage.showModal();
    if (!managementOpen && manage.open) manage.close();
    for (const item of bottom.querySelectorAll<HTMLButtonElement>('button[data-tab]')) {
      item.setAttribute('aria-current', item.dataset.tab === mobileTab ? 'page' : 'false');
    }
    byId('left-tab-photos').setAttribute('aria-pressed', String(leftView === 'photos'));
    byId('left-tab-visits').setAttribute('aria-pressed', String(leftView === 'visits'));
    const rightClose = byId('right-close') as HTMLButtonElement;
    albumIcon(rightClose, 'close', '閉じる');
    drawerToggle.setAttribute('aria-expanded', String(leftOpen));
    const drawerLabel = leftOpen ? '写真・アルバムの一覧を閉じる' : '写真・アルバムの一覧を開く';
    drawerToggle.setAttribute('aria-label', drawerLabel); drawerToggle.title = drawerLabel; drawerToggle.textContent = leftOpen ? '‹' : '›';
    byId('header-manage').setAttribute('aria-expanded', String(managementOpen));
    viewportChange?.(mapViewportInsets(byId('map')));
  };
  let managementReturnFocus: HTMLElement | null = null;
  const closeManagement = () => {
    managementOpen = false; setState();
    managementReturnFocus?.focus(); managementReturnFocus = null;
  };
  const openManagement = (section: 'trip' | 'import' | 'recovery' | 'archive' = 'archive') => {
    if (section === 'import') { openImport(); return; }
    if (section === 'trip') { openTrips(); return; }
    navigate(() => {
    if (!managementOpen) managementReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (tripManagement.open) tripManagement.close();
    managementOpen = true; setState();
    if (section !== 'archive') ({ trip, import: importing, recovery, archive })[section].scrollIntoView({ block: 'start' });
    else manage.scrollTop = 0;
    byId('management-close').focus({ preventScroll: true });
    });
  };
  importDialog.addEventListener('cancel', event => { event.preventDefault(); closeImport(); });
  tripDialog.addEventListener('cancel', event => { event.preventDefault(); closeTripCreate(); });
  manage.addEventListener('cancel', event => { event.preventDefault(); navigate(closeManagement); });
  manage.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...manage.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex]')]
      .filter(item => {
        if (item.tabIndex < 0 || item.matches(':disabled') || item.closest('[hidden], [inert]') || !item.getClientRects().length) return false;
        // Closed disclosures can retain layout boxes for descendants in Chromium.
        for (let parent = item.parentElement; parent && parent !== manage; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(item)) return false;
        }
        return true;
      });
    const first = controls[0], last = controls.at(-1);
    if (!first || !last) { event.preventDefault(); manage.focus(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  const showLeftView = (next: LeftView) => {
    navigate(() => { if (leftView !== next) { listScroll[leftView] = left.scrollTop; leftView = next; left.scrollTop = listScroll[next]; }
      setState(); });
  };
  const selectTab = (tab: MobileTab) => {
    navigate(() => { mobileTab = tab;
      if (tab !== 'map' && leftView !== tab) { listScroll[leftView] = left.scrollTop; leftView = tab; left.scrollTop = listScroll[tab]; }
      rightOpen = false; managementOpen = false; setState(); }, true);
  };
  const openDetail = (kind: DetailView, resetScroll = false) => {
    if (detailView !== kind) { detailScroll[detailView] = right.scrollTop; detailView = kind; right.scrollTop = detailScroll[kind]; }
    if (matchMedia('(min-width: 701px) and (max-width: 1100px)').matches) leftOpen = false;
    rightOpen = true;
    managementOpen = false;
    setState();
    if (resetScroll) right.scrollTop = 0;
  };
  const leftTitle = document.createElement('div'); leftTitle.className = 'panel-top';
  const leftTabs = document.createElement('div'); leftTabs.className = 'panel-tabs'; leftTabs.setAttribute('role', 'group'); leftTabs.setAttribute('aria-label', '一覧切替');
  leftTabs.append(button('left-tab-photos', '写真', () => showLeftView('photos')),
    button('left-tab-visits', 'アルバム', () => showLeftView('visits')));
  leftTitle.append(leftTabs);
  const createVisit = button('visit-create-from-list', '', () => {});
  albumIcon(createVisit, 'add', '新規アルバム');
  const albumListHeading = document.createElement('div'); albumListHeading.className = 'album-list-heading';
  const albumListTitle = document.createElement('strong'); albumListTitle.textContent = 'アルバム';
  albumListHeading.append(albumListTitle, byId('visit-count'), createVisit); visits.insertBefore(albumListHeading, visitStatus);
  const albumSearch = document.createElement('input'); albumSearch.id = 'album-search'; albumSearch.type = 'search';
  albumSearch.placeholder = 'アルバムを検索'; albumSearch.setAttribute('aria-label', 'アルバム名で検索'); albumSearch.autocomplete = 'off';
  const albumSearchField = document.createElement('div'); albumSearchField.className = 'search-field album-search-field';
  const albumSearchClear = button('album-search-clear', '', () => {}); albumSearchClear.hidden = true;
  albumIcon(albumSearchClear, 'close', 'アルバムの検索語を解除');
  albumSearchField.append(albumSearch, albumSearchClear); visits.insertBefore(albumSearchField, visits.querySelector('#visit-list'));
  byId('photo-filter-icon').innerHTML = iconMarkup('settings');
  albumIcon(byId('photo-search-clear') as HTMLButtonElement, 'close', '写真の検索語を解除');
  left.append(leftTitle, photos, visits);

  const visitDetail = document.createElement('section'); visitDetail.id = 'visit-detail-panel'; visitDetail.className = 'panel';
  const visitDetailHeading = document.createElement('h2'); visitDetailHeading.textContent = 'アルバムの詳細';
  const visitOverview = document.createElement('div'); visitOverview.id = 'visit-summary'; visitOverview.hidden = true;
  const visitAll = document.createElement('div'); visitAll.id = 'visit-all-photos'; visitAll.hidden = true;
  const allBack = button('visit-all-back', '戻る', () => {});
  albumIcon(allBack, 'back', 'アルバムへ戻る');
  const allTitle = document.createElement('h3'); allTitle.textContent = 'アルバムの写真';
  allTitle.id = 'visit-all-heading';
  const allCount = document.createElement('p'); allCount.id = 'visit-all-count';
  const allList = document.createElement('ul'); allList.id = 'visit-all-photo-list';
  const allHeader = document.createElement('div'); allHeader.className = 'visit-all-header'; allHeader.append(allBack, allTitle, allCount);
  visitAll.append(allHeader, allList);
  const visitEditor = document.createElement('div'); visitEditor.id = 'visit-editor'; visitEditor.hidden = true;
  const editBack = button('visit-edit-back', 'キャンセル', () => {});
  const editPhotos = button('visit-photo-edit-open', '写真を選択', () => {});
  const editorPreview = document.createElement('div'); editorPreview.id = 'visit-editor-preview';
  visitForm.insertBefore(editPhotos, visitForm.querySelector('.form-actions'));
  visitForm.insertBefore(editorPreview, editPhotos);
  visitForm.querySelector('.form-actions')!.prepend(editBack);
  const editActions = visitForm.querySelector<HTMLElement>('.form-actions')!;
  editActions.setAttribute('role', 'group'); editActions.setAttribute('aria-label', 'アルバム編集の操作');
  linkedHeading.setAttribute('hidden', ''); linked.hidden = true;
  visitEditor.append(visitForm, linkedHeading, linked);
  visitDetail.append(visitDetailHeading, visitStatus, visitOverview, visitAll, visitEditor);
  const rightTitle = document.createElement('div'); rightTitle.className = 'panel-top';
  const rightHeading = document.createElement('strong'); rightHeading.textContent = '詳細';
  rightTitle.append(rightHeading, button('right-close', '閉じる', () => navigate(() => { if (!rightCloseHandler?.()) { rightOpen = false; setState(); } }, true)));
  right.append(rightTitle, photoDetail, visitDetail);

  const manageTitle = document.createElement('div'); manageTitle.className = 'panel-top';
  const manageHeading = document.createElement('strong'); manageHeading.id = 'management-heading'; manageHeading.textContent = '管理';
  manageTitle.append(manageHeading, button('management-close', '閉じる', () => navigate(closeManagement)));
  albumIcon(manageTitle.querySelector<HTMLButtonElement>('#management-close')!, 'close', '管理を閉じる');
  const manageLinks = document.createElement('nav'); manageLinks.className = 'manage-links'; manageLinks.setAttribute('aria-label', '管理項目');
  for (const [key, label] of [['recovery', 'ごみ箱'], ['archive', 'ZIP']] as const) {
    const item = button(`manage-${key}`, label, () => openManagement(key));
    if (key === 'recovery') item.setAttribute('aria-label', 'ごみ箱');
    if (key === 'archive') item.setAttribute('aria-label', 'バックアップと復元');
    manageLinks.append(item);
  }
  const manageCards = document.createElement('div'); manageCards.className = 'manage-cards';
  manageCards.append(archive, restore, recovery);
  const manageExtra = document.createElement('details'); manageExtra.className = 'manage-extra'; manageExtra.id = 'management-extra';
  const extraHeading = document.createElement('summary'); extraHeading.textContent = '地図の設定と配信情報';
  manageExtra.append(extraHeading);
  const tripHeading = document.createElement('h2'); tripHeading.id = 'trip-create-heading'; tripHeading.textContent = '新しい旅行';
  const tripForm = trip.querySelector<HTMLFormElement>('#trip-form')!;
  tripDialog.append(tripHeading, tripForm);
  const tripManagementTitle = document.createElement('div'); tripManagementTitle.className = 'panel-top';
  const tripManagementHeading = document.createElement('h2'); tripManagementHeading.id = 'trip-management-heading'; tripManagementHeading.textContent = '旅行の管理';
  const tripClose = button('trip-management-close', '', closeTrips); albumIcon(tripClose, 'close', '旅行管理を閉じる');
  tripManagementTitle.append(tripManagementHeading, tripClose);
  const tripActions = document.createElement('div'); tripActions.className = 'row';
  tripActions.append(button('trip-management-create', '新しい旅行を作成', () => openTripCreate()), byId('trip-trash'));
  tripManagement.append(tripManagementTitle, tripManagementSelect, tripActions);
  tripManagement.addEventListener('cancel', event => { event.preventDefault(); closeTrips(); });
  tripForm.querySelector('#trip-create-cancel')!.addEventListener('click', closeTripCreate);
  const importTitle = document.createElement('div'); importTitle.className = 'panel-top';
  const importHeading = document.createElement('h2'); importHeading.id = 'photo-import-heading'; importHeading.textContent = '写真を追加';
  const importClose = button('import-close', '', closeImport); albumIcon(importClose, 'close', '写真追加を閉じる');
  importTitle.append(importHeading, importClose);
  const importTrip = document.createElement('p'); importTrip.id = 'photo-import-trip';
  byId('import-heading').classList.add('sr-only'); importDialog.append(importTitle, importTrip, importing);
  importing.querySelector<HTMLButtonElement>('#import-done')!.addEventListener('click', closeImport);
  const privacy = document.createElement('details'); privacy.id = 'basemap-privacy'; privacy.className = 'map-privacy';
  privacy.innerHTML = `<summary>地図の配信元とプライバシー</summary><p>標準地図はOpenFreeMap（Liberty）から起動時に読み込みます。淡色はPositronです。地図の表示・配信・保護のため、IPアドレス、ブラウザ等の通信情報や閲覧地域が配信元・CDNへ伝わり得ます。</p><p>スタイル、タイル、フォント、スプライトの要求先は tiles.openfreemap.org です。航空・衛星写真を選ぶと tiles.maps.eox.at（EOX・2016年）へ、拡大時は日本の cyberjapandata.gsi.go.jp（国土地理院）・米国本土の basemap.nationalmap.gov（USGS）へ追加通信します。地形を選ぶと tiles.mapterhorn.com（Mapterhorn）へ追加通信します。ラベルはOpenFreeMapから読み込みます。写真ファイル、Exif、ファイル名、アルバムデータは送信しません。現在地は自動取得しません。</p><p>すべて無料・APIキー不要です。航空写真は日本・米国本土の提供範囲に限定し、撮影時期・精度・欠損は地域によります。提供内でも海面などが空白になる場合があります。対象外の世界衛星写真は2016年の約10m級で、細部の確認には向きません。無料配信の継続・精度・稼働は保証されず、通信できない場合も写真とアルバムは利用できます。</p><p><a href="https://openfreemap.org/privacy/" target="_blank" rel="noopener noreferrer">OpenFreeMapのプライバシー</a> · <a href="https://openfreemap.org/tos/" target="_blank" rel="noopener noreferrer">利用規約</a> · <a href="https://cloudless.eox.at/documentation/faq" target="_blank" rel="noopener noreferrer">EOXの利用条件</a> · <a href="https://mapterhorn.com/attribution/" target="_blank" rel="noopener noreferrer">Mapterhornの出典</a> · <a href="https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html" target="_blank" rel="noopener noreferrer">地理院の利用条件</a> · <a href="https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer" target="_blank" rel="noopener noreferrer">USGSの提供情報</a></p>`;
  manageExtra.append(privacy);
  manage.append(manageTitle, manageCards, manageExtra);
  for (const icon of manage.querySelectorAll<HTMLElement>('[data-manage-icon]')) {
    const name = icon.dataset.manageIcon;
    if (name === 'trash' || name === 'history' || name === 'download' || name === 'upload') icon.innerHTML = iconMarkup(name);
  }
  for (const summary of manage.querySelectorAll<HTMLElement>('.manage-help > summary')) {
    const label = summary.textContent ?? '補足情報';
    summary.title = label; summary.setAttribute('aria-label', label); summary.innerHTML = iconMarkup('info');
    const text = document.createElement('span'); text.className = 'sr-only'; text.textContent = label; summary.append(text);
  }

  const mapStatus = byId('map-status'), mapElement = byId('map');
  const photoChooser = byId('map-photo-chooser'), visitChooser = byId('visit-map-chooser');
  const mapNavigation = document.createElement('div'); mapNavigation.id = 'map-navigation';
  mapNavigation.setAttribute('role', 'group'); mapNavigation.setAttribute('aria-label', '地図の拡大・縮小');
  for (const [id, text, label] of [['map-zoom-in', '+', '地図を拡大'], ['map-zoom-out', '−', '地図を縮小']] as const) {
    const zoom = byId(id); zoom.textContent = text; zoom.setAttribute('aria-label', label); zoom.title = label; mapNavigation.append(zoom);
  }
  const mapTools = document.createElement('div'); mapTools.id = 'map-settings';
  for (const child of [...mapPanel.children]) {
    if (child !== mapElement && child !== mapStatus && child !== photoChooser && child !== visitChooser && child.id !== 'map-heading') mapTools.append(child);
  }
  const visitFocus = document.createElement('div'); visitFocus.id = 'visit-focus-banner'; visitFocus.hidden = true;
  const focusMessage = document.createElement('p'); focusMessage.id = 'visit-focus-message';
  const focusExit = button('visit-focus-exit', '×', () => {});
  albumIcon(focusExit, 'close', 'アルバム限定表示を終了して通常の地図に戻る');
  const focusEmpty = document.createElement('p'); focusEmpty.id = 'visit-focus-empty'; focusEmpty.hidden = true;
  focusEmpty.textContent = 'このアルバムには地図に表示できる写真がありません'; focusEmpty.setAttribute('role', 'status');
  visitFocus.append(focusMessage, focusExit, focusEmpty);
  mapPanel.append(mapElement, mapStatus, photoChooser, visitChooser, visitFocus, mapNavigation);
  const mapSettings = document.createElement('details'); mapSettings.id = 'management-map-settings';
  const mapSettingsHeading = document.createElement('summary'); mapSettingsHeading.textContent = '地図の表示設定';
  mapSettings.append(mapSettingsHeading, mapTools); manageExtra.insertBefore(mapSettings, privacy);

  const headerActions = document.createElement('div'); headerActions.className = 'header-actions';
  const photoAdd = button('header-add', '', () => openImport());
  albumIcon(photoAdd, 'add', '写真を追加');
  photoAdd.setAttribute('aria-label', '写真追加'); photoAdd.title = '写真追加';
  const photoToolbar = document.createElement('div'); photoToolbar.className = 'photo-list-toolbar';
  photoToolbar.append(photos.querySelector<HTMLElement>('#photo-count')!, photoAdd); photos.prepend(photoToolbar);
  const mapPhotoGroup = document.createElement('div'); mapPhotoGroup.id = 'map-photo-group'; mapPhotoGroup.hidden = true;
  const mapGroupBack = button('map-photo-group-back', '', () => {}); albumIcon(mapGroupBack, 'back', '通常の写真一覧に戻る');
  const mapGroupHeading = document.createElement('strong'); mapGroupHeading.id = 'map-photo-group-heading';
  mapPhotoGroup.append(mapGroupBack, mapGroupHeading); photos.prepend(mapPhotoGroup);
  const tripManageButton = button('header-trips', '', openTrips); albumIcon(tripManageButton, 'panel', '旅行を管理'); tripPicker.append(tripManageButton);
  const appManage = button('header-manage', '', () => managementOpen ? navigate(closeManagement) : openManagement());
  albumIcon(appManage, 'settings', 'アプリ管理'); headerActions.append(appManage);
  header.replaceChildren(brand, tripPicker, headerActions);
  for (const [tab, label] of [['map', '地図'], ['photos', '写真'], ['visits', 'アルバム']] as const) {
    const item = button(`mobile-tab-${tab}`, label, () => selectTab(tab)); item.dataset.tab = tab;
    albumIcon(item, tab === 'map' ? 'map' : tab === 'photos' ? 'photos' : 'panel', label);
    const text = document.createElement('span'); text.textContent = label; item.append(text); bottom.append(item);
  }
  main.replaceChildren(mapPanel, left, right, manage, bottom, drawerToggle, importDialog, importTask, tripDialog, tripManagement);
  const panelSizeObserver = new ResizeObserver(() => {
    document.body.style.setProperty('--detail-panel-height', `${Math.ceil(right.getBoundingClientRect().height)}px`);
    document.body.style.setProperty('--list-header-height', `${Math.ceil(leftTitle.getBoundingClientRect().height)}px`);
  });
  panelSizeObserver.observe(right); panelSizeObserver.observe(leftTitle);
  matchMedia('(max-width: 700px)').addEventListener('change', setState);
  matchMedia('(max-width: 1100px)').addEventListener('change', event => { if (event.matches) leftOpen = false; setState(); });
  window.addEventListener('resize', setState);
  left.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && !matchMedia('(max-width: 700px)').matches) {
      event.preventDefault(); event.stopPropagation();
      navigate(() => { leftOpen = false; setState(); drawerToggle.focus(); });
    }
  });
  setState();
  return { requestNavigation: navigate, openDetail, openManagement, closeManagement, selectTab, openImport, closeImport,
    openPhotoList: () => navigate(() => { leftOpen = true; leftView = 'photos'; mobileTab = 'photos'; rightOpen = false; setState(); }, true),
    refreshTrips, openTripCreate, closeTripCreate, tripCreateForImport: () => tripCreateForImport,
    onImportRequest: (handler: () => boolean) => { importRequest = handler; },
    onTripCreateOpening: (handler: () => void) => { tripCreateOpening = handler; },
    onTripCreateClosing: (handler: () => boolean) => { tripCreateClosing = handler; },
    setImportState: (running: boolean, message: string, target: string, hasResult = true) => {
      if (running || !hasResult) importResultSeen = false;
      importRunning = running; importMessage = message; importTargetLabel = target;
      importHasResult = hasResult;
      byId('photo-import-trip').textContent = `取り込み先：${target}`; refreshImportTask();
    },
    prepareVisitEditor: () => {
      mobileTab = 'visits';
      if (leftView !== 'visits') { listScroll[leftView] = left.scrollTop; leftView = 'visits'; left.scrollTop = listScroll.visits; }
      setState();
    },
    closeRight: () => { rightOpen = false; setState(); }, isDetailOpen: () => rightOpen,
    closeLeft: () => { if (!matchMedia('(max-width: 700px)').matches && leftOpen) { leftOpen = false; setState(); } },
    onNavigate: (handler: (proceed: () => void, leavesDetail: boolean) => void) => { navigationHandler = handler; },
    onRightClose: (handler: () => boolean) => { rightCloseHandler = handler; },
    mapViewportInsets: () => mapViewportInsets(mapElement),
    onViewportChange: (listener: NonNullable<typeof viewportChange>) => { viewportChange = listener; setState(); } };
}
