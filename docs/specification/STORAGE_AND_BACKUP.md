# 保存・バックアップ

実装: [storage.ts](../../src/infrastructure/storage.ts)、[archive.ts](../../src/infrastructure/archive.ts)、[zip-stream.ts](../../src/infrastructure/zip-stream.ts)。フィールド/索引は[DATA_MODEL](DATA_MODEL.md)を参照します。

## IndexedDB v3と移行

`LibraryDb.open(name = 'photo-route-library', options)`がバージョン3で開きます。v1基盤ストア、v2のrecovery、v3のリンクストアを必要に応じて作成します。

v2→v3は一つのversionchangeトランザクションで実行します。Trip/Visitを検証し、Photoをcursorで走査。有効な旧`visitId`を同一Tripのリンクへ変換し、旧フィールドをnullにします。リンク作成日時はnullです。Exif/GPS/日時/補正/updatedAtは変更しません。ごみ箱内Visitへの有効な所属も移行します。

不正参照、Trip不一致、代表写真の不正参照、検証/書き込み失敗ではabortし、アップグレード全体をロールバックします。移行内部にネットワーク/ハッシュ等の非IDB非同期処理を挟みません。旧recoveryを削除・書き換えません。`onblocked`で他タブを閉じる案内、接続中の`onversionchange`でclose/書き込み停止/再読み込み案内を行います。

旧版はv3 DBをそのまま開けません。v2アプリへの単純なコード差し戻しはDBの逆移行ではありません。

## 書き込み境界

| API | 保存と安全条件 |
|---|---|
| `createTrip` | 既存ID拒否、Trip保存。画面は同じID/内容の照会で作成結果を確認 |
| `createVisit(visit, [])` | 空アルバム作成。写真IDを同時に渡す旧方式は拒否 |
| `updateVisit` | 既存アルバム/Trip整合性を検証し、更新とrecoveryを同じトランザクションで保存 |
| `savePhoto` | Photo/サムネイルを一体保存。Trip生存・SHA-256重複・参照を再検証。旧visitId非nullを拒否 |
| `saveAlbumMembershipBatch` | Trip/全関連Album/全対象Photo/全期待リンクの完全比較後、追加解除と履歴を一括確定 |
| `updatePhotoCorrection` | 元Photoを取得し手動補正/updatedAtを変更、recoveryと一体保存。元解析値は保持 |
| `moveToTrash` / `restoreFromTrash` | レコードのdeletedAt/updatedAtと履歴を一体保存。リンク/サムネイルを削除しない |
| `restoreNew` | 検証済みSnapshotの全関連ID衝突を確認し、5ストアへ原子的に追加。上書きではない |

旧`setPhotoVisit`、`savePhotoVisitBatch`、`photoVisitBatchStatus`はv3ではガードされます。旧APIを新UIへ再接続しません。新しい所属の正本はリンクのみです。

## 所属保存・競合・operationId

要求は`operationId`、`expectedTrip`、既存/追加先を含む`expectedAlbums`、各写真の`beforePhoto`/`expectedLinks`/`afterAlbumIds`です。正規化した要求をSHA-256化してからトランザクションを開きます。生存Trip、変更されていないPhoto/Album/リンク、同一Trip、重複禁止を検証します。ごみ箱リンクの維持は許容しますが、削除済みAlbumへの新規追加は拒否します。

同じoperationIdで異なる要求、保存後に変化した要求の再送は拒否します。同一要求が既に適用されていれば`already-applied`。無変更は`no-change`で、履歴を作りません。

`albumMembershipOperationStatus()`は`absent` / `applied` / `undone` / `changed-after-save` / `unknown`。`absent`だけでは「未送信」と「無変更」を区別できないため、UIは変更なし要求を送らず、結果不明時に成功と断定しません。盲目的な再送より状態照会を優先します。

## ごみ箱と内部Undo

写真・アルバム・旅行は論理削除です。Trip削除で子のdeletedAtを変更せず、通常の閲覧対象から隠します。写真/アルバムを復元する際は先にTripを復元します。

`undoLatest(expectedId?)`は最新の未取り消し履歴を同じトランザクション内で選び、期待ID・全対象状態を比較して復元し、undoneAtを付けます。旧単一所属履歴は専用互換処理でリンクへ解釈します。条件不成立の履歴は削除せず拒否します。一般Undo UIは撤去済みです。ごみ箱からの復元や編集キャンセルは残っています。

## ZIP v2の構造

```text
manifest.json
records/trips.json
records/visits.json
records/photos.json
records/thumbnails.json
records/photo-album-links.json
media/thumbnails/<thumbnail-id>.jpg|png|webp
```

manifestは`format: 'photo-route'`, `version: 2`, `exportId`, `exportedAt`, `entries[]`。entriesはmanifest自身を除き、各`path`, `size`, `sha256`を含みます。レコードはJSON配列、サムネイルJSONはBlobを除いたメタ値です。レコードのキーやID/リンク順を正規化し、サムネイルを順次書き込みます。**Photo原本、jobs、recovery、UI状態は含まれません。**

`inspectArchive()`はZIPエントリ/manifestの集合一致、重複、SHA-256、サイズ、スキーマ、実画像形式/寸法、参照/同一Trip/旧visitIdの条件を検証します。SHA-256は改ざんや破損の検出用で、送信者認証や暗号化ではありません。

旧ZIP v1は4つのrecord JSONとサムネイルを読み、旧visitIdをリンクへ変換してPhoto.visitIdをnullにします。v1に新リンクや過大なエントリが含まれる場合は拒否。現在の書き出しはv2だけで、複数所属を1件へ減らすv1出力はありません。

## 上限と保存方式

| 対象 | 実装上の暫定上限 |
|---|---|
| 通常のメモリー内ZIP | 64MiB |
| 直接保存/ZIP入力/展開後合計 | 各256MiB |
| 全ZIPエントリ | 5006（v1は5005以下） |
| 1 recordエントリ | 32MiB |
| 1サムネイルエントリ | 1MiB |
| Trip / Visit / Photo / Thumbnail | 1000 / 5000 / 5000 / 5000 |
| リンク | 150000 |
| ZIP中央ディレクトリ | 2MiB |

書き出しはZIP32のstoredエントリ方式です。入力はstored/deflateを扱い、deflateはDecompressionStreamの対応が必要です。展開比率100倍超、許可外のフラグ/パス、重複、不正範囲等を拒否します。暗号化ZIP/任意のZIP形式への汎用対応を保証しません。

`exportArchive()`は64MiBまでバッファします。`streamArchive()`はWritableStreamへ逐次書き込み、対応Chrome等では`showSaveFilePicker`の保存先へ接続します。出力を再検証する既存処理があります。256MiB方式でもSnapshot/JSON/入力復元がすべて定数メモリーになるとは保証しません。

## 復元と別コピー

`previewArchiveRestore()`が既存Snapshotとの同一性/衝突を分類し、`restoreArchive()`が全検証後に追加します。同一旅行はスキップ、ID衝突は既定拒否。分類された旅行衝突に対し、明示した`copy-conflicts`ではTrip/Visit/Photo/Thumbnail/リンク/代表写真参照を一貫して新IDへ付け替えます。ごみ箱内レコード/リンクも保存対象です。未分類写真の衝突コピーも別IDで追加します。任意の参照衝突をすべて自動修復するAPIではなく、最終的な`restoreNew()`でも残るID衝突を拒否します。

DBへの確定前に中断/検証失敗なら変更しません。確定後の結果不明を「失敗したから何度でも復元してよい」と扱わず、保存済みデータを確認します。

ブラウザ・プロファイル・ポート・ドメインが変わると別保存環境です。同じ端末のローカル環境から公開HTTPSサイトへはZIPで移します。詳しい手順は[復旧](ERRORS_AND_RECOVERY.md)へ。

## 2026-11-22 編集時の期待値と件数案内

`updateVisit(input, expected?)`は期待値指定時に全Visitを同一トランザクション内で比較します。`updatePhotoCorrection(photoId, change, expected?)`は変更するGPS/日時の補正レコード全体を比較し、異なる補正欄の並行更新を許容します。更新日時だけの比較ではありません。同一の保存値へ戻った変更履歴そのもの（ABA）の識別は保証しません。通常UIは編集開始時の期待値を保持し、競合時は`EditConflict`として本体/recoveryとも変更せず拒否します。引数省略の既存内部呼出は従来契約を維持します。DB v3、ZIP v2、Recovery構造、原子保存は変えません。

`backupCounts()`は5ストアのcountを同じ読み取りトランザクションで取得します。全旅行・ごみ箱を含み、表示旅行や検索に限定しません。UIは現行件数/容量上限を警告しますが、取り込み/復元を新しい固定上限で禁止しません。選択ファイル数からの写真総数は全件追加時の最大値で、重複/失敗/サムネイルサイズや復元衝突分類後の正確な出力容量を予測するものではありません。既存上限を超えるDBの全体バックアップを可能にした変更ではなく、分割書き出しも未実装です。

根拠: [保存API](../../src/infrastructure/storage.ts)、[件数案内](../../src/presentation/backup-capacity.ts)、[競合/履歴失敗試験](../../tests/e2e/safety-ux-improvements.spec.ts)。

今回変更の確認基準Git HEAD: `26093c16cec1924c8110efe5f932bd7159a8ca13`
