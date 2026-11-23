# Third-party notices / 第三者のライセンス

Photo Route本体のコードは[MIT](LICENSE)です。この許諾は、権利者がライセンスできる本体コードを対象とし、以下の第三者ソフトウェア・地図等をMITへ変更するものではありません。各原文の著作権/免責/許諾を保持します。

## npmソフトウェア

[全195件の版・ライセンス・配布元・完全性ハッシュ・通知元](third-party/DEPENDENCIES.json)と[簡易一覧](docs/specification/DEPENDENCIES.csv)を同梱しています。npm ciで導入した167パッケージの通知原文/抽出元をthird-party/licensesに保存しました。Windowsで導入されなかった28件は他プラットフォーム等の任意依存で、ソース/バイナリを本リポジトリへコピーしていません。各版の公式取得先はJSONとpackage-lockにあります。

| 本番の直接依存 | 条件・通知 | 対応するソース |
|---|---|---|
| MapLibre GL JS 6.18.0 | [BSD-3-Clause](third-party/licenses/maplibre-gl/LICENSE.txt) | [MapLibre](https://github.com/maplibre/maplibre-gl-js)、正確なnpmアーカイブは依存JSON |
| ExifReader 4.54.0 | [MPL-2.0](third-party/licenses/exifreader/LICENSE) | [4.54.0ソース付きnpmアーカイブ](https://registry.npmjs.org/exifreader/-/exifreader-4.54.0.tgz)、[上流ソース](https://github.com/mattiasw/ExifReader) |
| fflate 0.8.3 | [MIT](third-party/licenses/fflate/LICENSE) | [上流ソース](https://github.com/101arrowz/fflate)、版は依存JSON |
| Zod 4.6.7 | [MIT](third-party/licenses/zod/LICENSE) | [上流ソース](https://github.com/colinhacks/zod)、版は依存JSON |

本番の推移的依存の通知もJSONから各原文へ到達できます。ExifReaderの対象ソースはMPL-2.0のままです。未改変の上流を利用し、実行形式を配布する場合も受領者が上記の対応ソースを取得できる案内とMPLの権利を維持してください。[Mozilla公式FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)参照。

開発用のheic-to（LGPL-3.0、実物ではv3以降も可）、lightningcss（MPL-2.0）等の通知も含みます。これらの開発バイナリやnode_modulesは配布対象外です。現行アプリはheic-toをimportしません。将来HEIC復号/WASMを同梱するならlibheif/libde265等を含めて、対応ソース、再リンク等の条件を別途確認してください。

通知を同梱しない6パッケージは、配布JSヘッダー/READMEの許諾部分、または同一プロジェクトのLICENSEから抽出し、JSONのnotice_provenanceに根拠を記録しました。OSの異なる配布や依存更新時は`python tools/collect_third_party.py`と実際の配布内容を照合します。第三者の通知メール/著作権者は原文の公開情報であり、Photo Route所有者の連絡先ではありません。

ビルドはMapLibre worker等の同梱物を生成します。distだけを将来配布する場合は、この通知、third-party/licenses、依存JSONと対応ソース案内も受領者が参照できる形で一緒に配布してください。Viteが通知一式を自動コピーすると仮定しないでください。今回はdistをGitへ追加せず、Web公開もしません。

## 地図・スタイル・フォント・地図用アイコン

背景地図は実行時にOpenFreeMapから取得し、タイル/スタイル/フォントをリポジトリへコピーしていません。既存の地図上の帰属表示を維持します。

- [OpenFreeMap公式内訳](https://github.com/hyperknot/openfreemap/blob/main/LICENSE.md): サービスコードMITと、配信される地図の条件を区別します。
- [OpenStreetMap](https://www.openstreetmap.org/copyright): データはODbL。表示ではOpenStreetMapへの帰属を保持します。
- OpenMapTiles: コードBSD-3-Clause、デザインCC BY 4.0。地図内のクレジットを保持します。
- Positron: GLスタイルコードBSD-3-Clause、デザインCC BY 4.0、基となるCartoDB/Stamen/Paul NormanのデザインはCC BY 3.0。詳細は上記公式内訳を参照。
- スタイルのNoto SansはSIL OFL 1.1、MakiアイコンはCC0。MapLibre内部の画像/スタイルはそのライセンスに従います。

帰属の基本表記: OpenFreeMap · © OpenMapTiles · Data from OpenStreetMap。[OpenFreeMapの案内](https://openfreemap.org/)と[OSMF帰属指針](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)を確認してください。提供内容が変わる場合は実配信スタイルのクレジットも確認します。

## アプリのアイコン・試験画像

固定SVGは本体ソース中のパスで、外部アイコンファイルをコピーしていません。外部アイコンライブラリの新規採用はありません。第三者素材を追加する際は出典/条件/クレジットを記録してください。

同梱画像23件は[合成素材台帳](docs/specification/SAFE_ASSETS.md)のfixtureだけです。実写真、過去スクリーンショット、参考デザイン画像、写真バックアップは含みません。本体コードへのMIT適用を、未知の画像や地図の権利へ拡張しないでください。

## 2026-11-22 世界背景の追加配信

- OpenFreeMap Libertyも利用する。[公式内訳](https://github.com/hyperknot/openfreemap/blob/main/LICENSE.md)ではOSM LibertyはOSM Bright由来、styleコードBSD-3-Clause・デザインCC BY 4.0。配信styleをブラウザ内で合成し、帰属を維持する。地図ファイル/フォント/スプライトをリポジトリに同梱しない。
- EOX cloudlessは**2016版限定**。[公式FAQ](https://cloudless.eox.at/documentation/faq)がCC BY 4.0、商用含む無料公開endpoint利用、Fair Use、SLAなしを明示。正規帰属は「EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)」。地図上で帰属/CC BYリンクを表示する。2018年以降へ自動更新せず、原タイルの再配布/販売/独自キャッシュは追加しない。
- Mapterhornは[公開配信](https://mapterhorn.com/data-access/)を実行時に取得し、地図上の[出典一覧](https://mapterhorn.com/attribution/)を保持する。提供元コードのBSD-3と、各元標高資料の利用条件は別。元データ/タイルは同梱しない。

本体MITを外部地図へ適用しない。今回追加するnpm依存はない。[配信条件と検証記録](docs/free-world-basemaps-2026-11-22.md)。


## 日本・米国本土の地域航空写真（2026-11-22）

- 地理院seamlessphoto z14–18：[タイル一覧](https://maps.gsi.go.jp/development/ichiran.html#seamlessphoto)、[コンテンツ規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)。現行はPDL1.0と個別の第三者条件。地図上は地理院タイルから一覧へのリンクと、該当範囲用の「GRUS画像（© Axelspace）」を日本sourceの帰属へ常時表示する。写真を加工/同梱せず、閲覧用タイルを公開endpointから読む。
- USGSImageryOnly：[現行サービス](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer)、[公式サービス案内](https://www.usgs.gov/faqs/what-are-urls-imagery-services-national-map-and-are-they-cached-or-dynamic)。米国本土の要求矩形に限定、z14–16。主に公共領域のNAIP等、地域により画像が異なる。アラスカのSPOT等を今回の対象へ含めず、サービス全域を一律CC0と称さない。地図上は「USDA, USGS The National Map: Orthoimagery」とサービスへのリンクを維持。

原画像・タイルをリポジトリへ同梱しない。アカウント・キー不要で通常の閲覧要求を行い、大量取得/原ラスタexport/独自永続キャッシュは追加しない。提供者の利用条件は本体MITへ置き換えず、SLAや将来の無料継続を保証しない。

今回地域画像変更前基準Git HEAD: `1fdcb271c166a8fed98238bab63f039110290e65`

今回地域画像の実装・検証の確認元Git HEAD: `7199cdc7329960b059946a216bcead6e50d46cbd`


## 「もっと見る」の3地図（2026-11-23）

鉄道/散策は取得したOpenFreeMap Libertyの表示をPhoto Routeが用途別に調整する。元データ・帰属・元styleの条件を維持し、styleファイル/タイルを同梱しない。散策の標高は従来のMapterhorn条件を引き継ぐ。

Darkは[OpenFreeMap公式style](https://openfreemap.org/quick_start/)と[公開fork](https://github.com/hyperknot/openfreemap-styles)を実行時に利用する。元となる[Dark Matterの許諾](https://github.com/openmaptiles/dark-matter-gl-style/blob/master/LICENSE.md)はコードBSD-3-Clause、デザインCC BY 4.0、CartoDB/Stamen/Paul Norman由来部分CC BY 3.0。地図上のOpenMapTiles/OpenStreetMap等の実際の帰属を維持し、本体MITへ置き換えない。

今回追加地図変更前基準Git HEAD: `7d24340be57d17bbec6237de5df252fef71bb549`
