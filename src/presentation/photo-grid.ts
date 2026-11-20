import type { Photo, Thumbnail } from '../domain/model';
import { displayCalendarDay } from './date-display';

type Row = { kind: 'date'; label: string; count: number; height: number } | { kind: 'photos'; photos: Photo[]; height: number };

/** A local calendar day, with no assumed UTC offset or import-time fallback. */
export function photoDay(photo: Photo): string | null {
  const clock = photo.timeCorrection?.correctedLocalClock ?? photo.sourceTime.localClock;
  const match = /^(\d{4}):(\d{2}):(\d{2}) /.exec(clock ?? '');
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const dayLabel = (key: string) => key === 'unknown' ? '撮影日時不明' : displayCalendarDay(key);

export class PhotoGrid {
  private photos: Photo[] = [];
  private photoById = new Map<string, Photo>();
  private tripKey = '';
  private signature = '';
  private rows: Row[] = [];
  private offsets: number[] = [0];
  private columns = 2;
  private start = -1;
  private end = -1;
  private selectedId: string | null = null;
  private scheduled = false;
  private observer: IntersectionObserver;
  private urls = new Map<HTMLButtonElement, string>();
  private pending: { button: HTMLButtonElement; photo: Photo }[] = [];
  private loading = 0;
  private emptyMessage = 'この旅行に写真はありません';

  constructor(
    private readonly list: HTMLUListElement,
    private readonly scroller: HTMLElement,
    private readonly thumbnail: (id: string) => Promise<Thumbnail | undefined>,
    private readonly onSelect: (id: string) => void,
  ) {
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const button = entry.target as HTMLButtonElement;
        this.observer.unobserve(button);
        const photo = this.photoById.get(button.dataset.photoId ?? '');
        if (photo?.thumbnailId) this.pending.push({ button, photo });
      }
      this.loadPending();
    }, { root: scroller, rootMargin: '160px' });
    scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    new ResizeObserver(() => { this.rebuildRows(); this.schedule(); }).observe(list);
  }

  setPhotos(photos: Photo[], tripKey: string, emptyMessage = 'この旅行に写真はありません'): void {
    const signature = emptyMessage + photos.map(photo => `${photo.id}:${photo.thumbnailId ?? ''}:${photo.sourceTime.localClock ?? ''}:${photo.timeCorrection?.correctedLocalClock ?? ''}:${photo.originalFilename}`).join('|');
    if (this.tripKey === tripKey && this.signature === signature) { this.schedule(); return; }
    if (this.tripKey !== tripKey) this.scroller.scrollTop = 0;
    this.tripKey = tripKey;
    this.signature = signature;
    this.emptyMessage = emptyMessage;
    this.photos = photos;
    this.photoById = new Map(photos.map(photo => [photo.id, photo]));
    this.rebuildRows();
    this.start = -1;
    this.schedule();
  }

  select(id: string | null): void {
    this.selectedId = id;
    for (const button of this.list.querySelectorAll<HTMLButtonElement>('button[data-photo-id]')) {
      button.setAttribute('aria-pressed', String(button.dataset.photoId === id));
    }
  }

  private rebuildRows(): void {
    const width = this.list.clientWidth || Math.max(240, this.scroller.clientWidth - 32);
    const columns = Math.max(2, Math.min(3, Math.floor((width + 8) / 112)));
    this.columns = columns;
    const tile = (width - (columns - 1) * 8) / columns;
    const groups = new Map<string, Photo[]>();
    for (const photo of this.photos) {
      const key = photoDay(photo) ?? 'unknown';
      const group = groups.get(key) ?? [];
      group.push(photo);
      groups.set(key, group);
    }
    this.rows = [];
    const dates = [...groups.keys()].sort((a, b) => a === 'unknown' ? 1 : b === 'unknown' ? -1 : b.localeCompare(a));
    for (const date of dates) {
      this.rows.push({ kind: 'date', label: dayLabel(date), count: groups.get(date)!.length, height: 40 });
      const group = groups.get(date)!.sort((a, b) => (b.timeCorrection?.correctedLocalClock ?? b.sourceTime.localClock ?? '').localeCompare(a.timeCorrection?.correctedLocalClock ?? a.sourceTime.localClock ?? '') || a.id.localeCompare(b.id));
      for (let index = 0; index < group.length; index += columns) this.rows.push({ kind: 'photos', photos: group.slice(index, index + columns), height: tile + 8 });
    }
    this.offsets = [0];
    for (const row of this.rows) this.offsets.push(this.offsets.at(-1)! + row.height);
    this.start = -1;
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; this.renderWindow(); });
  }

  private lowerBound(value: number): number {
    let low = 0, high = this.rows.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.offsets[middle + 1]! <= value) low = middle + 1; else high = middle; }
    return low;
  }

  private clearVisible(): void {
    this.observer.disconnect();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.pending = [];
    this.list.replaceChildren();
  }

  private renderWindow(): void {
    if (!this.photos.length) {
      if (this.start === 0 && this.end === 0) return;
      this.clearVisible();
      const item = document.createElement('li'); item.className = 'photo-grid-empty'; item.textContent = this.emptyMessage;
      this.list.append(item); this.start = this.end = 0; return;
    }
    const listTop = this.list.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
    const top = Math.max(0, this.scroller.scrollTop - listTop - 240);
    const bottom = Math.max(0, this.scroller.scrollTop - listTop + this.scroller.clientHeight + 240);
    const start = this.lowerBound(top), end = Math.min(this.rows.length, this.lowerBound(bottom) + 1);
    if (start === this.start && end === this.end) return;
    this.clearVisible(); this.start = start; this.end = end;
    const spacer = (height: number) => { const item = document.createElement('li'); item.className = 'photo-grid-spacer'; item.style.height = `${height}px`; item.setAttribute('aria-hidden', 'true'); return item; };
    this.list.append(spacer(this.offsets[start]!));
    for (let index = start; index < end; index++) {
      const row = this.rows[index]!;
      const item = document.createElement('li'); item.style.height = `${row.height}px`;
      if (row.kind === 'date') {
        item.className = 'photo-grid-date';
        const heading = document.createElement('h3'); heading.textContent = row.label;
        const count = document.createElement('span'); count.className = 'photo-grid-count'; count.textContent = `${row.count}枚`;
        item.append(heading, count);
      } else {
        item.className = 'photo-grid-row';
        item.style.gridTemplateColumns = `repeat(${this.columns}, minmax(0, 1fr))`;
        for (const photo of row.photos) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'photo-tile';
          button.dataset.photoId = photo.id; button.setAttribute('aria-label', photo.originalFilename);
          button.setAttribute('aria-pressed', String(photo.id === this.selectedId));
          const placeholder = document.createElement('span'); placeholder.className = 'photo-tile-placeholder';
          placeholder.textContent = photo.thumbnailId ? '読み込み中' : '画像なし'; button.append(placeholder);
          button.addEventListener('click', () => this.onSelect(photo.id));
          item.append(button);
          if (photo.thumbnailId) this.observer.observe(button);
        }
      }
      this.list.append(item);
    }
    this.list.append(spacer(this.offsets.at(-1)! - this.offsets[end]!));
  }

  private loadPending(): void {
    while (this.loading < 4 && this.pending.length) {
      const { button, photo } = this.pending.shift()!;
      if (!button.isConnected || !photo.thumbnailId) continue;
      this.loading++;
      void this.thumbnail(photo.thumbnailId).then(found => {
        if (!found || !button.isConnected || button.dataset.photoId !== photo.id) {
          if (button.isConnected) button.querySelector('.photo-tile-placeholder')!.textContent = '画像なし';
          return;
        }
        const image = document.createElement('img'); image.alt = ''; image.decoding = 'async';
        const url = URL.createObjectURL(found.blob); image.src = url;
        this.urls.set(button, url); button.replaceChildren(image);
      }).catch(() => {
        if (button.isConnected) button.querySelector('.photo-tile-placeholder')!.textContent = '画像なし';
      }).finally(() => { this.loading--; this.loadPending(); });
    }
  }
}
