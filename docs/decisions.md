> Historical policy context: current implementation is described in [the formal specification](specification/INDEX.md). Early OPEN/PROPOSED items are not claims about the present implementation.

# Approved decision record D-001–D-018

All items below are APPROVED by the product owner. These record **product and architecture policy**, not a requirement to implement every feature in Phase 1. If details were not actually approved, they remain proposals in `docs/open-questions.md`.

| ID | Topic | Approved decision | Earliest planned implementation |
|---|---|---|---|
| D-001 | Photo storage | Persist parsed metadata + thumbnails; do not routinely persist original image bytes | Phase 1 |
| D-002 | Persistence/portability | IndexedDB automatic save + export/import | Phase 1 |
| D-003 | Domain | Photo and Visit are independent entities | Schema in Phase 1; UX later |
| D-004 | Trip assignment | User chooses Trip manually; unclassified Photo is allowed | Phase 1 |
| D-005 | Incomplete metadata | Import whenever safely possible; retain raw-relevant source values and manual corrections separately | Source states Phase 1; edit UX Phase 2 |
| D-006 | Duplicate photos | SHA-256 of source bytes for exact duplicate detection; default skip; explicit exception possible | Default skip Phase 1; choices Phase 2 |
| D-007 | Import collisions | Detect same-trip/data; identical skip; changed content: copy, backup-protected replace or cancel; **no automatic merge** | Safe refusal Phase 1; choices Phase 2 |
| D-008 | Recovery | Undo, trash, critical-operation snapshots, manual external backup; automatic cloud backup deferred | Manual archive Phase 1; other UX Phase 2 |
| D-009 | Formats | JPEG, PNG, WebP, HEIC/HEIF; separate metadata parsing from thumbnail decoding | Phase 0 spike; Phase 1 implementation |
| D-010 | Volume | Design chunked/limited concurrency; verify ~1,000 per import, ~5,000 cumulative, not fixed limits | Design Phase 1; scale test Phase 4 |
| D-011 | Time semantics | Preserve source local time; derive UTC only with sufficient evidence; unknown offsets remain unknown and correctable | Model Phase 1; corrections Phase 2 |
| D-012 | GPS semantics | Validate, record accuracy/unverified states, warn; original retained, manual correction possible; no automatic GPS fix | Model Phase 1; corrections Phase 2 |
| D-013 | Map layers | Photo and Visit separate from basemap and each other; UI not frozen | Model Phase 1; full UI Phase 3 |
| D-014 | Visit creation | From selected Photo(s) or directly on map; Visit may have zero photos; locations independent | Domain Phase 1; workflows Phase 3 |
| D-015 | Map technology | MapLibre GL JS + external basemap provider; decouple for later PMTiles/self-host possibility | Phase 0/1 |
| D-016 | Map display | Clustering by zoom, separate Photo/Visit clustering and layer toggling; cluster is never persistent Visit; appearance TBD | Phase 3; structure Phase 1 |
| D-017 | Delivery strategy | Small working vertical slice: photo import → map → persistence → export/re-import, then enhancements | Phase 0/1 |
| D-018 | Environment | Verify Phase 0/1 locally, then release a static HTTPS web site and test devices | Phase 0/1 local; Phase 4 deployment |

## Preserved contextual decisions

- Codex is the main implementer; ChatGPT assists with professional design, specifications, review; product owner decides material trade-offs.
- Kiro subscription/credits are not used; only spec-driven design principles are adopted.
- Default map-first design and circular thumbnail markers are **candidates only**, not approved pixel/layout contracts.
- User-visible photo and map side-by-side permanent layout is **not required**.
- Routing inference is deferred, not just hidden.

## Approved vs. scoped

The selected D-008 recovery policies must be implemented before the corresponding destructive operations become available. The selected D-016 cluster policy is part of eventual display behavior, but Phase 1 can show minimal unclustered markers for a small test dataset.

## Change record format

`D-019: [title] — context / alternatives / recommendation / owner approval / scope effect / migration effect / tests`. Codex may propose, but may not self-approve a new product decision.

## D-019：新規ファイル取り込みの旅行必須化（APPROVED）

- 承認：2026-11-20、利用者の「IA-2・IA-3 一括実装」指示。
- D-004の手動旅行選択を維持し、**新規ファイル取り込みだけ、生存する非null Tripを必須**とする。
- 既存Photoと旧DB/ZIP v1・v2の復元ではTrip未所属（`tripId=null`）を保持する。削除・自動割り当てをしない。
- Photoのnullable、IndexedDB v3、ZIP v2、所属APIは変更しない。アルバム所属は任意のまま。
- 旧D-004は当時の決定として残す。新規取り込みのnull可否だけを本決定が限定して上書きする。
- UIとPhotoImporter入口で検証し、無効な旅行ではジョブ/Photoを作る前に拒否する。互換閲覧・補正・バックアップを維持。
- 関連検証：[tests/e2e/ia-2b-import.spec.ts](../tests/e2e/ia-2b-import.spec.ts)。過去の私有実行報告は本公開版の対象外。

## P2.2 publication decision (APPROVED)

The owner approved MIT for Photo Route application code and a separate public repository with an independent initial history. Private history, unapproved screenshots and user data are excluded. Third-party terms remain separate. Copyright-holder wording is provisional and must be confirmed before publication. This does not authorize Push, hosted publication, or data migration.

## 2026-11-22 所有者依頼：無料の世界背景4種類

所有者は標準・航空/衛星写真・地形・淡色、および学術情報を「詳しく知る」にまとめる構成に賛成し、続けて無料の基本4地図を計画後に実装するよう明示指示した。[計画](free-world-basemaps-2026-11-22.md)に実装範囲・無料配信の技術選択・通信・復旧・検証を記録する。サービス名は所有者指定ではなく、この条件内での実装上の選択。課金・DB/ZIP変更・学術データAPI・公開は含めない。過去のOPEN/PROPOSEDの一括承認や長期配信保証を意味しない。
