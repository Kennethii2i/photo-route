"""公開準備の静的検査。Git/写真/ZIPを変更せず、秘密候補の値も出力しない。"""
import argparse
import collections
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', '-c', 'core.quotepath=false', *args], cwd=ROOT)


def audit(ref):
    lines = git('rev-list', '--objects', ref).decode('utf-8').splitlines()
    paths = {}
    for line in lines:
        oid, _, name = line.partition(' ')
        paths[oid] = name
    checked = subprocess.run(['git', 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
                             input=('\n'.join(paths) + '\n').encode(), stdout=subprocess.PIPE, check=True, cwd=ROOT)
    blobs = []
    for line in checked.stdout.decode().splitlines():
        oid, kind, size = line.split()
        if kind == 'blob':
            blobs.append({'oid': oid, 'path': paths[oid], 'bytes': int(size)})
    current = git('ls-tree', '-r', '-l', ref).decode('utf-8').splitlines()
    current_files = []
    for line in current:
        meta, name = line.split('\t', 1)
        _, _, oid, size = meta.split()
        current_files.append({'path': name, 'oid': oid, 'bytes': int(size)})
    patterns = {
        'provider-token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{24,})\b'),
        'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
        'credential-assignment': re.compile(r'''(?i)\b(?:api[_-]?key|access[_-]?token|password|secret)\b\s*[:=]\s*['"][^'"\r\n]{8,}['"]'''),
        'local-windows-path': re.compile(r'[A-Za-z]:[\\/](?:Users|home)[\\/]', re.I),
        'email': re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'),
    }
    findings, skipped, binary = [], [], 0
    batch = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    text_count = 0
    try:
        for blob in blobs:
            if blob['bytes'] > 20 * 1024 * 1024:
                skipped.append(blob)
                continue
            batch.stdin.write((blob['oid'] + '\n').encode()); batch.stdin.flush()
            header = batch.stdout.readline().decode().split()
            data = batch.stdout.read(int(header[2])); batch.stdout.read(1)
            if b'\x00' in data:
                binary += 1
                continue
            try:
                text = data.decode('utf-8-sig')
            except UnicodeDecodeError:
                binary += 1
                continue
            text_count += 1
            for category, pattern in patterns.items():
                matches = list(pattern.finditer(text))
                if matches:
                    findings.append({**blob, 'category': category, 'count': len(matches),
                                     'lines': sorted({text.count('\n', 0, match.start()) + 1 for match in matches})[:30]})
    finally:
        batch.stdin.close(); batch.wait()
    all_names = set(git('log', ref, '--format=', '--name-only').decode('utf-8').splitlines()) - {''}
    metadata = git('log', ref, '--format=%H%x09%an%x09%ae').decode('utf-8').splitlines()
    author_count = len({line.split('\t', 1)[1] for line in metadata})
    messages = git('log', ref, '--format=%H%x00%B%x00').decode('utf-8').split('\0')
    commit_findings = []
    for index in range(0, len(messages) - 1, 2):
        commit, body = messages[index].strip(), messages[index + 1]
        for category, pattern in patterns.items():
            count = len(pattern.findall(body))
            if count:
                commit_findings.append({'commit': commit, 'category': category, 'count': count})
    risky_names = sorted(name for name in all_names if re.search(r'(^|/)(\.env(?:\.|$)|.*\.(?:zip|sqlite|db|log|pem|key)$)', name, re.I))
    lock = json.loads((ROOT / 'package-lock.json').read_text(encoding='utf-8'))
    licenses = []
    for name, package in lock.get('packages', {}).items():
        if name:
            licenses.append({'path': name, 'version': package.get('version'), 'license': package.get('license', '未記載'), 'dev': package.get('dev', False)})
    return {
        'ref': ref, 'head': git('rev-parse', ref).decode().strip(),
        'commits': int(git('rev-list', '--count', ref)), 'historicalPathCount': len(all_names),
        'currentFiles': len(current_files), 'currentBytes': sum(b['bytes'] for b in current_files),
        'uniqueHistoryBlobs': len(blobs), 'uniqueHistoryBytes': sum(b['bytes'] for b in blobs),
        'textBlobsScanned': text_count, 'binaryBlobs': binary, 'skippedLargeBlobs': skipped,
        'findings': findings, 'riskyHistoricalNames': risky_names,
        'commitMessageFindings': commit_findings, 'authorIdentityCount': author_count,
        'largeHistoryBlobs': sorted([b for b in blobs if b['bytes'] >= 1024 * 1024], key=lambda b: -b['bytes']),
        'currentScreenshots': [b for b in current_files if '/screenshots/' in b['path']],
        'currentMedia': [b for b in current_files if re.search(r'\.(png|jpg|jpeg|webp|heic|heif|zip)$', b['path'], re.I)],
        'licenseInventory': licenses,
        'licenseCounts': dict(collections.Counter(item['license'] for item in licenses)),
        'limits': ['バイナリの秘密情報・実写真判定・OCRは自動検査しない', '20MiB超のblobは内容検査せず一覧化', '高エントロピー文字列全般の検出ではない', '秘密候補の値は出力しない'],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref', default='main')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    report = audit(args.ref)
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ['head', 'commits', 'currentFiles', 'currentBytes', 'uniqueHistoryBlobs', 'uniqueHistoryBytes', 'textBlobsScanned', 'binaryBlobs', 'licenseCounts']}, ensure_ascii=False))
    print('秘密形式候補:', sum(1 for f in report['findings'] if f['category'] in ['provider-token', 'private-key', 'credential-assignment']))
    print('履歴の要確認ファイル名:', len(report['riskyHistoricalNames']))
