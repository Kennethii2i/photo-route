# Photo Route

旅行写真を地図で見返し、同じ旅行内の写真をアルバムへまとめるWebアプリです。写真の情報はブラウザ内に保存します。

以下は、Web公開サイトを使わず、**自分のPCで起動して試す手順**です。ソースをダウンロードしただけでは起動しません。`index.html`を直接開くのではなく、下記のコマンドで起動します。

## 1. 最初に用意するもの

- WindowsのPowerShellなど、コマンドを入力できる画面。
- Node.js 24.13以上・25未満。確認済み環境はNode.js 24.13.0 / npm 11.6.2です。
- Chromeなどのブラウザ。最初は試用専用の新しいプロファイルを使ってください。
- GitHubから取得する場合はGit。Privateリポジトリの場合はアクセス権のあるGitHubアカウントも必要です。

PowerShellで次が表示できれば、Node.jsとnpmを使えます。

```powershell
node --version
npm --version
```

## 2. ソースを取得する

保存したいフォルダでPowerShellを開き、実行します。GitHubからの認証を求められた場合は、アクセス権のあるアカウントで認証してください。

```powershell
git clone https://github.com/Kennethii2i/photo-route.git
cd photo-route
```

すでにソースがある場合は、**package.jsonがあるフォルダ**でPowerShellを開いて、次へ進みます。GitHubから「Download ZIP」で取得した場合も、先に展開してそのフォルダを開きます。

## 3. 起動してブラウザで開く

初回だけ、必要なライブラリを準備します。

```powershell
npm ci
```

続けて起動します。

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

試用後にコードを変更する場合は、[CONTRIBUTING](CONTRIBUTING.md)と[AGENTS](AGENTS.md)を読み、**[正式仕様書の入口](docs/specification/INDEX.md)**から対象機能を確認してください。

```powershell
npm run typecheck
npm run lint
npm run build
```

試験の選び方は[TESTING](docs/specification/TESTING.md)、開発環境の詳細は[DEVELOPMENT](docs/specification/DEVELOPMENT.md)へ。内部Undoは保持していますが、一般利用者向けのUndo UIはありません。

## ライセンス・公開準備

本体コードは[MIT License](LICENSE)です。著作権表記の「2026 Photo Route contributors」は暫定表記で、Public化前に所有者の最終確認が必要です。第三者ライブラリ・地図・素材にはそれぞれの条件があります。[第三者通知](THIRD_PARTY_NOTICES.md)を確認してください。

このリポジトリは過去の履歴・未承認画像を含まない独立した公開準備版です。[公開前の確認事項](docs/specification/PUBLICATION_REVIEW.md)と[Pages準備案](docs/specification/GITHUB_PAGES.md)を分けて記録しています。ローカルで起動する手順を実行しても、GitHub Pagesへの公開は行われません。

記載の確認元実装Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
