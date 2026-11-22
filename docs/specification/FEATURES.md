# 実装済み機能

この表は現在の一般UIから到達できる機能です。内部APIだけの機能は別記します。具体的な保存条件は[保存仕様](STORAGE_AND_BACKUP.md)、画面状態は[UI/UX](UI_UX.md)へ分けています。

| 機能 | 利用者から見た動作 | 主な実装 | 制約 |
|---|---|---|---|
| 旅行の作成/選択 | ヘッダーの旅行セレクター/旅行管理から名前を入力。作成結果は作成画面内に表示 | [app](../../src/presentation/app.ts) `confirmCreatedTrip`、[layout](../../src/presentation/layout.ts) `openTripCreate`、[DB](../../src/infrastructure/storage.ts) `createTrip` | 名前変更UIなし。自動で既定旅行を作らない |
| 旅行管理 | 旅行を切り替え、ごみ箱移動は確認後に実行 | [layout](../../src/presentation/layout.ts)、[app](../../src/presentation/app.ts) `stageTrash` | 子レコードの完全削除ではない。未保存変更は保護 |
| 写真追加 | 写真一覧の件数右の＋から独立した取り込みダイアログへ。ファイル結果と処理件数は1枚につき1回計上 | [layout](../../src/presentation/layout.ts) `openImport`、[importer](../../src/application/import-photos.ts) `importFiles` | 生存するTripが必要。進捗保存失敗は全体エラーとして案内し、保存済み写真を確認する。[取り込み仕様](IMPORT_AND_PHOTOS.md) |
| 重複判定 | 元バイト列のSHA-256一致は既定スキップ。明示設定で別旅行へ別Photoとして追加可能 | [importer](../../src/application/import-photos.ts)、[DB](../../src/infrastructure/storage.ts) `findByHash`/`savePhoto` | 同じ旅行へ二重取り込み不可。類似画像判定ではない |
| 大JPEGの自動縮小 | 対応する写真は原本選択だけで表示用画像を生成し「追加」 | [専用Worker](../../src/infrastructure/automatic-jpeg.worker.ts) | 長辺12000px超・60MP以下・64MiB以下の限定baseline JPEG。失敗はPhoto未保存、timeout/稼働中中断等は再読込が必要。[取り込み仕様](IMPORT_AND_PHOTOS.md) |
| 写真一覧 | 撮影日別サムネイルグリッドと件数。画面周辺だけ仮想描画/遅延取得。再描画時のフォーカスを保持し、Tab/Shift+Tabで未描画の写真へ進める | [PhotoGrid](../../src/presentation/photo-grid.ts) | 範囲外・0件時は一覧容器へフォーカスを戻す。サムネイル欠損時はプレースホルダー。[UI/UX](UI_UX.md) |
| 写真検索 | ファイル名、撮影日範囲、確認済み/参考/GPSなし、所属あり/なし/特定アルバムで絞る | [photo-filter](../../src/presentation/photo-filter.ts)、[app](../../src/presentation/app.ts) `applyPhotoFilter`/`renderLibrary` | 検索語は検索欄だけ。日付範囲を1条件として数える。特定アルバム候補は現在の旅行から生成 |
| プレビュー/詳細 | 選択でコンパクトプレビュー、詳細ボタンで情報/編集へ。同じ写真の再選択で解除 | [app](../../src/presentation/app.ts) `choosePhoto`/`showDetail` | 単なる選択はズームしない。写真ごとに補正ドラフトを保持 |
| GPS/日時補正 | 詳細情報・編集で元情報とは別の手動補正を保存/解除。確定した入力項目だけ同期し、保存中の追加入力・他方の未保存補正を保持 | [corrections](../../src/domain/corrections.ts)、[app](../../src/presentation/app.ts)、[DB](../../src/infrastructure/storage.ts) `updatePhotoCorrection` | 同じ補正欄の他画面変更は競合として拒否。最新値の確認と基準採用を分ける。元Exif/解析値と時差不明の扱いを維持。[保存仕様](STORAGE_AND_BACKUP.md) |
| アルバム作成 | アルバム一覧の＋→名前→空アルバムを保存→概要 | [app](../../src/presentation/app.ts)、[visits](../../src/domain/visits.ts) `newVisit`、[DB](../../src/infrastructure/storage.ts) `createVisit(visit, [])` | 写真選択を後でキャンセルしても作成済みアルバムは残る |
| アルバム閲覧/編集 | サムネイル、名前、件数、写真由来の撮影期間。名前保存時は編集開始時の期待値を比較 | [VisitSummary](../../src/presentation/visit-summary.ts)、[visit-view](../../src/presentation/visit-view.ts)、[app](../../src/presentation/app.ts) | 他画面との競合時は入力を保持し、最新値の明示採用後に編集を続ける。代表地点/旧手動日時の既存値は保持。[UI/UX](UI_UX.md) |
| アルバム側の所属編集 | 概要/編集の「写真を選択」→画像本体をタップして追加/解除→一括保存 | [VisitPhotoEditor](../../src/presentation/visit-photo-editor.ts)、[draft](../../src/presentation/visit-photo-draft.ts) | 変更するのは現在のアルバムとのリンクだけ。他アルバム/ごみ箱リンクを勝手に外さない |
| 写真側の所属編集 | 写真詳細の「アルバムを編集」→同じ旅行のアルバムを検索/選択→一括保存 | [PhotoAlbumEditor](../../src/presentation/photo-album-editor.ts)、[draft](../../src/presentation/photo-album-draft.ts) | 写真本体を複製しない。削除済みアルバムへ新規追加不可 |
| 所属保存 | 変更件数・保存中・結果照会・競合を表示 | [DB](../../src/infrastructure/storage.ts) `saveAlbumMembershipBatch`、両編集画面 | 全対象が一括確定。競合時は全拒否してドラフトを保持 |
| アルバム限定地図 | 「地図で見る」で所属写真の位置だけ表示。×で通常検索の地図へ復帰 | [app](../../src/presentation/app.ts) `startVisitFocus`/`endVisitFocus` | GPSのない写真に代表地点を割り当てない |
| 地図で写真選択 | 単独マーカー/一覧からプレビュー。見えない場合だけズーム不変でパン | [PhotoMap](../../src/presentation/map.ts) `selectPhoto`/`revealPhoto` | クラスタ所属は確認できた場合だけ輪郭表示。専用の重複マーカーは作らない |
| クラスタ操作 | クラスタ直接タップで拡大。分離しない写真は最大12枚を画面内に展開 | [map](../../src/presentation/map.ts) `selectAt`/`showSpider`、[配置](../../src/presentation/map-spider-layout.ts) | 領域不足/13枚以上は既存写真一覧へ。ページ送りや新しい選択モーダルなし |
| ごみ箱/復元 | 写真詳細の地図隣アイコン、アルバム概要、旅行管理から確認→移動。管理から復元 | [app](../../src/presentation/app.ts) `stageTrash`/`renderRecovery`、[DB](../../src/infrastructure/storage.ts) | 写真本体の移動と所属解除は別操作。完全削除UIなし |
| ZIP保存/復元 | 通常ダウンロード/対応ブラウザの直接保存、ZIP選択、検証、衝突時の別コピー復元 | [archive](../../src/infrastructure/archive.ts)、[app](../../src/presentation/app.ts) | 原本・jobs・recoveryは含まない。v2出力/v1互換入力 |
| バックアップ件数案内 | 管理・写真取り込み・復元前に全旅行/ごみ箱を含む累積件数を表示。上限への接近・超過・選択分による超過可能性を案内 | [backup-capacity](../../src/presentation/backup-capacity.ts)、[DB](../../src/infrastructure/storage.ts) `backupCounts`、[app](../../src/presentation/app.ts) | 警告のみで固定取り込み禁止を追加しない。5000枚等の上限と通常64 MiB/直接256 MiBは維持。分割バックアップは未実装。[保存仕様](STORAGE_AND_BACKUP.md) |
| 障害/未保存保護 | 基本画面の障害案内、再試行、未保存入力の保持/破棄/継続、保存状態確認 | [error-notice](../../src/presentation/error-notice.ts)、[draft](../../src/presentation/photo-correction-draft.ts)、[app](../../src/presentation/app.ts) | 保存結果不明を成功扱いせず、無条件再送しない |

## 一般UIにない内部機能

`latestUndoable()`、`undoLatest(expectedId?)`、旧履歴互換Undo、recoveryレコードは保持されていますが、一般画面・管理・成功通知・ショートカットにデータUndoの入口はありません。入力欄のブラウザ標準の文字取り消し、編集キャンセル、ごみ箱からの復元とは別です。

`PhotoFilter.visit`の`album:<id>`条件は通常の絞り込みセレクターにも接続されています。同名アルバム候補は番号で区別します。アルバム限定地図はこの検索とは独立したUI状態です。

今回の自動取り込み変更前基準Git HEAD: `22521bdb8e7ea9f944251039d185b221da69c102`

今回の自動取り込み実装・検証の確認元Git HEAD: `9dcef54e80cacc4e2be5d7aa3d0ba395a917d396`
