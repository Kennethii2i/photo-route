# 2026-11-22 安全性・操作性改善計画

基準実装HEAD: `26093c16cec1924c8110efe5f932bd7159a8ca13`。所有者の改善計画・実行指示に基づく。DB v3、ZIP v2、原本非保存、既存送信先、Recovery構造は変更しない。PROPOSED事項を承認済みに変更しない。

| 項目 | 目的と受入条件 | 検証 |
|---|---|---|
| 補正ドラフト | 確定したGPS/日時の送信項目だけ同期。保存中の追加入力、他方の未保存値、失敗時の入力を保持 | ドラフト単体、対象E2E |
| 取り込み結果 | 写真処理とジョブ保存の失敗を分離。1ファイル1結果・処理件数1増加。ジョブ保存失敗を写真保存成功と誤表示しない | 失敗注入単体、型検査 |
| 中断試験 | 生存Trip前提の中断・再起動試験とnull拒否を検証。試験の外部通信を遮断 | 隔離Playwright |
| バックアップ警告 | ごみ箱を含む累積件数と現行上限を管理・取り込み/復元前に案内。64MiB通常/256MiB直接保存の差とサイズ予測の限界を表示 | 集計単体、対象UI |
| 競合保護 | アルバム/同じ写真補正の編集開始時期待値を保存トランザクションで比較。他タブの新値を守り、競合時はドラフト保持 | 隔離DB原子性・競合E2E |
| 写真一覧フォーカス | 仮想範囲/resize更新後、写真IDでpreventScroll復帰。範囲外でもフォーカスを失わず、連続Tabで次写真へ到達 | 仮想一覧キーボードE2E |

対象外: 分割バックアップ、ZIP上限変更、新しい固定取り込み禁止上限、再起動時の自動markInterruptedJobs、一般Undo UI、保存形式/階層/モデル意味変更、通信先追加、実データ検証、Push/統合/公開。

重要判断: 既存APIの期待値引数は省略可能とし既存呼出互換を維持するが、通常UIは必ず期待値を渡す。上限警告は利用を禁止せず、正確に予測できない出力バイト数を断定しない。編集担当を1名とし、Mainが最終検証を統括する。

## 実装と対応ファイル

| 要件 | 変更ファイル |
|---|---|
| 補正送信項目別同期 | `src/presentation/photo-correction-draft.ts`、`src/presentation/app.ts`、`tests/unit/safety-ux.test.ts` |
| 取り込み結果の一回計上 | `src/application/import-photos.ts`、同単体試験 |
| 現行中断/旅行必須 | `tests/e2e/phase4-interruption.spec.ts` |
| バックアップ警告 | `index.html`、`src/style.css`、`src/presentation/backup-capacity.ts`、`src/infrastructure/storage.ts`、`src/presentation/app.ts` |
| 他画面競合/原子性 | `src/infrastructure/storage.ts`、`src/presentation/app.ts`、`tests/e2e/safety-ux-improvements.spec.ts` |
| 仮想一覧キーボード | `src/presentation/photo-grid.ts`、同E2E |
| 正式仕様 | `docs/specification/UI_UX.md`、`STORAGE_AND_BACKUP.md`、`IMPORT_AND_PHOTOS.md`、`ERRORS_AND_RECOVERY.md`、`TESTING.md`、`KNOWN_LIMITATIONS.md`、`CHANGELOG.md` |
| 計画/結果 | 本書 |

比較した最小案: 保存中に全入力をdisabledにする案より、追加入力を保持する項目別同期を採用。競合を全Photoで拒否する案より、GPS/日時の対象欄別比較で独立編集を許容。バックアップは保存禁止追加/上限引上げではなく案内を採用。仮想DOM全面変更より、ID復帰と窓境界のTab移動を採用。範囲外のフォーカスは一覧容器へ戻し、手動スクロールを巻き戻さない。

## 検証記録

- Developer: `npm run typecheck`、`npm run lint`成功。`npm test -- tests/unit/safety-ux.test.ts`は7件成功。
- Main: `npm ci --offline --no-audit --no-fund`はキャッシュ不足（ENOTCACHED zod）で失敗。その後、lockfile固定の`npm ci --no-audit --no-fund`成功。package/lock変更なし。
- Main: `npm test`は18ファイル79件成功。`npm run build`成功（既存の大きなchunk警告あり）。`git diff --check`成功。
- Main: `npm run typecheck`、`npm run lint`成功。隔離Chromium/専用ポート18241で`node node_modules/@playwright/test/cli.js test tests/e2e/phase-b2-membership.spec.ts tests/e2e/phase4-interruption.spec.ts --reporter=line`計17件成功（所属・Undo・旧互換・中断）。先行`developer-onboarding.spec.ts`1件成功。sandboxのlocalhost接続EACCESを解消した実行環境で検証。
- Main: `phase-b3-archive.spec.ts`の小規模3件（`--grep "ZIP v2 round trip|genuine ZIP v1|Photo, album edit"`）成功。ZIP v2往復/v1入力互換/編集後復元を確認。
- Developer: `python tools/check_specification.py`、`python tools/check_public_safety.py`、`git diff --check`成功（秘密形式検出0、承認済み画像23）。MainはPC1440/390/320の警告・競合画像6枚を最終視認し、主操作と文言の収まりを確認。独立Reviewer/UX Auditorは現差分に追加必須指摘なしと報告。追加E2Eは新規9件＋導入1件＋空アルバム2件。初回12件中8件成功/4件失敗（mockの拡張子なしURLが製品と異なるmoduleを参照した3件、resize後の旧描画窓最終ボタンを選ぶテスト待機不足1件）。mock URLを製品と同じ`.ts`へ揃え、全体最後の写真ID描画を待ってからTabするよう修正。再実行12件は11件成功/1件失敗（仮想DOM差し替えとlocator評価の間で対象がdetachedとなる試験側のTypeError）。現在のactiveElement/ID/接続/所属/上下可視を単一評価するpollへ強化し、仮想一覧の対象1件再実行は成功（4.7秒）。新規9件＋導入/空アルバム3件の全12件の成功を確認。最終E2Eの対象は重複を除き32件（所属/Undo/中断17、ZIP小規模3、新規/導入/空アルバム12）。成功を確認した対象だけを数え、全E2E一括成功とは扱わない。後続変更があれば必要な対象を再確認する。

## リスクと未確認

保存形式、通信先、写真原本、所属モデル、既存データの移行は変更なし。既存のDB/ZIP安全拒否条件とrecoveryを維持。期待値を省略する旧API呼出は従来契約のため、通常UI以外の全競合を検出すると保証しない。完全に同一値へ戻った履歴（ABA）や、全実機/他ブラウザでの動作は保証しない。

5000枚等の全体ZIP上限超過は警告するだけで、超過DBのバックアップを可能にしたものではない。分割バックアップ/上限変更は未実装。件数照会は同一読取トランザクションだが、他タブの後続変更まで凍結しない。保存/復元前の参考値で、出力容量の保証ではない。

再起動時のジョブ自動訂正、永続ドラフト、一般Undo UIは追加なし。既存ごみ箱/ZIP復元の保存確定後に表示再取得だけが失敗する場合の案内は今回未修正。実写真・実DB・実ZIP/通常Chrome/実地図通信の検証、大容量ZIP全回帰、全歴史的E2Eは未実施。Push・統合・公開・実DB移行は行わない。

作業ブランチ: `codex/safety-ux-improvements`。基準HEADは冒頭に記録。Developerはコミット未作成の差分をMainへ引き渡す。最終コミットはMainが実施し、Push/統合は行わない。
