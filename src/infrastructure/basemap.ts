import type { StyleSpecification } from 'maplibre-gl';

/** O-03 is open: this local style makes no tile/style/font request and is not a provider choice. */
export type BasemapConfig = { style: StyleSpecification | string; attribution: string | null; externalRequests: boolean };
export const localBlankBasemap: BasemapConfig = {
  style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e9f0ef' } }] },
  attribution: null,
  externalRequests: false,
};

/** Approved default for the local UI package; replaceable provider adapter. */
export const openFreeMapTrial: BasemapConfig = {
  style: 'https://tiles.openfreemap.org/styles/positron',
  attribution: null,
  externalRequests: true,
};
