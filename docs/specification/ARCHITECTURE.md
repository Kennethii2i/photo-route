# アーキテクチャ

## 構成

React等のUIフレームワークを使わない、TypeScript strictのクライアントアプリです。DOMを組み立てるプレゼンテーション層と、Domain・取り込み・保存アダプターを分離したモジュラーモノリスです。Nodeは開発/ビルド用で、製品の保存先サーバーではありません。

```mermaid
flowchart TD
  HTML["index.html / style.css"] --> Main["main.ts → startApp"]
  Main --> Layout["createLayout / DOM / UI状態"]
  Main --> App["app.ts 操作の調整"]
  App --> Grid["PhotoGrid / VisitSummary / 編集ドラフト"]
  App --> Importer["PhotoImporter"]
  App --> Map["PhotoMap / 可視領域 / クラスタ"]
  App --> DB["LibraryDb"]
  App --> Archive["archive / zip-stream"]
  Importer --> Image["image: 検証・Exif・サムネイル"]
  Importer --> DB
  Archive --> DB
  DB --> IDB["IndexedDB v3"]
  Map --> OFM["MapLibre → OpenFreeMap"]
  App --> Domain["domain: モデル・日時・GPS・関係"]
  DB --> Domain
  Image --> Domain
```

## 責務と主要モジュール

| 層 | 実装 | 責務 |
|---|---|---|
| 起点 | [main.ts](../../src/main.ts)、[app.ts](../../src/presentation/app.ts) | イベント接続、状態の調整、再読み込みと描画 |
| Domain | [model.ts](../../src/domain/model.ts)、[gps.ts](../../src/domain/gps.ts)、[time.ts](../../src/domain/time.ts)、[corrections.ts](../../src/domain/corrections.ts)、[visits.ts](../../src/domain/visits.ts)、[map.ts](../../src/domain/map.ts) | Zodモデル、関係整合性、証拠を失わない日時/GPS、GeoJSON化 |
| Application | [import-photos.ts](../../src/application/import-photos.ts) | 検証・重複判定・解析・保存・進捗を1枚ずつ調整 |
| Infrastructure | [storage.ts](../../src/infrastructure/storage.ts) | IndexedDB、移行、原子的な保存/競合/内部Undo |
| Infrastructure | [archive.ts](../../src/infrastructure/archive.ts)、[zip-stream.ts](../../src/infrastructure/zip-stream.ts) | ZIP検証、書き出し、衝突分類、ID再割当て |
| Infrastructure | [image.ts](../../src/infrastructure/image.ts)、[basemap.ts](../../src/infrastructure/basemap.ts) | 画像と地図配信の境界 |
| Presentation | [layout.ts](../../src/presentation/layout.ts) | 既存HTMLの再配置、drawer/タブ/モーダル、フォーカス、可視領域通知 |
| Presentation | [photo-grid.ts](../../src/presentation/photo-grid.ts)、[visit-summary.ts](../../src/presentation/visit-summary.ts)、[visit-view.ts](../../src/presentation/visit-view.ts) | 仮想一覧、概要、撮影期間と関連写真の表示用集計 |
| Presentation | [map.ts](../../src/presentation/map.ts)、[map-viewport.ts](../../src/presentation/map-viewport.ts)、[map-spider-layout.ts](../../src/presentation/map-spider-layout.ts) | 地図ソース、選択、カメラ、一時的な画面座標配置 |
| Presentation | [visit-photo-editor.ts](../../src/presentation/visit-photo-editor.ts)、[photo-album-editor.ts](../../src/presentation/photo-album-editor.ts) | 両方向の複数所属編集。各draftモジュールは未保存選択を保持 |
| Presentation | [photo-correction-draft.ts](../../src/presentation/photo-correction-draft.ts)、[error-notice.ts](../../src/presentation/error-notice.ts) | 写真別の補正ドラフト、障害の優先表示 |

## 起動とデータ経路

1. `index.html`から`src/main.ts`を読み、`startApp()`が`createLayout()`と`ErrorNotice`を作る。
2. DB読み込みが完了するまでworkspaceをinert/disabledにし、`LibraryDb.open()`でv3へ接続する。blocked/versionchangeを登録する。
3. `render()`→`renderLibrary()`がTrip/Photo/Visit/リンクを取得。写真とアルバムの集合をメモリー上で索引化する。
4. Trip・論理削除・検索条件から表示対象を作り、`PhotoGrid`、アルバムカード、`PhotoMap.update()`へ渡す。通常の一覧と地図の写真検索条件は共通。
5. 変更はDB APIへ送り、確定後に`render()`する。所属の応答不明はoperationIdで状態を確認する。

## 状態管理

外部の状態管理ライブラリや履歴ルーターはありません。`app.ts`が選択ID、Trip、検索、アルバム限定モード、戻り先/スクロール、保存状態、取り込み状態を保持します。`layout.ts`は表示容器とナビゲーションを保持し、離脱は`onNavigate`へ集約します。編集draftは保存データと別です。

UI状態は主にメモリー上であり、再読み込み後のドラフト/選択/検索の永続復帰は保証しません。非同期サムネイルや候補には世代/選択IDの確認があり、Object URLは表示終了時に解放します。

## 依存ライブラリ

[package.json](../../package.json)の本番依存は`maplibre-gl 6.18.0`、`exifreader 4.54.0`、`fflate 0.8.3`、`zod 4.6.7`です。現行ZIP処理の正本は独自の`zip-stream.ts`で、依存宣言だけから利用経路を推測しません。`exifr`、`heic-to/csp`、`@su-engineering/heic`等は開発/spikeとVite optimizeDepsにも現れますが、現行のHEICサムネイル対応を意味しません。[ライセンス検査](PUBLICATION_REVIEW.md)を参照してください。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
