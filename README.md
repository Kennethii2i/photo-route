# Photo Route

旅行写真を地図で見返し、同じ旅行内のアルバムへ自由にまとめる、ブラウザ内で動くローカルファーストのWebアプリです。現在はローカル試用段階で、GitHub/Pagesへの公開は未実施です。

## 主な機能

- 旅行を作成・選択して写真を取り込み、SHA-256で完全一致の重複を判定。
- 日付別写真一覧、ファイル名/撮影日/GPS/アルバムの検索・絞り込み。
- 写真プレビュー/詳細、元情報と分離したGPS・日時補正。
- 同じ写真を同一旅行の複数アルバムへ所属。空アルバムも利用可能。
- MapLibre/OpenFreeMap、クラスタ直接タップで拡大、同一地点写真の展開、アルバム限定地図。
- 写真選択時はズーム維持と必要パン。PC左drawer、モバイル下部3タブ。
- 削除前確認とごみ箱復元、ZIP v2バックアップ/復元（旧v1読み込み互換）。

## 開発環境

Node.js 24.13.0（engines: 24.13以上25未満）、npm 11.6.2。リポジトリルートで実行します。

```powershell
npm ci --registry=https://registry.npmjs.org/
npm run dev -- --host 127.0.0.1 --port 18194 --strictPort
```

18194は例です。未使用を確認し、専用Chromeプロファイル/合成データを使ってください。既存の試用環境や通常ブラウザのデータを無断で操作しません。

```powershell
npm run typecheck
npm run lint
npm run build
```

単体/E2Eの選択と実行方法は[TESTING](docs/specification/TESTING.md)、新規参加者の手順は[DEVELOPMENT](docs/specification/DEVELOPMENT.md)へ。

## データについて

保存するのはメタデータ・手動補正・サムネイル・ハッシュ・所属等です。**元の高解像度写真はDBにもZIPにも保存されません。** 原本を別途保管してください。新規取り込みは旅行必須ですが、アルバム未所属は許可します。

保存先はIndexedDB v3です。ブラウザ/プロファイル/オリジン（ホスト・ポート・HTTPS）が変わると同じDBは自動共有されません。公開サイトへ移る場合もZIPで移行します。更新前のバックアップと空の別環境での復元確認を推奨します。

背景地図は起動時にOpenFreeMapへ通信します。閲覧地域や通信情報が提供者/CDNへ伝わり得ます。写真やExifをアップロードする機能ではありません。[SECURITY_PRIVACY](docs/specification/SECURITY_PRIVACY.md)を確認してください。

## 仕様と開発参加

**[正式仕様書の入口](docs/specification/INDEX.md)**から製品・モデル・保存・地図・UI・復旧を確認できます。[CONTRIBUTING](CONTRIBUTING.md)、[AGENTS](AGENTS.md)に変更と検証のルールがあります。過去の私有検証報告・画面画像は公開版へ含めず、現行ソースとテストを参照します。

## 制約・公開状況

HEIC/HEIFサムネイル、原本ビューア、自動同期、手動カバー保存等は未対応。内部Undoは保持していますが一般Undo UIはありません。実機/他ブラウザ/低メモリー環境の全面保証はありません。[既知の制約](docs/specification/KNOWN_LIMITATIONS.md)を参照してください。

Photo Route本体のコードは[MIT License](LICENSE)です。著作権表記の「2026 Photo Route contributors」は暫定表記で、GitHub公開前に所有者の最終確認が必要です。第三者ライブラリ・地図・素材にはそれぞれの条件があります。[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)を確認してください。

このディレクトリは過去の履歴・未承認画像を含まない独立した公開準備版です。公開前の確認事項と今回の検証は[PUBLICATION_REVIEW](docs/specification/PUBLICATION_REVIEW.md)へ。[Pages準備案](docs/specification/GITHUB_PAGES.md)は非稼働で、Pushによる自動公開を設定していません。

記載の確認元実装Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
