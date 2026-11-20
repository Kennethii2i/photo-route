> Historical policy context: current implementation is described in [the formal specification](specification/INDEX.md). Early OPEN/PROPOSED items are not claims about the present implementation.

# Open decisions and provisional choices

This file prevents accidental promotion of proposals to user-approved decisions. Decisions D-001–D-018 are already approved and may not be re-opened casually.

## Before Phase 0 implementation

| ID | Status | Issue | Proposed default / approval gate |
|---|---|---|---|
| O-01 | OPEN | Actual frontend dependency versions and package manager | React+TS+Vite + npm (proposed); record dependency licenses and pin versions; technical choice can be approved with Phase 0 plan |
| O-02 | OPEN | HEIF thumbnail decoding strategy in target browsers | Browser native if supported, local WASM/JS decode fallback or report partial success; benchmark before choosing |
| O-03 | OPEN | Long-term basemap provider and style/tile pricing/terms | Phase 2-A local OpenFreeMap trial is approved with opt-in requests; production provider remains undecided; no unapproved production tile use |
| O-04 | OPEN | Thumbnail dimensions and JPEG/WebP encoding | Prefer bounded ~512px long edge, encoded locally with metadata stripped; adjust from observed quality/storage costs |
| O-05 | OPEN | Physical archive wire format & library | Phase 4-B is approved to test ZIP v1 streaming. The provisional implementation keeps v1 entries/manifest, streams writes up to 256 MiB and limits buffered downloads to 64 MiB. Split backups and the long-term device budget remain open; see [the current backup specification](specification/STORAGE_AND_BACKUP.md). |
| O-06 | OPEN | Max file bytes/pixels and import concurrency | Conservative preflight limits, low concurrency and no blanket promises; tune by measurements |

## Before Phase 1 merge

| ID | Status | Issue | Proposed default / approval gate |
|---|---|---|---|
| O-07 | OPEN | Default map style, appearance, marker shape, panel placement | Map-first lightweight UI; final appearance intentionally undecided |
| O-08 | OPEN | Default initial time-order behavior for offset-unknown photos | Show local-clock order with uncertainty notice; no claims of strict global chronology |
| O-09 | OPEN | Trip schema naming, exact IDs, export canonical content digest | Implement simple stable identity with validation; preserve approved semantics |
| O-10 | OPEN | Import exception flow for same Photo bytes in another Trip | Phase 2-D offers an explicit new-ID copy into a different Trip, with default skip and no overwrite. Same-Trip exception remains undecided and disabled |
| O-11 | OPEN | Mobile device floor and browser compatibility target | Desktop Chromium-first validation; manual mobile test before public release |
| O-12 | OPEN | Long-term restoration retention and automatic snapshot count | Phase 2-C local metadata snapshots are retained without automatic purge; quota failure refuses the edit atomically. Permanent deletion and in-place ZIP replacement stay disabled until retention, independent-backup verification and rollback policy are approved. |

## Owner-decision triggers

Before making a change requiring external photo/location transfer; accepting new ongoing costs; adding account/backend; enabling replacement/delete that can lose data; changing Photo-Visit cardinality; or changing D-001 original storage, stop and present alternatives, recommendation, cost/risk/rollback.

## Not blockers for Phase 0

Full screen design, cluster marker artwork, automatic travel classification, route engine selection, mobile GPS recording, automatic syncing, RAW/video support, multilingual UI.
