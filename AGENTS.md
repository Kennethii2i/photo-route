# Photo Route: 開発者・AIエージェントへの指示

## 目的と権限

ローカルファーストの旅行写真地図アプリを、既存データと操作の安全性を守って開発する。所有者の明示依頼の範囲だけを実装する。保存形式、送信先、課金、破壊的操作、データ階層/モデルの意味を変える場合は承認と移行/復旧案が必要。提案を独断でAPPROVEDにしない。

## 最初に読む

1. [README](README.md)、[正式仕様INDEX](docs/specification/INDEX.md)。
2. [PRODUCT](docs/specification/PRODUCT.md)、[ARCHITECTURE](docs/specification/ARCHITECTURE.md)、[DATA_MODEL](docs/specification/DATA_MODEL.md)、[STORAGE_AND_BACKUP](docs/specification/STORAGE_AND_BACKUP.md)。
3. [constitution](docs/constitution.md)、[decisions](docs/decisions.md)（D-001〜D-019）、[open-questions](docs/open-questions.md)。PROPOSEDをAPPROVEDへ無断変更しない。初期決定の計画と現在の実装を混同しない。
4. 現在の依頼と[DEVELOPMENT](docs/specification/DEVELOPMENT.md)、[TESTING](docs/specification/TESTING.md)。過去の私有Phase報告/ロードマップは公開版へ含めない。公開版の工程は所有者の現在の依頼で決める。

正式仕様は現在のコードの説明、decisions/所有者指示は承認の根拠。食い違いを記録し、重要な製品/保存方針に関わる場合は勝手に変更せず代替案を示す。

## 公開版の権利・履歴

本体コードは[MIT](LICENSE)。第三者コード・地図・素材は[通知文書](THIRD_PARTY_NOTICES.md)と[安全な素材一覧](docs/specification/SAFE_ASSETS.md)を維持する。新しい初期コミットから始まる独立した履歴で、参照元の確認HEADは由来の識別子であり本リポジトリ内のコミットではない。未承認画像/実データ/旧履歴を取り込まない。

## 責務とコーディング

- src/domain: モデル、参照整合性、元/補正の日時・GPS。外部地図の型や永続化都合を混入しない。
- src/application: 取り込み等の調整。保存APIを画面ごとに複製しない。
- src/infrastructure: IndexedDB、画像検証/Exif、ZIP、配信設定。
- src/presentation: DOM、CSS、表示集計、ドラフト、ナビゲーション、地図。
- TypeScript strict、既存モジュールを再利用し、小さく独立検証できる変更にする。無関係な一括リネーム/大規模書き換え/依存追加を避ける。
- ユーザーラベルはテキストとして描画。不正画像/ZIPは検証・上限管理し、元写真/Exifを外部APIへ送らない。

## 保存データの不変条件

- 元写真を変更しない。取り込み後の原本バイト列をDBへ永続保存しない。元値と分離した補正、サムネイル、SHA-256、安定IDを保持。
- 不明な時差/GPS/訪問期間を事実として推定しない。参考GPSと確認済みGPSを区別し、自動GPS/日時補正や経路推定を追加しない。
- 新規ファイル取り込みは生存Trip必須。旧データ/移行/ZIP復元のPhoto.tripId=nullは保持し、自動で旅行へ割り当てない。
- アルバムは同一Trip内。photoAlbumLinksが唯一の所属正本。同じペアの重複禁止、Photoは0個以上へ所属可能。Trip未設定Photoはリンクを持てない。
- v3で旧Photo.visitIdを独立した正本へ戻さず、旧単一所属保存APIを新UIへ再接続しない。
- 所属解除で写真を消さない。ごみ箱アルバムの既存リンクを保持し、新規追加だけを拒否。Trip/Visit/Photo/Thumbnailの参照を壊さない。
- 旧代表地点/根拠写真/手動日時は通常UIから外れても保存値を保持。カバーや写真GPSへ転用しない。
- DB v3/ZIP v2変更は明示承認、隔離移行/旧版互換/中断/失敗の原子的ロールバック検証が必要。内部Undo/recovery/期待操作ID/競合条件を緩めない。
- 危険な上書き復元/永久削除は、バックアップ・確認・検証・ロールバックが未完成なら安全に拒否。DB削除/自動リセットで障害を隠さない。

## UI/UX

PCのMap-firstと左drawer、モバイルの下部3タブを基本とする。写真を主役にし、補助アイコンにはaria-label/titleと原則44pxの領域。保存/キャンセル等の主操作は意味を伝える文字を残す。

×は表示容器の終了、←は親へ戻る。地図余白は閲覧の一時表示を1層だけ閉じ、検索/限定地図を破壊しない。未保存・保存中・結果不明を黙って破棄しない。一般Undo UIを独断で復活させない。ごみ箱復元/編集キャンセルは維持。

写真選択はズーム維持と必要パン。クラスタ直接操作だけが展開ズーム。一時マーカーはデータモデルではなく、座標/所属を変更しない。OpenFreeMapの既定通信と出典/説明を維持し、新しい送信先には承認が必要。

## 作業環境とGit

開始時にHEAD/ブランチ/status/worktree/remoteを確認。利用者の未追跡資料・ZIPを変更/削除/勝手にステージしない。稼働中サーバーの作業ディレクトリを切り替えず独立ブランチ/worktreeを使う。同名を無条件上書きしない。

通常Chrome、実写真/実DB/実ZIP、既存試用環境へ無断アクセスしない。別ポート・専用プロファイル・合成データ/専用DBを使用。削除できるのは自分で作成した試験資源で対象確認済みのものだけ。

main統合/Push/Web公開/実DB移行/履歴書き換えはそれぞれ明示指示が必要。統合承認時もバックアップ参照と別worktreeでFast-forwardを基本とし、不可なら停止。稼働中サーバー/ブラウザを無断停止しない。

## 検証と文書更新

変更に応じ型チェック/ビルド/Lint、必要な単体/代表E2Eを選ぶ。UIだけなら大量ZIP/全回帰を繰り返さない。保存・移行・関係・解析・失敗モードの必要な安全試験は省略しない。文書だけなら型チェック/ビルド/リンク/参照ソース/公開対象検査を中心にする。

実行したコマンド/成功失敗/省略/未確認を正確に報告し、期待値だけの変更や無条件skipで隠さない。新機能と同じ変更単位で正式仕様・関連テスト・CHANGELOGを更新し、確認元実装HEADを記録する。

完了時は変更ファイル、満たした要件、検証と省略、データ/通信/移行リスク、コミット/ブランチ/statusを報告し、未承認の次工程へ進まない。

指示整理に使用した実装Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
