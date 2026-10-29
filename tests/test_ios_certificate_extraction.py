"""Exercise real PKCS#12 parsing without Apple identities or private fixtures."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class CertificateExtractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='leafhour-p12-test-')
        cls.path = Path(cls.directory.name)
        cls.env = dict(os.environ, IOS_DISTRIBUTION_P12_PASSWORD='synthetic-fixture-only')
        cls.openssl3 = subprocess.check_output(['openssl', 'version'], text=True).startswith('OpenSSL 3.')
        cls.run_openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=Isolated release test', '-keyout', str(cls.path / 'key.pem'),
                        '-out', str(cls.path / 'certificate.pem'))

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    @classmethod
    def run_openssl(cls, *args):
        return subprocess.run(['openssl', *args], env=cls.env, capture_output=True, check=True)

    def export(self, name, legacy=False):
        output = self.path / (name + '.p12')
        options = ['-legacy'] if legacy and self.openssl3 else []
        if legacy:
            options += ['-certpbe', 'PBE-SHA1-RC2-40', '-keypbe', 'PBE-SHA1-3DES']
        self.run_openssl('pkcs12', '-export', *options, '-in', str(self.path / 'certificate.pem'),
                         '-inkey', str(self.path / 'key.pem'), '-out', str(output),
                         '-passout', 'env:IOS_DISTRIBUTION_P12_PASSWORD')
        return output

    def extract(self, source, target, env=None):
        return subprocess.run(['bash', str(ROOT / 'scripts/ios/extract-certificate.sh'),
                               str(source), str(target)], env=env or self.env,
                              capture_output=True, text=True)

    def assert_certificate(self, name, legacy=False):
        source = self.export(name, legacy)
        target = self.path / (name + '.pem')
        result = self.extract(source, target)
        self.assertEqual(result.returncode, 0, result.stderr)
        actual = self.run_openssl('x509', '-in', str(target), '-outform', 'DER').stdout
        expected = self.run_openssl('x509', '-in', str(self.path / 'certificate.pem'), '-outform', 'DER').stdout
        self.assertEqual(actual, expected)
        self.assertNotIn('PRIVATE KEY', target.read_text())
        self.assertEqual(result.stdout, '')

    def test_modern_certificate(self):
        self.assert_certificate('modern')

    def test_legacy_rc2_certificate(self):
        if self.openssl3:
            source = self.export('legacy-baseline', legacy=True)
            baseline = subprocess.run(['openssl', 'pkcs12', '-in', str(source), '-clcerts', '-nokeys',
                                       '-passin', 'env:IOS_DISTRIBUTION_P12_PASSWORD', '-out', os.devnull],
                                      env=self.env, capture_output=True)
            self.assertNotEqual(baseline.returncode, 0, 'The fixture must exercise the legacy provider fallback')
        self.assert_certificate('legacy', legacy=True)

    def test_wrong_password_has_fixed_diagnostic_and_no_output_certificate(self):
        source = self.export('wrong-password')
        target = self.path / 'rejected.pem'
        result = self.extract(source, target, dict(self.env, IOS_DISTRIBUTION_P12_PASSWORD='wrong'))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr.strip(), 'Unable to parse the distribution P12; verify its password and format')
        self.assertFalse(target.exists())
        self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
