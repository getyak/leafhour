import datetime as dt
import importlib.util
from pathlib import Path
import unittest

module_path = Path(__file__).parents[1] / 'scripts/ios/signing.py'
spec = importlib.util.spec_from_file_location('signing', module_path)
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


class SigningTest(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 10, 28, tzinfo=dt.timezone.utc)
        self.profile = {'ExpirationDate': self.now + dt.timedelta(days=90), 'TeamIdentifier': ['EXAMPLETE1'],
                        'ApplicationIdentifierPrefix': ['OLDPREFIX1'], 'Entitlements': {'application-identifier': 'OLDPREFIX1.example.verified', 'com.apple.developer.team-identifier': 'EXAMPLETE1', 'get-task-allow': False},
                        'Platform': ['iOS'], 'DeveloperCertificates': [b'synthetic-cert'], 'UUID': '00000000-0000-0000-0000-000000000000'}

    def validate(self, **changes):
        return signing.validate_profile({**self.profile, **changes}, {'bundleId': 'example.verified'}, 'EXAMPLETE1', b'synthetic-cert', self.now)

    def test_exact_profile_accepts_a_distinct_historical_app_id_prefix(self):
        self.assertEqual(self.validate(), self.profile['UUID'])

    def test_wrong_team_expiring_device_and_enterprise_profiles_are_rejected(self):
        for change in [{'TeamIdentifier': ['OTHERTTEAM']}, {'ExpirationDate': self.now}, {'ProvisionedDevices': ['device']}, {'ProvisionsAllDevices': True}, {'Platform': ['tvOS']}, {'DeveloperCertificates': [b'wrong-cert']}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.validate(**change)

    def test_wildcard_and_development_entitlements_are_rejected(self):
        for change in [{'application-identifier': 'OLDPREFIX1.*'}, {'get-task-allow': True}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.validate(Entitlements={**self.profile['Entitlements'], **change})


if __name__ == '__main__':
    unittest.main()
