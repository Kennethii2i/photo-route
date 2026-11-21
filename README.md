# Photo Route

旅行写真を地図で見返し、同じ旅行内の写真をアルバムへまとめるWebアプリです。写真の情報はブラウザ内に保存します。

ソースコードは[GitHubで公開](https://github.com/Kennethii2i/photo-route)されています。GitHub Pagesで動くWebアプリは公開されていません。以下は自分のPCで起動し、開発する手順です。`index.html`を直接開かず、開発サーバーを使います。

技術スタックはTypeScript（strict）、Vite、MapLibre GL、IndexedDBです。単体テストはVitest、ブラウザテストはPlaywrightを使います。写真・アルバムはブラウザ内に保存し、GitHubへ自動同期しません。

## 1. 最初に用意するもの

- Git、Node.js **24.13.0**（[.nvmrc](.nvmrc)、許容範囲は`>=24.13.0 <25`）、npm **11.6.2**（[package.json](package.json)）。
- WindowsではPowerShell、macOS/Linuxではターミナル。
- Chromeなどのブラウザ。最初は試用専用の新しいプロファイルを使ってください。

PowerShellで次が表示できれば、Node.jsとnpmを使えます。

```powershell
node --version
npm --version
git --version
```

## 2. ソースを取得する

保存したいフォルダでPowerShellを開き、実行します。公開リポジトリのクローンにはGitHubの認証は不要です。

```powershell
git clone https://github.com/Kennethii2i/photo-route.git
cd photo-route
npm ci
```

macOS/Linuxでもターミナルで同じ`git clone`、`cd photo-route`、`npm ci`を実行します。Nodeの切り替えにnvmを使う場合は、`npm ci`の前に`nvm install`と`nvm use`を実行します。WindowsではNode 24.13.0とnpm 11.6.2をインストールしてからPowerShellを開き直してください。

すでにソースがある場合は、**package.jsonがあるフォルダ**でコマンドを実行します。ZIP取得でも起動はできますが、ブランチ・Push・Pull RequestにはGitクローンを使います。既存の作業ツリーに未コミット変更があれば、そのまま上書きしないでください。

## 3. 起動してブラウザで開く

依存関係はロックファイルに従って`npm ci`で導入します。続けて起動します。

```powershell
npm run dev -- --host 127.0.0.1 --port 18194 --strictPort
```

PowerShellに起動完了のURLが出たら、ブラウザで **http://127.0.0.1:18194/** を開いてください。PowerShellは起動したままにします。

18194は試用ポートの例です。使用中というエラーが出た場合は、別の未使用ポートへ変更し、ブラウザで開くURLの番号も合わせます。既存の試用環境のポートや通常利用中の保存先を再利用しないでください。

## 4. 最初に試す操作

新しいブラウザの保存領域では、旅行も写真も空の状態から始まります。

1. **旅行を作る**：上部の旅行選択欄から「＋ 新しい旅行を作成」を選び、名前を入力して「作成」。
2. **写真一覧を開く**：PCでは地図左端の矢印で一覧を開き、「写真」タブを選びます。モバイルでは下部の「写真」タブです。
3. **写真を追加する**：写真枚数の右にある「＋」→「写真を選択」→ファイルを選ぶ→「取り込む」。
4. **写真を地図で見る**：取り込み後に写真を選ぶとプレビューが開きます。GPS付き写真は地図にも表示されます。GPSがない写真も一覧から閲覧できます。
5. **アルバムを作る**：「アルバム」タブの「＋」から名前を入力して作成し、「写真を選択」で追加したい写真を選んで保存します。1枚を複数アルバムに入れられます。

実写真を使わずに確認する場合は、ファイル選択画面で、このリポジトリ内の次の合成画像を選べます。

- `fixtures/generated/jpeg_gps_offset_orientation6.jpg`：GPS・日時付き。
- `fixtures/generated/png_exif_gps.png`：GPS・日時付き。
- `fixtures/generated/webp_no_metadata.webp`：GPS・日時なし。

これらは操作確認用の小さな図形画像です。fixturesには意図的な破損画像・過大寸法画像もあるため、最初は上の正常な画像だけを選んでください。

## 5. 終了と次回の起動

終了するときは、起動中のPowerShellで **Ctrl+C** を押します。ブラウザを閉じるだけではサーバーは終了しません。

次回は同じフォルダで起動コマンドをもう一度実行します。ライブラリやロックファイルに変更がなければ、`npm ci`のやり直しは不要です。

写真・アルバムを続けて使う場合は、**同じブラウザのプロファイルと、同じURL（ポート番号も含む）**で開きます。サーバーを終了しても、ブラウザの保存領域を消さなければデータは残ります。ただしブラウザ内保存は独立バックアップではありません。

## データと地図について

- **元の高解像度写真は保存されません。** アプリとバックアップZIPが保持するのは、サムネイル・写真情報・補正・アルバム所属などです。原本は別途保管してください。
- 写真やアルバムはGit/GitHubへ自動保存されません。管理画面からZIPバックアップを作成し、別の環境へ移すときは復元します。
- ブラウザ・プロファイル・ホスト・ポート・HTTPSが変わると、同じ写真データは自動では表示されません。
- 背景地図は起動時にOpenFreeMapへ通信します。閲覧地域や通信情報が提供者/CDNへ伝わり得ます。写真やExifをアップロードする機能ではありません。[プライバシー仕様](docs/specification/SECURITY_PRIVACY.md)を確認してください。
- HEIC/HEIFのサムネイル生成、原本ビューア、自動同期、手動カバー保存等は未対応です。最初の取り込み確認にはJPEG/PNG/WebPを使ってください。[既知の制約](docs/specification/KNOWN_LIMITATIONS.md)も参照できます。

## 開発・仕様書

開発に参加する場合は[CONTRIBUTING](CONTRIBUTING.md)でブランチ・Fork・Pull Requestの手順を読み、[AGENTS](AGENTS.md)、[正式仕様書の入口](docs/specification/INDEX.md)へ進んでください。変更前に対象機能の仕様を確認します。

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

代表E2Eは、未使用ポートと隔離ブラウザを用意してから、例えば`$env:PHOTO_ROUTE_TEST_PORT='18194'; npx playwright test tests/e2e/developer-onboarding.spec.ts --reporter=line`（PowerShell）で実行します。macOS/Linuxでは`PHOTO_ROUTE_TEST_PORT=18194 npx playwright test tests/e2e/developer-onboarding.spec.ts --reporter=line`です。ChromiumのChromeチャンネルが必要です。詳細と試験選択は[TESTING](docs/specification/TESTING.md)を参照してください。Pull Requestと`main`へのPushでは、GitHub Actionsが上の5コマンド（`npm ci`を含む）を実行します。E2EはCIの標準ジョブには含めていません。

環境構築で困ったら、`node --version`と`npm --version`を確認してください。`npm ci`がlockfile不整合で止まった場合は、作業ツリーを確認し、依存変更を意図した人が`package.json`と`package-lock.json`を揃えてコミットします。ポート使用中なら未使用ポートに変えます。Playwrightがブラウザを見つけられない場合はChromeを導入するか、[TESTING](docs/specification/TESTING.md)に従い別ブラウザを指定します。地図タイルが表示されない場合はネットワークとOpenFreeMapへの接続を確認してください。内部Undoは保持していますが、一般利用者向けのUndo UIはありません。

## ライセンス・公開状況

本体コードは[MIT License](LICENSE)です。著作権表記の「2026 Photo Route contributors」は暫定表記のため、所有者の最終確認が残っています。第三者ライブラリ・地図・素材にはそれぞれの条件があります。[第三者通知](THIRD_PARTY_NOTICES.md)を確認してください。

このリポジトリは過去の非公開履歴・未承認画像を含まない独立した公開版です。[公開時の選別記録](docs/specification/PUBLICATION_REVIEW.md)は当時の記録として保持しています。[Pages準備案](docs/specification/GITHUB_PAGES.md)はWeb公開に向けた未実施の案です。ローカル起動やCIによってPages公開は行われません。

記載の確認元実装Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
