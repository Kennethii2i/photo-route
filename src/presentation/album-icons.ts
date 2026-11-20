const paths = {
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M19 12H5m6-6-6 6 6 6',
  add: 'M12 5v14M5 12h14',
  edit: 'm15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 15z',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16',
  fit: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  photos: 'M3 4h18v16H3zM3 16l5-5 5 5 3-3 5 5M16 8h.01',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  panel: 'M3 4h18v16H3zM9 4v16',
  download: 'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 15v6h16v-6',
  history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 11v6M12 7h.01',
};

export function iconMarkup(icon: keyof typeof paths): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[icon]}"/></svg>`;
}

export function albumIcon(button: HTMLButtonElement, icon: keyof typeof paths, label: string): void {
  button.classList.add('album-icon-button'); button.setAttribute('aria-label', label); button.title = label;
  // All paths are fixed application literals; user content remains in text/attributes.
  button.innerHTML = iconMarkup(icon);
}

export function albumTextButton(button: HTMLButtonElement, label: string): void {
  if (!button.classList.contains('album-icon-button')) return;
  button.classList.remove('album-icon-button'); button.removeAttribute('aria-label'); button.removeAttribute('title'); button.textContent = label;
}
