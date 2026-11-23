# データモデル

正本は[model.ts](../../src/domain/model.ts)のZodスキーマと[storage.ts](../../src/infrastructure/storage.ts)の型/トランザクションです。初期の`docs/data-model.md`の単一所属図は現行ではありません。

## 共通の型とストア

`ID`はUUID文字列、`UTC`は`z.iso.datetime({ offset: false })`で検証する日時文字列、`Point`は`{ longitude: number[-180,180], latitude: number[-90,90] }`の有限値です。表の`?`はプロパティ省略可、`| null`は明示的なnullです。`JSON`はnull/文字列/有限数/boolean/配列/文字列キーのオブジェクトです。

| ストア | キー | 索引（すべて非unique） | 主なレコード |
|---|---|---|---|
| `trips` | `id` | なし | `Trip` |
| `visits` | `id` | `byTrip: tripId` | `Visit`（アルバム） |
| `photos` | `id` | `byHash: contentSha256`、`byTrip: tripId` | `Photo` |
| `photoAlbumLinks` | `[albumId, photoId]` | `byPhoto: photoId` | `PhotoAlbumLink` |
| `thumbnails` | `id` | なし | `Thumbnail` |
| `jobs` | `id` | なし | `ImportJob` |
| `recovery` | `sequence`（autoIncrement） | なし | `RecoveryEntry`の3形式 |

DB名の既定値は`photo-route-library`、バージョンは3です。`appMeta`、独立した`cover`、`snapshots`ストアはありません。「スナップショット」というUI文言は別ストアの存在を意味しません。

## Trip

| フィールド | 型・制約 |
|---|---|
| `id` | ID |
| `name` | trim後1〜200文字 |
| `createdAt`, `updatedAt` | UTC |
| `deletedAt` | UTC \| null。論理削除日時 |

旅行削除はTrip自身の`deletedAt`を更新し、子Photo/Visitを一括削除しません。通常UIでは生存する旅行を選ぶため、子も見えなくなります。子の復元前には旅行が生存している必要があります。

## Visit（UI上のアルバム）

| フィールド | 型・制約 |
|---|---|
| `id`, `tripId` | ID。参照するTripが必要 |
| `label` | 最大200文字。`newVisit`/`reviseVisit`はtrimした空名を拒否 |
| `representativeLocation` | Point \| null。写真GPSとは別の旧代表地点 |
| `locationSource` | `manual` / `selected-photo` / `none` |
| `representativePhotoId` | ID \| null。存在する場合は同一TripのPhoto |
| `userStartAtUtc`, `userEndAtUtc` | UTC \| null。旧手動時刻。写真の撮影期間ではない |
| `createdAt`, `updatedAt` | UTC |
| `deletedAt` | UTC \| null |

通常UIの編集対象は主に名前と所属写真です。代表地点・根拠写真・旧手動時刻は既存値を保持し、カバーへ転用しません。`coverPhotoId`はありません。アルバム削除でもPhoto/サムネイル/リンクは残ります。

## Photo

| フィールド | 型・制約 |
|---|---|
| `id` | ID |
| `tripId` | ID \| null。旧データ/復元のnullを許容。新規ファイル取り込みは生存Trip必須 |
| `visitId` | ID \| null。互換用の旧フィールド。v3の正規保存ではnull |
| `originalFilename` | 1〜255文字のbasename。`.`/`..`、スラッシュ、制御文字を拒否 |
| `sourceMime` | `image/jpeg` / `image/png` / `image/webp` / `image/heic` / `image/heif` |
| `sourceByteLength` | 正整数、最大64MiB。実入力は形式別の追加制限あり |
| `contentSha256` | 小文字16進64桁。元ファイルの完全一致用 |
| `sourceGps` | 下表の元GPS構造 |
| `gpsCorrection` | `{value: Point, reason?: string, correctedAt: UTC, source: 'manual'}` \| null |
| `sourceTime` | 下表の元日時構造 |
| `timeCorrection` | 下表の日時補正 \| null |
| `sourceOrientation` | 整数1〜8 \| null |
| `thumbnailId` | ID \| null |
| `thumbnailState` | `available` / `failed` / `not-attempted` |
| `metadataIssues` | string[] |
| `importedAt`, `updatedAt` | UTC。`createdAt`フィールドはない |
| `deletedAt` | UTC \| null |

### sourceGps

| フィールド | 型 |
|---|---|
| `rawTags` | Record<string, JSON> |
| `normalized` | Point \| null |
| `horizontalErrorMeters` | 有限非負数 \| null |
| `datum` | string \| null |
| `status` | `valid` / `suspect` / `invalid` / `missing` |
| `issues` | string[] |

`valid`にはWGS-84とnormalizedが必要。`missing`/`invalid`でnormalizedがあるレコードは拒否します。測地系不明の参考位置は[表示用再評価](MAP_AND_GEO.md)で扱い、保存済みnormalizedへ自動変換しません。

### sourceTime / timeCorrection

| 構造 | フィールドと型 |
|---|---|
| `sourceTime` | `rawDateTimeOriginal`, `rawOffsetTimeOriginal`, `rawGpsDateStamp`: string \| null |
| 同上 | `rawGpsTimeStamp`: JSON（null可） |
| 同上 | `localClock`: string \| null、`offsetMinutes`: 整数[-840,840] \| null、`capturedAtUtc`: UTC \| null |
| 同上 | `status`: `utc-derived` / `local-only` / `missing` / `invalid` |
| 同上 | `evidence`: `exif-offset` / `explicit-manual` / `none`、`issues`: string[] |
| `timeCorrection` | `correctedLocalClock`: string \| null、`correctedOffsetMinutes`: 整数[-840,840] \| null、`correctedUtc`: UTC \| null |
| 同上 | `source: 'manual'`, `correctedAt: UTC`, `reason?: string` |

元日時は`sourceClockEvidence(rawDateTimeOriginal, rawOffsetTimeOriginal)`との整合を検証します。補正構造の型はnullableですが、非null補正では有効な時計文字列と、時差から算出したUTCの一致が必要です。時差不明時はUTCを確定しません。根拠: [time.ts](../../src/domain/time.ts)、[corrections.ts](../../src/domain/corrections.ts)。

## PhotoAlbumLink / Thumbnail

| レコード | 全フィールド |
|---|---|
| `PhotoAlbumLink` | `albumId: ID`, `photoId: ID`, `createdAt: UTC \| null` |
| `ThumbnailMeta` | `id: ID`, `photoId: ID`, `mime: 'image/jpeg' \| 'image/png' \| 'image/webp'`, `width`, `height`: 正整数≤1024、`byteLength`: 正整数≤1MiB |
| `Thumbnail` | ThumbnailMeta全フィールド＋`blob: Blob`。Blob.size/typeとメタ値が一致すること |

リンクのnull日時は旧所属の追加日時に証拠がないことを表します。移行時刻を過去の追加日時にしません。新しい追加は保存時刻を記録し、維持する既存リンクの日時は変えません。

サムネイル正規生成の長辺は512pxです。1024pxはモデルが受け入れる上限であり、通常生成サイズではありません。`thumbnailState === 'available'`と`thumbnailId !== null`は同値。Photo→ThumbnailとThumbnail→Photoの相互参照が必要です。

## ImportJob

[storage.ts](../../src/infrastructure/storage.ts)で定義され、`jobs`へ保存されます。Zodのdomainモデルではありません。

| フィールド | 型 |
|---|---|
| `id` | string（通常crypto.randomUUID） |
| `startedAt` | string（通常ISO UTC） |
| `targetTripId` | string \| null。旧レコード互換。現行取り込み入口はnullを拒否 |
| `total`, `processed` | number（取り込み側が件数を更新） |
| `state` | `running` / `completed` / `cancelled` / `interrupted` |
| `lastError` | string \| null |

各ファイルの`FileOutcome`一覧は取り込み中のメモリー状態で、独立した永続ストアではありません。`markInterruptedJobs()`は存在しますが、現行の起動経路にその呼び出しはなく、再起動でrunningを必ずinterruptedへ変換するとは保証しません。

取り込みの先行準備は最大2件ですが、結果と`processed`は入力順で1件ずつ確定します。準備完了を保存済みとは数えません。この最適化でImportJobやPhotoの保存フィールド、DB v3/ZIP v2は変更しません。根拠: [取り込み](../../src/application/import-photos.ts)。今回の変更前基準Git HEAD: `4ad902d6adef8c3d1b72e7d44063a25f74e2dd4e`。

## RecoveryEntry

共通: `sequence?: number`（保存後はautoIncrementキー）、`id: string`（操作ID）、`kind`、`action: string`、`targetId: string`、`createdAt: string`、`undoneAt: string | null`。

| 形式 / kind | 固有フィールド |
|---|---|
| `LegacyRecoveryEntry` / `trip`・`visit`・`photo` | `before`, `after`: 対応するTrip/Visit/Photoの全レコード |
| `BatchRecoveryEntry` / `photo-visit-batch` | `changes: {before: Photo, afterVisitId: string \| null, afterUpdatedAt: string}[]`。旧単一所属履歴 |
| `AlbumMembershipRecoveryEntry` / `photo-album-batch` | `requestHash: string`, `expectedTrip: Trip`, `expectedAlbums: Visit[]`, `changes: {beforePhoto: Photo, beforeLinks: PhotoAlbumLink[], afterLinks: PhotoAlbumLink[]}[]` |

復旧履歴はbefore/afterや所属の比較に必要な記録であり、元写真バイト列や全DBの独立バックアップではありません。一般Undo UIはありませんが、旧履歴の保持と安全な内部実行は維持します。

## 関係・削除・整合性

- Trip 1対多 Photo/Visit。PhotoとVisitは`photoAlbumLinks`を介する多対多。写真0所属・空アルバムを許容。
- 同一ペアは複合主キーと検証で重複禁止。リンク先のPhoto/Visitが存在し、両者のTripが同じであること。Trip未設定写真はリンクを持てません。
- `representativePhotoId`は同一Trip制約のみで、アルバム所属を強制するカバーフィールドではありません。
- ごみ箱アルバムへの既存リンクは保持。新しい所属追加は拒否。削除済み写真の新しい所属編集も拒否します。
- 所属保存はPhoto本体・サムネイル・Photo.updatedAtを変えません。写真本体のごみ箱移動もリンク/サムネイルを削除しません。
- `Snapshot`は`{trips, visits, photos, thumbnails, links}`を返す集約型。独立ストアではなく、jobs/recoveryを含みません。

IndexedDB自体にリレーショナルDBの外部キー制約はありません。整合性はDomain検証とLibraryDbのトランザクションで守ります。製品コードからストアへ直接書いて検証を迂回しません。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`

## 2026-11-22 大JPEG自動処理の保存契約

[限定自動取り込み](IMPORT_AND_PHOTOS.md)も既存Photo/Thumbnailを使用し、DB v3/ZIP v2・所属・補正・原本非保存の意味を変えません。`contentSha256`と`sourceByteLength`は選んだ原本、sourceGps/sourceTime/sourceOrientationは原本Exifに由来します。表示用の縮小JPEGを別Photoとして登録しません。新経路の失敗ではPhoto/Thumbnailを保存せず、Jobの書き込みはあり得ます。timeout等は既存のJob.state=interruptedを使い、新フィールド/移行はありません。

今回の自動取り込み変更前基準Git HEAD: `22521bdb8e7ea9f944251039d185b221da69c102`

今回の自動取り込み実装・検証の確認元Git HEAD: `9dcef54e80cacc4e2be5d7aa3d0ba395a917d396`

## 2026-11-23 新規旅行名と完全削除

新規`createTrip`だけでtrim後の同名を拒否する。既存の同名Trip・ZIPから復元される同名を自動変更しない。DB unique index/モデル全体の一意性は追加しない。

確認付きの完全削除は[保存仕様](STORAGE_AND_BACKUP.md)の単一トランザクションで参照を保つ。DB v3/ZIP v2・各レコード・recoveryの形式・旧値の意味は変更しない。消えた対象の既存履歴は保持し、条件を満たさないUndoは拒否する。

今回変更前基準Git HEAD: `cf8d38afa6fb022154a84e9d983bcac6e28c5551`
