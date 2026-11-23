# Photo Route 正式仕様書

この仕様書は **現在の公開リポジトリの実装を確認する開発者向け入口**です。初版は参照元実装 `989eae4` を整理して作成し、公開後の変更は関連文書へ追記しています。実装済みの現状、互換性のための内部処理、将来案を分けて記録します。

2026-11-22の6項目の改善は、[機能一覧](FEATURES.md)、[変更履歴](CHANGELOG.md)、[改善計画・検証結果・統合前確認](../improvement-plan-2026-11-22.md)から確認できます。

同日の[写真取り込み高速化の計画・検証と後続課題](../import-performance-2026-11-22.md)は別の変更単位です。

その後の[大きなJPEGの自動取り込み・限定対応と検証](../automatic-large-jpeg-2026-11-22.md)では、長辺制限で拒否される60MP以下のJPEGを原本選択だけで処理します。試作64MPと製品対応範囲を区別します。

無料の世界背景4種類は[地図仕様](MAP_AND_GEO.md)と[計画・検証](../free-world-basemaps-2026-11-22.md)を参照してください。

地図選択の簡素化・hoverと無料高精細画像の調査は[追加計画・検証](../compact-map-layers-2026-11-22.md)を参照してください。

## 読む順序

初参加者はルートの[README](../../README.md)で環境を作り、[CONTRIBUTING](../../CONTRIBUTING.md)と[AGENTS](../../AGENTS.md)で共同開発ルールを確認します。仕様は PRODUCT → ARCHITECTURE → DEVELOPMENT → DATA_MODEL → STORAGE_AND_BACKUP の順に読み、変更対象の機能文書とTESTINGへ進んでください。

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
| [PUBLICATION_REVIEW](PUBLICATION_REVIEW.md) | 独立公開版の選別・公開時の検証記録と残課題 |
| [SAFE_ASSETS](SAFE_ASSETS.md) / [全件CSV](SAFE_ASSETS.csv) | 同梱する23合成fixtureの由来・ハッシュ |
| [第三者通知](../../THIRD_PARTY_NOTICES.md) | MIT本体と第三者ソフトウェア・地図の条件 |
| [GITHUB_PAGES](GITHUB_PAGES.md) | 公開していないPages準備案と確認手順 |

## 正本と承認の区別

- **現在動く仕様の根拠**は各文書からリンクしたソースです。実装との差を見つけたら、コードとテストを確認して仕様書を修正します。
- **製品・保存・通信の承認**は[decisions.md](../decisions.md)と所有者の明示指示に従います。既存コードが承認されたと推測して新しい機能へ拡張しません。
- [constitution.md](../constitution.md)のデータ保護原則は維持します。現行の構造は[ARCHITECTURE](ARCHITECTURE.md)・[DATA_MODEL](DATA_MODEL.md)を参照します。
- 参照元の私有Phase報告/スクリーンショットは公開版に含みません。初版の旧確認HEADは由来の記録、公開後のHEADは本リポジトリ内の確認対象を示します。以下の区分を使い、変更前の基準を変更後の実装HEADと混同しません。

| HEAD | 意味 |
|---|---|
| `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e` | 初版の参照元実装。この独立リポジトリ内のコミットではない |
| `26093c16cec1924c8110efe5f932bd7159a8ca13` | 今回の改善前の基準。関連7仕様の「今回変更の確認基準」はこのHEADを指す |
| `a493c20509dea1654434bf05ac8e8986da846fce` | 6改善・テスト・関連仕様を含む公開リポジトリの実装コミット。今回の統合前照合対象 |

## 更新規則

機能変更と同じ変更単位で該当文書・関連テスト・CHANGELOGを更新します。新しい仕様はこの目次へ登録し、実装ファイルと検証の根拠を付けます。[更新対象の対応表](DEVELOPMENT.md)と[CONTRIBUTING](../../CONTRIBUTING.md)を使用してください。未実装案には「将来案」「未実装」、実測していない内容には「未確認」を付けます。

今回の自動取り込み変更前基準Git HEAD: `22521bdb8e7ea9f944251039d185b221da69c102`

今回の自動取り込み実装・検証の確認元Git HEAD: `9dcef54e80cacc4e2be5d7aa3d0ba395a917d396`

今回の世界背景地図の実装・検証の確認元Git HEAD: `d12df590a808604414a8a4ce6d3a2b02422aadbb`

今回のコンパクト選択の実装・検証の確認元Git HEAD: `c01a34d9e5f3af931305431c5340c2b7b23d79b2`


## 外部APIの資格情報

[保護規則](EXTERNAL_API_CREDENTIALS.md)と[Esri導入準備・接続計画](../esri-key-security-2026-11-22.md)を参照。混入防止は実装済み、Esri接続とPC内中継は未実装。

今回キー保護変更前基準Git HEAD: `5cc666be292b6135b0bf901599279f4ea6db80ae`

今回キー保護実装・検証の確認元Git HEAD: `1d9becaa88a24b5050cd012d5a21f99eadb984c0`


## 現在の航空写真計画

所有者の変更依頼によりEsri世界高画質/キー/中継案を取り下げ、[日本・米国本土のキー不要画像](../regional-imagery-2026-11-22.md)に変更。以前のEsri接続提案は現在の作業計画ではない。資格情報保護は維持する。

今回地域画像変更前基準Git HEAD: `1fdcb271c166a8fed98238bab63f039110290e65`

今回地域画像の実装・検証の確認元Git HEAD: `7199cdc7329960b059946a216bcead6e50d46cbd`


## レイヤーUIの最新変更

[2026-11-23の縮小と×撤去](../smaller-layer-controls-2026-11-23.md)が現在の選択UI。基本4レイヤーと地域画像機能はそのまま。

今回レイヤーUI変更前基準Git HEAD: `cc33039be2a707393a0c21a24bd2f5ead1d00aea`

今回レイヤーUI実装・検証の確認元Git HEAD: `3e2882c6896fb251e199e23ce98f529ce6554d92`

## 地図レイヤーのmain統合確認

[2026-11-23の承認範囲・バックアップ・統合検証](../map-layers-main-integration-2026-11-23.md)。現UI採用と無料4背景/地域画像のローカルmain統合が対象で、Push/公開は含まない。

統合対象の確認元Git HEAD: `ea94e9ba0b153e7472712cd3af3be5fa42523791`


## 「もっと見る」の追加地図

[2026-11-23の追加候補比較・実装](../more-map-layers-2026-11-23.md)：基本4種類の外に鉄道・散策・ダーク。地域/学術テーマの未実装候補と区別する。

今回追加地図変更前基準Git HEAD: `7d24340be57d17bbec6237de5df252fef71bb549`

今回追加地図の実装・検証の確認元Git HEAD: `4b7c4382f05f0cc1fab695c00b4870094ca4c7ab`

## 追加3地図のmain統合確認

[鉄道・散策・ダークと「もっと見る」の承認・統合検証](../more-map-layers-main-integration-2026-11-23.md)。今回の承認はローカルmain統合まで。

統合対象の確認元Git HEAD: `d93490104a84fc8677451338d339188331b5f2ad`
