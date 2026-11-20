"""Collect installed dependency notices without copying dependency code or binaries."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def collect():
    lock = json.loads((ROOT / 'package-lock.json').read_text(encoding='utf-8'))
    records = []
    mit_body = 'Permission is hereby' + (ROOT / 'LICENSE').read_text(encoding='utf-8').split('Permission is hereby', 1)[1]
    for path, package in lock['packages'].items():
        if not path:
            continue
        folder = ROOT / path
        name = path.removeprefix('node_modules/')
        notices, provenance = [], []
        if folder.is_dir():
            target = ROOT / 'third-party' / 'licenses' / name.replace('/', '__')
            target.mkdir(parents=True, exist_ok=True)
            for file in folder.iterdir():
                if file.is_file() and file.name.lower().startswith(('license', 'licence', 'notice', 'copying', 'copyright')):
                    output = target / file.name
                    output.write_bytes(file.read_bytes())
                    notices.append(output.relative_to(ROOT).as_posix())
                    provenance.append(f'{path}/{file.name}')
            if not notices:
                read = lambda file: file.read_text(encoding='utf-8')
                if name == 'esrecurse':
                    text = read(folder / 'esrecurse.js').split('*/', 1)[0] + '*/\n'
                    source = f'{path}/esrecurse.js copyright/license header'
                elif name in ('imurmurhash', 'murmurhash-js'):
                    text = read(folder / 'README.md').split('License (MIT)', 1)[1]
                    source = f'{path}/README.md license section'
                elif name == 'natural-compare':
                    text = read(folder / 'README.md').split('Licence\n-------', 1)[1].strip() + '\n\n' + mit_body
                    source = f'{path}/README.md copyright and MIT declaration; standard MIT body'
                elif name == '@humanfs/types':
                    text = read(ROOT / 'node_modules/@humanfs/core/LICENSE')
                    source = 'node_modules/@humanfs/core/LICENSE (same humanfs monorepo Apache-2.0); types/package.json identifies author'
                elif name == '@rolldown/binding-win32-x64-msvc':
                    text = read(ROOT / 'node_modules/rolldown/LICENSE')
                    source = 'node_modules/rolldown/LICENSE (same 1.2.19 release and repository)'
                else:
                    raise RuntimeError(f'No notice source; inspect {name} before distribution')
                output = target / 'LICENSE-extracted.txt'
                output.write_text(text, encoding='utf-8')
                notices.append(output.relative_to(ROOT).as_posix())
                provenance.append(source)
        records.append({
            'name': name, 'version': package['version'], 'license': package.get('license'),
            'dev': package.get('dev', False), 'optional': package.get('optional', False),
            'source_archive': package.get('resolved'), 'integrity': package.get('integrity'),
            'notice_files': notices, 'notice_provenance': provenance,
            'installed_for_verification': folder.is_dir(),
        })
    assert all(row['notice_files'] for row in records if row['installed_for_verification'])
    (ROOT / 'third-party/DEPENDENCIES.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"{len(records)} lock entries; {sum(row['installed_for_verification'] for row in records)} installed packages with notices")


if __name__ == '__main__':
    collect()
