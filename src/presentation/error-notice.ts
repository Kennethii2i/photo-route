export type ErrorGuide = { title: string; detail: string; action?: { label: string; run: () => void; allowed?: () => boolean }; dismissible?: boolean };

/** Reports quota errors in the UI without retrying a mutation. */
export function storageErrorText(error: unknown): string {
  let cause = error;
  for (let depth = 0; cause && depth < 4; depth++) {
    if (cause instanceof Error && cause.name === 'QuotaExceededError') {
      window.dispatchEvent(new CustomEvent('photo-route-quota-error', { detail: error })); break;
    }
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return error instanceof Error ? error.message : String(error);
}

export class ErrorNotice {
  private readonly root = document.createElement('section');
  private readonly title = document.createElement('p');
  private readonly details = document.createElement('details');
  private readonly detail = document.createElement('p');
  private readonly action = document.createElement('button');
  private readonly close = document.createElement('button');
  private db: { kind: string; guide: ErrorGuide } | null = null;
  private map: ErrorGuide | null = null;

  constructor() {
    this.root.id = 'app-error'; this.root.hidden = true; this.root.setAttribute('aria-label', '利用上の問題');
    this.title.id = 'app-error-title'; this.title.setAttribute('role', 'alert');
    const summary = document.createElement('summary'); summary.textContent = '詳細';
    this.details.append(summary, this.detail); this.action.type = 'button'; this.action.id = 'app-error-action';
    this.close.type = 'button'; this.close.textContent = '×'; this.close.setAttribute('aria-label', 'エラー案内を閉じる');
    this.close.addEventListener('click', () => { if (this.db) this.db = null; else this.map = null; this.render(); });
    this.action.addEventListener('click', () => {
      const guide = this.db?.guide ?? this.map;
      if (guide?.action?.allowed && !guide.action.allowed()) {
        this.detail.textContent = `編集中の内容・保存状態を先に確認してください。 ${guide.detail}`; this.details.open = true; return;
      }
      guide?.action?.run();
    });
    this.root.append(this.title, this.action, this.close, this.details); document.body.append(this.root);
    new ResizeObserver(() => this.measure()).observe(this.root);
    new MutationObserver(() => this.place()).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
    window.addEventListener('photo-route-quota-error', event => this.showDb('quota', {
      title: '端末の保存領域が不足しています',
      detail: `空き容量を確保し、画面で操作結果を確認してください。保存は自動再送しません。 ${String((event as CustomEvent<unknown>).detail)}`,
      dismissible: true,
    }));
  }

  showDb(kind: string, guide: ErrorGuide): void {
    if (this.db && ['open', 'blocked', 'closed'].includes(this.db.kind) && this.db.kind !== kind) return;
    this.db = { kind, guide }; this.render();
  }
  clearDb(kind: string): void { if (this.db?.kind === kind) { this.db = null; this.render(); } }
  showMap(guide: ErrorGuide | null): void { this.map = guide; this.render(); }

  private render(): void {
    const guide = this.db?.guide ?? this.map;
    document.body.dataset.dbError = String(Boolean(this.db));
    this.root.dataset.kind = this.db ? 'data' : 'map'; this.root.hidden = !guide;
    if (!guide) { this.title.textContent = ''; this.measure(); return; }
    if (this.title.textContent !== guide.title) { this.title.textContent = guide.title; this.details.open = false; }
    this.detail.textContent = guide.detail; this.action.hidden = !guide.action;
    this.action.textContent = guide.action?.label ?? ''; this.close.hidden = !guide.dismissible; this.place();
  }
  private place(): void {
    const modal = document.querySelector<HTMLElement>('dialog[open], #visit-photo-editor-overlay:not([hidden])');
    const host = modal ?? document.body;
    if (this.root.parentElement !== host) {
      const heading = modal?.querySelector(':scope > header, :scope > .panel-top, :scope > .vpe-top');
      if (heading) heading.after(this.root); else host.append(this.root);
    }
    this.root.classList.toggle('app-error-inline', Boolean(modal)); this.measure();
  }
  private measure(): void {
    const height = this.root.hidden || this.root.parentElement !== document.body ? 0 : this.root.getBoundingClientRect().height;
    document.body.style.setProperty('--app-error-height', `${Math.ceil(height)}px`);
    document.body.dataset.appError = String(height > 0);
  }
}
