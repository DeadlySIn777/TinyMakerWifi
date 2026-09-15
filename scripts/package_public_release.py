"""Prepare public firmware/bridge downloads without local logs or user designs.

This command only writes local files. It never publishes or contacts a printer.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--version', required=True)
parser.add_argument('--commit', required=True)
args = parser.parse_args()
if not all(c in '0123456789.' for c in args.version) or len(args.commit) != 40 or any(c not in '0123456789abcdef' for c in args.commit):
    parser.error('Use a numeric version and full verified Git commit.')
root = Path(__file__).resolve().parents[1]
release = root / 'release' / args.version
manifest = json.loads((release / 'manifest.json').read_text(encoding='utf-8'))
dest = root / '.cache' / 'public-release' / args.version
dest.mkdir(parents=True, exist_ok=True)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

files = {}
for suffix in ['OTA.bin', 'full-USB.bin']:
    name = f'TinyMaker-{args.version}-{suffix}'
    path = release / name
    if sha(path) != manifest['files'][name]['sha256']:
        raise SystemExit('Artifact changed since verification: ' + name)
    shutil.copy2(path, dest / name)
    files[name] = {'bytes': path.stat().st_size, 'sha256': sha(path)}

bridge_name = f'TinyMaker-PC-Bridge-{args.version}.zip'
bridge_files = {
    'tm_send.py': 'scripts/tm_send.py',
    'Send-Model.ps1': 'scripts/Send-Model.ps1',
    'README.md': 'docs/slicers.md',
    'TinyMaker.ini': 'PrusaSlicer/TinyMaker.ini',
}
with zipfile.ZipFile(dest / bridge_name, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, source in bridge_files.items():
        archive.write(root / source, 'TinyMaker-PC-Bridge/' + name)
    license_text = (root / 'LICENSE.md').read_text(encoding='utf-8')
    archive.writestr('TinyMaker-PC-Bridge/LICENSE.md', license_text[license_text.index('**FIRMWARE:'):])
files[bridge_name] = {'bytes': (dest / bridge_name).stat().st_size, 'sha256': sha(dest / bridge_name)}
public = {'product':'DeadlySIn777 TinyMaker Studio fork', 'version':args.version,
          'sourceCommit':args.commit, 'firmwareBuild':manifest['build'],
          'files':files, 'firmwareSourceHashes':manifest['source'],
          'validation':'See release notes for the software checks; no physical print quality is claimed.'}
(dest / 'manifest.json').write_text(json.dumps(public, indent=2)+'\n', encoding='utf-8')
(dest / 'SHA256SUMS.txt').write_text(''.join(v['sha256']+'  '+k+'\n' for k,v in files.items()), encoding='utf-8')
print(json.dumps({'directory':str(dest), 'files':files}, indent=2))
