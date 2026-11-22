import { basemaps, type BasemapId } from '../infrastructure/basemap';
import type { BasemapState } from './map';

export function createBasemapControl(container: HTMLElement, choose: (id: BasemapId) => void, beforeOpen: () => void = () => {}) {
  const dock = document.createElement('div'); dock.id = 'basemap-control';
  const toggle = document.createElement('button'); toggle.id = 'basemap-open'; toggle.type = 'button';
  const togglePreview = document.createElement('span'); togglePreview.className = 'basemap-preview basemap-standard'; togglePreview.setAttribute('aria-hidden', 'true');
  const toggleLabel = document.createElement('span'); toggleLabel.textContent = 'レイヤー'; toggle.append(togglePreview, toggleLabel); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'basemap-panel');
  const panel = document.createElement('section'); panel.id = 'basemap-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'basemap-heading');
  const heading = document.createElement('strong'); heading.id = 'basemap-heading'; heading.textContent = '地図の種類'; heading.className = 'sr-only';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
  close.setAttribute('aria-label', 'レイヤーを閉じる'); close.title = 'レイヤーを閉じる';
  const top = document.createElement('div'); top.className = 'basemap-heading'; top.append(heading, close);
  const choices = document.createElement('fieldset'); choices.className = 'basemap-choices';
  const legend = document.createElement('legend'); legend.className = 'sr-only'; legend.textContent = '背景地図'; choices.append(legend);
  for (const item of basemaps) {
    const label = document.createElement('label'); label.className = 'basemap-card';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'basemap'; input.value = item.id;
    input.setAttribute('aria-label', item.label); input.checked = item.id === 'standard';
    const preview = document.createElement('span'); preview.className = `basemap-preview basemap-${item.id}`; preview.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span'); name.className = 'basemap-name'; name.textContent = item.id === 'satellite' ? '衛星写真' : item.label;
    const description = document.createElement('span'); description.textContent = item.description;
    description.className = 'sr-only'; label.title = item.description;
    description.id = `basemap-description-${item.id}`; input.setAttribute('aria-describedby', description.id);
    input.addEventListener('change', () => { if (input.checked) choose(item.id); });
    label.append(input, preview, name, description); choices.append(label);
  }
  const note = document.createElement('p'); note.className = 'basemap-note';
  note.textContent = 'すべて無料・APIキー不要。標準・淡色はOpenFreeMap、衛星写真はEOX、地形はMapterhornへ通信します。選んだ地図の閲覧地域やIPアドレス等が配信元へ伝わり得ます。写真・Exifは送信しません。';
  const status = document.createElement('p'); status.id = 'basemap-load-status'; status.setAttribute('role', 'status');
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '再試行'; retry.hidden = true;
  let selected: BasemapId = 'standard'; retry.addEventListener('click', () => choose(selected));
  const info = document.createElement('details'); info.className = 'basemap-info';
  const infoHeading = document.createElement('summary'); infoHeading.textContent = '詳細・出典';
  const selectedDescription = document.createElement('p'); selectedDescription.className = 'basemap-description'; selectedDescription.textContent = basemaps[0]!.description;
  const credits = document.createElement('div'); credits.className = 'basemap-credits';
  const creditHeading = document.createElement('strong'); creditHeading.textContent = '地図の出典';
  const creditText = document.createElement('div'); credits.append(creditHeading, creditText);
  // Keep the renderer's actual credits accessible when the selector covers compact map attribution.
  const attribution = container.querySelector('.maplibregl-ctrl-attrib-inner');
  if (attribution) {
    const mirror = () => creditText.replaceChildren(...[...attribution.childNodes].map(node => node.cloneNode(true)));
    mirror(); new MutationObserver(mirror).observe(attribution, { childList: true, subtree: true });
  }
  // The selector must be above the mobile photo preview, whose panel has its own stacking context.
  info.append(infoHeading, selectedDescription, note, credits);
  panel.append(top, choices, status, retry, info); dock.append(toggle); container.append(dock); document.body.append(panel);
  let pinned = false, hoverSuppressed = false;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelHide = () => { if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; } };
  const position = () => {
    if (panel.hidden) return;
    const mobile = matchMedia('(max-width: 700px)').matches, anchor = toggle.getBoundingClientRect();
    const right = innerWidth - 12;
    panel.style.left = mobile ? '10px' : `${Math.max(12, Math.min(anchor.left, right - 396))}px`;
    panel.style.top = 'auto';
    panel.style.bottom = `${innerHeight - anchor.top + 6}px`;
    panel.style.maxWidth = mobile ? 'calc(100vw - 20px)' : 'calc(100vw - 24px)';
    // Compact chooser anchors above its button; expanded details may use the full safe viewport.
    if (mobile && info.open) {
      panel.style.top = '68px'; panel.style.bottom = 'auto';
      panel.style.maxHeight = 'calc(100dvh - 154px - env(safe-area-inset-bottom))';
    } else if (mobile && anchor.top < 240) {
      panel.style.top = `${anchor.bottom + 6}px`; panel.style.bottom = 'auto';
      panel.style.maxHeight = `${Math.max(130, innerHeight - anchor.bottom - 86)}px`;
    } else panel.style.maxHeight = `${Math.max(130, anchor.top - 80)}px`;
  };
  const dismiss = (restoreFocus = true) => {
    if (panel.hidden) return false;
    cancelHide(); pinned = false; hoverSuppressed = dock.matches(':hover') || panel.matches(':hover');
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    info.open = false;
    if (restoreFocus) toggle.focus({ preventScroll: true });
    return true;
  };
  const focusSelected = () => {
    const input = panel.querySelector<HTMLInputElement>('input:checked');
    input?.focus({ preventScroll: true }); input?.closest('label')?.scrollIntoView({ block: 'nearest' });
  };
  const open = (explicit: boolean) => {
    cancelHide();
    if (!panel.hidden) { if (explicit) { beforeOpen(); pinned = true; position(); focusSelected(); } return; }
    if (!explicit && hoverSuppressed) return;
    if (explicit) beforeOpen();
    pinned = explicit; panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    position(); if (explicit) focusSelected();
  };
  toggle.addEventListener('click', () => {
    if (!panel.hidden && pinned) dismiss(); else open(true);
  });
  const canHover = (event: PointerEvent) => event.pointerType === 'mouse' && matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hoverEnter = (event: PointerEvent) => { if (canHover(event)) { cancelHide(); open(false); } };
  const hoverLeave = (event: PointerEvent) => {
    // Hiding an overlapping panel can expose the dock without any actual mouse movement.
    if (panel.hidden) return;
    hoverSuppressed = false;
    if (!canHover(event)) return;
    cancelHide();
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (!pinned && !panel.contains(document.activeElement)) dismiss(false);
    }, 220);
  };
  dock.addEventListener('pointerenter', hoverEnter); dock.addEventListener('pointerleave', hoverLeave);
  panel.addEventListener('pointerenter', hoverEnter); panel.addEventListener('pointerleave', hoverLeave);
  panel.addEventListener('focusin', cancelHide);
  document.addEventListener('pointermove', event => {
    if (hoverSuppressed && canHover(event) && event.target instanceof Node && !dock.contains(event.target) && !panel.contains(event.target)) hoverSuppressed = false;
  });
  panel.addEventListener('focusout', () => {
    if (pinned) return;
    cancelHide(); hideTimer = setTimeout(() => {
      hideTimer = null;
      if (!panel.matches(':hover') && !dock.matches(':hover') && !panel.contains(document.activeElement)) dismiss(false);
    }, 220);
  });
  info.addEventListener('toggle', position);
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
      selectedDescription.textContent = basemaps.find(item => item.id === selected)!.description;
      togglePreview.className = `basemap-preview basemap-${selected}`;
      toggle.title = `レイヤー：${basemaps.find(item => item.id === selected)!.label}`;
      toggle.setAttribute('aria-label', toggle.title);
    },
  };
}
