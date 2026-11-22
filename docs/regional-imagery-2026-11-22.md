# キー不要の地域航空写真：変更計画と検証

## 所有者指示と範囲

2026-11-22の所有者は世界の高画質航空写真をEsriで導入する計画を取り下げ、日本・米国のようにAPIキーなしで高画質画像を利用できる場所に限定した実装へ変更した。Esri登録・キー作成・課金・PC内中継は今回の計画から外す。既存の資格情報保護規則・検査は一般的な事故防止として残す。Mainが編集し、Explorerは公式提供条件、Reviewerは差分を読み取り確認する。

## 実装前の計画

1. 基本4種類とhover選択を維持する。航空・衛星写真の中で、拡大時に日本/米国本土の航空写真を自動で重ねる。地域用の設定画面・キー入力・サーバーを追加しない。
2. 世界の下地は従来のEOX2016を維持。日本は地理院seamlessphoto、米国本土はUSGSImageryOnlyの公式キャッシュを採用する。米国のキャッシュはz16より上の実画像がなく、単にmaxzoomを増やす方法は採用しない。NAIP動的配信は実画像取得がtimeout/504で確認できず、今回は見送る。高精細さより確実な表示を優先し、米国と日本の差を説明する。
3. 地理院はz14–18、USGSはz14–16、256pxとし、縮尺とboundsで対象要求を限定する。日本の矩形[122,20,154,46]、米国本土[-125,24,-66,50]は要求を絞る範囲で、実際の高精細画像の存在や国境を保証する境界ではない。海外領域・アラスカ・ハワイへの拡張は今回行わない。
4. 下地→地域画像→地名/施設ラベル→写真表示の順とする。欠損・404・通信失敗で全地図を消さず、取得済み画像/世界下地を残して一部取得不可を案内する。背景切替や再選択で再試行できる。404/通信失敗では下地が見えるが、JPEG画像内の海面/黒いno-dataは自動透過しない。この制約も説明する。
5. 地図の出典とUI内の通信説明を更新する。地理院リンクとGRUS画像（© Axelspace）、USGS/USDA/The National Mapの帰属を維持する。画像の時点・精度・欠損・サービス稼働は保証しない。
6. 合成応答の単体/E2Eで、地域/縮尺外の無要求、ラベル順、正常表示、404時の世界下地維持、再選択回復、カメラ/選択/DB不変を確認する。別ポートと隔離ブラウザで実サービスの少数表示も確認する。実写真/実DBを使わない。

## 配信条件と新しい通信

- 日本：`cyberjapandata.gsi.go.jp`。公式[タイル一覧](https://maps.gsi.go.jp/development/ichiran.html#seamlessphoto)のXYZ JPEGを利用。z14–18はシームレス空中写真で、地域によって衛星画像等を含む。[コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)と個別の第三者クレジットに従う。画像加工や同梱・再配布を追加しない。
- 米国本土：`basemap.nationalmap.gov`の[USGSImageryOnly](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer)。公式説明は主に1m級NAIPほか、画像によって解像度・年が異なる。256px・EPSG3857の公開キャッシュを無認証でGETし、米国本土の矩形に限定する。原データの解像度と配信タイルの精細さを同一視しない。z16はDC付近で約1.9m/表示pxとなる。z16より上は拡大表示。大量取得・exportTiles・独自永続キャッシュは追加しない。
- [USGS配信FAQ](https://www.usgs.gov/faqs/what-are-urls-imagery-services-national-map-and-are-they-cached-or-dynamic)はキャッシュ/動的表示を案内。`arcgis/rest`はUSGSの配信ソフトウェアのパスであり、Esri商用World Imageryへ接続する計画ではない。
- 航空・衛星写真を選択し、対象範囲/縮尺を閲覧したときだけ新しいホストへGETする。閲覧範囲・IP等は配信先へ伝わり得る。写真・Exif・名前・所属を送らない。利用者アカウント/認証情報は付加しない。

## 変更ファイル

- 実装：`src/infrastructure/basemap.ts`、`src/presentation/map.ts`、`src/presentation/basemap-control.ts`、`src/presentation/layout.ts`。
- 試験：`tests/unit/basemap.test.ts`、`tests/e2e/free-world-basemaps.spec.ts`。
- 現行仕様：`docs/specification/MAP_AND_GEO.md`、`UI_UX.md`、`SECURITY_PRIVACY.md`、`TESTING.md`、`CHANGELOG.md`、`INDEX.md`、`DEVELOPMENT.md`、`EXTERNAL_API_CREDENTIALS.md`。
- 出典/判断：`THIRD_PARTY_NOTICES.md`、`docs/decisions.md`、取り下げを明示した`docs/esri-key-security-2026-11-22.md`、本文書。

## 安全性・復旧

DB v3、ZIP v2、写真/アルバム/カメラの意味は変更しない。地域配信が停止した場合は従来の地図を選べる。実装の復旧は地域source/layerの追加を外してEOX単独へ戻す。既存サーバー・試用データ・mainは維持し、Push/公開/統合は含めない。

## 検証結果

- 最終`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`：すべて成功。単体23ファイル130件。buildは既存の500kB超チャンク警告のみ。
- 最終`PHOTO_ROUTE_TEST_BROWSER=chromium`・`PHOTO_ROUTE_TEST_PORT=18289`で`npx playwright test tests/e2e/free-world-basemaps.spec.ts tests/e2e/developer-onboarding.spec.ts --reporter=line`：13件成功（1.3分）。既存試用ポートとは分離し、模擬外部応答/合成DBだけで確認した。
- `python -m unittest discover -s tools -p test_public_safety.py`：4件成功。`python tools/check_public_safety.py`：公開候補447件/登録画像23件/定義した秘密形式0件。`python tools/check_specification.py`：文書22・相対リンク398・ソース参照137・Mermaid5、成功。`git diff --check`成功。
- ローカル保存先は`codex/regional-imagery-20261122`。新規previewは18290（起動時PID16552）。既存18280/18283は停止/変更していない。別ポートのため以前の試用データは新previewに自動表示されない。main統合/Push/公開は行っていない。
- 実配信スモーク：未使用確認済み18290、専用の新規Chromium保存領域、旅行/写真0件で東京z18とWashington DC z17を表示。GSI画像応答12件、USGS画像応答4件、各ready。JavaScript実行時エラー0。配信hostはOpenFreeMap/EOX/GSI/USGSの4ホストだけ。撮影画像・Exif・実DBを使用していない。1440×900と320×568の画像・出典・選択UIを確認した。原画像を公開ソースへ同梱しない。
- 途中の404E2Eが案内未表示で失敗。MapLibre6.18は404をerrorイベントへ流さないため、sourceイベントで渡されるtile状態を終端時に確認して案内するよう修正。成功/中断/切替/offでは参照を解放する。404用routeが共通の要求記録を上書きするため専用counterも追加し、404と再試行の1件が成功した。
- 地域移動試験の途中で、jumpTo直後のareTilesLoadedが前フレームの状態を返し、古い地域要求の到着を新地域要求と誤認した。新しいidleを待つよう修正し、期待値は緩めていない。
- 途中のLintは無視対象の検証用mjsにも適用されて失敗。自分が作成した検証スクリプトだけを同じ無視ディレクトリ内のtxt記録へ変更し、製品Lintの対象やルールは変更していない。
- Explorer/Reviewerの独立読み取り確認：必須修正なし。警告は別地域へ動いた後も再試行/再選択まで保持する。期限切れによる自動再取得だけが404になる場合、MapLibreがdataloadingを出さず案内を見逃す可能性は未検証・未対応。初回取得と明示再試行は対象試験で確認する。
- 全E2E/大容量ZIP/DB移行/実写真試験は保存の変更がないため省略。全日本/全米国の網羅・常時高画質・常時最新・配信SLAは保証しない。

事前Explorerの少数HTTP確認ではGSI東京z18とUSGS DC z16がJPEG/HTTP200/CORS *、USGS z17/18は404。USGS NAIP Imagery動的表示はtimeout/504、NAIPPlusは応答例があるものの安定性/条件を広げるため今回は採用しない。

変更前基準Git HEAD: `1fdcb271c166a8fed98238bab63f039110290e65`
