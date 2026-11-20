> Historical policy context: current implementation is described in [the formal specification](specification/INDEX.md). Early OPEN/PROPOSED items are not claims about the present implementation.

# Privacy, security and threat model

Status: policy from approved decisions + necessary engineering safeguards. Scope: local-first browser app processing personal photo locations.

## Assets and trust boundaries

**Sensitive assets:** geocoordinates, capture times, file basename, thumbnail visual contents, original bytes while in memory, user edits, Trip/Visit associations, exported archives. **Untrusted inputs:** imported image bytes, EXIF strings, ZIP archives, filenames, map style content and browser environment. **External parties:** basemap/style/tile provider, hosting provider after public release.

## Privacy contract

- No automatic uploads of original images or photo EXIF to app servers or AI APIs.
- Read source files only after user selection; write only app metadata, thumbs, hashes and explicit user edits to IndexedDB.
- Thumbnails must be stripped of original EXIF/GPS metadata; derived timestamps/location exist in separate records.
- No third-party analytics/telemetry by default; new telemetry requires approval and privacy assessment.
- Basemap requests are external and can disclose approximate viewed regions, network identifiers and access logs. UI and privacy notice must explain this. Do not include photo IDs/EXIF in tile URL parameters.
- The UI package (D1 → Map → D2 → D3, owner approved 2026-11-19) supersedes the Phase 2-A opt-in UI: OpenFreeMap Positron loads by default. Management exposes the provider, requests, privacy policy and terms. IP/network information and viewed regions can reach the provider/CDN; no Photo/Exif/filename/album payload is sent. Provider failure falls back to the blank style without altering saved photos. This is a local development default, not approval to publish or merge the multi-membership branch.
- Client map API keys are not secrets; restrict to allowed HTTP origins, quotas and minimum privileges where supported. No private keys in bundle/Git.
- Archives may reveal precise locations and thumbnail scenes; show a warning before export/sharing.

## Security controls by flow

| Flow | Threat | Mandatory mitigations |
|---|---|---|
| Image import | malicious parser input, excessive dimensions/size | sniff type, validate signatures, cap bytes/pixels/decode time, isolate failures, test corrupt fixtures |
| Thumbnail decode | image bomb, persistent EXIF disclosure | bounded concurrency, controlled output dimensions, strip metadata, release object URLs/buffers |
| EXIF text | XSS via filename or raw tags | safe text rendering, escaping, no `innerHTML` with untrusted data |
| ZIP import | zip bomb, traversal, malicious URLs, schema smuggling | entry allowlist, uncompressed size caps, no filesystem extract, strict JSON schema and referential checks, no executable/remote fetch |
| IDB mutation | partial commits, duplicate links, quota failure | transaction handling, rollback/staging, errors propagated, test quota/faults |
| Export | accidental disclosure | user-triggered download, location/privacy notice, no network egress |
| Map | external tracking, provider outage | configurable provider, attribution, remove photo identifiers from requests, graceful list fallback |
| Static hosting | XSS/dependency compromise | CSP where compatible, pinned dependencies/lockfile, dependency scanning, no secrets in JS |

## Minimum browser and network policy

- Build for `localhost` first; HTTPS for deployment.
- Never silently call geolocation API to determine current user position; this product works from selected photos. Do not request current location permissions in MVP.
- During local tests, observe network traffic to verify no image upload. The only external network expected should be approved map style/tile/font assets, and optional package installation during development (not user app runtime).
- Offline availability: metadata and thumbnails can still be accessed; basemap may be blank. The UI must remain useful with a list/record detail and export.

## Recovery and deletion

Phase 2-C implements soft deletion and restore for Photo/Visit/Trip, plus local pre-change recovery entries for important edits and Undo. Trip deletion only hides its children; it does not purge Photo, Visit or thumbnail records. Recovery entries contain metadata, remain in IndexedDB, and are not exported as an independent backup. Browser storage deletion and private browsing can destroy them despite `persist()`; warn and offer verified manual ZIP export. No automatic recovery-history purge or irreversible delete is enabled while retention O-12 is open. Changed same-ID ZIP content is rejected by default; an explicit separate-copy operation remaps all linked IDs atomically. In-place replacement remains disabled pending external-backup confirmation and rollback verification.

## Risk register

| Risk | Priority | Required response |
|---|---|---|
| Loss of local storage | Critical | versioned manual export, restore tests, notice on backup limitation |
| Photo/GPS data exfiltration | Critical | local-only processing, audited network calls, disclosure of map requests |
| Wrong UTC or GPS inference | High | source/effective separation and uncertainty labels |
| Inconsistent Trip/Visit refs | High | domain validation and transactional writes |
| Malicious or large image/archive | High | validation/limits/memory control, failure isolation |
| Public provider overuse or license breach | Medium/High | license/terms review, attribution, quota monitoring before release |
| Unsupported HEIF decoding | Medium | partial import and observable fallback; Phase 0 go/no-go decision |

## Incident / test practice

Never commit private trip files or real geotagged photos to test fixtures. Use fabricated data or explicitly licensed/synthetic images. If a security flaw is found, stop affected feature, preserve original data without migration, document reproduction and recovery plan; do not ship a bypass.
