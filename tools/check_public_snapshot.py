"""Verify the immutable first-publication source manifest against the initial Git commit.

This is a historical provenance check, not a gate for current source edits. It needs
the initial public commit in local history and never reads private source history.
Run check_public_safety.py for files proposed for today's public repository.
"""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INITIAL_PUBLIC_COMMIT = 'f8d0c34c8af8a1048bcfe8500d3d52c5935ceb17'
MANIFEST_PATH = 'docs/specification/SOURCE_MANIFEST.json'


def initial_blob(path):
    return subprocess.check_output(['git', '-C', str(ROOT), 'show', f'{INITIAL_PUBLIC_COMMIT}:{path}'])


def check():
    roots = subprocess.check_output(
        ['git', '-C', str(ROOT), 'rev-list', '--max-parents=0', 'HEAD'], text=True
    ).splitlines()
    assert roots == [INITIAL_PUBLIC_COMMIT], 'The expected independent public root commit is unavailable'
    recorded = json.loads((ROOT / MANIFEST_PATH).read_text(encoding='utf-8'))
    original = json.loads(initial_blob(MANIFEST_PATH))
    assert recorded == original, 'Historical SOURCE_MANIFEST.json was changed'
    for row in original['files']:
        digest = hashlib.sha256(initial_blob(row['path'])).hexdigest()
        assert digest == row['sha256'], row['path']
    result = {'initial_public_commit': INITIAL_PUBLIC_COMMIT, 'historical_source_files': len(original['files'])}
    print(json.dumps(result))
    return result


if __name__ == '__main__':
    check()
