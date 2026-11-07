"""Real small host files/tars only; no SDK, process, network or Simulator."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
MODULE = REPO / 'scripts/ios/hosted_get328_evidence.py'
if MODULE.exists():
    SPEC = importlib.util.spec_from_file_location('get328_hosted_evidence_tests', MODULE)
    E = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(E)
else:
    E = SimpleNamespace()


def sha(data):
    return hashlib.sha256(data).hexdigest()


class HostedEvidenceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='get328-host-evidence-unit-')
        self.addCleanup(directory.cleanup)
        self.temp = Path(directory.name).resolve()
        self.serial = 0
        for target, name in ((subprocess, 'run'), (subprocess, 'Popen'), (os, 'system')):
            blocker = patch.object(target, name, side_effect=AssertionError('No external command may execute'))
            blocker.start(); self.addCleanup(blocker.stop)

    def api(self, name):
        function = getattr(E, name, None)
        self.assertTrue(callable(function), name + ' is not implemented')
        return function

    def source(self):
        self.serial += 1
        root = self.temp / ('source-' + str(self.serial))
        for name in ('logs', 'results', 'products', 'receipts', 'fixture'):
            (root / name).mkdir(parents=True)
        (root / 'logs/.hidden.log').write_bytes(b'first-pass synthetic test output\n')
        (root / 'logs/.hidden.log').chmod(0o600)
        (root / 'results/case.xcresult').mkdir()
        (root / 'results/case.xcresult/Info.plist').write_bytes(b'synthetic-result-only')
        (root / 'products/Leafhour.app').mkdir()
        (root / 'products/Leafhour.app/Leafhour').write_bytes(b'SYNTHETIC-NOT-A-MACHO')
        (root / 'products/Leafhour.app/Leafhour').chmod(0o755)
        (root / 'products/Leafhour.app/Info.plist').write_bytes(b'synthetic-app-info')
        (root / 'products/Leafhour.xctestrun').write_bytes(b'synthetic-xctestrun')
        (root / 'receipts/report.json').write_text(json.dumps({'status': 'complete'}))
        (root / 'fixture/public.txt').write_bytes(b'Public-domain synthetic archive test source.\n')
        return root

    def package(self, root=None):
        function = self.api('package_evidence')
        root = root or self.source()
        return function(root, self.temp / ('output-' + str(self.serial)))

    def result_paths(self, result):
        return Path(result['archive_path']), Path(result['manifest_path'])

    def altered_archive(self, result, extra=None, transform=None):
        archive, manifest = self.result_paths(result)
        value = json.loads(manifest.read_text())
        with tarfile.open(archive, 'r:') as handle:
            members = [(copy.copy(member), handle.extractfile(member).read() if member.isfile() else None)
                       for member in handle.getmembers()]
        if transform:
            transform(members, value)
        if extra:
            member, data, entry = extra
            members.append((member, data)); value['entries'].append(entry)
        changed = archive.parent / 'altered.tar'
        with tarfile.open(changed, 'w', format=tarfile.PAX_FORMAT) as handle:
            for member, data in members:
                handle.addfile(member, io.BytesIO(data) if data is not None else None)
        raw = changed.read_bytes()
        value['archive'] = {'filename': changed.name, 'bytes': len(raw), 'sha256': sha(raw)}
        altered_manifest = archive.parent / 'altered.manifest.json'
        altered_manifest.write_text(json.dumps(value))
        return changed, altered_manifest

    def test_round_trip_preserves_hidden_content_modes_and_every_products_file(self):
        root = self.source()
        result = self.package(root)
        archive, manifest = self.result_paths(result)
        self.assertEqual(result['archive_sha256'], sha(archive.read_bytes()))
        self.assertEqual(result['manifest_sha256'], sha(manifest.read_bytes()))
        self.assertEqual(result['total_bytes'], archive.stat().st_size + manifest.stat().st_size)
        inventory = json.loads(manifest.read_text())
        self.assertEqual(inventory['status'], 'complete')
        self.assertIn('products/Leafhour.app/Leafhour', [entry['path'] for entry in inventory['entries']])
        dest = self.temp / 'download'
        receipt = self.api('verify_download')(archive, manifest, dest)
        self.assertIs(receipt['verified'], True)
        self.assertEqual(receipt['archive_sha256'], result['archive_sha256'])
        self.assertEqual((dest / 'logs/.hidden.log').read_bytes(), b'first-pass synthetic test output\n')
        self.assertEqual(stat.S_IMODE((dest / 'logs/.hidden.log').stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((dest / 'products/Leafhour.app/Leafhour').stat().st_mode), 0o755)
        expected = sorted(str(path.relative_to(root)) for path in root.rglob('*'))
        self.assertEqual(sorted(str(path.relative_to(dest)) for path in dest.rglob('*')), expected)

    def test_internal_symlinks_and_hardlinks_remain_links_after_download(self):
        root = self.source()
        os.link(root / 'logs/.hidden.log', root / 'logs/hard-copy')
        (root / 'products/current').symlink_to('Leafhour.app/Leafhour')
        (root / 'logs/app').symlink_to('../products/Leafhour.app', target_is_directory=True)
        archive, manifest = self.result_paths(self.package(root))
        dest = self.temp / 'links'
        self.api('verify_download')(archive, manifest, dest)
        self.assertEqual(os.readlink(dest / 'products/current'), 'Leafhour.app/Leafhour')
        self.assertEqual(os.readlink(dest / 'logs/app'), '../products/Leafhour.app')
        self.assertEqual((dest / 'logs/hard-copy').stat().st_ino, (dest / 'logs/.hidden.log').stat().st_ino)

    def test_symlink_dotdot_must_follow_the_intermediate_link_before_parent_components(self):
        function = self.api('package_evidence'); root = self.source()
        (root / 'logs/d').mkdir(); (root / 'logs/receipts').mkdir()
        (root / 'logs/receipts/outside.txt').write_text('inside decoy, not the actual target')
        (root / 'logs/d/a').symlink_to('../../products', target_is_directory=True)
        (root / 'logs/escape').symlink_to('d/a/../../receipts/outside.txt')
        outside = self.temp / 'receipts/outside.txt'; outside.parent.mkdir(); outside.write_text('outside sentinel')
        self.assertFalse((root / 'logs/escape').resolve().is_relative_to(root))
        with self.assertRaises(ValueError): function(root, self.temp / 'dotdot-source')
        self.assertEqual(outside.read_text(), 'outside sentinel')

    def test_download_rejects_intermediate_symlink_dotdot_even_with_matching_archive_hash(self):
        verify = self.api('verify_download'); root = self.source()
        (root / 'logs/d').mkdir(); (root / 'logs/receipts').mkdir()
        (root / 'logs/receipts/outside.txt').write_text('inside decoy')
        (root / 'logs/d/a').symlink_to('../../products', target_is_directory=True)
        result = self.package(root)
        member = tarfile.TarInfo('logs/escape'); member.type = tarfile.SYMTYPE; member.mode = 0o777
        member.linkname = 'd/a/../../receipts/outside.txt'
        entry = dict(path='logs/escape', kind='symlink', mode=0o777, bytes=0, link_target=member.linkname)
        archive, manifest = self.altered_archive(result, extra=(member, None, entry))
        dest = self.temp / 'dotdot-download'
        with self.assertRaises(ValueError): verify(archive, manifest, dest)
        self.assertFalse(dest.exists())

    def test_internal_versioned_framework_links_with_parent_components_round_trip(self):
        root = self.source()
        (root / 'products/Framework/Versions/A').mkdir(parents=True)
        (root / 'products/Framework/Versions/A/Binary').write_bytes(b'synthetic framework binary')
        (root / 'products/Framework/Versions/Current').symlink_to('A', target_is_directory=True)
        (root / 'products/Framework/Binary').symlink_to('Versions/Current/Binary')
        (root / 'logs/framework').symlink_to('../products/Framework/Versions/Current/../A/Binary')
        archive, manifest = self.result_paths(self.package(root))
        dest = self.temp / 'framework-download'
        self.api('verify_download')(archive, manifest, dest)
        self.assertEqual((dest / 'logs/framework').read_bytes(), b'synthetic framework binary')
        self.assertTrue((dest / 'logs/framework').resolve().is_relative_to(dest))

    def test_missing_body_requires_explicit_partial_report_and_reason(self):
        function = self.api('package_evidence')
        root = self.source(); shutil.rmtree(root / 'products'); shutil.rmtree(root / 'results')
        with self.assertRaises(ValueError):
            function(root, self.temp / 'missing-complete')
        (root / 'receipts/report.json').write_text(json.dumps({'status': 'partial'}))
        with self.assertRaises(ValueError):
            function(root, self.temp / 'reason-missing')
        (root / 'receipts/report.json').write_text(json.dumps({
            'status': 'partial', 'partial_reason': 'Synthetic build failed before products and results existed.'}))
        result = function(root, self.temp / 'partial')
        archive, manifest = self.result_paths(result)
        value = json.loads(manifest.read_text())
        self.assertEqual(value['status'], 'partial')
        self.assertEqual(value['missing_components'], ['products', 'results'])
        receipt = self.api('verify_download')(archive, manifest, self.temp / 'partial-download')
        self.assertEqual(receipt['status'], 'partial')

    def test_outside_allowlist_and_unusable_source_roots_are_refused(self):
        function = self.api('package_evidence')
        for bad in ('unknown-root', 'root-file', 'symlink-root'):
            with self.subTest(bad=bad):
                root = self.source()
                if bad == 'unknown-root': (root / 'private-account').mkdir()
                elif bad == 'root-file': (root / '.secret').write_text('synthetic only')
                else:
                    link = self.temp / 'root-link'; link.symlink_to(root, target_is_directory=True); root = link
                with self.assertRaises(ValueError): function(root, self.temp / ('reject-' + bad))

    def test_source_escape_cycle_dangling_and_special_files_are_refused(self):
        function = self.api('package_evidence')
        for bad in ('absolute', 'escape', 'dangling', 'cycle', 'fifo'):
            with self.subTest(bad=bad):
                root = self.source()
                link = root / 'logs/link'
                if bad == 'fifo': os.mkfifo(link)
                elif bad == 'cycle':
                    link.symlink_to('other'); (root / 'logs/other').symlink_to('link')
                else: link.symlink_to({'absolute': '/outside', 'escape': '../../outside', 'dangling': 'missing'}[bad])
                with self.assertRaises(ValueError): function(root, self.temp / ('unsafe-' + bad))

    def test_source_mutation_during_tar_write_is_not_published(self):
        function = self.api('package_evidence'); root = self.source()
        original = tarfile.TarFile.addfile
        def change_after_read(handle, info, fileobj=None):
            original(handle, info, fileobj)
            if info.name == 'logs/.hidden.log':
                (root / 'logs/.hidden.log').write_bytes(b'changed after the archive read')
        with patch.object(tarfile.TarFile, 'addfile', change_after_read), self.assertRaises(ValueError):
            function(root, self.temp / 'mutated')
        self.assertFalse((self.temp / 'mutated/evidence.manifest.json').exists())

    def test_payload_and_combined_tar_manifest_limit_block_without_clipping(self):
        function = self.api('package_evidence')
        root = self.source()
        (root / 'logs/larger').write_bytes(b'A' * 4096)
        with patch.object(E, 'MAX_BYTES', 2048), self.assertRaises(ValueError):
            function(root, self.temp / 'payload-over')
        result = self.package(root)
        # The payload fits, and the tar alone fits; the complete upload pair does not.
        with patch.object(E, 'MAX_BYTES', result['total_bytes'] - 1), self.assertRaises(ValueError):
            function(root, self.temp / 'combined-over')

    def test_one_absolute_packaging_deadline_is_not_refreshed_between_files(self):
        function = self.api('package_evidence'); root = self.source()
        now = [0.0]
        def clock():
            now[0] += 0.2
            return now[0]
        with patch.object(E, 'TIMEOUT_SECONDS', 0.5), patch.object(E.time, 'monotonic', side_effect=clock), \
             self.assertRaises(ValueError):
            function(root, self.temp / 'timed-out')
        self.assertFalse((self.temp / 'timed-out/evidence.manifest.json').exists())

    def test_caller_absolute_deadline_and_local_cap_both_bound_packaging(self):
        function = self.api('package_evidence')
        for caller_deadline in (100.5, 10000):
            with self.subTest(deadline=caller_deadline):
                root = self.source(); now = [100.0]
                def clock():
                    now[0] += 0.1
                    return now[0]
                with patch.object(E, 'TIMEOUT_SECONDS', 0.5), patch.object(E.time, 'monotonic', side_effect=clock):
                    try:
                        with self.assertRaises(ValueError):
                            function(root, self.temp / ('caller-timeout-' + str(self.serial)), deadline=caller_deadline)
                    except TypeError as error:
                        self.fail('package_evidence must accept the shared absolute deadline: ' + str(error))

    def test_unknown_or_nonfinite_caller_deadline_is_refused(self):
        function = self.api('package_evidence')
        for deadline in (True, '100', float('nan'), float('inf')):
            with self.subTest(deadline=deadline):
                root = self.source()
                try:
                    with self.assertRaises(ValueError):
                        function(root, self.temp / ('bad-deadline-' + str(self.serial)), deadline=deadline)
                except TypeError as error:
                    self.fail('The caller deadline must be validated: ' + str(error))

    def test_download_corruption_is_rejected_before_creating_destination(self):
        verify = self.api('verify_download')
        archive, manifest = self.result_paths(self.package())
        raw = bytearray(archive.read_bytes()); raw[len(raw) // 2] ^= 1; archive.write_bytes(raw)
        dest = self.temp / 'corrupt-download'
        with self.assertRaises(ValueError): verify(archive, manifest, dest)
        self.assertFalse(dest.exists())

    def test_unsafe_tar_is_rejected_even_when_its_archive_hash_is_updated(self):
        verify = self.api('verify_download')
        for bad in ('traversal', 'absolute', 'backslash', 'duplicate', 'case-collision', 'symlink-escape',
                    'hardlink-escape', 'special', 'symlink-parent'):
            with self.subTest(bad=bad):
                result = self.package()
                path = {'traversal': '../outside', 'absolute': '/outside', 'backslash': 'logs\\outside',
                        'duplicate': 'logs/.hidden.log', 'case-collision': 'logs/.HIDDEN.LOG'}.get(bad, 'logs/unsafe')
                member = tarfile.TarInfo(path); member.mode = 0o600
                data = b'unsafe synthetic member'
                member.size = len(data)
                entry = {'path': path, 'kind': 'file', 'mode': 0o600, 'bytes': len(data), 'sha256': sha(data)}
                if bad in ('symlink-escape', 'hardlink-escape', 'symlink-parent'):
                    member.type = tarfile.SYMTYPE if bad != 'hardlink-escape' else tarfile.LNKTYPE
                    member.linkname = '../../outside' if bad != 'symlink-parent' else '../products/Leafhour.app'
                    member.size = 0; data = None
                    entry = {'path': path, 'kind': 'hardlink' if bad == 'hardlink-escape' else 'symlink',
                             'mode': 0o600, 'bytes': 0, 'link_target': member.linkname}
                elif bad == 'special': member.type = tarfile.FIFOTYPE; member.size = 0; data = None
                archive, manifest = self.altered_archive(result, extra=(member, data, entry))
                if bad == 'symlink-parent':
                    changed = json.loads(manifest.read_text())
                    child = tarfile.TarInfo('logs/unsafe/child'); child.mode = 0o600; child.size = 1
                    with tarfile.open(archive, 'a') as handle: handle.addfile(child, io.BytesIO(b'x'))
                    changed['entries'].append({'path': child.name, 'kind': 'file', 'mode': 0o600, 'bytes': 1, 'sha256': sha(b'x')})
                    changed['archive']['bytes'] = archive.stat().st_size
                    changed['archive']['sha256'] = sha(archive.read_bytes()); manifest.write_text(json.dumps(changed))
                dest = self.temp / ('unsafe-download-' + bad)
                with self.assertRaises(ValueError): verify(archive, manifest, dest)
                self.assertFalse(dest.exists())
                self.assertFalse((self.temp / 'outside').exists())

    def test_manifest_content_mode_and_size_tampering_are_rejected(self):
        verify = self.api('verify_download')
        for field, changed in (('sha256', '0' * 64), ('mode', 0o777), ('bytes', 999)):
            with self.subTest(field=field):
                archive, manifest = self.result_paths(self.package())
                value = json.loads(manifest.read_text())
                item = next(entry for entry in value['entries'] if entry['path'] == 'logs/.hidden.log')
                item[field] = changed; manifest.write_text(json.dumps(value))
                dest = self.temp / ('tampered-' + field)
                with self.assertRaises(ValueError): verify(archive, manifest, dest)
                self.assertFalse(dest.exists())

    def test_manifest_mutation_after_payload_verification_is_rejected(self):
        verify = self.api('verify_download')
        archive, manifest = self.result_paths(self.package())
        dest = self.temp / 'manifest-race'
        original = E._collect
        def mutate_after_extraction(root, deadline):
            result = original(root, deadline)
            if root == dest:
                with manifest.open('ab') as handle: handle.write(b'\n')
            return result
        with patch.object(E, '_collect', side_effect=mutate_after_extraction), self.assertRaises(ValueError):
            verify(archive, manifest, dest)
        self.assertFalse(dest.exists())

    def test_metadata_payload_reads_respect_the_same_chunk_bound(self):
        verify = self.api('verify_download')
        archive, manifest = self.result_paths(self.package())
        unbounded = []
        original = tarfile.ExFileObject.read
        def read(handle, size=-1):
            if size < 0 or size > 16: unbounded.append(size)
            return original(handle, size)
        with patch.object(E, 'CHUNK_BYTES', 16), patch.object(tarfile.ExFileObject, 'read', read):
            verify(archive, manifest, self.temp / 'bounded-metadata')
        self.assertEqual(unbounded, [], 'Metadata inside the tar also needs per-chunk deadline checks')

    def test_existing_output_and_download_destinations_are_preserved(self):
        package = self.api('package_evidence'); verify = self.api('verify_download')
        root = self.source(); result = self.package(root)
        archive, manifest = self.result_paths(result)
        before = archive.read_bytes()
        with self.assertRaises(ValueError): package(root, archive.parent)
        self.assertEqual(archive.read_bytes(), before)
        dest = self.temp / 'retained'; dest.mkdir(); (dest / 'sentinel').write_text('keep')
        with self.assertRaises(ValueError): verify(archive, manifest, dest)
        self.assertEqual((dest / 'sentinel').read_text(), 'keep')

    def test_vendored_public_fixture_has_the_exact_verified_bytes_and_public_manifest(self):
        fixture = REPO / 'ci/fixtures/get328'
        raw = (fixture / 'Alice-complete-GET328-20261107.pdf').read_bytes()
        manifest = json.loads((fixture / 'manifest.json').read_text())
        self.assertEqual(len(raw), 243472)
        self.assertEqual(sha(raw), '0e5810fe2dfe46470a388382d3a0149a42bf36e54df354980a312f05483650b9')
        self.assertEqual(manifest['source']['path'], 'catalog/alice.txt')
        self.assertEqual(manifest['pdf']['sha256'], sha(raw))
        self.assertEqual((manifest['pdf']['pageCount'], manifest['coverage']['parsedWords'],
                          manifest['coverage']['parsedParagraphs']), (73, 26441, 811))
        self.assertFalse(manifest['provenance']['reproducesHistoricalOriginal'])
        self.assertEqual(manifest['source']['sha256'], sha((REPO / 'catalog/alice.txt').read_bytes()))


if __name__ == '__main__':
    unittest.main()
