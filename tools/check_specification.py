"""正式仕様の相対リンク・参照ソース・確認HEADを検査する（標準ライブラリのみ）。"""
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / 'docs' / 'specification'
REQUIRED = ['INDEX', 'PRODUCT', 'FEATURES', 'ARCHITECTURE', 'DATA_MODEL', 'STORAGE_AND_BACKUP',
            'UI_UX', 'MAP_AND_GEO', 'IMPORT_AND_PHOTOS', 'ERRORS_AND_RECOVERY', 'SECURITY_PRIVACY',
            'TESTING', 'DEVELOPMENT', 'KNOWN_LIMITATIONS', 'CHANGELOG']


def check():
    errors, links, source_links, diagrams = [], 0, 0, 0
    for name in REQUIRED:
        if not (SPEC / f'{name}.md').is_file():
            errors.append(f'必須文書なし: {name}.md')
    files = sorted(SPEC.glob('*.md')) + [ROOT / name for name in ['README.md', 'AGENTS.md', 'CONTRIBUTING.md']]
    for file in files:
        if not file.is_file():
            errors.append(f'文書なし: {file.name}')
            continue
        text = file.read_text(encoding='utf-8')
        relative = file.relative_to(ROOT)
        if not re.search(r'Git HEAD: `([0-9a-f]{40})`\s*$', text):
            errors.append(f'確認元HEADの末尾表記なし: {relative}')
        if len(re.findall(r'^```', text, re.M)) % 2:
            errors.append(f'コードフェンス不整合: {relative}')
        diagrams += text.count('```mermaid')
        without_code = re.sub(r'```.*?```', '', text, flags=re.S)
        for match in re.finditer(r'!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)', without_code):
            target = match.group(1).strip('<>')
            parts = urlsplit(target)
            if parts.scheme or parts.netloc:
                continue
            path = unquote(parts.path)
            resolved = (file.parent / path).resolve() if path else file
            links += 1
            if not resolved.is_relative_to(ROOT):
                errors.append(f'リポジトリ外参照: {relative}: {target}')
            elif not resolved.exists():
                errors.append(f'リンク切れ: {relative}: {target}')
            else:
                # Windowsの大文字小文字非区別でGitHub上のリンク切れを見逃さない。
                local = resolved.relative_to(ROOT)
                parent = ROOT
                for part in local.parts:
                    if part not in {entry.name for entry in parent.iterdir()}:
                        errors.append(f'大文字小文字の不一致: {relative}: {target}')
                        break
                    parent /= part
                if resolved.is_relative_to(ROOT / 'src'):
                    source_links += 1
        if file.name != 'INDEX.md' and file.parent == SPEC and file.name in [f'{n}.md' for n in REQUIRED] and not re.search(r'^# ', text):
            errors.append(f'タイトルなし: {relative}')
    readme = (ROOT / 'README.md').read_text(encoding='utf-8')
    if '(docs/specification/INDEX.md)' not in readme:
        errors.append('READMEから正式仕様INDEXへのリンクなし')
    print(f'文書 {len(files)} / 相対リンク {links} / ソース参照 {source_links} / Mermaid図 {diagrams}')
    for error in errors:
        print(error)
    if errors:
        raise SystemExit(1)
    print('検査合格（外部URL取得・Mermaid実描画・仕様の動作検証はこのスクリプトの対象外）')


if __name__ == '__main__':
    check()
