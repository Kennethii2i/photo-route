# 重要な仕様変更

詳細なコミット全履歴ではなく、引き継ぎ時に理解すべき契約の変化です。各IDは参照元実装の変化を識別する目印で、この公開リポジトリのGit履歴には含みません。将来工程の実装承認ではありません。

| 段階 | 変更と移行上の意味 | 根拠 |
|---|---|---|
| 初期〜Phase 5 | メタデータ/サムネイル主体、Trip/Visit/Photo、手動補正、ZIP v1、復旧履歴、一括所属。Photo.visitId単一所属が当初の契約 | [旧設計](DATA_MODEL.md)、[storageの互換処理](../../src/infrastructure/storage.ts) |
| Phase A | 利用者表記をアルバムへ統一し、管理/写真/アルバムのMap-first UIを整理。内部Visit名は維持 | [現行UI](UI_UX.md) |
| B1〜B3 | DB v3のphotoAlbumLinksを唯一の正本へ。v2移行は原子的に旧visitIdを変換。複数所属一括保存/競合/互換Undo、ZIP v2とv1入力互換 | [保存仕様](STORAGE_AND_BACKUP.md) |
| B4〜B5/RC | 一覧・検索・地図・両方向の所属編集をリンクAPIへ接続。旧保存経路をガードし、隔離データで移行/復元/操作を確認 | [RC-1テスト](../../tests/e2e/rc1-data-protection.spec.ts) |
| C/D UI改善 | アルバム限定地図、代表地点/旧手動日時の通常UI撤去。既存保存値は保持。アイコン/モバイル/写真選択を簡素化 | [UI/UX](UI_UX.md)、[地図](MAP_AND_GEO.md) |
| UX-R / IA | PC drawer、常設ズーム、未保存補正/結果不明保護、独立取り込み、統一した戻る/閉じる、条件UI、旅行必須の新規取り込み、一覧＋からの空アルバム作成 | [D-019](../decisions.md)、[取り込み仕様](IMPORT_AND_PHOTOS.md) |
| UX Navigation v2 | 一般Undo UI撤去、写真選択と再選択解除、旅行管理/写真追加の整理。内部Undoは保持 | `fed9ee5`、[内部Undo実装](../../src/infrastructure/storage.ts) |
| V4.1 | 6枚ページ送りを撤去し、最大12枚の展開と既存一覧フォールバックへ | `bc18631`、[代表テスト](../../tests/e2e/ux-v41.spec.ts) |
| V4.2 | 展開の全ターゲット矩形を可視領域へ収め、元サムネイル重複を隠し、複数リング/線を調整。元GPS/カメラは変更しない | `e89c233`、[代表テスト](../../tests/e2e/ux-v42.spec.ts) |
| W1 | 写真選択はズーム維持、必要時だけパン。確定できたクラスタだけ輪郭表示。明示地図操作は周辺ズーム15 | `8aa78db`、[代表テスト](../../tests/e2e/ux-w1.spec.ts) |
| W2 | 写真件数右の＋、タブ下のsticky操作、ごみ箱を地図隣へ。確認前の未保存保護と写真本体の確認を維持 | `989eae4`、[代表テスト](../../tests/e2e/ux-w2.spec.ts) |
| P1/P2（本文書） | 現行コードから正式仕様を新設。README/AGENTS/開発手順/公開履歴検査/非稼働Pages案を整備。製品/保存形式を変更しない | [INDEX](INDEX.md)、[公開前検査](PUBLICATION_REVIEW.md) |
| P2.1 | 参照元で公開前検査を実施。私有報告・未承認画像・旧履歴をこの公開版へ持ち込まず、安全な合成fixtureのみを選択 | [公開前検査](PUBLICATION_REVIEW.md)、[素材](SAFE_ASSETS.md)、[ライセンス](../../THIRD_PARTY_NOTICES.md) |

P2.2: 独立した公開用初期履歴、本体コードのMIT採用、第三者通知、安全なfixture、公開版リンク整理を実施。製品ソースと依存バージョンは参照元から変更していません。

承認済みの旧決定を黙って書き換えません。新しい仕様が変更する契約、移行、旧データ/バックアップ、検証、所有者判断を記録し、更新対象は[DEVELOPMENT](DEVELOPMENT.md)で確認します。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
