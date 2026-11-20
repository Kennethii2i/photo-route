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

## 隔離E2E

```powershell
$env:PHOTO_ROUTE_TEST_PORT='18194'
npx playwright test tests/e2e/ux-w1.spec.ts tests/e2e/ux-w2.spec.ts --reporter=line
```

ポートは実行前に未使用を確認し、利用中のサーバーを再利用しません。設定は5173を拒否、workers=1、reuseExistingServer=false。既定は5184、Chromeチャンネルの一時プロファイルです。`PHOTO_ROUTE_TEST_BROWSER`はchrome/edge/firefox/webkitを選べますが、各環境の導入/動作確認は別途必要です。

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

## 文書検査

標準ライブラリだけで動く[check_specification.py](../../tools/check_specification.py)を`python tools/check_specification.py`で実行し、内部リンク/ソース参照/HEAD表記を確認します。[公開履歴検査](PUBLICATION_REVIEW.md)は別工程です。これらは実装の動作保証や秘密情報不存在の証明ではありません。

この公開準備版の実行結果は[公開準備の検証記録](PUBLICATION_REVIEW.md)にまとめます。公開準備の最小検証と、未実行の試験を分けて記録します。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
