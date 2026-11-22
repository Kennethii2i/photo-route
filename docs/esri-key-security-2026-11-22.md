# Esri導入前のキー保護と接続計画

**計画変更：所有者の後続指示でEsri接続・アカウント・キー・PC内中継は取り下げ。現在は[地域限定・キー不要の画像](regional-imagery-2026-11-22.md)を実装する。以下は当時の提案と保護実装の記録で、今から登録やキー作成を求める手順ではない。**

## 依頼・今回の範囲

所有者は2026-11-22にEsri APIの利用を受け入れ、キー等をネットへ公開しないよう必要なルール作成を依頼した。所有者回答時点でアカウントは未作成。無料条件は維持する。今回まずルール・公開検査・Vite環境変数の誤設定防止を実装し、実キーを使う接続は下記の構成承認後に行う。編集担当はMainのみ、Explorerは公式資料の読み取り調査を担当した。

## 実装前の計画

1. [資格情報ルール](specification/EXTERNAL_API_CREDENTIALS.md)とAGENTSへの参照を追加する。
2. 公開安全性検査へEsriトークン形式とEsri/ArcGIS用資格情報の代入検出を追加する。値を検査結果へ表示しない。
3. Viteの公開用環境変数へキーを置く誤設定を、開発・ビルド・preview起動時に拒否する。非公開ファイルをGitから除外するだけでは、クライアントへ埋め込む事故を防げない。
4. 合成値で検出・誤検出・非表示と設定読込を試験し、型/Lint/単体/build/仕様/公開検査を実行する。実キー・実アカウント・既存試用環境を使わない。

## 接続構成の比較と推奨（未承認・未実装）

| 方法 | キーの扱い | 判断 |
|---|---|---|
| ブラウザからEsriへ直接要求 | Git外の設定でも、配布JavaScriptや通信からキーを取得できる | 所有者の非公開条件を満たせないため採用しない |
| PC内限定の中継 | Node側だけでキーを読み、ブラウザへは地図画像と必要な出典だけ返す | ローカル試用の推奨案。既存Viteにサーバー側処理を加えるため構成承認が必要 |
| インターネット公開の中継 | サーバー運用・認証・濫用防止・費用管理が必要 | 今回の範囲外。別途設計と承認が必要 |

推奨案は次の範囲に限定する。

- `127.0.0.1`へ限定したViteのdev/preview中継。非公開の`.env.local`またはプロセス環境の非`VITE_`変数をNode側だけで読む。現在は読込・中継とも未実装。
- Host/Origin/接続元を確認し、固定HTTPS接続先と許可パスのみ、GET・検証済みタイル座標のみ通す。任意URLの中継、LAN公開、外部トンネルは追加しない。
- 認証は上流へのヘッダーのみ。リダイレクト拒否、期限・応答量の上限を設け、認証付きURLや上流エラー本文をブラウザ・ログへ返さない。
- 正規のWorld Imageryを使う。画像の解像度・撮影時期は地域で異なり、全世界一律の画質は保証しない。`Powered by Esri`と実際の提供者出典を表示する。
- 衛星写真を選んだときだけ中継からEsriへ要求する。写真・Exif・名前・所属は送らないが、タイル範囲とIP等はEsriへ伝わる。
- キー未設定・期限切れ・無料枠停止時は説明して安全に失敗し、従来の地図へ戻せる。静的配布物にはキーや中継を含めない。
- DB/ZIP/原本・保存形式は変更しない。復旧は中継設定を無効にして従来のEOX背景へ戻す。既存の試用サーバーとその保存領域は維持する。

## アカウント準備（所有者が行う・未実施）

1. [ArcGIS Location Platform](https://location.arcgis.com/)の無料アカウントを作成する。契約・個人情報入力・利用規約への同意は所有者が行う。
2. [Billing](https://location.arcgis.com/help/billing/)でPay-as-you-goがOFFであることを確認し、無料利用のため決済情報を登録しない。新規アカウントはPAYGが初期OFFで、OFFのまま無料枠を超過するとサービス権限が停止する。アプリ側で課金状態を確認・保証する仕組みはない。
3. 接続構成の承認・実装後、[公式のキー作成手順](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/tutorials/create-an-api-key/)に沿ってPhoto Route専用キーを作る。Basemapsのみ、item accessなし、短い有効期限を選ぶ。実装で確定したローカルURLだけをreferrerに許可する。referrerは秘密保持の代替ではない。
4. キーはチャットへ貼らず、画面共有・スクリーンショットも避けて手元の専用設定へ入力する。現在のアプリにはキー入力欄も、キーを読む接続機能もないため、現時点ではキーの作成を急ぐ必要はない。

## 公式根拠（2026-11-22確認）

- [ブラウザ等で使うAPIキーは取得・再利用され得る](https://architecture.arcgis.com/en/framework/architecture-pillars/security/securing-public-data.html)。
- [資格情報のサーバー側保持を想定したprivate applicationの権限設定](https://doc.arcgis.com/en/arcgis-online/manage-data/add-app-url.htm)。
- [最小権限、短い期限、referrerと利用監視](https://developers.arcgis.com/documentation/security-and-authentication/security-best-practices/)、[キーの変更・再生成](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/api-key-credentials/location-platform/)。
- [公式MapLibreのWorld Imageryタイルと出典の例](https://developers.arcgis.com/maplibre-gl-js/maps/raster-tile-basemaps/display-multiple-basemap-layers/)、[Esriとデータ提供者の帰属要件](https://location.arcgis.com/help/licensing-and-attribution/)。
- [Basemap Stylesの無料枠](https://developers.arcgis.com/rest/basemap-styles/)、[PAYGと枠超過](https://location.arcgis.com/help/billing/)。条件は利用開始時にも再確認する。

## 検証結果

- `npm run typecheck`、`npm run lint`、`npm test`：成功。単体23ファイル129件（新規4件）。
- `npm run build`：成功。既存の500kB超チャンク警告あり。新規設定importの拡張子警告は`.ts`明記で解消した。
- Vite CLIを子プロセスで起動する合成試験：dev/build/previewの3入口で公開用キー設定を拒否し、出力に合成値を含めないことを確認。非公開変数の合成値で通常ビルド成功し、出力ログとdist全ファイルにその値がないことも確認した。実キーは使用していない。
- `python -m unittest discover -s tools -p test_public_safety.py`：4件成功。`python tools/check_public_safety.py`：公開候補446件・登録画像23件・定義した秘密形式0件。`python tools/check_specification.py`：文書22・相対リンク388・ソース参照137・図5、成功。
- `npx playwright test tests/e2e/developer-onboarding.spec.ts --reporter=line`：1件成功（5.3秒）。未使用確認済み18287・隔離Chromium・合成写真/専用DB・外部地図はローカル応答。既存試用環境を利用していない。
- Explorerによる公式調査と独立読み取りレビュー：必須修正なし。「アカウント未作成」は所有者の直近回答を根拠とする。引用付き変数参照を検出する場合がある点は、公開サンプルを空欄だけにする規則と合わせて明記した。
- 全E2E・大容量ZIP・DB移行は、製品UI/保存変更がないため省略。実Esri接続・画質・無料枠停止・アカウント作成・利用規約同意・キー発行・課金設定・公開は未実施。キー保護の補助検査は全秘密の不存在を保証しない。

rootのmainと既存試用サーバーは維持。今回は新しい製品通信・DB/ZIP変更なし。PC内中継の提案を承認済みに変更せず、接続実装へは進んでいない。

変更前基準Git HEAD: `5cc666be292b6135b0bf901599279f4ea6db80ae`

今回キー保護実装・検証の確認元Git HEAD: `1d9becaa88a24b5050cd012d5a21f99eadb984c0`
