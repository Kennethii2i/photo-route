import { basemaps, type BasemapId } from '../infrastructure/basemap';
import type { BasemapState } from './map';

export function createBasemapControl(container: HTMLElement, choose: (id: BasemapId) => void, beforeOpen: () => void = () => {}) {
  const dock = document.createElement('div'); dock.id = 'basemap-control';
  const toggle = document.createElement('button'); toggle.id = 'basemap-open'; toggle.type = 'button';
  toggle.textContent = 'レイヤー'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'basemap-panel');
  const panel = document.createElement('section'); panel.id = 'basemap-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'basemap-heading');
  const heading = document.createElement('strong'); heading.id = 'basemap-heading'; heading.textContent = '地図の種類';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
  close.setAttribute('aria-label', 'レイヤーを閉じる'); close.title = 'レイヤーを閉じる';
  const top = document.createElement('div'); top.className = 'basemap-heading'; top.append(heading, close);
  const choices = document.createElement('fieldset'); choices.className = 'basemap-choices';
  const legend = document.createElement('legend'); legend.className = 'sr-only'; legend.textContent = '背景地図'; choices.append(legend);
  for (const item of basemaps) {
    const label = document.createElement('label'); label.className = `basemap-card basemap-${item.id}`;
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'basemap'; input.value = item.id;
    input.setAttribute('aria-label', item.label); input.checked = item.id === 'standard';
    const name = document.createElement('strong'); name.textContent = item.label;
    const description = document.createElement('span'); description.textContent = item.description;
    description.id = `basemap-description-${item.id}`; input.setAttribute('aria-describedby', description.id);
    input.addEventListener('change', () => { if (input.checked) choose(item.id); });
    label.append(input, name, description); choices.append(label);
  }
  const note = document.createElement('p'); note.className = 'basemap-note';
  note.textContent = 'すべて無料・APIキー不要。標準・淡色はOpenFreeMap、衛星写真はEOX、地形はMapterhornへ通信します。選んだ地図の閲覧地域やIPアドレス等が配信元へ伝わり得ます。写真・Exifは送信しません。';
  const status = document.createElement('p'); status.id = 'basemap-load-status'; status.setAttribute('role', 'status');
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '再試行'; retry.hidden = true;
  let selected: BasemapId = 'standard'; retry.addEventListener('click', () => choose(selected));
  const credits = document.createElement('details'); credits.className = 'basemap-credits';
  const creditHeading = document.createElement('summary'); creditHeading.textContent = '地図の出典';
  const creditText = document.createElement('div'); credits.append(creditHeading, creditText);
  // Keep the renderer's actual credits accessible when the selector covers compact map attribution.
  const attribution = container.querySelector('.maplibregl-ctrl-attrib-inner');
  if (attribution) {
    const mirror = () => creditText.replaceChildren(...[...attribution.childNodes].map(node => node.cloneNode(true)));
    mirror(); new MutationObserver(mirror).observe(attribution, { childList: true, subtree: true });
  }
  // The selector must be above the mobile photo preview, whose panel has its own stacking context.
  panel.append(top, choices, note, status, retry, credits); dock.append(toggle); container.append(dock); document.body.append(panel);
  const position = () => {
    if (panel.hidden) return;
    const mobile = matchMedia('(max-width: 700px)').matches, anchor = toggle.getBoundingClientRect();
    const right = document.body.dataset.rightOpen === 'true' && !mobile
      ? document.getElementById('right-panel')!.getBoundingClientRect().left - 16 : innerWidth - 16;
    panel.style.left = mobile ? '10px' : `${anchor.left + 40}px`;
    panel.style.top = mobile ? '68px' : 'auto';
    panel.style.bottom = mobile ? 'auto' : `${innerHeight - anchor.top + 8}px`;
    panel.style.maxWidth = mobile ? 'calc(100vw - 20px)' : `${Math.max(0, right - anchor.left - 40)}px`;
    panel.style.maxHeight = mobile ? 'calc(100dvh - 154px - env(safe-area-inset-bottom))' : `${Math.max(120, anchor.top - 80)}px`;
  };
  const dismiss = (restoreFocus = true) => {
    if (panel.hidden) return false;
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus({ preventScroll: true });
    return true;
  };
  toggle.addEventListener('click', () => {
    if (dismiss()) return;
    beforeOpen();
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    position();
    const selected = panel.querySelector<HTMLInputElement>('input:checked');
    selected?.focus({ preventScroll: true }); selected?.closest('label')?.scrollIntoView({ block: 'nearest' });
  });
  close.addEventListener('click', () => dismiss());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) {
      event.preventDefault(); event.stopImmediatePropagation(); dismiss();
    }
  }, { capture: true });
  document.addEventListener('click', event => {
    const target = event.target;
    // Canvas blank clicks are dismissed through the map's one-layer background handler.
    if (target instanceof Element && !dock.contains(target) && !panel.contains(target) && !target.matches('.maplibregl-canvas')) dismiss(false);
  });
  window.addEventListener('resize', position);
  return {
    dismiss,
    update: (state: BasemapState) => {
      selected = state.id; dock.dataset.basemap = selected; dock.dataset.state = state.state;
      for (const input of choices.querySelectorAll<HTMLInputElement>('input')) input.checked = input.value === selected;
      status.textContent = state.message; retry.hidden = state.state !== 'error';
      toggle.title = `レイヤー：${basemaps.find(item => item.id === selected)!.label}`;
      toggle.setAttribute('aria-label', toggle.title);
    },
  };
}
