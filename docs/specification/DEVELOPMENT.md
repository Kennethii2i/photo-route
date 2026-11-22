# 開発開始・引き継ぎ

## 環境とコマンド

[.nvmrc](../../.nvmrc)はNode.js 24.13.0、[package.json](../../package.json)のenginesは`>=24.13.0 <25`、packageManagerはnpm 11.6.2です。公開GitHubリポジトリをクローンし、リポジトリルートで実行します。Windows PowerShellとmacOS/Linuxの基本手順は[README](../../README.md)、ブランチ・Fork・PRは[CONTRIBUTING](../../CONTRIBUTING.md)を参照してください。

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 18194 --strictPort
```

18194は例で、未使用確認が必要です。既に利用中のポートや作業ディレクトリを勝手に変更しません。起動URLのポートを変えるとIndexedDBも別です。専用Chromeプロファイルで合成データだけを扱います。

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

試験範囲は[TESTING](TESTING.md)で選びます。`preview`というnpm scriptはありません。ビルド成果物の確認には導入済みVite CLIの`npx vite preview --host 127.0.0.1 --port 18195 --strictPort`を使えます。これも未使用ポートと隔離ブラウザが必要で、本番配信サーバーではありません。

Pull Requestと`main`へのPushでは[CI](../../.github/workflows/ci.yml)が`npm ci`、型チェック、Lint、単体テスト、ビルド、公開安全性検査、合成データだけの代表E2Eを実行します。Pagesデプロイと実データを用いる検証は含みません。

## 公開監査と通常開発

- `python tools/check_public_safety.py`：**現在の公開候補**を検査します。Gitの追跡ファイルと、通常の`git add`で追加可能な未追跡ファイルを対象に、配置、既知の資格情報形式・個人用パス、禁止拡張子、サイズ、画像の[SAFE_ASSETS.csv](SAFE_ASSETS.csv)への登録とハッシュ、`.gitignore`の重要な除外方針を確認します。安全なソースや`.github`の新規ワークフロー・テンプレートは追加できます。ステージ前とコミット前に実行し、CIでも実行します。新しい合成画像を公開する場合は由来を人が確認し、SAFE_ASSETSの一覧とハッシュを更新します。
- `python tools/check_public_snapshot.py`：**初回公開の由来**を検査します。[SOURCE_MANIFEST.json](SOURCE_MANIFEST.json)の190ハッシュを、独立した初回公開コミット`f8d0c34`のGit blobに照合します。現在のコードとは照合しません。履歴全体があるクローンで実行してください。過去のハッシュや[公開時記録](PUBLICATION_REVIEW.md)を書き換えるためのコマンドではありません。

[PUBLIC_FILES.txt](../../PUBLIC_FILES.txt)は過去の公開ファイル一覧で、通常開発の固定許可リストには使いません。現在の公開候補はGitの追跡状態で決まり、`git status`と`git diff --cached --name-only`で確認します。静的な安全性検査は未知の秘密形式、画像内部の個人情報、ライセンス上の許諾を完全には証明しません。公開前に差分と素材の由来を人が確認してください。

## main保護の推奨設定（所有者がGitHubで実施）

2026年11月21日の確認では、公開`main`は保護されておらず、Rulesetsは0件でした。公開リポジトリのブランチ保護はGitHub Freeでも利用できます。所有者のadmin権限は確認できましたが、契約プラン名はこの公開情報からは確認できません。以下は[GitHub公式の設定手順](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)に沿った、個人開発でも運用できる最小案です。設定はこの文書の変更だけでは有効になりません。

1. リポジトリの **Settings → Branches → Add branch protection rule** を開き、branch name patternを`main`にする。
2. **Require a pull request before merging**を有効にする。**Require approvals**は有効にしない。PR作成者は自分のPRを承認できないため、必須承認を1件にすると単独所有者が統合できなくなります。レビューは依頼でき、未解決の会話は次のルールで扱います。
3. **Require status checks to pass before merging**を有効にし、既存のGitHub Actionsチェック`quality`を選ぶ。今回の代表E2Eと公開安全性検査も同じjob内に含まれます。チェック名を変えた場合は保護設定も更新する。
4. **Require conversation resolution before merging**を有効にする。**Allow force pushes**と**Allow deletions**は有効にしない。**Do not allow bypassing the above settings**を有効にし、所有者もPRとCIを通す。署名必須・merge queue・必須レビュー件数は現在の規模では設定しない。
5. 設定を保存し、テスト用PRで`quality`成功後に所有者が統合でき、失敗時や未解決会話では統合できないことをGitHub上で確認する。CI障害で作業が止まった場合は、所有者が設定を見直して復旧する。

この方針は[GitHubの保護ルールの説明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)と[自分のPRを承認できない制約](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)を踏まえています。CIが一度も実行されていない新規チェックは選択候補に出ない場合があるため、まずPhase 2のPRで`quality`を実行してから設定します。

## 最初に読むもの

[INDEX](INDEX.md)、[PRODUCT](PRODUCT.md)、[ARCHITECTURE](ARCHITECTURE.md)、[DATA_MODEL](DATA_MODEL.md)、[STORAGE_AND_BACKUP](STORAGE_AND_BACKUP.md)、ルートの[AGENTS](../../AGENTS.md)を読みます。[decisions](../decisions.md)/[constitution](../constitution.md)は承認とデータ保護の根拠です。過去の初期案と現行実装を混同しないでください。

## ブランチとworktree

mainはレビュー済み基準。新しいタスクは独立ブランチ/未使用worktreeから始め、HEAD・ブランチ・status・worktree・remoteを確認します。既存の同名ブランチを上書きせず、未追跡資料も利用者の管理対象として扱います。

稼働中サーバーの作業ディレクトリではブランチを切り替えません。main統合を明示依頼された場合は祖先関係を確認し、統合前バックアップブランチと別worktreeで`--ff-only`を使用。不可なら通常merge/rebase/resetへ勝手に変更しません。Push/公開/実DB移行は別の明示指示が必要です。

## 機能追加の進め方

1. 変更目的と対象外を確認し、現行の入口/イベント/保存APIと関連テストを調べる。
2. 未実装案は提案として区別。保存形式、送信先、課金、破壊的操作、階層/モデルの意味が変わるなら所有者の承認と移行/復旧案を先に確認する。
3. Domainの検証、Applicationの調整、Infrastructureの保存境界、Presentationの表示を混ぜず、既存API/コンポーネントを再利用する。
4. 保存成功・失敗・競合・結果不明・未保存を設計し、成功が確認される前に成功通知/画面終了を行わない。
5. 対象の代表試験と必要な安全回帰、PC/モバイルの実画面を確認し、実行した結果だけを報告する。
6. 仕様/変更履歴/テストを同じ変更単位で更新し、小さなローカルコミットにする。

新画面を加える場合は`layout.onNavigate`、ドラフトの離脱保護、×/←、フォーカス復帰、余白クリックとの除外、エラー優先度を維持します。既存の保存ロジックを画面ごとに複製しません。

## 仕様書の更新対応表

| 変更対象 | 必ず確認/更新する文書 |
|---|---|
| 製品の責務/旅行・写真・アルバムの意味 | PRODUCT、FEATURES、DATA_MODEL、承認記録 |
| モデル/DB/リンク/Undo | DATA_MODEL、STORAGE_AND_BACKUP、ERRORS_AND_RECOVERY、TESTING、CHANGELOG |
| ZIP/上限/復元 | STORAGE_AND_BACKUP、SECURITY_PRIVACY、KNOWN_LIMITATIONS、TESTING |
| 画面/ナビゲーション/保存状態 | UI_UX、FEATURES、関連テスト、CHANGELOG |
| 地図/カメラ/位置の根拠 | MAP_AND_GEO、UI_UX、SECURITY_PRIVACY |
| 取り込み/画像 | IMPORT_AND_PHOTOS、DATA_MODEL、KNOWN_LIMITATIONS、TESTING |
| 依存/ビルド/配信 | ARCHITECTURE、DEVELOPMENT、PUBLICATION_REVIEW、GITHUB_PAGES |

各文書末尾に確認した実装HEADを記録します。全ファイルを機械的に同じ日付へ更新するのではなく、確認した変更範囲と未確認事項を明示してください。詳細なPhase証跡を正式仕様へ全文コピーしません。

## 保存形式を変える場合

DB v3/ZIP v2と`photoAlbumLinks`正本性は現行契約です。旧`Photo.visitId`を復活させたり、代表地点/手動日時を空欄だからnullにする変更は不可。移行は隔離DBで原子的ロールバック、他タブ、旧バックアップ、所属/サムネイル、内部Undoを検証します。利用者DBを勝手に移行/削除して試験しません。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`


## 2026-11-22 APIキーの開発ルール

[資格情報規則](EXTERNAL_API_CREDENTIALS.md)を守る。`.env.local`をGitから除外しても、`VITE_`変数ならブラウザへ公開される。Viteは資格情報名または既知Esriトークンを持つ非空の公開用変数を設定読込時に拒否する。実値はエラーへ出さない。この保護はクライアントへ秘密を渡す実装を許可するものではない。

公開検査の検出回帰は`python -m unittest discover -s tools -p test_public_safety.py`で実行し、CIも公開安全性検査の前に実行する。実キーを検査へ投入しない。Esri接続は未実装。[ローカル中継計画](../esri-key-security-2026-11-22.md)の承認後に別途実装する。

今回キー保護変更前基準Git HEAD: `5cc666be292b6135b0bf901599279f4ea6db80ae`

今回キー保護実装・検証の確認元Git HEAD: `1d9becaa88a24b5050cd012d5a21f99eadb984c0`


## 2026-11-22 地域限定への計画変更

Esriアカウント/キー/PC内中継の接続計画は所有者依頼で取り下げ。[地域限定計画](../regional-imagery-2026-11-22.md)が現在の範囲。新しいキー設定・契約は不要。既存の一般的な資格情報保護規則と検査は維持。

今回地域画像変更前基準Git HEAD: `1fdcb271c166a8fed98238bab63f039110290e65`

今回地域画像の実装・検証の確認元Git HEAD: `7199cdc7329960b059946a216bcead6e50d46cbd`
