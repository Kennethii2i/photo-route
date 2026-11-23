# 追加の地図と「もっと見る」

## 目的・候補比較

所有者は基本4種類以外の追加候補を考え、追加地図を「もっと見る」等から選べるよう依頼した。無料・APIキー不要を維持。Mainが編集し、Explorerが公式データ/条件を調査、独立Reviewerが確認する。

| 優先 | 候補 | 価値・制約 | 判断 |
|---|---|---|---|
| 1 | 鉄道 | 地図に掲載された線路・駅を強調。運行情報や事業者公式路線図ではない | 今回追加、既存OpenFreeMapのみ |
| 2 | 散策 | 地図の歩道・小道・公園と起伏を強調。登録状況に地域差があり、通行可否/案内を保証しない | 今回追加、既存OpenFreeMap/Mapterhorn |
| 3 | ダーク | 暗い背景で写真を見返す。現行styleは施設POIが少ない | 今回追加、既存OpenFreeMapのみ |
| 4 | 色別標高 | 高低を色で理解。日本限定、凡例と海域帰属が必要 | 次候補、既存GSI内の別データ |
| 5 | 過去の航空写真 | 景観・土地利用の変化。日本の地域/年代限定 | 次候補、既存GSI内の別データ |
| 6 | 登録徒歩/自転車ルート | 世界の登録ルートを重ねる | 新しいWaymarked Trailsの送信先/Referer条件の確認と承認後 |
| 7 | 地質図 | 岩相・形成時代。日本限定、凡例が必須 | GSJ配信の稼働確認と新送信先承認後 |

単なるBright色違いは標準と情報差が小さいため今回は追加しない。3Dは操作性と描画負荷が変わるため今回含めない。候補の検討は追加配信/全候補実装の承認と混同しない。

## 実装前の計画

1. 基本4種類の順序/大きさとhover入口を維持。情報アイコンの枠を44px「もっと見る」ボタンへ置き換え、押したときだけ追加3地図・説明/出典を同じパネルに展開する。新しいダイアログ/×/設定画面は増やさない。
2. 追加も背景の排他的な選択とする。基本と追加で同じradio groupを使い、カメラ/写真/検索/アルバム限定・ドラフトを変更しない。追加選択中は「もっと見る」と入口で現在の選択が分かるようにする。
3. hoverだけでは追加欄を展開せず通信しない。明示展開は固定表示とし、キーボードでも追加候補へ到達できる。Escape/入口再クリック/余白で従来どおり一層終了する。情報/追加欄は閉じると折りたたむ。
4. 鉄道/散策は取得したLibertyを深いコピーで変換し、対象の既存レイヤーの色/幅を強調する。元データを増やしたとは説明しない。DarkはOpenFreeMapの公開styleを選択時に取得。散策は既存の標高陰影を再利用し、従来の15秒期限・再試行・ラベル/写真レイヤー再設置を維持。
5. 型/Lint/build、意味のあるstyle変換の単体、基本/追加の開閉・選択・失敗・カメラ/DB不変・PC/モバイルを隔離E2Eで確認。実配信は専用の新しい保存領域で少数表示を確認する。

## 根拠・条件

[OpenFreeMap公式スタイル](https://openfreemap.org/quick_start/)、[公式styleリポジトリ](https://github.com/hyperknot/openfreemap-styles)、[交通データ仕様](https://github.com/openmaptiles/openmaptiles/blob/master/layers/transportation/transportation.yaml)。ExplorerはLiberty/Dark等のJSONを取得し、source/glyph/spriteが既存`tiles.openfreemap.org`内であることを確認した。

地域テーマは[GSI一覧](https://maps.gsi.go.jp/development/ichiran.html)、登録ルートは[Waymarked Trailsヘルプ原文](https://raw.githubusercontent.com/waymarkedtrails/waymarkedtrails-website/master/src/i18n/en-gb/helppages.yaml)、地質は[GSJ公式API](https://gsj-seamless.jp/seamless/v2/api/1.3.1/)を参照。今回は新しい送信先・キー・課金・独自永続キャッシュ・地理検索APIを追加しない。出典は実style/sourceから維持する。

## データ保護・復旧

DB v3/ZIP v2・写真原本・保存API・GPS/日時は無変更。追加の種類と表示はページ内状態だけ。復旧は新3種類と追加欄のUIを戻すだけで保存移行なし。既存main/試用サーバー/実DBを維持する。今回の依頼は新機能開発であり、main統合/Push/公開は別承認。

## 結果

- `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`成功。単体23ファイル133件。最終buildにも型検査を含む。既存の500kB超チャンク警告あり。
- 最初の型確認でHTML hiddenのboolean/文字列union、単体fixtureのlayer unionの型エラーを検出して修正。製品/試験の型を緩めず解消した。
- 未使用18297・隔離Chromium・合成写真/DB・模擬地図応答で、`npx playwright test tests/e2e/free-world-basemaps.spec.ts tests/e2e/developer-onboarding.spec.ts --reporter=line`：15件成功（1.1分）。
- 一覧説明の短文化後、`--grep 'more preserves|more remains|middle-width|mouse hover'`で関連4件再実行成功（17.4秒）。320×568で情報/出典ボタンがパネル内に収まり、44px以上であることも確認。実機タッチ/スクリーンリーダーは未検証。
- 実配信スモーク：新規専用Chromium、写真0件、東京周辺/高尾周辺で鉄道・散策・Darkを各ready確認。JavaScript実行時エラー0、アプリ障害表示なし。要求hostはOpenFreeMap/Mapterhornのみ。1440×900と320×568の実画面と追加欄を確認した。ライブの写真選択リングは未確認（合成DBでは選択/カメラ/DB不変をE2E確認）。
- `python tools/check_public_safety.py`：公開候補450件・登録画像23件・定義した秘密形式0件。`python tools/check_specification.py`：文書22・相対リンク414・ソース参照137・Mermaid5、成功。`git diff --check`成功。
- 独立Explorerが公式styleと候補条件を比較し、Reviewer/UX Auditorが差分と画像を読み取り確認。必須指摘なし。短文化前は小画面の情報欄にスクロールが必要だったため改善した。
- 全歴史的E2E、大容量ZIP、DB移行、全世界のデータ網羅確認は変更範囲外のため省略。配信条件・時点・精度の将来継続を保証しない。
- Previewは18298、起動時PID26376。既存試用/mainを維持。別ポートのため既存写真は自動では表示されない。main統合/Push/公開は未実施。

変更ファイル：`src/infrastructure/basemap.ts`、`src/presentation/basemap-control.ts`、`src/presentation/map.ts`、`src/presentation/layout.ts`、`src/style.css`、関連unit/E2E、正式FEATURES/MAP_AND_GEO/UI_UX/SECURITY_PRIVACY/TESTING/CHANGELOG/INDEX、THIRD_PARTY_NOTICESと本文書。

候補のWaymarked Trailsは公式のReferer/キャッシュ条件と新送信先承認が必要で未導入。地質APIは稼働と凡例の確認前。今回の追加3種類にそれらの実データが含まれるとは表示しない。

変更前基準Git HEAD: `7d24340be57d17bbec6237de5df252fef71bb549`
