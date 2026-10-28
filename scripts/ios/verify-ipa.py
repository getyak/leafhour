"""Check exported bundle identity, signature, and release digest on macOS."""
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import zipfile

ipa, plan_path, team = sys.argv[1:]
plan = json.loads(Path(plan_path).read_text())
with tempfile.TemporaryDirectory(prefix='leafhour-ipa-') as root:
    with zipfile.ZipFile(ipa) as archive:
        for name in archive.namelist():
            if Path(name).is_absolute() or '..' in Path(name).parts:
                sys.exit('Unsafe IPA archive path')
        archive.extractall(root)
    apps = list((Path(root) / 'Payload').glob('*.app'))
    if len(apps) != 1:
        sys.exit('Expected exactly one archived app')
    app = apps[0]
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    for key, value in {'CFBundleIdentifier':plan['bundleId'], 'CFBundleShortVersionString':plan['version'], 'CFBundleVersion':plan['buildNumber']}.items():
        if info.get(key) != value:
            sys.exit('Exported app differs from plan: ' + key)
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True,capture_output=True)
    entitlements = subprocess.run(['codesign','-d','--entitlements',':-',str(app)],check=True,capture_output=True).stdout
    entitlements = plistlib.loads(entitlements)
    if entitlements.get('get-task-allow') is True or entitlements.get('com.apple.developer.team-identifier') != team or not entitlements.get('application-identifier','').endswith('.'+plan['bundleId']):
        sys.exit('Exported app has invalid distribution entitlements')
plan['ipaSha256'] = hashlib.sha256(Path(ipa).read_bytes()).hexdigest()
Path(plan_path).write_text(json.dumps(plan,indent=2)+'\n')
