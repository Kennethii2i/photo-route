# 開発開始・引き継ぎ

## 環境とコマンド

[.nvmrc](../../.nvmrc)はNode.js 24.13.0、[package.json](../../package.json)のenginesは`>=24.13.0 <25`、packageManagerはnpm 11.6.2です。新しい開発環境ではリポジトリルートで実行します。

```powershell
npm ci --registry=https://registry.npmjs.org/
npm run dev -- --host 127.0.0.1 --port 18194 --strictPort
```

18194は例で、未使用確認が必要です。既に利用中のポートや作業ディレクトリを勝手に変更しません。起動URLのポートを変えるとIndexedDBも別です。専用Chromeプロファイルで合成データだけを扱います。

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

試験範囲は[TESTING](TESTING.md)で選びます。`preview`というnpm scriptはありません。ビルド成果物の確認には導入済みVite CLIの`npx vite preview --host 127.0.0.1 --port 18195 --strictPort`を使えます。これも未使用ポートと隔離ブラウザが必要で、本番配信サーバーではありません。

## 最初に読むもの

[INDEX](INDEX.md)、[PRODUCT](PRODUCT.md)、[ARCHITECTURE](ARCHITECTURE.md)、[DATA_MODEL](DATA_MODEL.md)、[STORAGE_AND_BACKUP](STORAGE_AND_BACKUP.md)、ルートの[AGENTS](../../AGENTS.md)を読みます。[decisions](../decisions.md)/[constitution](../constitution.md)は承認とデータ保護の根拠です。過去の初期案と現行実装を混同しないでください。

## ブランチとworktree

mainはレビュー済み基準。新しいタスクは独立ブランチ/未使用worktreeから始め、HEAD・ブランチ・status・worktree・remoteを確認します。既存の同名ブランチを上書きせず、未追跡資料も利用者の管理対象として扱います。

稼働中サーバーの作業ディレクトリではブランチを切り替えません。main統合を明示依頼された場合は祖先関係を確認し、統合前バックアップブランチと別worktreeで`--ff-only`を使用。不可なら通常merge/rebase/resetへ勝手に変更しません。Push/公開/実DB移行は別の明示指示が必要です。

## 機能追加の進め方

1. 変更目的と対象外を確認し、現行の入口/イベント/保存APIと関連テストを調べる。
2. 未実装案は提案として区別。保存形式、送信先、課金、破壊的操作、階層/モデルの意味が変わるなら所有者の承認と移行/復旧案を先に確認する。
3. Domainの検証、Applicationの調整、Infrastructureの保存境界、Presentationの表示を混ぜず、既存API/コンポーネントを再利用する。
4. 保存成功・失敗・競合・結果不明・未保存を設計し、成功が確認される前に成功通知/画面終了を行わない。
5. 対象の代表試験と必要な安全回帰、PC/モバイルの実画面を確認し、実行した結果だけを報告する。
6. 仕様/変更履歴/テストを同じ変更単位で更新し、小さなローカルコミットにする。

新画面を加える場合は`layout.onNavigate`、ドラフトの離脱保護、×/←、フォーカス復帰、余白クリックとの除外、エラー優先度を維持します。既存の保存ロジックを画面ごとに複製しません。

## 仕様書の更新対応表

| 変更対象 | 必ず確認/更新する文書 |
|---|---|
| 製品の責務/旅行・写真・アルバムの意味 | PRODUCT、FEATURES、DATA_MODEL、承認記録 |
| モデル/DB/リンク/Undo | DATA_MODEL、STORAGE_AND_BACKUP、ERRORS_AND_RECOVERY、TESTING、CHANGELOG |
| ZIP/上限/復元 | STORAGE_AND_BACKUP、SECURITY_PRIVACY、KNOWN_LIMITATIONS、TESTING |
| 画面/ナビゲーション/保存状態 | UI_UX、FEATURES、関連テスト、CHANGELOG |
| 地図/カメラ/位置の根拠 | MAP_AND_GEO、UI_UX、SECURITY_PRIVACY |
| 取り込み/画像 | IMPORT_AND_PHOTOS、DATA_MODEL、KNOWN_LIMITATIONS、TESTING |
| 依存/ビルド/配信 | ARCHITECTURE、DEVELOPMENT、PUBLICATION_REVIEW、GITHUB_PAGES |

各文書末尾に確認した実装HEADを記録します。全ファイルを機械的に同じ日付へ更新するのではなく、確認した変更範囲と未確認事項を明示してください。詳細なPhase証跡を正式仕様へ全文コピーしません。

## 保存形式を変える場合

DB v3/ZIP v2と`photoAlbumLinks`正本性は現行契約です。旧`Photo.visitId`を復活させたり、代表地点/手動日時を空欄だからnullにする変更は不可。移行は隔離DBで原子的ロールバック、他タブ、旧バックアップ、所属/サムネイル、内部Undoを検証します。利用者DBを勝手に移行/削除して試験しません。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
