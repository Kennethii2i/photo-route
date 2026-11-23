# 追加3地図と「もっと見る」のmain統合確認

## 承認と範囲

2026-11-23、所有者がこの構成を採用し、追加3地図と「もっと見る」を必要確認後mainへ統合するよう明示指示した。対象は`codex/more-map-layers-20261123`の`d93490104a84fc8677451338d339188331b5f2ad`。旧mainは`7d24340be57d17bbec6237de5df252fef71bb549`、mainとの差分は2コミット/16ファイルでFast-forward可能。

鉄道・散策・ダークと追加欄、説明/出典の導線が対象。基本4種類と60px入口/304px幅を維持し、配信は既存OpenFreeMap/Mapterhornだけ。保存API、DB v3/ZIP v2、Domain/Application、写真原本、依存、資格情報処理は変更しない。未実装の地域/学術テーマを含めない。[変更ファイル・候補比較・制約](more-map-layers-2026-11-23.md)を参照。

## 分離・復旧

旧mainを`codex/backup-main-before-more-map-layers-20261123`へ保存し、別の`codex/integrate-more-map-layers-20261123`作業ツリーで対象を`--ff-only`統合して検証した。Mainだけが編集/検証/統合を担当。独立Reviewerは読み取りで範囲・コード・仕様を照合し、P1/P2や承認外の混入なしを確認した。

既存試用Nodeは別worktreeで稼働し、mainルートで稼働するNodeがないことを作業ディレクトリだけで確認した。試用サーバー/ブラウザ/実写真/実DBに変更やアクセスを行わない。最終mainは旧HEAD・クリーン状態・バックアップ一致を再確認し、この検証記録を含む統合候補へFast-forwardする。通常merge/rebase/resetや履歴改変を行わず、Push/公開は今回の承認範囲外。保存形式は変わらず移行不要で、必要な復旧はバックアップ参照を基に所有者の指示で行う。

## 検証

製品コードの検証HEADは`d93490104a84fc8677451338d339188331b5f2ad`。別の統合確認worktreeで実行した。

- `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`成功。単体23ファイル133件。既存の500kB超チャンク警告のみ。
- 未使用確認済み18300・一時Chromium・合成写真/専用DB・模擬地図応答で、`npx playwright test tests/e2e/free-world-basemaps.spec.ts tests/e2e/developer-onboarding.spec.ts --reporter=line`：15件成功（1.1分）。基本4/追加3、Moreの無通信展開・focus・小画面/タッチ・失敗/再試行・カメラ/写真/DB保持を確認。
- `python -m unittest discover -s tools -p test_public_safety.py`：4件成功。
- `python tools/check_public_safety.py`：機能候補450件・登録画像23件・定義した秘密形式0件。統合記録を追加した候補も再検査する。
- `python tools/check_specification.py`：機能候補の文書22・相対リンク414・ソース参照137・Mermaid5、成功。統合記録への入口追加後も再検査する。
- `git diff --check main..HEAD`成功。独立ReviewerはP1/P2・承認外混入なしを確認。元の配信先/保存/依存が変わっていないことをMainも差分照合した。
- 検証後は製品コードを変更せず、統合確認文書だけを加えた候補へmainをFast-forwardする。

全歴史的E2E・大容量ZIP・DB移行・実写真の試験は保存/取り込みの変更がないため省略。既存の実配信/画像/UX確認を維持し、今回は繰り返さない。実機タッチ/スクリーンリーダー/全世界の情報網羅は未検証。GitHub Actions自体はPushしないため未実行。Gitのmainと検証候補のtree一致・クリーン状態で最終確認する。

統合対象の確認元Git HEAD: `d93490104a84fc8677451338d339188331b5f2ad`
