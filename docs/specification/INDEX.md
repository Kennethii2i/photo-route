# Photo Route 正式仕様書

この仕様書は **参照元実装 `989eae4` の実装を整理し、公開用に参照を整理した開発者向け入口**です。過去のPhase資料を連結したものではありません。実装済みの現状、互換性のための内部処理、将来案を分けて記録します。

## 読む順序

初参加者は PRODUCT → ARCHITECTURE → DEVELOPMENT → DATA_MODEL → STORAGE_AND_BACKUP を読み、変更対象の機能文書とTESTINGへ進んでください。AIエージェントは先にルートの[AGENTS.md](../../AGENTS.md)を読みます。

| 文書 | 用途 |
|---|---|
| [PRODUCT](PRODUCT.md) | 目的、旅行・写真・アルバムの意味、対象外 |
| [FEATURES](FEATURES.md) | 利用者の操作と実装箇所の対応 |
| [ARCHITECTURE](ARCHITECTURE.md) | モジュール、初期化、状態と描画の経路 |
| [DATA_MODEL](DATA_MODEL.md) | 現行の全永続化レコード、索引、関連制約 |
| [STORAGE_AND_BACKUP](STORAGE_AND_BACKUP.md) | DB v3、移行、ZIP v2、保存・復元・内部Undo |
| [UI_UX](UI_UX.md) | 画面と状態遷移、戻る・閉じる・離脱保護 |
| [MAP_AND_GEO](MAP_AND_GEO.md) | 位置の根拠、地図、クラスタ、カメラ |
| [IMPORT_AND_PHOTOS](IMPORT_AND_PHOTOS.md) | ファイル検証、解析、サムネイル、ジョブ |
| [ERRORS_AND_RECOVERY](ERRORS_AND_RECOVERY.md) | 失敗時の案内、再試行の可否、復旧 |
| [SECURITY_PRIVACY](SECURITY_PRIVACY.md) | 保存・外部通信・機密情報の扱い |
| [TESTING](TESTING.md) | 試験の選び方、隔離環境、検証の限界 |
| [DEVELOPMENT](DEVELOPMENT.md) | 開発開始、ブランチ、仕様更新手順 |
| [KNOWN_LIMITATIONS](KNOWN_LIMITATIONS.md) | 制約、未実装、未確認、過去資料との相違 |
| [CHANGELOG](CHANGELOG.md) | 保存形式・機能・操作体系の重要な変更 |
| [PUBLICATION_REVIEW](PUBLICATION_REVIEW.md) | 独立公開版の選別・検証と公開前の確認事項 |
| [SAFE_ASSETS](SAFE_ASSETS.md) / [全件CSV](SAFE_ASSETS.csv) | 同梱する23合成fixtureの由来・ハッシュ |
| [第三者通知](../../THIRD_PARTY_NOTICES.md) | MIT本体と第三者ソフトウェア・地図の条件 |
| [GITHUB_PAGES](GITHUB_PAGES.md) | 公開していないPages準備案と確認手順 |

## 正本と承認の区別

- **現在動く仕様の根拠**は各文書からリンクしたソースです。実装との差を見つけたら、コードとテストを確認して仕様書を修正します。
- **製品・保存・通信の承認**は[decisions.md](../decisions.md)と所有者の明示指示に従います。既存コードが承認されたと推測して新しい機能へ拡張しません。
- [constitution.md](../constitution.md)のデータ保護原則は維持します。現行の構造は[ARCHITECTURE](ARCHITECTURE.md)・[DATA_MODEL](DATA_MODEL.md)を参照します。
- 参照元の私有Phase報告/スクリーンショットは公開版に含みません。文書末尾の確認HEADは由来の記録で、この独立リポジトリ内には旧コミットを含みません。

## 更新規則

機能変更と同じ変更単位で該当文書・関連テスト・CHANGELOGを更新します。新しい仕様はこの目次へ登録し、実装ファイルと検証の根拠を付けます。[更新対象の対応表](DEVELOPMENT.md)と[CONTRIBUTING](../../CONTRIBUTING.md)を使用してください。未実装案には「将来案」「未実装」、実測していない内容には「未確認」を付けます。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
