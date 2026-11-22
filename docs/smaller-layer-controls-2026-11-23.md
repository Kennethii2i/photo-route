# レイヤー入口・選択パネルの縮小

## 依頼と変更

所有者は既存レイヤー機能に満足しており、入口と選択パネルをさらに小さくし、×を外して見やすくするよう依頼した。MainがUIのみ編集し、独立したUX読み取り確認を依頼。背景画像・配信・カメラ・写真/アルバム・保存APIは変更しない。

- 入口は76px級から60px角へ。見本48×32と「レイヤー」を残す。
- パネルは幅396から304pxへ。4種類の見本44×32と短名、選択枠を横並びにする。通常時の余分な行と×を撤去。
- 「詳細・出典」は同じ行の情報アイコンへ。44×44pxのsummaryとアクセシブル名/titleを持たせ、説明と実際の地図出典は必要時に展開する。
- hoverで展開し、移動で終了。クリックで固定し、入口の再クリック/余白/Escapeで閉じる。タッチは入口をタップし、同じ入口の再タップか余白で閉じる。閉じる際のフォーカス・再展開抑制を維持。
- 背景を不透明な白にして地図文字の透けを避ける。選択ラベルは44px以上の操作領域を維持。アルバム限定バナーの余白も入口の新しい高さへ合わせる。

## ファイル

`src/presentation/basemap-control.ts`、`src/style.css`、`tests/e2e/free-world-basemaps.spec.ts`、正式UI/TESTING/CHANGELOG/INDEXと本文書。

## 検証

- `npm run typecheck`、`npm run lint`、`npm run build`：成功。最終buildにも型検査を含む。既存の500kB超チャンク警告のみ。
- 未使用18292、一時Chromium、合成DB、模擬外部応答で`npx playwright test tests/e2e/free-world-basemaps.spec.ts tests/e2e/developer-onboarding.spec.ts --reporter=line`を実行。初回13件中12件成功、1件はパネル高さが89pxで縮小目標82px以下に届かず失敗。共通labelの上下marginが残っていたため、対象カードだけmargin:0へ修正した。
- 修正後、`--grep 'mouse hover|layer controls fit|middle-width|touch opens'`で関連4件を再実行し4件成功（14.4秒）。通常パネルは約304×74px、モバイル320pxでは300px幅。入口60×60、×なし、44px情報領域、Enterで情報の開閉、hover/pin/Escape/入口再click/タッチ、詳細/写真プレビュー/バナーとの位置関係を確認。期待値を緩めていない。
- 1440/390/320幅と320×568の画像を確認し、独立UX Auditorも差分・画像を読み取り確認。必須指摘なし。
- `python tools/check_specification.py`：文書22・相対リンク403・ソース参照137・Mermaid5、成功。`python tools/check_public_safety.py`：公開候補448件・登録画像23件・定義した秘密形式0件。`git diff --check`成功。通常単体・全E2E・大容量ZIP・移行・実配信の反復はUIのみの変更のため省略。
- 新previewは127.0.0.1:18293、起動時PID14464。既存18290と旧試用は維持し、既存の写真/DBへアクセスしていない。別オリジンなので旧試用データを自動移動しない。

通信先・DB v3/ZIP v2・元写真は変更なし。復旧はこのUI差分を戻すだけでデータ移行不要。既存サーバーとmainは維持し、Push/統合/公開は行わない。

変更前基準Git HEAD: `cc33039be2a707393a0c21a24bd2f5ead1d00aea`

今回レイヤーUI実装・検証の確認元Git HEAD: `3e2882c6896fb251e199e23ce98f529ce6554d92`
