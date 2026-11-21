# 開発への参加

Photo Routeのソースは[GitHubで公開](https://github.com/Kennethii2i/photo-route)されています。WebアプリのGitHub Pages公開は別工程で、現在は行っていません。本体は[MIT](LICENSE)、第三者の条件は[通知文書](THIRD_PARTY_NOTICES.md)を参照してください。

初参加者は[README](README.md)で起動し、[AGENTS](AGENTS.md)のデータ保護ルール、[正式仕様INDEX](docs/specification/INDEX.md)、[DEVELOPMENT](docs/specification/DEVELOPMENT.md)、[TESTING](docs/specification/TESTING.md)を順に確認してください。変更する機能の仕様も読んでください。

## 標準フロー

GitHub `main` → ローカルClone/Pull → 作業ブランチ → Codexまたはエディタで実装 → ローカル検証 → Commit/Push → Pull Request → CI確認 → レビュー → `main`統合、の順です。Push、PR作成、統合、Web公開はそれぞれ作業者・所有者の権限と指示に従います。AIエージェントには[AGENTS](AGENTS.md)の明示指示が適用されます。

Node.js 24.13.0、npm 11.6.2、Gitを準備し、リポジトリルートで以下を実行します。Windows PowerShellとmacOS/Linuxのターミナルで同じGit/npmコマンドを使えます。

```text
git clone https://github.com/Kennethii2i/photo-route.git
cd photo-route
npm ci
git switch -c feat/short-description
npm run dev -- --host 127.0.0.1 --port 18194 --strictPort
```

作業を始める前に`git status --short --branch`、`git remote -v`、`git worktree list`を確認します。すでにクローン済みなら、クリーンな`main`で`git pull --ff-only origin main`を行い、専用ブランチを作ります。未コミット変更や稼働中サーバーの作業ツリーは切り替えず、別worktreeまたは新しいクローンを用意してください。上のポートは未使用であることを確認し、合成写真と専用ブラウザプロファイルだけを使います。

## 検証とPull Request

```text
npm run typecheck
npm run lint
npm test
npm run build
```

E2Eは[TESTING](docs/specification/TESTING.md)から現行仕様に合う対象を選び、専用ポートと隔離ブラウザで実行します。全歴史的E2Eを標準検証とみなしません。公開するファイルは`python tools/check_public_safety.py`で検査し、文書変更には`python tools/check_specification.py`も実行します。失敗した試験を理由なく削除・skip・期待値変更しないでください。

変更内容と検証結果を確認してから、以下のようにローカルコミットします。PushとPR作成は許可された時点で行います。

```text
git diff --check
git status --short
git add README.md CONTRIBUTING.md
git commit -m "docs: explain local development workflow"
git push -u origin feat/short-description
```

`git add`には**自分が変更した対象ファイルだけ**を指定してください。GitHubで当該ブランチから`main`宛てのPull Requestを作成し、[PRテンプレート](.github/PULL_REQUEST_TEMPLATE.md)へ変更目的、実行したコマンドと結果、未実行事項、データ・通信・移行への影響を記入します。CIが通った後にレビューを依頼し、指摘を同じブランチで修正します。統合はレビュー済みの変更に限ります。

書き込み権限のない外部開発者はGitHubでこのリポジトリを**Fork**し、自分のForkをクローンします。`git remote add upstream https://github.com/Kennethii2i/photo-route.git`を設定し、作業前に`upstream/main`を取得して自分の`main`を更新します。作業ブランチをForkの`origin`へPushし、GitHubで`Kennethii2i/photo-route:main`宛てのPull Requestを作成します。Fork上で作業する場合も、実写真・実DB・ZIP・認証情報をコミットしないでください。

```text
git clone https://github.com/<your-user>/photo-route.git
cd photo-route
git remote add upstream https://github.com/Kennethii2i/photo-route.git
git fetch upstream
git switch main
git merge --ff-only upstream/main
git switch -c feat/short-description
npm ci
# 変更、検証、Commitの後
git push -u origin feat/short-description
```

## 変更時に守ること

- 現行ソースと仕様を調べ、実装済みと将来案を区別します。保存・競合・未保存保護を再利用し、変更を小さくします。
- 仕様、CHANGELOG、必要なテストを同じ変更単位で更新します。`python tools/check_specification.py`で参照を確認します。公開準備時の履歴は[PUBLICATION_REVIEW](docs/specification/PUBLICATION_REVIEW.md)に記録されています。
- 元Exif/GPS/日時と補正、TripとAlbum、所属解除と写真本体の削除を混同しません。DB v3/ZIP v2の変更、追加通信、依存・ライセンス、破壊的操作には所有者の判断と移行・復旧案が必要です。
- 実写真・実DB・実ZIP、個人情報、秘密情報をコミット・試験素材にしません。通常Chromeや既存利用者の保存領域を検証に使いません。

## よくある環境構築エラー

| 状況 | 確認と対処 |
|---|---|
| `node`/`npm`/`git`が見つからない | 各ツールを導入してターミナルを開き直し、`node --version`、`npm --version`、`git --version`を確認する。 |
| Node/npmの版が違う | [.nvmrc](.nvmrc)と[package.json](package.json)の指定に合わせる。 |
| `npm ci`が失敗 | ネットワークを確認する。lockfile不整合なら依存変更者がpackage.jsonとpackage-lock.jsonを揃える。既存の変更を消すために`npm install`を安易に実行しない。 |
| 開発ポートが使用中 | 別の未使用ポートに変え、開くURLも合わせる。ポートが変わるとブラウザの保存領域も別になる。 |
| E2Eでブラウザが見つからない | Chromeを導入するか、[TESTING](docs/specification/TESTING.md)のブラウザ指定を使う。 |
| 地図が見えない | OpenFreeMapへの通信とWebGLを確認する。外部地図の通信を遮断するE2Eでは実タイル表示を検証できない。 |

記載の確認元実装Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
