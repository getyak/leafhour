"""Check exported bundle identity, signature, and release digest on macOS."""
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import zipfile

def validate_app_icons(app, info):
    primary = info.get('CFBundleIcons', {}).get('CFBundlePrimaryIcon', {})
    names = primary.get('CFBundleIconFiles', [])
    if primary.get('CFBundleIconName') != 'AppIcon' or not isinstance(names, list) or not names:
        raise ValueError('Exported app is missing compiled AppIcon metadata')
    if not (app / 'Assets.car').is_file() or not (app / 'Assets.car').stat().st_size:
        raise ValueError('Exported app is missing its compiled asset catalog')
    for name in names:
        if not isinstance(name, str) or not name or '/' in name or '\\' in name:
            raise ValueError('Invalid compiled AppIcon PNG name')
        images = list(app.glob(name + '*.png'))
        if not images or not all(image.read_bytes().startswith(b'\x89PNG\r\n\x1a\n') for image in images):
            raise ValueError('Exported AppIcon PNG is missing or invalid')


def main():
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
        validate_app_icons(app, info)
        subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True,capture_output=True)
        entitlements = subprocess.run(['codesign','-d','--entitlements',':-',str(app)],check=True,capture_output=True).stdout
        entitlements = plistlib.loads(entitlements)
        if entitlements.get('get-task-allow') is True or entitlements.get('com.apple.developer.team-identifier') != team or not entitlements.get('application-identifier','').endswith('.'+plan['bundleId']):
            sys.exit('Exported app has invalid distribution entitlements')
    plan['ipaSha256'] = hashlib.sha256(Path(ipa).read_bytes()).hexdigest()
    Path(plan_path).write_text(json.dumps(plan,indent=2)+'\n')


if __name__ == '__main__':
    main()
