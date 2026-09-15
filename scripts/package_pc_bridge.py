"""Package the PC bridge separately; does not publish, upload or print."""
from pathlib import Path
import argparse
from datetime import datetime, timezone
import hashlib
import json
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--version', required=True)
args = parser.parse_args()
release = root / 'release' / args.version
dest = release / 'pc-bridge'
dest.mkdir(parents=True, exist_ok=True)
files = {
    'tm_send.py': 'scripts/tm_send.py',
    'Send-Model.ps1': 'scripts/Send-Model.ps1',
    'README.md': 'docs/slicers.md',
    'TinyMaker.ini': 'PrusaSlicer/TinyMaker.ini',
    'tests/test_tm_send_bridge.py': 'scripts/tests/test_tm_send_bridge.py',
    'tests/test_tm_send_watch.py': 'scripts/tests/test_tm_send_watch.py',
    'validation/conversion-result.json': '.cache/bridge-validation/conversion-result.json',
    'validation/live-upload-result.json': '.cache/bridge-validation/live-upload-result.json',
    'validation/device-installation.json': f'release/{args.version}/device-installation.json',
}
for name, rel in files.items():
    path = dest / name
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / rel, path)
license_text = (root/'LICENSE.md').read_text(encoding='utf-8')
(dest/'LICENSE.md').write_text(license_text[license_text.index('**FIRMWARE:'):], encoding='utf-8')
receipt = root / '.cache/bridge-validation/regression-result.json'
if receipt.is_file():
    shutil.copy2(receipt, dest/'validation/regression-result.json')
live_receipt = root / '.cache/import-receipt-validation/live-results.json'
if live_receipt.is_file():
    shutil.copy2(live_receipt, dest/'validation/live-import-results.json')
manifest = {'packagedAt': datetime.now(timezone.utc).isoformat(),
            'product': 'TinyMaker PC slicer bridge', 'files': {}}
for path in sorted(dest.rglob('*')):
    if path.is_file() and path.name != 'manifest.json':
        manifest['files'][path.relative_to(dest).as_posix()] = {
            'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
(dest/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
archive = release / f'TinyMaker-PC-Bridge-{args.version}.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
    for path in sorted(dest.rglob('*')):
        if path.is_file():
            zipped.write(path, 'TinyMaker-PC-Bridge/' + path.relative_to(dest).as_posix())
print(json.dumps({'folder':str(dest),'zip':str(archive),'bytes':archive.stat().st_size,
                  'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()}, indent=2))
