# 外部API資格情報の保護

## 範囲と現状

2026-11-22の所有者依頼に基づく資格情報の取扱規則。現在の製品にはEsri接続・キー入力・秘密を保持する中継は未実装。[接続計画](../esri-key-security-2026-11-22.md)のPC内中継は所有者の後続指示で取り下げ済み。現在の[地域画像](../regional-imagery-2026-11-22.md)はキーを使わない。API利用の許可は、有料利用・公開・キー配布の許可を含まない。

## 開発者・AI共通の必須ルール

1. キー・トークン・秘密鍵・client secretの実値をソース、Git、チャット、Issue/PR、文書、テスト、スクリーンショット、ログ、HARへ記録しない。実キーをAIへ送らない。所有者の秘密設定を調査目的で表示しない。確認は値を出さず、設定の有無や成否だけで行う。
2. `.env.local`等は既存の`.gitignore`で除外する。`git add -f`、除外解除、キー入りファイルのステージをしない。サンプルは空欄だけにする。写真DB・ZIP・localStorage・IndexedDB・URLへキーを保存しない。
3. クライアントへ秘密を渡さない。`VITE_`、`define`、HTML置換、公開設定JSON、ソースマップ、配布JavaScriptへ埋め込まない。Gitから除外してもクライアントへ埋め込めば見える。難読化・暗号化して同じクライアントへ復号手段を配る方法も秘密保持とは扱わない。
4. サーバー用の非公開設定はNode側だけで読む。接続機能の承認・実装前はキーを設定しない。静的ホスティングに共有の秘密キーを持たせない。公開中継・LAN公開・トンネルは別の設計と承認が必要。
5. アプリ専用・最小権限・短い有効期限を使い、利用状況を確認する。EsriはBasemapsのみ、item accessなしを基本とする。referrer制限は秘密保持の代替としない。期限・権限・referrer変更時は公式手順で再生成し、古いキーを無効にする。
6. 無料利用では所有者がPAYG OFFを確認し、決済情報を登録しない。枠超過・認証失敗時に課金を有効化する処理や有料APIへ迂回する処理を追加しない。アカウント契約・課金設定・サービス追加は所有者が判断する。
7. ステージ前・コミット前に公開安全性検査を通し、差分のファイル名と内容を人が確認する。検査は既知形式に限られ、全秘密の不存在や過去Git履歴の安全を保証しない。公開・Pushの許可は別途必要。

## 実装済みの保護と検証

- [公開検査](../../tools/check_public_safety.py)は現在のGit追跡ファイルと通常追加可能な未追跡ファイルだけを検査する。Esriの既知トークン形式とEsri/ArcGIS用設定名への一定長以上の直接代入を検出し、ファイル名・検出種類だけを報告する。無視された秘密ファイルを読み出す検査ではない。引用付き変数参照も検出する場合があるため、公開サンプルは空欄のみとする。
- [Vite設定](../../vite.config.ts)は開発/ビルド/previewの設定読込時に、公開用`VITE_`変数の資格情報名または既知Esriトークンを拒否する。[保護関数](../../tools/public-env-policy.ts)はエラーへ実値を入れない。環境変数をクライアント設定へコピーしない。
- 別名・未知形式・コードへ直接埋め込んだ全秘密や任意の`define`追加を検出できるものではない。設計・差分レビューも必要。

```powershell
python -m unittest discover -s tools -p test_public_safety.py
python tools/check_public_safety.py
npm test -- tests/unit/public-env-policy.test.ts
```

検査はCIにも含める。合成値だけで回帰確認し、実キーをテストへ渡さない。

## 漏えい・誤コミット時

使用を止め、所有者へ値を含めず状況を報告する。Esri側で失効・再発行し、不正利用と課金状態を確認する。ファイルや最新コミットから削除しただけでは過去履歴・キャッシュ・ログから回収できない。必要な履歴対応や外部公開物の回収案を示し、明示承認なしに履歴を書き換えない。調査ログへ漏えい値を再掲しない。

[公式のセキュリティ推奨](https://developers.arcgis.com/documentation/security-and-authentication/security-best-practices/)、[キー管理](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/api-key-credentials/location-platform/)、[課金](https://location.arcgis.com/help/billing/)。外部条件は利用開始時にも確認する。

今回変更前基準Git HEAD: `5cc666be292b6135b0bf901599279f4ea6db80ae`

今回キー保護実装・検証の確認元Git HEAD: `1d9becaa88a24b5050cd012d5a21f99eadb984c0`

今回地域画像の実装・検証の確認元Git HEAD: `7199cdc7329960b059946a216bcead6e50d46cbd`
