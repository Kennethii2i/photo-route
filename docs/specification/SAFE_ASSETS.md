# 公開版に含む合成素材

公開対象は23画像だけです。実写真・過去の画面画像・デザイン参考画像・ZIPは含みません。[SAFE_ASSETS.csv](SAFE_ASSETS.csv)は全23パスのSHA-256/サイズ/由来を記録します。

- fixtures/generated: 16画像。[基本生成器](../../tools/generate_fixtures.py)と[manifest](../../fixtures/generated/manifest.json)。
- fixtures/camera: 4画像。[生成器](../../tools/generate_camera_jpeg_fixtures.py)と[manifest](../../fixtures/camera/manifest.json)。cameraという名前でも実カメラ写真ではありません。
- fixtures/heif: 2画像。[生成器](../../tools/generate_heif_fixtures.py)と[manifest](../../fixtures/heif/manifest.json)。
- spikes/p0-t04-followup/fixtures/synthetic_2048.heic: [生成器](../../tools/generate_large_heic_probe.py)の合成HEIC。SHA-256はCSVに記録。

22 fixtureはmanifestの全ハッシュと一致し、追加HEICは参照元の検証済みハッシュと一致します。ピクセル・Exif日時・GPSは架空で、個人の撮影記録ではありません。不正寸法PNG/切断JPEGは安全な拒否検証用です。画像ビューアで無制限に復号しないでください。

本体コードへのMIT採用と、非コードの生成物の適用範囲は区別します。fixtureに第三者写真は含まれませんが、著作権者表記と非コード素材の最終利用条件は公開前に所有者が確認してください。素材を第三者のものと無条件に再ライセンスする指示ではありません。

地図タイル/スタイル/フォントは静的画像として同梱していません。実行時の外部取得と帰属については[第三者通知](../../THIRD_PARTY_NOTICES.md)と[プライバシー](SECURITY_PRIVACY.md)を参照します。アプリの固定SVGパスは[album-icons.ts](../../src/presentation/album-icons.ts)内のコードで、外部アイコン画像/新しいアイコンライブラリを同梱していません。MapLibre/地図スタイル内部のアイコンは提供元の条件を保持します。

仕様の確認元Git HEAD: `989eae47f3ae96fa557b97eb5d7cb63e47e77f9e`
