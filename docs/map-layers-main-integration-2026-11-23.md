# 地図レイヤーとUI改善のmain統合確認

## 所有者の承認と対象

2026-11-23に所有者が「このUIで進めましょう。今回の地図レイヤー機能とUI改善を、必要な確認をしたうえでmainに統合してください」と明示指示した。対象は`codex/smaller-layer-controls-20261123`の`ea94e9ba0b153e7472712cd3af3be5fa42523791`、統合前mainは`b3142ba0cefd217ca015f6e8c2236761d6ccfd7e`。祖先関係はmain側0・対象側10コミットでFast-forward可能。

- 標準・航空/衛星写真・地形・淡色の無料4背景。
- 日本GSI、米国本土USGSImageryOnlyのキー不要地域画像と、EOX世界下地。
- hover、60px入口、約304×74pxの選択、×なし、情報アイコンからの詳細/出典。
- 誤ったクライアント設定やGitへの資格情報混入を防ぐ一般ルール/検査。

撤回済みのEsriアカウント・キー・中継・課金は導入しない。学術情報API、別large-photoブランチ、保存API/Domain/Application、DB v3/ZIP v2、JPEG処理、依存定義の変更を含まない。mainとの差分は機能候補で36ファイル。[各変更・ファイル一覧](free-world-basemaps-2026-11-22.md)、[コンパクト化](compact-map-layers-2026-11-22.md)、[地域画像](regional-imagery-2026-11-22.md)、[最新UI](smaller-layer-controls-2026-11-23.md)を参照。

## 分離・バックアップ・統合方法

統合前mainの参照を`codex/backup-main-before-map-layers-20261123`として保存。新しい`codex/integrate-map-layers-20261123`作業ツリーを旧mainから作り、`git merge --ff-only codex/smaller-layer-controls-20261123`で統合候補を再現した。Mainだけが編集/検証/統合を担当し、Reviewerは独立した読み取り確認を行った。

既存Nodeプロセスの作業ディレクトリを値の漏えいがない方法で確認し、稼働中の4つの試用サーバーはすべて別worktree、mainルートで動くNodeはなかった。既存の試用ブラウザ/DB/実写真にはアクセスしていない。最終mainはクリーンな状態・旧HEAD不変・Fast-forward可能性を再確認して、この検証記録を含む統合ブランチへ`--ff-only`で進める。通常merge/rebase/reset、履歴改変、Push、Web公開、試用サーバーの停止は行わない。

## 実行した検証

検証対象の製品コードGit HEAD: `ea94e9ba0b153e7472712cd3af3be5fa42523791`。統合用の別作業ツリーで実行した。

- Node v24.13.0 / npm 11.6.2を確認。package/lock無変更のため、既存の固定依存を再利用しnpm ciの再実行は省略。
- `npm run typecheck`、`npm run lint`、`npm test`、`npm run build`成功。単体23ファイル130件。既存の500kB超チャンク警告のみ。
- 未使用確認済み18295、一時Chromium、合成DB/画像、外部地図は模擬応答。`npx playwright test tests/e2e/free-world-basemaps.spec.ts tests/e2e/developer-onboarding.spec.ts tests/e2e/automatic-large-jpeg.spec.ts --reporter=line`で23件成功（1.2分）。最終UI、地域要求、失敗/再試行、カメラ/選択/DB不変とCI代表の初回操作・JPEG安全回帰を確認。
- `python -m unittest discover -s tools -p test_public_safety.py`：4件成功。
- `python tools/check_public_safety.py`：機能候補448ファイル・登録画像23件・定義した秘密形式0件。追跡対象/通常追加可能なファイルのみ検査し、無視された秘密や実データを読まない。
- `python tools/check_specification.py`：機能候補の文書22・相対リンク403・ソース参照137・Mermaid5、成功。
- 新規10コミットのテキストblob116件に現行の秘密検出を適用し、候補0件。実値を出さず、未知の秘密や画像内部の不存在を証明する検査とは区別する。
- `git diff --check main..HEAD`成功。独立Reviewerはコード/仕様/出典/範囲を照合し、既知制約を超えるP1/P2なし。別の取り込みブランチ混入なしをMainも照合した。

最初のOS待受ポート確認はsandbox内のCIMアクセスで失敗し、読み取り専用の権限付き確認で解消した。テストの失敗やskipによる隠蔽はない。

## 制約・省略・復旧

米国画像はz16、日本はz18が元タイルの上限。地域/時点/精度差とJPEG内の空白、404警告の期限切れ再取得時の見逃し可能性、再選択までの警告保持は既知のまま。前工程の実配信/PC/モバイル確認を維持し、今回は実配信・全世界の画質・実写真・全歴史的E2E・大容量ZIP・DB移行を繰り返していない。GitHub Actions自体はPushしないため未実行で、CIと同じ品質コマンドおよび代表E2Eをローカルで実行した。

追加配信先・画質制約は正式仕様/出典通知へ記載済み。写真/Exifの外部送信、課金・保存/移行の追加はない。バックアップ参照から旧mainコードを参照でき、保存形式の復旧は不要。実際にmainを戻す操作は、その時点の作業状態を確認して所有者の指示の下で行う。今回の承認はローカルmain統合まで。

統合対象の確認元Git HEAD: `ea94e9ba0b153e7472712cd3af3be5fa42523791`
