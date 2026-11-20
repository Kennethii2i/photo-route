"""サブパス用ビルドのHTML資産/明示worker URLを静的に確認する。公開/サーバー起動はしない。"""
import argparse
import re
from pathlib import Path
from urllib.parse import unquote

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory')
parser.add_argument('base')
args = parser.parse_args()
root = Path(args.directory).resolve()
base = args.base
if not base.startswith('/') or not base.endswith('/'):
    raise SystemExit('baseは先頭/末尾が / のパスを指定してください')
html = (root / 'index.html').read_text(encoding='utf-8')
assets = re.findall(r'(?:src|href)="(' + re.escape(base) + r'[^\"]+)"', html)
if not assets:
    raise SystemExit('HTMLからbase配下の資産が参照されていません')


def exists(url):
    file = (root / unquote(url.removeprefix(base))).resolve()
    return file.is_relative_to(root) and file.is_file()


if not all(exists(url) for url in assets):
    raise SystemExit('HTML参照先がありません')
scripts = '\n'.join(file.read_text(encoding='utf-8') for file in (root / 'assets').glob('index-*.js'))
workers = re.findall(r'''["'`](''' + re.escape(base) + r'''assets/maplibre-gl-worker-[^"'`]+)["'`]''', scripts)
if not workers or not all(exists(url) for url in workers):
    raise SystemExit('MapLibre workerのbase/参照先が不正です')
if 'tiles.openfreemap.org/styles/positron' not in scripts:
    raise SystemExit('既定OpenFreeMapのHTTPSスタイルURLを確認できません')
print(f'静的検査合格: HTML資産{len(assets)}、worker参照{len(workers)}、OpenFreeMap HTTPS URL維持')
print('ブラウザ/実際のGitHub Pages/ZIP保存復元は未実行')
