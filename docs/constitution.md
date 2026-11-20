> Historical policy context: current implementation is described in [the formal specification](specification/INDEX.md). Early OPEN/PROPOSED items are not claims about the present implementation.

# Development constitution

Status: APPROVED principles inferred from D-001–D-018; implementation details marked as PROPOSED where relevant.

## Priority order

1. **Integrity and reversibility**: protect originals, avoid silent data loss, preserve reference consistency.
2. **Privacy and user control**: local processing by default, disclose external map requests and avoid hidden location uploads.
3. **Truthfulness of evidence**: actual GPS/time, manually corrected values, and future estimates must be distinguishable.
4. **Portability**: user can export and import a self-describing archive of the app-owned data.
5. **Accessibility and clarity**: show the map without forcing misleading certainty or clutter.
6. **Testability and modularity**: parsing, persistence, domain and rendering are independently testable.
7. **Scope discipline**: implement the smallest approved feature with a complete verification path.

## Immutable-ish data semantics

- Image source is read-only; no image rewrite, renaming or deletion of original local files.
- Source EXIF tags relevant to time/GPS are preserved separately from normalization and correction.
- `null/unknown` is not a default timezone, zero error, zero coordinate or inferred visit.
- Map clusters are transient visual aggregates, never Visit records.
- Local IndexedDB saves are not independent disaster backups.
- Export archives contain thumbnails and metadata, **not full originals**, unless a future separate decision changes D-001.
- Stable identifiers and a versioned schema enable migrations and safe re-import.

## Decision ownership and change control

Product owner approves material changes affecting product scope, persistent data contracts, third-party data sharing, cost, deployment, security posture, or destructive behavior. Codex may make local, reversible implementation decisions within approved constraints, recording meaningful choices and their tests. Unresolved cases are placed in `docs/open-questions.md` and implemented fail-closed when safety-related.

## Dependency and external services

- Prefer a permissively licensed, actively maintained library; record package, version, license, advisory status and justification before adding production dependencies.
- No vendor-specific map data in domain entities. Basemap config and app feature overlays are separate.
- No paid service credentials or services committed to Git; keys only via env/config, with scope restrictions where supported.

## Quality gates

Each approved feature has acceptance criteria, tests, and documented limitations. Changes touching serialization/data mutation require round-trip and failure-injection tests; no unobserved 'passed' claims. Security-sensitive features need an explicit privacy and rollback review.

## Accessibility

Aim for WCAG 2.2 AA in release. Provide text alternatives to map-only content, keyboard navigation for key flows, visible focus, error messages and reduced motion support. The final visual design remains undecided.
