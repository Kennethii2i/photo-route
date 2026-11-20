import type { Photo, PhotoAlbumLink, Thumbnail, Trip, Visit } from '../domain/model';
import { AlbumMembershipConflict, LibraryDb, type AlbumMembershipBatchResult } from '../infrastructure/storage';
import { filterPhotos, emptyPhotoFilter } from './photo-filter';
import { VisitPhotoDraft } from './visit-photo-draft';
import { storageErrorText } from './error-notice';

type Row = { kind: 'heading'; title: string; count: number; height: number } | { kind: 'photos'; photos: Photo[]; height: number };
const byId = <T extends HTMLElement>(root: ParentNode, id: string): T => {
  const found = root.querySelector<T>(`#${id}`); if (!found) throw new Error(`編集画面がありません: ${id}`); return found;
};
const errorText = (error: unknown) => storageErrorText(error).replaceAll('訪問記録', 'アルバム').replaceAll('Visit', 'アルバム');
const conflictText = (reason: string): string => {
  switch (reason) {
    case 'photo-changed': return '別の操作によって写真が変更されています。';
    case 'photo-missing': return '写真が見つかりません。';
    case 'photo-in-trash': return '写真がごみ箱に移動しています。';
    case 'duplicate-photo-id': return '同じ写真が保存対象に重複しています。';
    case 'membership-changed': return '別の操作によって写真のアルバム所属が変更されています。';
    case 'album-changed': return '対象のアルバムが変更されています。';
    case 'album-in-trash': return 'ごみ箱内のアルバムへ新しく追加できません。';
    case 'expected-albums-incomplete': return '所属アルバムを確認できません。';
    case 'operation-changed-after-save': return '保存後に写真の所属が変更されています。';
    case 'trip-changed': return '旅行が変更されています。';
    case 'trip-mismatch': return '写真とアルバムの旅行が一致しません。';
    case 'undo-order-or-photo-changed': return 'その後に別の操作が行われたため、ここから一括変更を戻せません。';
    case 'undo-membership-changed': return '保存後にアルバム所属が変更されたため、一括変更を戻せません。';
    case 'undo-photo-changed': return '保存後に写真が変更されたため、一括変更を戻せません。';
    case 'undo-trip-missing': return '旅行が見つからないため、一括変更を戻せません。';
    case 'undo-source-visit-invalid': return '移動元のアルバムを確認できないため、一括変更を戻せません。';
    case 'changed-after-save': return '保存後に写真が変更されています。';
    case 'undone': return 'この一括変更は既に取り消されています。';
    case 'status-unknown': return '保存結果をまだ確認できません。';
    case 'operation-id-reused': return '同じ保存操作が別の内容で使われています。';
    default: return '写真またはアルバムの状態を確認できません。';
  }
};
const conflictHeading = (reason: string): string => {
  if (reason === 'photo-changed' || reason === 'undo-photo-changed') return '写真が別の操作で変更されました';
  if (reason === 'undo-order-or-photo-changed') return '後続の変更があります';
  if (reason === 'status-unknown') return '保存結果を確認してください';
  return '写真やアルバムの状態が変わりました';
};

export class VisitPhotoEditor {
  readonly root: HTMLElement;
  private draft: VisitPhotoDraft | null = null;
  private rows: Row[] = [];
  private offsets: number[] = [0];
  private columns = 3;
  private lastWidth = 0;
  private visibleIds: string[] = [];
  private currentWindow = '';
  private scheduled = false;
  private generation = 0;
  private loading = 0;
  private pending: { button: HTMLElement; photo: Photo; generation: number }[] = [];
  private urls = new Map<HTMLElement, string>();
  private previewId: string | null = null;
  private previewUrl: string | null = null;
  private previewGeneration = 0;
  private busy = false;
  private conflictBlocked = false;
  private pendingLeave: (() => void) | null = null;
  private lastSavedOperationId: string | null = null;
  private lastSavedPhotoIds: string[] = [];
  private pendingUnknown: { operationId: string; counts: ReturnType<VisitPhotoDraft['counts']> } | null = null;
  private readonly observer: IntersectionObserver;
  private readonly scroller: HTMLElement;
  private readonly list: HTMLElement;
  private readonly rightPanel: HTMLElement;
  private readonly mapPanel: HTMLElement;
  private readonly backdrop: HTMLElement;
  private previousRightInert = false;
  private previousMapInert = false;
  private opener: HTMLElement | null = null;
  private previewOpener: HTMLElement | null = null;
  private shadeOpener: HTMLElement | null = null;
  private conflictPhotoId: string | null = null;

  constructor(private readonly db: LibraryDb, private readonly afterMutation: () => Promise<void>, private readonly onClose: () => void,
    private readonly onSaved: (operationId: string) => void = () => {}) {
    const root = document.createElement('section'); root.id = 'visit-photo-editor-overlay'; root.hidden = true; root.tabIndex = -1;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'vpe-title');
    root.innerHTML = `<div class="vpe-top"><div><p class="vpe-eyebrow">写真を選択 · タップで追加・解除</p><h2 id="vpe-title"></h2></div><button id="vpe-close" type="button">戻る</button></div>
      <div class="vpe-filters"><label for="vpe-search">追加する写真を探す</label><input id="vpe-search" type="search" placeholder="ファイル名で検索" autocomplete="off" />
        <details id="vpe-date-more"><summary>撮影日で絞り込む</summary><div class="row"><label>開始日<input id="vpe-from" type="date" /></label><label>終了日<input id="vpe-to" type="date" /></label></div></details>
        <p id="vpe-filter-count" role="status"></p></div>
      <div id="vpe-scroll" tabindex="0"><div id="vpe-list"></div></div>
      <footer class="vpe-footer"><p id="vpe-counts" role="status"></p><div class="row"><button id="vpe-cancel" type="button">キャンセル</button><button id="vpe-save" type="button" disabled>変更を保存</button></div><p id="vpe-status" role="status" aria-live="polite"></p><button id="vpe-state-review" type="button" hidden>保存状態を確認</button></footer>
      <div id="vpe-preview" class="vpe-shade" hidden><section class="vpe-dialog" role="dialog" aria-label="写真プレビュー"><button id="vpe-preview-close" type="button">プレビューを閉じる</button><div id="vpe-preview-image"></div><h3 id="vpe-preview-name"></h3><p id="vpe-preview-source"></p><label class="vpe-checkline"><input id="vpe-preview-check" type="checkbox" /> このアルバムに含める</label><div class="row"><button id="vpe-preview-prev" type="button">前の写真</button><button id="vpe-preview-next" type="button">次の写真</button></div></section></div>
      <div id="vpe-leave" class="vpe-shade" hidden><section class="vpe-dialog" role="dialog" aria-label="未保存の変更"><h3>写真の所属変更が未保存です</h3><p>保存、破棄、編集継続から選んでください。</p><div class="row"><button id="vpe-leave-save" type="button">変更を保存して移動</button><button id="vpe-leave-discard" type="button">変更を破棄して移動</button><button id="vpe-leave-stay" type="button">編集を続ける</button></div></section></div>
      <div id="vpe-conflict" class="vpe-shade" hidden><section class="vpe-dialog" role="dialog" aria-label="保存状態の確認"><h3>一括変更の確認が必要です</h3><p id="vpe-conflict-reason"></p><div id="vpe-conflict-latest"></div><div class="row"><button id="vpe-review" type="button">最新状態を確認</button><button id="vpe-restart" type="button" hidden>選択を破棄して編集し直す</button><button id="vpe-conflict-close" type="button">選択を保持して編集に戻る</button></div></section></div>`;
    const backdrop = document.createElement('div'); backdrop.id = 'visit-photo-editor-backdrop'; backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
    document.querySelector('main')!.append(backdrop, root); this.root = root; this.backdrop = backdrop;
    this.rightPanel = document.querySelector<HTMLElement>('#right-panel')!;
    this.mapPanel = document.querySelector<HTMLElement>('.map-panel')!;
    this.scroller = byId(root, 'vpe-scroll'); this.list = byId(root, 'vpe-list');
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const button = entry.target as HTMLElement, photo = this.draft?.byId.get(button.dataset.photoId ?? '');
        this.observer.unobserve(button);
        if (photo?.thumbnailId) this.pending.push({ button, photo, generation: this.generation });
      }
      this.loadPending();
    }, { root: this.scroller, rootMargin: '180px' });
    this.scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    new ResizeObserver(() => { if (this.isOpen) this.rebuildRows(false); }).observe(this.scroller);
    for (const id of ['vpe-search', 'vpe-from', 'vpe-to']) byId<HTMLInputElement>(root, id).addEventListener(id === 'vpe-search' ? 'input' : 'change', () => this.rebuildRows(true));
    byId(root, 'vpe-close').addEventListener('click', () => this.requestLeave(() => { this.close(); this.onClose(); }));
    byId(root, 'vpe-cancel').addEventListener('click', () => this.requestLeave(() => { this.close(); this.onClose(); }));
    byId(root, 'vpe-save').addEventListener('click', () => this.save());
    byId(root, 'vpe-preview-close').addEventListener('click', () => this.hidePreview());
    byId(root, 'vpe-preview-prev').addEventListener('click', () => this.movePreview(-1));
    byId(root, 'vpe-preview-next').addEventListener('click', () => this.movePreview(1));
    byId<HTMLInputElement>(root, 'vpe-preview-check').addEventListener('change', event => {
      if (this.previewId) this.choose(this.previewId, (event.target as HTMLInputElement).checked);
    });
    byId(root, 'vpe-leave-save').addEventListener('click', () => { this.hideShade('vpe-leave', false); this.save(); });
    byId(root, 'vpe-leave-discard').addEventListener('click', () => { const proceed = this.pendingLeave; this.pendingLeave = null; this.hideShade('vpe-leave', false); this.close(); proceed?.(); });
    byId(root, 'vpe-leave-stay').addEventListener('click', () => { this.pendingLeave = null; this.hideShade('vpe-leave'); });
    byId(root, 'vpe-review').addEventListener('click', () => { void this.reviewLatest(); });
    byId(root, 'vpe-state-review').addEventListener('click', () => { this.showShade('vpe-conflict', 'vpe-review'); void this.reviewLatest(); });
    byId(root, 'vpe-restart').addEventListener('click', () => { void this.restart(); });
    byId(root, 'vpe-conflict-close').addEventListener('click', () => { this.hideShade('vpe-conflict'); });
    window.addEventListener('beforeunload', event => { if (this.isOpen && this.isDirty) { event.preventDefault(); event.returnValue = ''; } });
    document.addEventListener('keydown', event => this.handleKeys(event), true);
  }

  get isOpen(): boolean { return !this.root.hidden; }
  get isDirty(): boolean { return Boolean(this.draft?.changes().length); }

  private showShade(id: string, focusId: string): void {
    this.shadeOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    byId(this.root, id).hidden = false;
    byId<HTMLElement>(this.root, focusId).focus();
  }

  private hideShade(id: string, restoreFocus = true): void {
    byId(this.root, id).hidden = true;
    if (restoreFocus) this.restoreFocus(this.shadeOpener);
    this.shadeOpener = null;
  }

  private restoreFocus(target: HTMLElement | null): void {
    if (target?.isConnected && !target.closest('[hidden], [inert]') && !(target instanceof HTMLButtonElement && target.disabled)) target.focus();
    else if (this.isOpen) byId<HTMLInputElement>(this.root, 'vpe-search').focus();
  }

  private activeShade(): HTMLElement | null {
    for (const id of ['vpe-conflict', 'vpe-leave', 'vpe-preview']) {
      const shade = byId(this.root, id); if (!shade.hidden) return shade;
    }
    return null;
  }

  private handleKeys(event: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (!byId(this.root, 'vpe-preview').hidden) this.hidePreview();
      else if (!byId(this.root, 'vpe-leave').hidden) { this.pendingLeave = null; this.hideShade('vpe-leave'); }
      else if (!byId(this.root, 'vpe-conflict').hidden) this.hideShade('vpe-conflict');
      else this.requestLeave(() => { this.close(); this.onClose(); });
      return;
    }
    if (event.key !== 'Tab') return;
    const scope = this.activeShade() ?? this.root;
    const focusables = [...scope.querySelectorAll<HTMLElement>('button, input, select, summary, [tabindex]')]
      .filter(item => !item.closest('[hidden], [inert]') && !('disabled' in item && item.disabled) && item.getClientRects().length > 0);
    if (!focusables.length) { event.preventDefault(); scope.focus(); return; }
    const first = focusables[0]!, last = focusables.at(-1)!;
    if (!scope.contains(document.activeElement) || event.shiftKey && document.activeElement === first) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  open(visit: Visit, trip: Trip, photos: Photo[], visits: Visit[], links: PhotoAlbumLink[], justCreated = false): void {
    this.draft = new VisitPhotoDraft(trip, visit, photos, visits, links);
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.previousRightInert = this.rightPanel.inert;
    this.previousMapInert = this.mapPanel.inert;
    this.rightPanel.inert = true;
    this.mapPanel.inert = true;
    this.backdrop.hidden = false;
    this.root.hidden = false; this.busy = false; this.conflictBlocked = false; this.pendingLeave = null; this.lastSavedOperationId = null;
    this.pendingUnknown = null;
    this.lastSavedPhotoIds = [];
    byId(this.root, 'vpe-title').textContent = visit.label;
    for (const id of ['vpe-search', 'vpe-from', 'vpe-to']) byId<HTMLInputElement>(this.root, id).value = '';
    for (const id of ['vpe-preview', 'vpe-leave', 'vpe-conflict']) byId(this.root, id).hidden = true;
    this.setStatus(justCreated ? 'アルバムは作成済みです。キャンセルすると写真の変更だけを破棄します。' : '変更は保存するまで反映されません。');
    this.rebuildRows(true); this.updateCounts();
    byId<HTMLInputElement>(this.root, 'vpe-search').focus();
  }

  close(): void {
    this.hidePreview(); this.clearVisible(); this.root.hidden = true; this.draft = null;
    this.rightPanel.inert = this.previousRightInert;
    this.mapPanel.inert = this.previousMapInert;
    this.backdrop.hidden = true;
    this.pendingLeave = null; this.lastSavedOperationId = null;
    this.pendingUnknown = null;
    this.lastSavedPhotoIds = [];
    this.restoreFocus(this.opener); this.opener = null;
  }

  requestLeave(proceed: () => void): void {
    if (!this.isOpen) { proceed(); return; }
    if (this.busy) { this.setStatus('保存処理中です。完了後に移動してください。'); return; }
    if (this.pendingUnknown) {
      this.showShade('vpe-conflict', 'vpe-review');
      this.setStatus('保存結果が不明です。最新状態を確認してから移動してください。'); return;
    }
    if (!this.isDirty) { this.close(); proceed(); return; }
    this.pendingLeave = proceed; this.hidePreview(); this.showShade('vpe-leave', 'vpe-leave-save');
  }

  private setStatus(text: string): void { byId(this.root, 'vpe-status').textContent = text; }

  private choose(id: string, include: boolean): void {
    if (!this.draft) return;
    if (this.busy) {
      for (const checkbox of this.root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
        if (checkbox.closest(`[data-tile-id="${id}"]`) || checkbox.id === 'vpe-preview-check' && this.previewId === id) {
          checkbox.checked = this.draft.selected(id);
        }
      }
      return;
    }
    this.draft.choose(id, include);
    for (const tile of this.list.querySelectorAll<HTMLElement>(`[data-tile-id="${id}"]`)) {
      tile.dataset.selected = String(include);
      const box = tile.querySelector<HTMLInputElement>('input[type="checkbox"]'); if (box) box.checked = include;
    }
    if (this.previewId === id) byId<HTMLInputElement>(this.root, 'vpe-preview-check').checked = include;
    this.updateCounts();
  }

  private updateCounts(): void {
    if (!this.draft) return;
    const counts = this.draft.counts();
    byId(this.root, 'vpe-counts').textContent = `選択 ${counts.selected}枚 · 追加 ${counts.added}枚 · 解除 ${counts.removed}枚`;
    byId<HTMLButtonElement>(this.root, 'vpe-save').disabled = this.busy || this.conflictBlocked || !this.isDirty;
    byId<HTMLButtonElement>(this.root, 'vpe-state-review').hidden = !this.conflictBlocked;
    for (const checkbox of this.root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) checkbox.disabled = this.busy;
  }

  private rebuildRows(resetScroll: boolean): void {
    const draft = this.draft; if (!draft) return;
    const style = getComputedStyle(this.scroller);
    const width = (this.scroller.clientWidth || 780) - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const columns = Math.max(2, Math.min(5, Math.floor((width + 8) / 170)));
    if (!resetScroll && columns === this.columns && Math.abs(width - this.lastWidth) < 2 && this.rows.length) return;
    this.columns = columns;
    this.lastWidth = width;
    const tile = (width - (columns - 1) * 8) / columns;
    const height = tile + 8;
    const filter = { ...emptyPhotoFilter(), filename: byId<HTMLInputElement>(this.root, 'vpe-search').value,
      fromDay: byId<HTMLInputElement>(this.root, 'vpe-from').value, toDay: byId<HTMLInputElement>(this.root, 'vpe-to').value };
    const candidates = filterPhotos(draft.photos, filter,
      draft.linkedPhotoIds());
    const sorted = (items: Photo[]) => items.sort((a, b) =>
      (b.timeCorrection?.correctedLocalClock ?? b.sourceTime.localClock ?? '').localeCompare(a.timeCorrection?.correctedLocalClock ?? a.sourceTime.localClock ?? '') || a.id.localeCompare(b.id));
    sorted(candidates);
    this.visibleIds = candidates.map(photo => photo.id);
    this.rows = [];
    for (let index = 0; index < candidates.length; index += columns)
      this.rows.push({ kind: 'photos', photos: candidates.slice(index, index + columns), height });
    this.offsets = [0]; for (const row of this.rows) this.offsets.push(this.offsets.at(-1)! + row.height);
    byId(this.root, 'vpe-filter-count').textContent = `表示 ${candidates.length}枚 / 全${draft.photos.length}枚`;
    if (resetScroll) this.scroller.scrollTop = 0;
    this.currentWindow = ''; this.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true; requestAnimationFrame(() => { this.scheduled = false; this.renderWindow(); });
  }

  private lowerBound(value: number): number {
    let low = 0, high = this.rows.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.offsets[middle + 1]! <= value) low = middle + 1; else high = middle; }
    return low;
  }

  private clearVisible(): void {
    ++this.generation; this.observer.disconnect(); this.pending = [];
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear(); this.list.replaceChildren();
  }

  private renderWindow(): void {
    if (!this.isOpen || !this.draft) return;
    const top = Math.max(0, this.scroller.scrollTop - 220);
    const bottom = this.scroller.scrollTop + this.scroller.clientHeight + 220;
    const start = this.lowerBound(top), end = Math.min(this.rows.length, this.lowerBound(bottom) + 1);
    const key = `${start}:${end}`; if (key === this.currentWindow) return;
    const focused = this.list.contains(document.activeElement) ? document.activeElement : null;
    const focusedPhotoId = focused instanceof HTMLElement ? focused.closest<HTMLElement>('.vpe-tile')?.dataset.tileId : null;
    const focusedCheckbox = focused instanceof HTMLInputElement && focused.type === 'checkbox';
    this.clearVisible(); this.currentWindow = key;
    const spacer = (height: number) => { const div = document.createElement('div'); div.className = 'vpe-spacer'; div.style.height = `${height}px`; div.setAttribute('aria-hidden', 'true'); return div; };
    this.list.append(spacer(this.offsets[start]!));
    for (let index = start; index < end; index++) {
      const row = this.rows[index]!;
      if (row.kind === 'heading') {
        const heading = document.createElement('h3'); heading.className = 'vpe-section-heading'; heading.textContent = `${row.title} ${row.count}枚`;
        heading.style.height = `${row.height}px`; this.list.append(heading); continue;
      }
      const line = document.createElement('div'); line.className = 'vpe-photo-row'; line.style.height = `${row.height}px`;
      line.style.gridTemplateColumns = `repeat(${this.columns}, minmax(0, 1fr))`;
      for (const photo of row.photos) {
        const tile = document.createElement('article'); tile.className = 'vpe-tile'; tile.dataset.tileId = photo.id;
        tile.dataset.selected = String(this.draft.selected(photo.id));
        const view = document.createElement('span'); view.className = 'vpe-photo-button';
        view.dataset.photoId = photo.id; view.setAttribute('aria-hidden', 'true');
        const placeholder = document.createElement('span'); placeholder.textContent = photo.thumbnailId ? '読み込み中' : '画像なし'; view.append(placeholder);
        const label = document.createElement('label'); label.className = 'vpe-selection';
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = this.draft.selected(photo.id);
        check.disabled = this.busy;
        check.setAttribute('aria-label', `${photo.originalFilename}をこのアルバムに所属させる`);
        check.addEventListener('change', () => this.choose(photo.id, check.checked));
        const indicator = document.createElement('span'); indicator.className = 'vpe-selection-mark'; indicator.setAttribute('aria-hidden', 'true');
        label.append(view, check, indicator);
        const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'vpe-preview-button';
        preview.setAttribute('aria-label', `${photo.originalFilename}をプレビュー`); preview.title = 'プレビュー';
        preview.textContent = '⤢';
        preview.addEventListener('click', () => this.showPreview(photo.id));
        tile.append(label, preview); line.append(tile);
        if (photo.thumbnailId) this.observer.observe(view);
      }
      this.list.append(line);
    }
    this.list.append(spacer(this.offsets.at(-1)! - this.offsets[end]!));
    if (focusedPhotoId) {
      const tile = [...this.list.querySelectorAll<HTMLElement>('.vpe-tile')].find(item => item.dataset.tileId === focusedPhotoId);
      tile?.querySelector<HTMLElement>(focusedCheckbox ? 'input[type="checkbox"]' : 'button')?.focus({ preventScroll: true });
    }
  }

  private loadPending(): void {
    while (this.loading < 4 && this.pending.length) {
      const task = this.pending.shift()!; if (!task.button.isConnected || !task.photo.thumbnailId) continue;
      this.loading++;
      void this.db.getThumbnail(task.photo.thumbnailId).then(found => {
        if (!found || task.generation !== this.generation || !task.button.isConnected || task.button.dataset.photoId !== task.photo.id) {
          if (task.button.isConnected && task.generation === this.generation) task.button.textContent = '画像なし';
          return;
        }
        const url = URL.createObjectURL(found.blob), image = document.createElement('img'); image.alt = ''; image.src = url;
        this.urls.set(task.button, url); task.button.replaceChildren(image);
      }).catch(() => { if (task.button.isConnected && task.generation === this.generation) task.button.textContent = '画像なし'; })
        .finally(() => { this.loading--; this.loadPending(); });
    }
  }

  private hidePreview(restoreFocus = true): void {
    const wasOpen = !byId(this.root, 'vpe-preview').hidden;
    ++this.previewGeneration; this.previewId = null;
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null; byId(this.root, 'vpe-preview').hidden = true;
    if (wasOpen && restoreFocus) this.restoreFocus(this.previewOpener);
    if (wasOpen) this.previewOpener = null;
  }

  private showPreview(id: string): void {
    const photo = this.draft?.byId.get(id); if (!photo || !this.draft) return;
    const opener = this.previewOpener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.hidePreview(false); this.previewOpener = opener; this.previewId = id; byId(this.root, 'vpe-preview').hidden = false;
    const index = this.visibleIds.indexOf(id);
    byId(this.root, 'vpe-preview-name').textContent = photo.originalFilename;
    byId(this.root, 'vpe-preview-source').textContent = `現在の所属: ${this.draft.sourceName(photo)}`;
    byId<HTMLInputElement>(this.root, 'vpe-preview-check').checked = this.draft.selected(id);
    byId<HTMLInputElement>(this.root, 'vpe-preview-check').setAttribute('aria-label', `${photo.originalFilename}をこのアルバムに所属させる`);
    byId<HTMLButtonElement>(this.root, 'vpe-preview-prev').disabled = index <= 0;
    byId<HTMLButtonElement>(this.root, 'vpe-preview-next').disabled = index < 0 || index >= this.visibleIds.length - 1;
    const imageBox = byId(this.root, 'vpe-preview-image'); imageBox.textContent = photo.thumbnailId ? '読み込み中' : '画像なし';
    const generation = this.previewGeneration;
    if (photo.thumbnailId) void this.db.getThumbnail(photo.thumbnailId).then((found: Thumbnail | undefined) => {
      if (generation !== this.previewGeneration || !found || this.previewId !== id) {
        if (generation === this.previewGeneration && this.previewId === id) imageBox.textContent = '画像なし'; return;
      }
      const url = URL.createObjectURL(found.blob); this.previewUrl = url;
      const image = document.createElement('img'); image.alt = '保存済みサムネイル'; image.src = url; imageBox.replaceChildren(image);
    }).catch(() => { if (generation === this.previewGeneration) imageBox.textContent = '画像なし'; });
    byId<HTMLButtonElement>(this.root, 'vpe-preview-close').focus();
  }

  private movePreview(direction: number): void {
    const index = this.visibleIds.indexOf(this.previewId ?? '');
    const next = this.visibleIds[index + direction]; if (next) this.showPreview(next);
  }

  private save(): void {
    if (!this.draft || this.busy || this.conflictBlocked || !this.isDirty) return;
    void this.performSave();
  }

  private async performSave(): Promise<void> {
    const draft = this.draft; if (!draft || this.busy || this.conflictBlocked || !this.isDirty) return;
    const operationId = crypto.randomUUID(), counts = draft.counts();
    this.busy = true; this.updateCounts(); this.setStatus('一括変更を保存しています。');
    const changes = draft.changes();
    let result: AlbumMembershipBatchResult | null = null;
    try {
      const request = draft.request(operationId);
      result = await this.db.saveAlbumMembershipBatch(request);
    } catch (error) {
      if (error instanceof AlbumMembershipConflict) this.showConflict(error, 'not-applied');
      else {
        try {
          const status = await this.db.albumMembershipOperationStatus(operationId);
          if (status === 'applied') {
            result = { status: 'saved', operationId, changedPhotos: changes.length,
              added: counts.added, removed: counts.removed };
          } else if (status === 'absent') {
            this.setStatus(`保存されていません。選択は保持しました。原因: ${errorText(error)}`);
            this.pendingLeave = null;
          } else if (status === 'unknown') {
            this.pendingUnknown = { operationId, counts };
            this.showConflict(new AlbumMembershipConflict(null, 'status-unknown'), 'unknown');
          } else this.showConflict(new AlbumMembershipConflict(null, status), 'applied');
        } catch {
          this.pendingUnknown = { operationId, counts };
          this.showConflict(new AlbumMembershipConflict(null, 'status-unknown'), 'unknown');
        }
      }
    }
    if (result) await this.saved(operationId, result, counts, changes.map(change => change.beforePhoto.id));
    this.busy = false; this.updateCounts();
  }

  private async saved(operationId: string, result: AlbumMembershipBatchResult, counts: ReturnType<VisitPhotoDraft['counts']>, ids: string[]): Promise<void> {
    this.lastSavedOperationId = result.status !== 'no-change' ? operationId : null;
    this.lastSavedPhotoIds = result.status !== 'no-change' ? ids : [];
    this.pendingUnknown = null;
    try {
      await this.afterMutation();
      const [trip, visits, photos, links] = await Promise.all([
        this.db.getTrip(this.draft!.trip.id), this.db.listVisits(), this.db.listPhotos(), this.db.listPhotoAlbumLinks(),
      ]);
      const target = visits.find(visit => visit.id === this.draft!.target.id);
      if (!trip || !target) throw new Error('保存後の旅行またはアルバムを確認できません');
      this.draft = new VisitPhotoDraft(trip, target, photos, visits, links);
      this.conflictBlocked = false; this.rebuildRows(true);
      this.setStatus(`${counts.added}枚追加、${counts.removed}枚解除しました。`);
      if (this.lastSavedOperationId) this.onSaved(operationId);
      const proceed = this.pendingLeave; this.pendingLeave = null;
      if (proceed) { this.close(); proceed(); }
    } catch (error) {
      this.conflictBlocked = true; this.pendingLeave = null;
      this.setStatus(`一括保存は確定しましたが、画面の更新を確認できません: ${errorText(error)}。再送せず最新状態を確認してください。`);
    }
  }

  private showConflict(error: AlbumMembershipConflict, state: 'not-applied' | 'applied' | 'unknown'): void {
    this.conflictBlocked = true; this.pendingLeave = null;
    this.conflictPhotoId = error.photoId;
    byId(this.root, 'vpe-conflict').querySelector('h3')!.textContent = conflictHeading(error.reason);
    const photo = error.photoId ? this.draft?.byId.get(error.photoId) : null;
    const outcome = state === 'not-applied' ? '一括変更は未保存です。' : state === 'applied'
      ? '後の変更は上書きしません。' : '保存結果が不明です。再送しません。';
    byId(this.root, 'vpe-conflict-reason').textContent = `${photo ? `「${photo.originalFilename}」: ` : ''}${conflictText(error.reason)} ${outcome}${this.isDirty ? '未保存の選択は保持しています。' : ''}`;
    byId(this.root, 'vpe-conflict-latest').textContent = '最新状態を確認し、必要なら選択を破棄して編集し直してください。';
    byId<HTMLButtonElement>(this.root, 'vpe-restart').hidden = true;
    this.showShade('vpe-conflict', 'vpe-review');
    this.setStatus(state === 'not-applied' ? '競合により保存を中止しました。選択は保持しています。'
      : state === 'applied' ? '保存履歴を確認しました。後続の変更を上書きしません。' : '保存結果を確認できません。再送せず最新状態を確認してください。');
    if (state !== 'unknown') void this.reviewLatest();
  }

  private async reviewLatest(): Promise<void> {
    const draft = this.draft; if (!draft) return;
    try {
      if (this.pendingUnknown) {
        const { operationId, counts } = this.pendingUnknown;
        const status = await this.db.albumMembershipOperationStatus(operationId);
        if (status === 'applied') {
          this.hideShade('vpe-conflict', false);
          await this.saved(operationId, { status: 'saved', operationId, changedPhotos: counts.added + counts.removed,
            added: counts.added, removed: counts.removed }, counts,
            draft.changes().map(change => change.beforePhoto.id));
          this.updateCounts(); return;
        }
        if (status === 'absent') {
          this.pendingUnknown = null; this.conflictBlocked = false;
          this.updateCounts(); this.hideShade('vpe-conflict');
          this.setStatus('保存されていないことを確認しました。選択を保持しているので、必要なら再度保存できます。'); return;
        }
        if (status === 'unknown') {
          byId(this.root, 'vpe-conflict-latest').textContent = '保存結果を確認できません。再送せず、しばらくしてからもう一度確認してください。';
          return;
        }
        this.pendingUnknown = null;
        this.showConflict(new AlbumMembershipConflict(null, status), 'applied');
      }
      const [photos, visits, links] = await Promise.all([this.db.listPhotos(), this.db.listVisits(), this.db.listPhotoAlbumLinks()]);
      const latest = new Map(photos.map(photo => [photo.id, photo]));
      const visitById = new Map(visits.map(visit => [visit.id, visit]));
      const linksByPhoto = new Map<string, string[]>();
      for (const link of links) {
        const names = linksByPhoto.get(link.photoId) ?? [];
        const album = visitById.get(link.albumId);
        names.push(album ? `${album.label}${album.deletedAt ? '（ごみ箱）' : ''}` : '確認できないアルバム');
        linksByPhoto.set(link.photoId, names);
      }
      const reviewIds = [...new Set([...(this.conflictPhotoId ? [this.conflictPhotoId] : []), ...draft.changes().map(change => change.beforePhoto.id), ...this.lastSavedPhotoIds])];
      const lines = reviewIds.map(id => {
        const photo = latest.get(id);
        const names = linksByPhoto.get(id) ?? [];
        return `${draft.byId.get(id)?.originalFilename ?? id}: ${!photo ? '写真が見つかりません' : photo.deletedAt ? '写真はごみ箱にあります' : names.length ? names.join('、') : '所属なし'}`;
      });
      const box = byId(this.root, 'vpe-conflict-latest'); box.replaceChildren();
      const intro = document.createElement('p'); intro.textContent = '現在の所属'; box.append(intro);
      const list = document.createElement('ul'); for (const line of lines.slice(0, 20)) { const item = document.createElement('li'); item.textContent = line; list.append(item); }
      if (lines.length > 20) { const item = document.createElement('li'); item.textContent = `ほか${lines.length - 20}枚`; list.append(item); }
      box.append(list); byId<HTMLButtonElement>(this.root, 'vpe-restart').hidden = Boolean(this.pendingUnknown);
    } catch (error) { byId(this.root, 'vpe-conflict-latest').textContent = `最新状態を読めません: ${errorText(error)}`; }
  }

  private async restart(): Promise<void> {
    const draft = this.draft; if (!draft) return;
    try {
      const [trip, photos, visits, links] = await Promise.all([this.db.getTrip(draft.trip.id), this.db.listPhotos(), this.db.listVisits(), this.db.listPhotoAlbumLinks()]);
      const target = visits.find(visit => visit.id === draft.target.id && !visit.deletedAt);
      if (!trip || trip.deletedAt || !target) throw new Error('旅行またはアルバムを編集できません');
      this.draft = new VisitPhotoDraft(trip, target, photos, visits, links);
      this.conflictBlocked = false; this.pendingLeave = null; this.lastSavedOperationId = null; this.pendingUnknown = null; this.lastSavedPhotoIds = [];
      this.hideShade('vpe-conflict', false); this.rebuildRows(true); this.updateCounts();
      this.setStatus('最新状態から編集をやり直します。以前の選択は破棄しました。');
      byId<HTMLInputElement>(this.root, 'vpe-search').focus();
    } catch (error) { byId(this.root, 'vpe-conflict-latest').textContent = `編集をやり直せません: ${errorText(error)}`; }
  }

}
