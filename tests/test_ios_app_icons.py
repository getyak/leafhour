import importlib.util
from pathlib import Path
import tempfile
import unittest
import plistlib

spec = importlib.util.spec_from_file_location('verify_ipa', Path(__file__).parents[1] / 'scripts/ios/verify-ipa.py')
verify_ipa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_ipa)


class AppIconsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.app = Path(self.directory.name)
        self.info = {'CFBundleIcons': {'CFBundlePrimaryIcon': {'CFBundleIconName': 'AppIcon', 'CFBundleIconFiles': ['AppIcon60x60']}}}
        (self.app / 'Assets.car').write_bytes(b'isolated asset catalog fixture')
        (self.app / 'AppIcon60x60@2x.png').write_bytes(b'\x89PNG\r\n\x1a\nfixture')

    def test_compiled_icon_metadata_and_files_are_required_together(self):
        verify_ipa.validate_app_icons(self.app, self.info)
        (self.app / 'AppIcon60x60@2x.png').unlink()
        with self.assertRaisesRegex(ValueError, 'PNG'):
            verify_ipa.validate_app_icons(self.app, self.info)

    def test_missing_or_wrong_primary_icon_is_rejected(self):
        for info in [{}, {'CFBundleIcons': {'CFBundlePrimaryIcon': {'CFBundleIconName': 'Other'}}}, {'CFBundleIcons': {'CFBundlePrimaryIcon': {'CFBundleIconName': 'AppIcon'}}}]:
            with self.subTest(info=info), self.assertRaises(ValueError):
                verify_ipa.validate_app_icons(self.app, info)

    def test_missing_compiled_catalog_or_invalid_png_is_rejected(self):
        (self.app / 'Assets.car').unlink()
        with self.assertRaisesRegex(ValueError, 'catalog'):
            verify_ipa.validate_app_icons(self.app, self.info)
        (self.app / 'Assets.car').write_bytes(b'fixture')
        (self.app / 'AppIcon60x60@2x.png').write_bytes(b'not an image')
        with self.assertRaisesRegex(ValueError, 'PNG'):
            verify_ipa.validate_app_icons(self.app, self.info)

    def test_embedded_listening_extension_has_exact_identity_version_and_extension_point(self):
        extension = self.app / 'PlugIns' / 'ListeningWidget.appex'
        extension.mkdir(parents=True)
        plan = {'bundleId': 'example.verified', 'version': '1.0.0', 'buildNumber': '17'}
        info = {'CFBundleIdentifier': 'example.verified.listening', 'CFBundleShortVersionString': '1.0.0',
                'CFBundleVersion': '17', 'NSExtension': {'NSExtensionPointIdentifier': 'com.apple.widgetkit-extension'}}
        (extension / 'Info.plist').write_bytes(plistlib.dumps(info))
        verify_ipa.validate_embedded_extensions(self.app, plan)
        for key, value in [('CFBundleIdentifier', 'example.other'), ('CFBundleVersion', '18'), ('NSExtension', {})]:
            (extension / 'Info.plist').write_bytes(plistlib.dumps({**info, key: value}))
            with self.subTest(key=key), self.assertRaises(ValueError):
                verify_ipa.validate_embedded_extensions(self.app, plan)
        (extension / 'Info.plist').write_bytes(plistlib.dumps(info))
        other = self.app / 'PlugIns' / 'Unknown.appex'; other.mkdir()
        with self.assertRaises(ValueError):
            verify_ipa.validate_embedded_extensions(self.app, plan)


if __name__ == '__main__':
    unittest.main()
