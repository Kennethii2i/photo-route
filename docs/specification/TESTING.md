# テストと検証

## 実在するコマンド

根拠: [package.json](../../package.json)、[vite.config.ts](../../vite.config.ts)、[playwright.config.ts](../../playwright.config.ts)、[tsconfig.json](../../tsconfig.json)。

| コマンド | 対象 |
|---|---|
| `npm run typecheck` | src/spikes/tests/設定のTypeScript strict型検査 |
| `npm run lint` | ESLint |
| `npm test` | Vitest、`tests/unit/**/*.test.ts` |
| `npm run build` | `tsc --noEmit && vite build`、既定出力dist |
| `npm run test:e2e` | tests/e2eのPlaywright。全実行を毎回の既定にしない |
| `npm run fixtures:check` | Pythonによる基本合成画像/manifest検査 |
| `npm run fixtures:check:heif` | 固定したPython環境でのHEIF検査 |

## 新規クローンでの標準検証

`npm ci`の後、`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`を順に実行します。[GitHub ActionsのCI](../../.github/workflows/ci.yml)もPull Requestと`main`へのPushでこの5コマンド、[現在の公開安全性検査](../../tools/check_public_safety.py)、[初回操作](../../tests/e2e/developer-onboarding.spec.ts)と[自動JPEG取り込み](../../tests/e2e/automatic-large-jpeg.spec.ts)の代表E2Eを実行します。全E2Eは標準検証に含めません。CIはUbuntu 24.04、lockfileのPlaywright 1.65.1に対応するChromium headless shell 159.0.8154.6（Playwright revision 1255）を`npx playwright install --with-deps --only-shell chromium`で導入します。ローカルの代表E2Eでは`npx playwright install chromium`を先に実行します。

## 隔離E2E

```powershell
$env:PHOTO_ROUTE_TEST_PORT='18194'
$env:PHOTO_ROUTE_TEST_BROWSER='chromium'
npx playwright test tests/e2e/developer-onboarding.spec.ts --reporter=line
```

ポートは実行前に未使用を確認し、利用中のサーバーを再利用しません。設定は5173を拒否、workers=1、reuseExistingServer=false。既定は5184、Chromeチャンネルの一時プロファイルです。`PHOTO_ROUTE_TEST_BROWSER=chromium`ではPlaywrightが導入した隔離Chromiumを使います。chrome/edge/firefox/webkitも選べますが、各環境の導入/動作確認は別途必要です。macOS/Linuxでは`PHOTO_ROUTE_TEST_BROWSER=chromium PHOTO_ROUTE_TEST_PORT=18194 npx playwright test tests/e2e/developer-onboarding.spec.ts --reporter=line`です。

合成データとテストが作ったDBだけを使い、通常Chrome/試用プロファイル/実DB/実ZIPは使用しません。外部地図要求は試験のrouteでローカル応答または遮断します。全テストが同じ通信方針かは試験ファイルを確認します。実地図での表示確認は別に明記します。

## 変更による試験選択

| 変更 | 必要な確認 |
|---|---|
| CSS/文言/小さな配置 | 型チェック・ビルド、対象UI 2〜3件、PC/390/320の画像/ヒット領域/キーボード |
| 選択/カメラ/閉じる | ズーム不変、必要パン、連続操作、戻り先、未保存/結果不明、クラスタ直接操作との区別 |
| 所属API/競合/Undo | 期待状態比較、全件拒否/全件確定、他アルバム保持、同一Trip、operationId、旧履歴、安全な内部Undo |
| DB版/モデル | 新規/旧版移行、不正参照、abort/容量失敗/blocked、再オープン、全保存値の不変、旧履歴、他タブ |
| ZIP/復元 | v1互換、v2往復、ID再割当て、ごみ箱リンク、不正/破損/サイズ/中断、DB無変更。上限/性能変更時だけ大容量を追加 |
| 画像処理 | 署名/寸法/バイト上限、向き、GPS/日時の根拠、部分成功、複数形式、ブラウザ復号差 |

保存処理を触らないUI変更で全E2Eや5000枚ZIPを繰り返しません。一方、保存ロジックへ影響が広がったら、理由を示して必要な回帰範囲を広げます。失敗原因を分類し、原因を直してから失敗対象を再実行します。期待値だけで成功扱いしたり、無条件skipで隠しません。

## テストの由来と現在の証拠

過去の私有検証報告とスクリーンショットは公開版に含めません。[RC-1データ保護テスト](../../tests/e2e/rc1-data-protection.spec.ts)、[V4.1](../../tests/e2e/ux-v41.spec.ts)、[V4.2](../../tests/e2e/ux-v42.spec.ts)、[W1](../../tests/e2e/ux-w1.spec.ts)・[W2](../../tests/e2e/ux-w2.spec.ts)等のテストコードは保持しています。存在することと今回合格したことを区別します。

一般Undo、旧単一所属、ズーム17への自動移動、旧件数文言等を前提にする歴史的E2Eも残っています。全旧テストが現在のUI仕様へ更新済みとは保証しません。実行前に目的を棚卸しし、新仕様で同等以上の検証へ置換します。旧DB/ZIPの互換確認は残します。テスト出力先のspecs/は生成物としてGit対象外です。任意の実写真/私有ZIPを使うテストに環境変数を設定しないでください。通常の確認は同梱の合成fixtureだけを使います。

### 仕様初版の整理時点の区分

以下の「今回」は仕様初版を整理した当時の実行記録を指します。2026-11-22の対象E2E32件の実行結果とは分け、後掲の追加回帰と[改善計画・結果](../improvement-plan-2026-11-22.md)で今回の成功・未実行範囲を確認してください。

| 区分 | 例・判断 |
|---|---|
| 現行仕様で実行できる | `tests/unit/**/*.test.ts`は`npm test`の標準対象。代表E2Eは`developer-onboarding.spec.ts`、`ia-3-1-empty-album.spec.ts`の今回合格した範囲。 |
| 旧仕様に依存 | `ia-2a-trips.spec.ts`と`ia-2b-import.spec.ts`は共通ヘルパーで旧件数文言`0件`を期待し、現行UIの`写真 0枚`と一致せず今回失敗した。`ux-r9-undo.spec.ts`は一般Undo通知・管理画面のUndoボタンを期待する。現在は一般利用者向けUndo UIがないため、現行仕様の標準回帰へ含めない。旧単一所属や旧件数文言を前提にする他の歴史的E2Eも要棚卸し。 |
| 外部環境や追加データが必要 | `camera-local-probe.spec.ts`は`CAMERA_BENCHMARK_FILE`または`PHOTO_PROBE_DIR`、`phase2-integration.spec.ts`の任意テストは`PHOTO_ROUTE_ARCHIVE`を要求する。環境変数なしでは明示的にskipされる。通常の開発検証に実データを渡さない。 |
| 実行結果が未確認 | 上記で実行した範囲以外の多数のE2E、他ブラウザ、全E2E一括実行。ファイルの存在を成功実績として扱わない。 |

## 文書検査

標準ライブラリだけで動く[check_specification.py](../../tools/check_specification.py)を`python tools/check_specification.py`で実行し、内部リンク/ソース参照/HEAD表記を確認します。公開対象には`python tools/check_public_safety.py`、初回公開の由来確認には`python tools/check_public_snapshot.py`を使用します。適用範囲は[DEVELOPMENT](DEVELOPMENT.md)を参照してください。これらは実装の動作保証や秘密情報不存在の証明ではありません。

初回公開準備時の実行結果は[当時の検証記録](PUBLICATION_REVIEW.md)にあります。現在の検証結果とは区別してください。

## 2026-11-22 安全性・操作性の追加回帰

[単体試験](../../tests/unit/safety-ux.test.ts)は補正の送信項目別同期/保存中追加入力、ZIP件数境界と各上限、重複結果の一回計上、進捗保存失敗後の非完了を検証します。[追加E2E](../../tests/e2e/safety-ux-improvements.spec.ts)は2接続の編集競合、異なる補正欄の両立、recovery追加失敗時の本体/履歴ロールバック、競合の明示的基準採用と遅延応答、仮想Tab窓越え/resize/範囲外、PC1440/390/320の案内を対象にします。画像出力は`test-results/safety-ux/`で、合成データのみです。

[中断試験](../../tests/e2e/phase4-interruption.spec.ts)は生存Tripを明示作成し、null拒否でjob/Photoを作らない試験も持ちます。context単位で外部通信を遮断し、再作成ページも含めます。再起動後のrunning→interruptedはAPIを明示実行する検証で、自動起動処理の保証ではありません。

これらは現行仕様の対象試験です。今回実行済みのコマンド/件数と未実行範囲は[改善計画・結果](../improvement-plan-2026-11-22.md)に記録します。

今回変更の確認基準Git HEAD: `26093c16cec1924c8110efe5f932bd7159a8ca13`

## 2026-11-22 取り込み並行準備の検証

[単体試験](../../tests/unit/import-pipeline.test.ts)は最大2件の固定窓、入力/復号予算の待機と解放、順序、同一バッチ重複と先行保存失敗、他旅行コピー、中断、Job/通知失敗を検証します。[E2E](../../tests/e2e/import-pipeline.spec.ts)はJPEG/PNG/WebP、80MPとHEIC/HEIFの部分成功、GPS/日時/向き・サムネイルバイト列の逐次/並行一致、Photo/Thumbnail書込失敗の原子性、他接続の重複/Trip削除を確認します。既存の中断E2Eと代表onboardingも合わせて実行します。

任意の性能比較は、Pillowを利用できるPython環境で`python tools/generate_import_benchmark.py`を実行し、Playwright Chromium導入後に`node tools/benchmark_import.mjs`を使います。既定は合成48枚・3回、専用ポート18262です。PowerShellでは`$env:PHOTO_ROUTE_BENCH_COUNT='650'; $env:PHOTO_ROUTE_BENCH_ROUNDS='1'`で650枚の比較を選べます。ポートは未使用を確認し、必要なら`PHOTO_ROUTE_BENCH_PORT`を変えます。macOS/Linuxでは同名環境変数をコマンド前に設定します。

入力は生成された`coverage/import-benchmark-24mp.jpg`のみ、出力は枚数・日時・UUIDを含む`coverage/import-benchmark-*.json`です。排他的に新規作成し、以前の計測結果を上書きしません。実写真・既存DBを渡す経路を使いません。毎回専用DBを作り、ブラウザ/サーバーは終了時に閉じます。合成画像の画素は共通、ハッシュはCOMコメントで変えているため、多様な実写真の性能・メモリーピークの保証ではありません。CIへ性能時間の固定閾値は追加しません。

[計画・実行結果・未確認事項](../import-performance-2026-11-22.md)。

今回の変更前基準Git HEAD: `4ad902d6adef8c3d1b72e7d44063a25f74e2dd4e`

## 2026-11-22 自動JPEG経路の検証

[構造/Worker単体試験](../../tests/unit/automatic-jpeg.test.ts)と[調整処理単体試験](../../tests/unit/automatic-jpeg-import.test.ts)は、元のガード維持、TIFF循環/範囲外、元メタデータ、返却検証、予算排他、転送後の元SHA/バイト数、重複、中断、timeout/通信異常、保存直前照会中の停止、fatal＋Job/通知失敗を検証します。従来の[中断試験](../../tests/unit/import-pipeline.test.ts)では、保存未開始時は中断を尊重し、開始済み保存は残ることを分けます。

[自動JPEG E2E](../../tests/e2e/automatic-large-jpeg.spec.ts)はブラウザCanvas生成の48MP実画像8向き、60MP/64MP境界、SHA/Exif保持、512pxの色/寸法、ZIP往復、原本だけを選ぶUI、過大coded/display/visibleRect、能力不足、不正構造、timeout/中断/進捗失敗を検証します。不正構造の試験ではnative機能照会へ到達したら異常応答を返し、単なるfailedと区別します。CIにも同じ試験を追加し、新しい合成画像バイナリーやPython依存は導入しません。

PowerShellで代表2ファイルを実行する例は、未使用ポートを指定して`$env:PHOTO_ROUTE_TEST_BROWSER='chromium'; $env:PHOTO_ROUTE_TEST_PORT='18266'; npx playwright test tests/e2e/developer-onboarding.spec.ts tests/e2e/automatic-large-jpeg.spec.ts --reporter=line`です。通常Chromeを操作せず、専用の一時プロファイルを使います。UI画像は1440/390/320で`test-results/automatic-jpeg/`へ出力します。

[検証記録](../automatic-large-jpeg-2026-11-22.md)に実行件数・ブラウザ版・nativeメモリー実測と限界を記録します。返却サイズ検査やWorker terminateを内部メモリーのハード上限とは扱いません。DB/ZIP版は変更しないため、全移行/大量ZIP/全歴史的E2Eは今回繰り返しません。

今回の自動取り込み変更前基準Git HEAD: `22521bdb8e7ea9f944251039d185b221da69c102`

今回の自動取り込み実装・検証の確認元Git HEAD: `9dcef54e80cacc4e2be5d7aa3d0ba395a917d396`

## 2026-11-22 世界背景地図の試験

[単体](../../tests/unit/basemap.test.ts)は固定配信先・EOX2016版/出典・地形とラベルの順序・入力スタイル非変更・カメラ設定排除・日付変更線の表示境界を確認する。[対象E2E](../../tests/e2e/free-world-basemaps.spec.ts)は外部通信を模擬応答し、4種類/写真選択/検索/カメラ/DB全レコード不変・アルバム限定維持・切替連打/失敗/再試行・PC1440/390/320とキーボードを確認する。代表onboardingも実行する。

実地図のスモークと模擬応答の結果、実行コマンド・失敗と修正・省略・未確認は[計画と検証](../free-world-basemaps-2026-11-22.md)に記録する。DB/ZIP変更がないため全移行・大量ZIP・全歴史的E2Eは繰り返さない。

今回の背景地図変更前基準Git HEAD: `b3142ba0cefd217ca015f6e8c2236761d6ccfd7e`

今回の世界背景地図の実装・検証の確認元Git HEAD: `d12df590a808604414a8a4ce6d3a2b02422aadbb`

## 2026-11-22 コンパクト選択の追加回帰

[地図E2E](../../tests/e2e/free-world-basemaps.spec.ts)にmouse hoverでの無選択/無通信/焦点維持、隙間の移動、mouseleave、クリック固定、Escape後の再展開抑制、低画面で入口へ重なった場合、タッチを追加。旧カードの左端座標だけの試験は、実際の矩形非重複とradioの実ヒット判定へ更新する。模擬応答/合成写真だけを使い、代表onboardingを合わせる。[実行記録](../compact-map-layers-2026-11-22.md)。

今回のコンパクト選択変更前基準Git HEAD: `444c94ca55798292a9e0abc6faf694bf7509d6b4`

今回のコンパクト選択の実装・検証の確認元Git HEAD: `c01a34d9e5f3af931305431c5340c2b7b23d79b2`


## 2026-11-22 資格情報の混入防止

[Python検出回帰](../../tools/test_public_safety.py)は`python -m unittest discover -s tools -p test_public_safety.py`で実行。Esriの既知形式、引用有無の資格情報代入、空欄・コード参照、既存GitHubキー検出、検出結果に実値を返さないことを合成値で確認する。CIにも追加。

[Vite保護の単体](../../tests/unit/public-env-policy.test.ts)は通常の`npm test`に含む。公開用変数の拒否、無関係な設定/非公開変数の許可、一時ディレクトリの`.env.local`と変数展開、エラーの非表示を合成値で確認する。実際のEsri接続・課金・実キー検査は対象外。

今回キー保護変更前基準Git HEAD: `5cc666be292b6135b0bf901599279f4ea6db80ae`

今回キー保護実装・検証の確認元Git HEAD: `1d9becaa88a24b5050cd012d5a21f99eadb984c0`


## 2026-11-22 地域画像の検証

[basemap単体](../../tests/unit/basemap.test.ts)でbounds・min/maxzoom・供給URL・出典・レイヤー順・他背景からの除外を確認。[地図E2E](../../tests/e2e/free-world-basemaps.spec.ts)に対象地域/縮尺でのみ要求すること、native上限以上を要求しないこと、認証なし、対象外の無要求、地域404でもEOXを残して再試行、DB/カメラ不変を追加。外部は模擬応答。実配信/画質の少数確認は[実行記録](../regional-imagery-2026-11-22.md)で区別する。

今回地域画像変更前基準Git HEAD: `1fdcb271c166a8fed98238bab63f039110290e65`

今回地域画像の実装・検証の確認元Git HEAD: `7199cdc7329960b059946a216bcead6e50d46cbd`


## 2026-11-23 レイヤーUI縮小の回帰

[地図E2E](../../tests/e2e/free-world-basemaps.spec.ts)の×終了を入口の再クリック/再タップへ更新。入口60px、通常パネル幅304px以下/高さ82px以下、×なし、情報summaryの44px領域とアクセシブル名を確認。既存のhover/固定/Escape/地図余白/PC・モバイル/低画面/ヒット領域/出典/地域画像/DB不変の試験を保持する。実行結果と省略は[記録](../smaller-layer-controls-2026-11-23.md)を参照。

今回レイヤーUI変更前基準Git HEAD: `cc33039be2a707393a0c21a24bd2f5ead1d00aea`
