"""Check files intended for the current public repository before staging.

This static check cannot prove that every possible secret or personal datum is absent.
Ignored local files are excluded; tracked files are always checked.
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
PREFIXES = ('src/', 'tests/', 'spikes/', 'fixtures/', 'tools/', 'docs/', 'third-party/', '.github/')
BLOCKED_SUFFIXES = {'.zip', '.db', '.sqlite', '.sqlite3', '.log', '.pem', '.key'}
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', '.gif', '.avif', '.svg', '.ico'}
MUST_IGNORE = (
    '.env', '.env.local', 'private-probe/photo.jpg', 'profiles/probe/data',
    'chrome-profile-probe/data', 'probe.zip', 'probe.db', 'probe.sqlite',
    'probe.sqlite3', 'probe.pem', 'probe.key', '.validation/probe.txt',
    'node_modules/probe.js', 'dist/probe.js', 'test-results/probe.txt',
)

# Never return matched values: diagnostics must contain only the kind and path.
ESRI_CREDENTIAL_NAME = r'(?:VITE_|PUBLIC_|NEXT_PUBLIC_|REACT_APP_)?(?:ESRI|ARCGIS)_(?:API_KEY|ACCESS_TOKEN|TOKEN|KEY|CLIENT_SECRET)'
SECRET_EXPRESSIONS = {
    'personal-path': r'[A-Za-z]:[\\/](?:Users|home)[\\/]',
    'provider-token': r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{24,}|(?:AAPK|AAPT)[A-Za-z0-9._~-]{20,})\b',
    'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'credential-assignment': r'''(?i)\b(?:api[_-]?key|access[_-]?token|password|secret)\b\s*[:=]\s*['"][^'"\r\n]{8,}['"]''',
    'esri-credential-assignment': rf'''(?im)(?:\b{ESRI_CREDENTIAL_NAME}\b["']?\s*[:=]\s*["'][^"'\r\n]{{8,}}["']|^[ \t]*(?:export[ \t]+)?{ESRI_CREDENTIAL_NAME}[ \t]*=[ \t]*(?!["'$\r\n])[^\s#;]{{8,}})''',
}


def secret_findings(text):
    return [kind for kind, expression in SECRET_EXPRESSIONS.items() if re.search(expression, text)]


def check_ignore_policy():
    for name in MUST_IGNORE:
        ignored = subprocess.run(
            ['git', '-C', str(ROOT), 'check-ignore', '--no-index', '--quiet', '--', name],
            check=False,
        )
        assert ignored.returncode == 0, f'Expected .gitignore to cover: {name}'


def public_files():
    # Include tracked files even when ignored later; include untracked files only when
    # Git would stage them normally. This leaves private, ignored local inputs alone.
    raw = subprocess.check_output(
        ['git', '-C', str(ROOT), 'ls-files', '--cached', '--others', '--exclude-standard', '-z']
    )
    names = sorted({name.decode('utf-8') for name in raw.split(b'\0') if name})
    files = []
    for name in names:
        path = ROOT / name
        if path.is_symlink():
            raise ValueError(f'Symlink not allowed: {name}')
        if not path.is_file():
            raise ValueError(f'Missing public file: {name}')
        if name not in ROOT_FILES and not name.startswith(PREFIXES):
            raise ValueError(f'Unexpected public path: {name}')
        files.append(path)
    return files


def check():
    check_ignore_policy()
    files = public_files()
    names = {path.relative_to(ROOT).as_posix() for path in files}
    assert ROOT_FILES <= names, ROOT_FILES - names
    assets = list(csv.DictReader((ROOT / 'docs/specification/SAFE_ASSETS.csv').open(encoding='utf-8', newline='')))
    images = {name for name in names if Path(name).suffix.lower() in IMAGE_SUFFIXES}
    approved_images = {row['path'] for row in assets}
    assert len(assets) == len(approved_images) and images == approved_images, 'Review image provenance in SAFE_ASSETS.csv'
    for row in assets:
        assert hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest() == row['sha256']
    findings = []
    for path in files:
        name = path.relative_to(ROOT).as_posix()
        assert path.suffix.lower() not in BLOCKED_SUFFIXES, name
        assert not path.name.startswith('.env'), name
        assert path.stat().st_size <= 2 * 1024 * 1024, name
        if name in images:
            continue
        text = path.read_text(encoding='utf-8-sig')
        findings.extend((name, kind) for kind in secret_findings(text))
    assert not findings, findings
    result = {'public_files': len(files), 'approved_images': len(images), 'secret_pattern_findings': len(findings)}
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    check()
