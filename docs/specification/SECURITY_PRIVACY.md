# セキュリティとプライバシー

## 保存する情報

[IndexedDB](STORAGE_AND_BACKUP.md)へ、旅行名、写真ファイル名、元メタデータ関連値、精密なGPS/日時、補正、SHA-256、サムネイル、所属、ジョブ、復旧履歴を保存します。元の高解像度写真バイト列は、取り込み後に永続保存しません。元ファイルは書き換えません。

「原本を保存しない」は、サムネイルやExifから個人情報が分からないことを保証する表現ではありません。顔、撮影場所、時刻、旅行名等が含まれ得ます。

## 外部通信

| 経路 | 現行の通信と情報 |
|---|---|
| 背景地図 | [basemap.ts](../../src/infrastructure/basemap.ts)のOpenFreeMap Libertyを既定で起動時に読み込む（追加背景は後掲） |
| 配信ホスト | スタイル/タイル/フォント/スプライトの要求先は`tiles.openfreemap.org`。HTTPS。提供者/CDN側の実際の処理まではこのコードから保証しない |
| 送信され得るもの | IPアドレス、ブラウザ等の通信情報、要求するタイル範囲から分かる閲覧地域。正確な写真座標そのものを独自APIへPOSTするコードではないが、閲覧地域の秘匿は保証しない |
| 写真/Exif/所属 | 取り込み/解析/保存に外部アップロードAPIは使っていない。ユーザー写真をOpenFreeMapへ送信しない |
| アカウント/分析 | 現行ソースにアカウント、バックエンド同期、分析SDK、位置取得APIはない |
| ポリシーリンク | UIからOpenFreeMapのprivacy/termsを別タブで開ける。リンクを開く場合は通常の外部閲覧になる |

[layout.ts](../../src/presentation/layout.ts)の地図配信元説明、MapLibreのattributionを維持します。OpenFreeMap/OpenMapTiles/OpenStreetMap等、実際の供給スタイルの帰属を勝手に削除しません。配信サービスの将来の可用性・条件を恒久保証しません。

開発時のnpm依存導入、GitHub Actions、将来のGitHub Pages配信は別のネットワーク経路です。PagesではGitHub側へのWebアクセスも発生します。製品の写真アップロード機能がないことと、通信全体がゼロであることは別です。

## ブラウザとバックアップ

- IndexedDBはオリジン（scheme/host/port）とブラウザプロファイルに依存。同じPCでも別ポート/別プロファイル/別HTTPSサイトは同じDBを参照しません。
- パスだけを変えた同一オリジンは隔離されません。同じGitHub Pagesホストの複数プロジェクト等で同じDB名を使う場合は保存領域を共有し得ます。[IndexedDBのsame-origin説明](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Basic_Terminology)を踏まえ、試用は専用プロファイル/別オリジンで分離します。
- DBとZIPの暗号化/パスワード保護はアプリで実装していません。端末/ブラウザ/保管先の保護は別途必要です。
- ブラウザによる容量制限/データ消去/プライベートモードの保持期間等を全面制御しません。永続ストレージ許可を自動確保する実装もありません。
- ZIPにはサムネイル・精密な場所/日時・旅行/アルバム名・ハッシュ・ごみ箱レコード/所属も含まれます。共有前に内容と保管先を確認してください。元写真/jobs/recoveryは含まれません。

## 入力の境界

[image.ts](../../src/infrastructure/image.ts)は署名/寸法/容量を検証してから解析/復号します。[archive.ts](../../src/infrastructure/archive.ts)と[zip-stream.ts](../../src/infrastructure/zip-stream.ts)は許可パス、エントリ数、サイズ、展開比率、CRC/SHA-256、スキーマ、関係を検証します。モデルにはbasename制限があり、ユーザー由来ラベルはtextContent等で扱います。固定SVG等の静的HTML生成と、ユーザー文字列をHTMLへ挿入することは区別します。

これらは無欠陥やマルウェア耐性の認証ではありません。ブラウザのデコーダーや依存ライブラリの将来の脆弱性、すべての不正ファイルについて安全性を保証したとは記載しません。CSP/認証/ZIP暗号化の専用基盤を実装済みと推測しません。

## 公開時の注意

main履歴にはローカルパス/過去の実利用バックアップに言及する報告が残ります。画像の全件OCR/機密情報不存在の証明は未実施です。[公開前検査](PUBLICATION_REVIEW.md)にある所有者確認・ライセンス整備が済むまで、公開可と扱いません。秘密/実データを見つけても勝手に履歴を書き換えません。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`

## 2026-11-22 無料の世界地図に伴う追加通信

起動時のOpenFreeMapはLibertyになり、淡色選択時はPositron。航空/衛星写真を選ぶとHTTPSの`tiles.maps.eox.at`へ2016版WMTSタイル、地形を選ぶと`tiles.mapterhorn.com`へTerrarium標高タイルをGETする。スタイル/ラベル/フォント/スプライトは引き続き`tiles.openfreemap.org`。追加2配信元へは選択前に要求せず、先読み・大量ダウンロード・独自永続キャッシュを追加しない。

新規のスタイルfetchはcredentialsを省略し、referrerを送らない。地図タイル要求の閲覧地域やIP等が提供者/CDNへ伝わり得ることは従来同様で、表示UIと管理に説明する。写真・Exif・名前・所属を要求へ含めない。APIキー・アカウント・決済・分析SDKは追加しない。外部の規約/出典リンクを開くと通常の外部閲覧が発生する。

[所有者依頼と配信条件](../free-world-basemaps-2026-11-22.md)、[設定](../../src/infrastructure/basemap.ts)、[第三者通知](../../THIRD_PARTY_NOTICES.md)。無料配信の稼働/永続継続は保証しない。

今回の背景地図変更前基準Git HEAD: `b3142ba0cefd217ca015f6e8c2236761d6ccfd7e`

今回の世界背景地図の実装・検証の確認元Git HEAD: `d12df590a808604414a8a4ce6d3a2b02422aadbb`


## 2026-11-22 外部API資格情報の保護

Esri利用の所有者承諾に伴い、[資格情報規則](EXTERNAL_API_CREDENTIALS.md)を追加。公開検査にEsriキー候補を追加し、Viteの公開用環境変数に資格情報を設定した場合は起動・ビルド・previewを拒否する。キーの実値をエラーへ含めない。Esri接続、キー保存、PC内中継は未実装で、新しい通信は発生しない。[接続計画](../esri-key-security-2026-11-22.md)は構成承認前。写真/Exif・DB/ZIPの経路は変更しない。

今回キー保護変更前基準Git HEAD: `5cc666be292b6135b0bf901599279f4ea6db80ae`

今回キー保護実装・検証の確認元Git HEAD: `1d9becaa88a24b5050cd012d5a21f99eadb984c0`


## 2026-11-22 日本・米国本土の航空写真

所有者のキー不要・地域限定への変更依頼により、航空・衛星写真を選び拡大した対象矩形の閲覧時だけ、`cyberjapandata.gsi.go.jp`（日本）・`basemap.nationalmap.gov`（米国本土）へHTTPSの公開画像GETを追加。閲覧範囲やIP等は配信者へ伝わり得る。写真・Exif・名前・所属は付加せず、認証情報・APIキーを要求へ追加しない。大量取得/先読み/独自永続キャッシュなし。ラベルはOpenFreeMap、世界下地はEOX。Esri商用World Imagery・アカウント・PC内中継は今回の計画から取り下げ。既存の資格情報保護は維持する。[配信条件](../regional-imagery-2026-11-22.md)と[第三者通知](../../THIRD_PARTY_NOTICES.md)を参照。

今回地域画像変更前基準Git HEAD: `1fdcb271c166a8fed98238bab63f039110290e65`
