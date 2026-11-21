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

`npm ci`の後、`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`を順に実行します。[GitHub ActionsのCI](../../.github/workflows/ci.yml)もPull Requestと`main`へのPushでこの5コマンド、[現在の公開安全性検査](../../tools/check_public_safety.py)、[代表E2E](../../tests/e2e/developer-onboarding.spec.ts)を実行します。全E2Eは標準検証に含めません。CIはUbuntu 24.04、lockfileのPlaywright 1.65.1に対応するChromium headless shell 159.0.8154.6（Playwright revision 1255）を`npx playwright install --with-deps --only-shell chromium`で導入します。ローカルの代表E2Eでは`npx playwright install chromium`を先に実行します。

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

### 現状の区分

| 区分 | 例・判断 |
|---|---|
| 現行仕様で実行できる | `tests/unit/**/*.test.ts`は`npm test`の標準対象。代表E2Eは`developer-onboarding.spec.ts`、`ia-3-1-empty-album.spec.ts`の今回合格した範囲。 |
| 旧仕様に依存 | `ia-2a-trips.spec.ts`と`ia-2b-import.spec.ts`は共通ヘルパーで旧件数文言`0件`を期待し、現行UIの`写真 0枚`と一致せず今回失敗した。`ux-r9-undo.spec.ts`は一般Undo通知・管理画面のUndoボタンを期待する。現在は一般利用者向けUndo UIがないため、現行仕様の標準回帰へ含めない。旧単一所属や旧件数文言を前提にする他の歴史的E2Eも要棚卸し。 |
| 外部環境や追加データが必要 | `camera-local-probe.spec.ts`は`CAMERA_BENCHMARK_FILE`または`PHOTO_PROBE_DIR`、`phase2-integration.spec.ts`の任意テストは`PHOTO_ROUTE_ARCHIVE`を要求する。環境変数なしでは明示的にskipされる。通常の開発検証に実データを渡さない。 |
| 実行結果が未確認 | 上記で実行した範囲以外の多数のE2E、他ブラウザ、全E2E一括実行。ファイルの存在を成功実績として扱わない。 |

## 文書検査

標準ライブラリだけで動く[check_specification.py](../../tools/check_specification.py)を`python tools/check_specification.py`で実行し、内部リンク/ソース参照/HEAD表記を確認します。公開対象には`python tools/check_public_safety.py`、初回公開の由来確認には`python tools/check_public_snapshot.py`を使用します。適用範囲は[DEVELOPMENT](DEVELOPMENT.md)を参照してください。これらは実装の動作保証や秘密情報不存在の証明ではありません。

初回公開準備時の実行結果は[当時の検証記録](PUBLICATION_REVIEW.md)にあります。現在の検証結果とは区別してください。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
