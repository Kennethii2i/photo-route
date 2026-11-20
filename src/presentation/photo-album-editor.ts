import type { Photo, PhotoAlbumLink, Thumbnail, Trip, Visit } from '../domain/model';
import { AlbumMembershipConflict, LibraryDb, type AlbumMembershipBatchResult } from '../infrastructure/storage';
import { sourceGpsDisplay } from '../domain/gps';
import { displayCaptureClock } from './date-display';
import { linkedPhotoDateRange } from './visit-view';
import { PhotoAlbumDraft } from './photo-album-draft';
import { storageErrorText } from './error-notice';

const byId = <T extends HTMLElement>(root: ParentNode, id: string): T => {
  const found = root.querySelector<T>(`#${id}`);
  if (!found) throw new Error(`編集画面がありません: ${id}`);
  return found;
};
const errorText = storageErrorText;
const conflictText = (reason: string) => ({
  'photo-changed': 'ほかの操作で写真が変更されました。',
  'membership-changed': 'ほかの操作で所属先が変更されました。',
  'album-changed': 'アルバムの状態が変更されました。',
  'album-in-trash': 'ごみ箱内のアルバムには追加できません。',
  'trip-changed': '旅行の状態が変更されました。',
  'operation-changed-after-save': '保存後に所属先が変更されました。',
}[reason] ?? '写真またはアルバムの最新状態を確認してください。');

export class PhotoAlbumEditor {
  readonly root: HTMLDialogElement;
  private readonly leave: HTMLDialogElement;
  private readonly list: HTMLElement;
  private readonly thumbnailObserver: IntersectionObserver;
  private draft: PhotoAlbumDraft | null = null;
  private photos: Photo[] = [];
  private albums: Visit[] = [];
  private links: PhotoAlbumLink[] = [];
  private rowPhotos = new Map<string, Photo[]>();
  private photoById = new Map<string, Photo>();
  private urls: string[] = [];
  private thumbGeneration = 0;
  private busy = false;
  private conflictBlocked = false;
  private pendingUnknown: { operationId: string; added: number; removed: number } | null = null;
  private pendingLeave: (() => void) | null = null;
  private opener: HTMLElement | null = null;

  constructor(private readonly db: LibraryDb, private readonly afterMutation: () => Promise<void>,
    private readonly onSaved: (operationId: string) => void = () => {}) {
    const root = document.createElement('dialog'); root.id = 'photo-album-editor';
    root.setAttribute('aria-labelledby', 'pae-title');
    root.innerHTML = `<header class="pae-header"><h2 id="pae-title">アルバムを編集</h2><button id="pae-close" type="button" aria-label="写真の詳細に戻る"><span class="pae-close-desktop" aria-hidden="true">閉じる</span><span class="pae-close-mobile" aria-hidden="true">〈 写真の詳細</span></button></header>
      <div class="pae-subject"><div id="pae-subject-thumb" class="pae-subject-thumb">画像なし</div><div class="pae-subject-copy"><strong id="pae-photo-name"></strong><span id="pae-photo-date"></span><span id="pae-photo-location"></span></div></div>
      <div class="pae-heading"><h3>この写真の所属アルバムを設定</h3><p id="pae-counts" role="status"></p></div>
      <label class="pae-search-label" for="pae-search">アルバムを検索</label><input id="pae-search" type="search" placeholder="この旅行内のアルバムを検索" autocomplete="off" />
      <div id="pae-list" class="pae-list" tabindex="0"></div>
      <p id="pae-trash-note" class="pae-note" hidden></p>
      <section id="pae-conflict" class="pae-conflict" hidden tabindex="-1" aria-label="所属変更の競合"><strong>所属の状態を確認してください</strong><p id="pae-conflict-message"></p><p id="pae-latest"></p><div class="row"><button id="pae-review" type="button">最新状態を確認</button><button id="pae-restart" type="button" disabled>選択を破棄して編集し直す</button></div></section>
      <footer class="pae-footer"><p id="pae-status" role="status" aria-live="polite"></p><div class="pae-actions"><button id="pae-cancel" type="button">キャンセル</button><button id="pae-save" type="button" disabled>保存</button></div></footer>`;
    const leave = document.createElement('dialog'); leave.id = 'pae-leave'; leave.setAttribute('aria-label', '未保存のアルバム変更');
    leave.innerHTML = `<h2>変更が保存されていません</h2><p>写真のアルバム所属を保存、破棄、または編集を続けるか選んでください。</p><div class="pae-actions"><button id="pae-leave-stay" type="button">編集を続ける</button><button id="pae-leave-discard" type="button">破棄して戻る</button><button id="pae-leave-save" type="button">保存して戻る</button></div>`;
    document.body.append(root, leave); this.root = root; this.leave = leave;
    this.list = byId(root, 'pae-list');
    this.thumbnailObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cover = entry.target as HTMLElement;
        this.thumbnailObserver.unobserve(cover);
        const photo = this.photoById.get(cover.dataset.photoId ?? '');
        if (photo?.thumbnailId) void this.loadThumbnail(cover, photo.thumbnailId, this.thumbGeneration);
      }
    }, { root: this.list, rootMargin: '100px' });
    byId(root, 'pae-close').addEventListener('click', () => this.requestLeave(() => this.close()));
    byId(root, 'pae-cancel').addEventListener('click', () => this.requestLeave(() => this.close()));
    byId(root, 'pae-save').addEventListener('click', () => { void this.save(); });
    byId(root, 'pae-search').addEventListener('input', () => this.filter());
    byId(root, 'pae-review').addEventListener('click', () => { void this.reviewLatest(); });
    byId(root, 'pae-restart').addEventListener('click', () => { void this.reload('最新状態から編集をやり直します。以前の選択は破棄しました。'); });
    root.addEventListener('cancel', event => { event.preventDefault(); this.requestLeave(() => this.close()); });
    leave.addEventListener('cancel', event => { event.preventDefault(); this.pendingLeave = null; leave.close(); });
    byId(leave, 'pae-leave-stay').addEventListener('click', () => { this.pendingLeave = null; leave.close(); });
    byId(leave, 'pae-leave-discard').addEventListener('click', () => { const proceed = this.pendingLeave; this.pendingLeave = null; leave.close(); proceed?.(); });
    byId(leave, 'pae-leave-save').addEventListener('click', () => { leave.close(); void this.save(); });
    window.addEventListener('beforeunload', event => { if (this.isOpen && this.isDirty) { event.preventDefault(); event.returnValue = ''; } });
  }

  get isOpen(): boolean { return this.root.open; }
  get isDirty(): boolean { return this.draft?.isDirty ?? false; }
  open(photo: Photo, trip: Trip, albums: Visit[], links: PhotoAlbumLink[], photos: Photo[]): void {
    if (this.isOpen) throw new Error('別の写真を編集中です');
    this.draft = new PhotoAlbumDraft(photo, trip, albums, links.filter(link => link.photoId === photo.id));
    this.photos = photos; this.albums = albums; this.links = links;
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.busy = false; this.conflictBlocked = false; this.pendingUnknown = null; this.pendingLeave = null;
    byId<HTMLInputElement>(this.root, 'pae-search').value = '';
    this.render(); this.setStatus('変更は保存するまで反映されません。');
    document.body.dataset.photoAlbumEditing = 'true';
    this.root.showModal(); byId<HTMLInputElement>(this.root, 'pae-search').focus();
  }
  close(): void {
    if (!this.isOpen) return;
    if (this.leave.open) this.leave.close();
    this.root.close(); delete document.body.dataset.photoAlbumEditing;
    this.clearThumbnails(); this.draft = null; this.pendingLeave = null; this.pendingUnknown = null;
    const focus = this.opener?.isConnected ? this.opener : document.querySelector<HTMLElement>('#photo-album-edit-open');
    focus?.focus(); this.opener = null;
  }
  requestLeave(proceed: () => void): void {
    if (!this.isOpen) { proceed(); return; }
    if (this.busy) { this.setStatus('保存処理中です。完了後に移動してください。'); return; }
    if (this.pendingUnknown) { this.showConflict('保存結果が不明です。最新状態を確認してから移動してください。'); return; }
    if (!this.isDirty) { this.close(); proceed(); return; }
    this.pendingLeave = proceed;
    if (!this.leave.open) this.leave.showModal();
    byId<HTMLButtonElement>(this.leave, 'pae-leave-stay').focus();
  }
  private clearThumbnails(): void {
    this.thumbGeneration++; this.thumbnailObserver.disconnect();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
  }
  private async loadThumbnail(target: HTMLElement, id: string, generation: number): Promise<void> {
    let thumbnail: Thumbnail | undefined;
    try { thumbnail = await this.db.getThumbnail(id); } catch { /* Keep the placeholder. */ }
    if (generation !== this.thumbGeneration || !target.isConnected) return;
    if (!thumbnail) { target.textContent = '画像なし'; return; }
    const url = URL.createObjectURL(thumbnail.blob); this.urls.push(url);
    const image = document.createElement('img'); image.src = url; image.alt = ''; target.replaceChildren(image);
  }
  private render(): void {
    const draft = this.draft; if (!draft) return;
    this.clearThumbnails();
    byId(this.root, 'pae-photo-name').textContent = draft.photo.originalFilename;
    byId(this.root, 'pae-photo-date').textContent = displayCaptureClock(draft.photo.timeCorrection?.correctedLocalClock ?? draft.photo.sourceTime.localClock) ?? '撮影日時不明';
    const gps = sourceGpsDisplay(draft.photo.sourceGps);
    byId(this.root, 'pae-photo-location').textContent = draft.photo.gpsCorrection ? '位置: 手動補正' : gps.state === 'reference' ? '位置: 測地系不明の参考位置' : gps.point ? '位置情報あり' : '位置情報なし';
    const subject = byId(this.root, 'pae-subject-thumb'); subject.textContent = '画像なし';
    if (draft.photo.thumbnailId) void this.loadThumbnail(subject, draft.photo.thumbnailId, this.thumbGeneration);
    const photoMap = new Map(this.photos.filter(photo => !photo.deletedAt).map(photo => [photo.id, photo]));
    this.photoById = photoMap; this.rowPhotos.clear();
    for (const link of this.links) {
      const photo = photoMap.get(link.photoId);
      if (!photo) continue;
      const linked = this.rowPhotos.get(link.albumId) ?? [];
      linked.push(photo); this.rowPhotos.set(link.albumId, linked);
    }
    const selected = draft.activeAlbums.filter(album => draft.initialActiveIds.has(album.id));
    const candidates = draft.activeAlbums.filter(album => !draft.initialActiveIds.has(album.id));
    this.list.replaceChildren();
    this.addGroup('現在の所属アルバム', selected);
    this.addGroup('その他のアルバム', candidates);
    const note = byId(this.root, 'pae-trash-note');
    const trash = draft.counts().trash;
    note.hidden = trash === 0;
    note.textContent = trash ? `ごみ箱内アルバムへの既存の所属 ${trash}件は、この編集では変更せず保持します。` : '';
    this.filter(); this.updateCounts();
  }
  private addGroup(title: string, albums: Visit[]): void {
    const section = document.createElement('section'); section.className = 'pae-group';
    const heading = document.createElement('h4'); heading.textContent = `${title}（${albums.length}件）`;
    section.append(heading);
    if (!albums.length) { const empty = document.createElement('p'); empty.className = 'pae-empty'; empty.textContent = '該当するアルバムはありません。'; section.append(empty); }
    for (const album of albums) {
      const row = document.createElement('label'); row.className = 'pae-album'; row.dataset.albumId = album.id;
      const linked = this.rowPhotos.get(album.id) ?? [];
      const cover = document.createElement('span'); cover.className = 'pae-cover'; cover.textContent = '画像なし';
      const featured = linked.find(photo => photo.thumbnailId);
      if (featured?.thumbnailId) { cover.dataset.photoId = featured.id; this.thumbnailObserver.observe(cover); }
      const copy = document.createElement('span'); copy.className = 'pae-album-copy';
      const name = document.createElement('strong'); name.textContent = album.label;
      const meta = document.createElement('small'); const range = linkedPhotoDateRange(linked);
      meta.textContent = `写真 ${linked.length}枚${range ? ` · 撮影 ${range}` : ''}`;
      copy.append(name, meta);
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = this.draft!.selected(album.id);
      check.setAttribute('aria-label', `${album.label}にこの写真を所属させる`);
      check.addEventListener('change', () => { this.draft?.choose(album.id, check.checked); row.dataset.selected = String(check.checked); this.updateCounts(); });
      const checkArea = document.createElement('span'); checkArea.className = 'pae-check'; checkArea.append(check);
      row.dataset.selected = String(check.checked); row.append(cover, copy, checkArea); section.append(row);
    }
    this.list.append(section);
  }
  private filter(): void {
    const query = byId<HTMLInputElement>(this.root, 'pae-search').value.trim().toLocaleLowerCase();
    for (const row of this.list.querySelectorAll<HTMLElement>('.pae-album')) {
      const album = this.albums.find(item => item.id === row.dataset.albumId);
      row.hidden = Boolean(query && !album?.label.toLocaleLowerCase().includes(query));
      const cover = row.querySelector<HTMLElement>('.pae-cover');
      if (!row.hidden && cover?.dataset.photoId && !cover.querySelector('img')) this.thumbnailObserver.observe(cover);
    }
  }
  private updateCounts(): void {
    const counts = this.draft?.counts(); if (!counts) return;
    const current = document.createElement('span'); current.textContent = `所属中 ${counts.current}件`;
    const delta = document.createElement('span'); delta.textContent = counts.added || counts.removed ? `変更 +${counts.added}・−${counts.removed}` : '変更なし';
    delta.className = counts.added || counts.removed ? 'pae-delta is-dirty' : 'pae-delta';
    byId(this.root, 'pae-counts').replaceChildren(current, delta);
    byId<HTMLButtonElement>(this.root, 'pae-save').disabled = this.busy || this.conflictBlocked || !this.isDirty;
  }
  private setStatus(text: string): void { byId(this.root, 'pae-status').textContent = text; }
  private showConflict(text: string): void {
    this.conflictBlocked = true; this.pendingLeave = null;
    const panel = byId(this.root, 'pae-conflict'); panel.hidden = false;
    byId(panel, 'pae-conflict-message').textContent = `${text} 未保存のチェックは保持しています。自動再送はしません。`;
    byId<HTMLButtonElement>(panel, 'pae-restart').disabled = Boolean(this.pendingUnknown);
    panel.focus(); this.updateCounts();
  }
  private async save(): Promise<void> {
    const draft = this.draft; if (!draft || !draft.isDirty || this.busy || this.conflictBlocked) return;
    const counts = draft.counts(), operationId = crypto.randomUUID();
    this.busy = true; this.updateCounts(); this.setStatus('アルバムの変更を保存しています。');
    let result: AlbumMembershipBatchResult | null = null;
    try { result = await this.db.saveAlbumMembershipBatch(draft.request(operationId)); }
    catch (error) {
      if (error instanceof AlbumMembershipConflict) this.showConflict(conflictText(error.reason));
      else {
        const status = await this.db.albumMembershipOperationStatus(operationId);
        if (status === 'applied') result = { status: 'saved', operationId, changedPhotos: 1, added: counts.added, removed: counts.removed };
        else if (status === 'absent') { this.pendingLeave = null; this.setStatus(`保存されていません。選択は保持しました。原因: ${errorText(error)}`); }
        else { this.pendingUnknown = status === 'unknown' ? { operationId, added: counts.added, removed: counts.removed } : null;
          this.showConflict(status === 'unknown' ? '保存結果を確認できません。最新状態を確認してください。' : '保存後に状態が変更されました。'); }
      }
    }
    if (result) await this.saved(operationId, counts.added, counts.removed);
    this.busy = false; this.updateCounts();
  }
  private async saved(operationId: string, added: number, removed: number): Promise<void> {
    this.pendingUnknown = null;
    try {
      await this.afterMutation();
      await this.reload(`${added}件追加・${removed}件解除しました。`);
      this.onSaved(operationId);
      const proceed = this.pendingLeave; this.pendingLeave = null;
      if (proceed) { this.close(); proceed(); }
    } catch (error) { this.showConflict(`保存は確定しましたが画面を更新できません: ${errorText(error)}`); }
  }
  private async reviewLatest(): Promise<void> {
    const draft = this.draft; if (!draft) return;
    if (this.pendingUnknown) {
      const { operationId, added, removed } = this.pendingUnknown;
      const status = await this.db.albumMembershipOperationStatus(operationId);
      if (status === 'applied') { await this.saved(operationId, added, removed); return; }
      if (status === 'absent') { this.pendingUnknown = null; this.conflictBlocked = false; byId(this.root, 'pae-conflict').hidden = true;
        this.setStatus('保存されていないことを確認しました。選択を保持しています。'); this.updateCounts(); return; }
      if (status === 'unknown') { byId(this.root, 'pae-latest').textContent = '保存結果がまだ不明です。再送せず、もう一度確認してください。'; return; }
      this.pendingUnknown = null;
    }
    try {
      const [links, albums] = await Promise.all([this.db.listPhotoAlbumLinks(draft.photo.id), this.db.listVisits()]);
      const names = links.map(link => albums.find(album => album.id === link.albumId))
        .map(album => album ? `${album.label}${album.deletedAt ? '（ごみ箱）' : ''}` : '確認できないアルバム');
      byId(this.root, 'pae-latest').textContent = `現在の所属: ${names.join('、') || 'なし'}`;
      byId<HTMLButtonElement>(this.root, 'pae-restart').disabled = false;
    } catch (error) { byId(this.root, 'pae-latest').textContent = `最新状態を確認できません: ${errorText(error)}`; }
  }
  private async reload(status: string): Promise<void> {
    const prior = this.draft; if (!prior) return;
    const [trip, albums, links, photos] = await Promise.all([
      this.db.getTrip(prior.trip.id), this.db.listVisits(), this.db.listPhotoAlbumLinks(), this.db.listPhotos(),
    ]);
    const photo = photos.find(item => item.id === prior.photo.id);
    if (!photo || !trip) throw new Error('写真または旅行が見つかりません');
    this.draft = new PhotoAlbumDraft(photo, trip, albums, links.filter(link => link.photoId === photo.id));
    this.photos = photos; this.albums = albums; this.links = links;
    this.conflictBlocked = false; this.pendingUnknown = null; byId(this.root, 'pae-conflict').hidden = true;
    this.render(); this.setStatus(status);
  }
}
