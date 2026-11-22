const credentialName = /(?:API[_-]?KEY|ACCESS[_-]?TOKEN|CLIENT[_-]?SECRET|PASSWORD|SECRET|(?:ESRI|ARCGIS)[_-](?:KEY|TOKEN))/i;
const esriToken = /\b(?:AAPK|AAPT)[A-Za-z0-9._~-]{20,}/;

/** Runs in Node configuration only. Never include environment values in errors. */
export function assertNoPublicCredentials(env: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_') || !value?.trim()) continue;
    if (credentialName.test(name) || esriToken.test(value)) {
      throw new Error('API credentials must not use VITE_ variables. Keep credentials server-side. Values were not logged.');
    }
  }
}
