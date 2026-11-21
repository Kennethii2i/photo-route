# GitHub Pages公開準備（未公開）

## 現状

- ソースは公開済みの[GitHubリポジトリ](https://github.com/Kennethii2i/photo-route)にあり、`main`が既定ブランチ。GitHub PagesのWebアプリは未公開。
- [vite.config.ts](../../vite.config.ts)にbase/outDirの上書きはなく、既定baseは`/`、ビルド出力はdist。
- [CI workflow](../../.github/workflows/ci.yml)は品質検証のみで、Pagesへのデプロイは行わない。
- 製品コード/DB/ZIP/配信先は変更していない。[公開時の確認記録](PUBLICATION_REVIEW.md)の残課題を確認する。

## Viteのbase

ユーザー/Organizationのルートサイトやルート独自ドメインは`/`、プロジェクトサイトは実際のリポジトリ配下パスが必要です。[Vite公式配信ガイド](https://vite.dev/guide/static-deploy)と[base設定](https://vite.dev/config/shared-options.html#base)に従い、未確定の名前をvite.config.tsへ固定しません。

将来の実際の公開ビルドでは、次の実在するCLIを使えます。`BASE_PATH`は実URLから決めます。

```powershell
npm run build -- --base=/実際のリポジトリ名/
```

この例の文字列をそのまま本番設定にしないでください。workflow案では`configure-pages`の`base_path`出力から求めます。`index.html`の開発用`/src/main.ts`はViteが成果物への参照へ変換し、MapLibre workerもビルド対象です。ソースファイルをそのままPagesへ配信する構成ではありません。

## サブパスの検査方法（この公開版では未実施）

参照元では静的サブパス検査がありましたが、今回の公開版でその実行結果を再現したとは扱いません。実際のリポジトリ名が決まったら、専用出力で次を実施してから公開判断します。

```powershell
npx vite build --base=/__pages_probe__/ --outDir .validation/pages-probe
python tools/check_pages_build.py .validation/pages-probe /__pages_probe__/
```

この検査はHTML/workerの資産パス確認で、GitHub Actions/Pagesの実配信、ブラウザ上のサブパス動作、HTTPSでのデータ復元を保証しません。今回は通常のルート用ビルドとローカル合成データでの確認のみです。

## 所有者承認後の設定手順

1. [公開時の確認記録](PUBLICATION_REVIEW.md)の個人情報/画像/ライセンス残課題を確認する。非公開の保全を維持する。
2. 既存の公開リポジトリ名・所有者と実際のPages URLを確認する。審査対象でないブランチ/バックアップ参照を`--all`等で一括Pushしない。
3. ソース公開とWeb公開を別に承認する。GitHubのSettings → PagesでSourceをGitHub Actionsにするのは、その段階の操作。[GitHub公式手順](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)を再確認する。
4. [非稼働workflow案](examples/github-pages.yml.example)をレビューし、承認された場合だけ`.github/workflows/`へコピーする。案は手動起動のみで、mainかつ確認入力trueの場合だけ実行。通常Pushトリガーはない。
5. `.nvmrc`/npm版、依存導入、型検査/ビルド、base、出力distを確認する。Pages environmentの保護と権限を設定し、distだけをアップロードする。リポジトリ全体、ZIP、写真、DB、ログを配信対象にしない。
6. 承認後に実URLを開き、root/プロジェクトパスの再読み込み、JS/CSS/worker、地図/帰属、合成データの保存/復元/ファイル選択を確認する。失敗時に実DBを初期化しない。

案は現時点の公式例で確認したActions参照を固定していますが、未実行です。実際に有効化する時点で参照SHA/対応ランナー/権限を再確認してください。[GitHub custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)に必要権限とartifact/environmentの説明があります。

## HTTPSとデータ移行

ローカルと公開HTTPSは別オリジンで、IndexedDBは自動共有されません。元環境のZIPと元写真を別保管し、空の専用環境で復元確認してから公開側へ移行します。[復旧手順](ERRORS_AND_RECOVERY.md)を参照してください。

**URLのパスはDBの隔離境界ではありません。** 同じ`owner.github.io`の別リポジトリ配下でも同一オリジンです。同じプロファイルで同じDB名を使うと同じ保存領域にアクセスし得ます。プレビュー/本番をパスだけで隔離せず、専用プロファイル/別オリジンを使います。現行DB名は変更していません。[IndexedDBのsame-origin説明](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Basic_Terminology)が根拠です。

クライアントの履歴ルーターはないため、通常の再読み込みは配信されたアプリのURLへ戻ります。存在しない深いパスのルーティング/SPAの404回避を実装済みとはしません。PagesはDBサーバーではなく、ローカル保存の保持保証を追加しません。対応ブラウザのFile System Access、DecompressionStream、WebGL等は公開環境でも別途確認が必要です。

OpenFreeMapの配信方式/HTTPS URLは維持します。GitHub配信時にはGitHubへのアクセス通信も発生し、地図の帰属・プライバシー説明を消しません。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
