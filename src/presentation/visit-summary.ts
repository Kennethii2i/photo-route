import type { Photo, Thumbnail, Visit } from '../domain/model';
import { linkedPhotoDateRange } from './visit-view';
import { albumIcon } from './album-icons';

export class VisitSummary {
  private generation = 0;
  private signature = '';
  private urls: string[] = [];

  constructor(private readonly container: HTMLElement,
    private readonly thumbnail: (id: string) => Promise<Thumbnail | undefined>,
    private readonly onPhoto: (id: string) => void,
    private readonly onAll: () => void,
    private readonly onMap: () => void,
    private readonly onEdit: () => void, private readonly onSelectPhotos?: () => void, private readonly onDelete?: () => void) {}

  clear(): void {
    ++this.generation;
    this.signature = '';
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
    this.container.replaceChildren();
  }

  render(visit: Visit, linked: Photo[], compact = false): void {
    const signature = `${visit.id}:${visit.updatedAt}:${linked.map(photo => `${photo.id}:${photo.thumbnailId ?? ''}:${photo.updatedAt}`).join('|')}`;
    if (signature === this.signature) return;
    this.clear(); this.signature = signature;
    const generation = this.generation;
    const photoButton = (photo: Photo) => {
      const button = document.createElement(compact ? 'span' : 'button');
      if (button instanceof HTMLButtonElement) button.type = 'button';
      button.setAttribute('aria-label', compact ? photo.originalFilename : `${photo.originalFilename} のプレビュー`);
      const placeholder = document.createElement('span'); placeholder.textContent = photo.thumbnailId ? '読み込み中' : '画像なし'; button.append(placeholder);
      if (!compact) button.addEventListener('click', () => this.onPhoto(photo.id));
      if (photo.thumbnailId) void this.thumbnail(photo.thumbnailId).then(found => {
        if (!found || generation !== this.generation || !button.isConnected) {
          if (generation === this.generation && button.isConnected) placeholder.textContent = '画像なし';
          return;
        }
        const url = URL.createObjectURL(found.blob); this.urls.push(url);
        const image = document.createElement('img'); image.alt = ''; image.src = url; button.replaceChildren(image);
      }).catch(() => { if (generation === this.generation && button.isConnected) placeholder.textContent = '画像なし'; });
      return button;
    };
    if (compact) {
      const strip = document.createElement('div'); strip.className = 'visit-editor-photos';
      for (const photo of linked.slice(0, 3)) strip.append(photoButton(photo));
      const count = document.createElement('p'); count.className = 'visit-editor-count';
      const range = linkedPhotoDateRange(linked);
      count.textContent = linked.length ? `写真 ${linked.length}枚${range ? ` · ${range}` : ''}` : '写真を選んでアルバムを作りましょう';
      this.container.append(strip, count); return;
    }
    const hero = document.createElement('div'); hero.className = 'visit-summary-hero';
    const featured = linked.find(photo => photo.thumbnailId) ?? linked[0];
    if (featured) {
      const cover = photoButton(featured); cover.className = 'visit-summary-cover'; hero.append(cover);
    }
    const intro = document.createElement('div'); intro.className = 'visit-summary-intro';
    const title = document.createElement('h3'); title.textContent = visit.label;
    const count = document.createElement('p'); count.className = 'visit-summary-count'; count.textContent = `写真 ${linked.length}枚`;
    const range = linkedPhotoDateRange(linked);
    intro.append(title, count);
    if (linked.length) { const captured = document.createElement('p'); captured.className = 'visit-summary-captured'; captured.textContent = range ? `撮影 ${range}` : '撮影日不明'; intro.append(captured); }
    hero.append(intro); this.container.append(hero);
    if (linked.length > 1) {
      const strip = document.createElement('div'); strip.className = 'visit-summary-photos';
      strip.setAttribute('aria-label', 'アルバムの写真');
      for (const photo of linked.filter(photo => photo.id !== featured?.id).slice(0, 2)) strip.append(photoButton(photo));
      this.container.append(strip);
    }
    const actions = document.createElement('div'); actions.className = 'visit-summary-actions';
    if (this.onSelectPhotos) {
      const select = document.createElement('button'); select.type = 'button'; select.className = 'album-select-photos'; select.textContent = '写真を選択';
      select.addEventListener('click', this.onSelectPhotos); actions.append(select);
    }
    for (const [label, callback, icon] of [['写真を見る', this.onAll, 'photos'], ['地図で見る', this.onMap, 'map'], ['編集', this.onEdit, 'edit']] as const) {
      const button = document.createElement('button'); button.type = 'button'; albumIcon(button, icon, label);
      button.addEventListener('click', callback); actions.append(button);
    }
    if (this.onDelete) {
      const remove = document.createElement('button'); remove.type = 'button';
      albumIcon(remove, 'trash', 'アルバムをごみ箱へ移動'); remove.classList.add('album-trash');
      remove.addEventListener('click', this.onDelete); actions.append(remove);
    }
    this.container.append(actions);
  }
}
