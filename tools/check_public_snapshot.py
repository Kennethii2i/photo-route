"""Check the public file allowlist, source integrity, safe media and secret patterns.

Run before staging. This is a static check, not a guarantee that no secret exists.
"""
import csv
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = {
    '.gitignore', '.nvmrc', 'AGENTS.md', 'CONTRIBUTING.md', 'README.md', 'LICENSE',
    'THIRD_PARTY_NOTICES.md', 'PUBLIC_FILES.txt', 'eslint.config.js', 'index.html',
    'package.json', 'package-lock.json', 'playwright.config.ts', 'tsconfig.json', 'vite.config.ts',
}
PREFIXES = ('src/', 'tests/', 'spikes/', 'fixtures/', 'tools/', 'docs/', 'third-party/', '.github/workflows/')
IGNORED = {'.git', 'node_modules', 'dist', '.validation', 'specs', 'test-results',
           'playwright-report', 'coverage', '.vite', '__pycache__'}


def public_files():
    files = []
    pending = [ROOT]
    while pending:
        for path in pending.pop().iterdir():
            if path.name in IGNORED:
                continue
            if path.is_symlink():
                raise ValueError(f'Symlink not allowed: {path.name}')
            if path.is_dir():
                pending.append(path)
            elif path.is_file():
                name = path.relative_to(ROOT).as_posix()
                assert name in ROOT_FILES or name.startswith(PREFIXES), name
                files.append(path)
    return sorted(files)


def check():
    files = public_files()
    names = {path.relative_to(ROOT).as_posix() for path in files}
    assert ROOT_FILES <= names, ROOT_FILES - names
    assets = list(csv.DictReader((ROOT / 'docs/specification/SAFE_ASSETS.csv').open(encoding='utf-8', newline='')))
    images = {name for name in names if Path(name).suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', '.gif', '.avif', '.svg', '.ico'}}
    assert len(assets) == 23 and images == {row['path'] for row in assets}
    for row in assets:
        assert hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() == row['sha256']
    manifest = json.loads((ROOT / 'docs/specification/SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
    for row in manifest['files']:
        path = ROOT / row['path']
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != row['sha256'] and (path.suffix in {'.ts', '.json', '.js', '.mjs', '.md', '.html', '.css', '.py', '.txt', '.csv'} or path.name == '.nvmrc'):
            # Windows core.autocrlf may change checkout line endings without changing the Git blob.
            digest = hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()
        assert digest == row['sha256'], row['path']
    expressions = {
        'personal-path': r'[A-Za-z]:[\\/](?:Users|home)[\\/]',
        'provider-token': r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{24,})\b',
        'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        'credential-assignment': r'''(?i)\b(?:api[_-]?key|access[_-]?token|password|secret)\b\s*[:=]\s*['"][^'"\r\n]{8,}['"]''',
    }
    findings = []
    for path in files:
        name = path.relative_to(ROOT).as_posix()
        assert path.suffix.lower() not in {'.zip', '.db', '.sqlite', '.sqlite3', '.log', '.pem', '.key'}, name
        assert not path.name.startswith('.env'), name
        assert path.stat().st_size <= 2 * 1024 * 1024, name
        if name in images:
            continue
        text = path.read_text(encoding='utf-8-sig')
        for kind, expression in expressions.items():
            if re.search(expression, text):
                findings.append((name, kind))
    assert not findings, findings
    workflows = {name for name in names if name.startswith('.github/')}
    assert workflows == {'.github/workflows/ci.yml'}, 'Only the reviewed quality CI workflow is permitted'
    listing = '\n'.join(sorted(names)) + '\n'
    assert (ROOT / 'PUBLIC_FILES.txt').read_text(encoding='utf-8') == listing, 'Update PUBLIC_FILES.txt after changing public files'
    result = {'public_files': len(files), 'safe_images': len(images), 'immutable_files': len(manifest['files']), 'secret_pattern_findings': len(findings)}
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    check()
