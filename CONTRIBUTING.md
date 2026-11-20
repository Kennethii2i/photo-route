# 開発への参加

最初に[AGENTS](AGENTS.md)と[正式仕様INDEX](docs/specification/INDEX.md)、[DEVELOPMENT](docs/specification/DEVELOPMENT.md)を読んでください。本体コードは[MIT](LICENSE)です。第三者の条件は[通知文書](THIRD_PARTY_NOTICES.md)に分離します。リモート/公開URLは未設定です。

## 変更の進め方

1. 対象と対象外、main/作業ツリー/worktreeを確認し、専用ブランチで作業する。
2. 現行ソースと仕様を調べ、未実装案と実装済みを区別する。
3. 保存・競合・未保存保護を再利用し、変更を小さくする。
4. [TESTING](docs/specification/TESTING.md)に従い影響範囲を検証する。失敗を隠すために削除/無条件skipしない。
5. 仕様/CHANGELOG/テストを同じ変更単位で更新し、確認した実装HEADと限界を残す。
6. 変更理由、結果の動作、検証、データ/通信/移行への影響を説明してレビューを依頼する。Push/統合/公開を独断で行わない。

## 守ること

- 実写真/実DB/実ZIPをコミット・試験素材にしない。既存の利用者ファイルを変更/削除しない。
- 元Exif/GPS/日時と補正、TripとAlbum、所属解除と写真本体の削除を混同しない。
- DB v3/ZIP v2の変更、追加通信、依存/ライセンス、破壊的操作は所有者判断を確認する。
- 合成データと隔離ブラウザ、未使用ポートを使う。稼働中worktreeを切り替えない。
- プライバシーや安全性についてコード/試験で確認できない保証を記載しない。

## 仕様の更新

既存文書を更新し、新しい責務がある場合はdocs/specificationへ追加してINDEXに登録します。説明の重複は関連文書へのリンクで避けます。

`python tools/check_specification.py`でリンクと参照を確認してください。公開準備時は[PUBLICATION_REVIEW](docs/specification/PUBLICATION_REVIEW.md)も更新します。問題を見つけても履歴の書き換えやライセンス選択を勝手に行いません。

記載の確認元実装Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
