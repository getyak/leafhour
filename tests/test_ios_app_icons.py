import importlib.util
from pathlib import Path
import tempfile
import unittest

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


if __name__ == '__main__':
    unittest.main()
