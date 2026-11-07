import importlib.util
import contextlib
import io
import hashlib
import json
import os
from pathlib import Path
import plistlib
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/ios'))
import hosted_get328 as d


class HostedDriverTests(unittest.TestCase):
    def test_cancel_reserves_cleanup_but_refuses_new_work(self):
        b=d.Budget.now()
        old=d.CANCELLED
        try:
            d.CANCELLED=True
            with self.assertRaises(d.SafetyError): b.check(True)
            b.check(False)
        finally: d.CANCELLED=old

    def test_live_owned_leader_and_child_are_both_stopped_on_timeout(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            s=d.Supervisor(root,d.Budget.now(),sample=lambda:(9*1024**3,0),poll=.03)
            code="import subprocess,sys,time; subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); time.sleep(30)"
            with self.assertRaises(d.SafetyError): s.run([sys.executable,'-c',code],'orphan',.12)
            r=json.loads((root/'receipts/orphan-command.json').read_text())
            self.assertTrue(r['group_absent'])

    def test_post_exit_resource_drop_is_blocked_even_on_exit_zero(self):
        with tempfile.TemporaryDirectory() as t:
            holder=[]; original=d.subprocess.Popen
            def spawn(*args,**kwargs):
                child=original(*args,**kwargs); holder.append(child); return child
            def sample():
                return ((2 if holder and holder[0].poll() is not None else 9)*1024**3,0)
            s=d.Supervisor(Path(t),d.Budget.now(),sample=sample,poll=.03)
            with mock.patch.object(d.subprocess,'Popen',side_effect=spawn):
                with self.assertRaises(d.SafetyError): s.run([sys.executable,'-c','pass'],'exit-floor',2)
            r=json.loads((Path(t)/'receipts/exit-floor-command.json').read_text())
            self.assertEqual(r['raw_exit'],0)

    def test_reaped_owner_never_signals_a_reused_numeric_group(self):
        child=mock.Mock(pid=123456,returncode=0)
        child.poll.return_value=0
        with mock.patch.object(d.Supervisor,'group_members',return_value=[777]), mock.patch.object(d.os,'getpgid',return_value=123456), mock.patch.object(d.os,'killpg') as kill:
            with self.assertRaises(d.SafetyError): d.Supervisor.stop(child)
            kill.assert_not_called()

    def test_unknown_walk_error_is_not_zero_scratch(self):
        with tempfile.TemporaryDirectory() as t:
            s=d.Supervisor(Path(t),d.Budget.now())
            def bad_walk(*args,**kwargs):
                kwargs['onerror'](PermissionError('denied'))
                return iter(())
            with mock.patch.object(d.os,'walk',side_effect=bad_walk):
                with self.assertRaises(d.SafetyError): s.resources()

    def test_sampling_across_global_reserve_refuses_new_spawn(self):
        ticks=[100]
        b=d.Budget({'monotonic_start':100,'monotonic_deadline':4300},clock=lambda:ticks[0])
        with tempfile.TemporaryDirectory() as t:
            def sample(): ticks[0]=4000; return (9*1024**3,0)
            s=d.Supervisor(Path(t),b,sample=sample)
            with self.assertRaises(d.SafetyError): s.run([sys.executable,'-V'],'late',2)
            self.assertEqual(s.launched,0)

    def test_changed_framework_link_cannot_reuse_verified_products(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); products=root/'products'; products.mkdir(); (root/'receipts').mkdir()
            for name in ('A','B'): (products/name).write_bytes(name.encode())
            (products/'Current').symlink_to('A')
            files=[{'path':name,'sha256':hashlib.sha256(name.encode()).hexdigest(),'bytes':1} for name in ('A','B')]
            (root/'receipts/products.json').write_text(json.dumps({'files':files,'links':[{'path':'Current','target':'A'}]}))
            d.verify_products(root)
            (products/'Current').unlink(); (products/'Current').symlink_to('B')
            with self.assertRaises(d.SafetyError): d.verify_products(root)

    def test_real_workflow_root_is_archived_without_losing_start_or_products(self):
        import hosted_get328_evidence as e
        with tempfile.TemporaryDirectory() as t:
            root=Path(t).resolve()/'job'; root.mkdir()
            (root/'start.json').write_text('{"run_id":7}')
            (root/'scratch/DerivedData/Build').mkdir(parents=True)
            (root/'scratch/DerivedData/Build/cache').write_text('rebuildable')
            for folder in ('logs','receipts','products','results','fixture'): (root/folder).mkdir()
            (root/'receipts/report.json').write_text('{"status":"complete"}')
            for folder in ('logs','results','fixture'): (root/folder/'body').write_bytes(b'body')
            (root/'products/a.xctestrun').write_text('actual new product')
            view=d.prepare_evidence_view(root)
            outcome=e.package_evidence(view,Path(t).resolve()/'upload')
            recovered=Path(t).resolve()/'download'
            e.verify_download(Path(outcome['archive_path']),Path(outcome['manifest_path']),recovered)
            self.assertEqual((recovered/'receipts/start.json').read_bytes(),(root/'start.json').read_bytes())
            self.assertEqual((recovered/'products/a.xctestrun').read_text(),'actual new product')
            self.assertTrue((root/'scratch/DerivedData/Build/cache').exists())

    def test_package_cli_keeps_false_cleanup_partial_and_uses_same_deadline(self):
        with tempfile.TemporaryDirectory() as t:
            parent=Path(t).resolve(); root=parent/'job'; root.mkdir()
            now=time.monotonic()
            (root/'start.json').write_text(json.dumps({'started_monotonic':now,'deadline_monotonic':now+4200}))
            for name in ('receipts','products','logs','results','fixture'): (root/name).mkdir()
            for name in ('logs','results','fixture'): (root/name/'body').write_bytes(b'body')
            xr=root/'products/a.xctestrun'; xr.write_bytes(b'new bytes')
            (root/'receipts/products.json').write_text(json.dumps({'files':[{'path':'a.xctestrun','bytes':9,'sha256':hashlib.sha256(b'new bytes').hexdigest()}]}))
            (root/'receipts/seven.json').write_text('{"all_passed":true}')
            (root/'receipts/cleanup.json').write_text('{"owned_device_absent":false}')
            output=io.StringIO()
            with mock.patch.object(sys,'argv',['controller','package','--root',str(root)]), contextlib.redirect_stdout(output): d.main()
            self.assertEqual(json.loads(output.getvalue())['status'],'partial')
            self.assertFalse(json.loads((parent/'get328-hosted-evidence-view/receipts/cleanup.json').read_text())['owned_device_absent'])

    def test_download_cli_requires_trusted_manifest_anchor_before_extraction(self):
        with tempfile.TemporaryDirectory() as t:
            parent=Path(t).resolve(); manifest=parent/'manifest'; manifest.write_text('{}')
            dest=parent/'new-destination'
            args=['controller','verify-download','--root',str(dest),'--manifest',str(manifest),'--archive',str(parent/'archive')]
            with mock.patch.object(sys,'argv',args):
                with self.assertRaises(d.SafetyError): d.main()
            self.assertFalse(dest.exists())

    def test_package_products_hash_obeys_same_absolute_deadline(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); (root/'products').mkdir(); (root/'receipts').mkdir()
            f=root/'products/App'; f.write_bytes(b'body')
            (root/'receipts/products.json').write_text(json.dumps({'files':[{'path':'App','bytes':4,'sha256':hashlib.sha256(b'body').hexdigest()}]}))
            with self.assertRaises(d.SafetyError): d.verify_products(root,deadline=time.monotonic()-1)

    def test_failed_build_products_and_activity_logs_are_preserved(self):
        import hosted_get328_evidence as e
        with tempfile.TemporaryDirectory() as t:
            parent=Path(t).resolve(); root=parent/'job'; root.mkdir()
            (root/'start.json').write_text('{}')
            partial=root/'scratch/DerivedData/Build/Products'; partial.mkdir(parents=True)
            (partial/'partial-binary').write_bytes(b'partial actual bytes')
            logs=root/'scratch/DerivedData/Logs'; logs.mkdir(); (logs/'build.xcactivitylog').write_bytes(b'unique failure log')
            (root/'receipts').mkdir()
            (root/'receipts/report.json').write_text('{"status":"partial","partial_reason":"first build failed"}')
            view=d.prepare_evidence_view(root)
            result=e.package_evidence(view,parent/'upload')
            dest=parent/'restored'; e.verify_download(Path(result['archive_path']),Path(result['manifest_path']),dest)
            self.assertEqual((dest/'products/partial-binary').read_bytes(),b'partial actual bytes')
            self.assertEqual((dest/'logs/deriveddata/build.xcactivitylog').read_bytes(),b'unique failure log')

    def test_job_wide_disk_growth_includes_device_files_outside_build_root(self):
        import shutil
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            baseline=shutil.disk_usage(root).free+5*1024**3
            (root/'start.json').write_text(json.dumps({'initial_free_bytes':baseline}))
            s=d.Supervisor(root,d.Budget.now())
            with self.assertRaises(d.SafetyError): s.run([sys.executable,'-V'],'outside-growth',2)
            self.assertEqual(s.launched,0)

    def test_recovery_never_moves_or_writes_through_foreign_parent_symlinks(self):
        for variant in ('source','destination'):
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as t:
                parent=Path(t).resolve(); root=parent/'job'; root.mkdir(); outside=parent/'foreign'; outside.mkdir()
                (root/'start.json').write_text('{}'); (root/'scratch').mkdir()
                if variant=='source':
                    (root/'scratch/DerivedData').symlink_to(outside,target_is_directory=True)
                    (outside/'Build/Products').mkdir(parents=True); marker=outside/'Build/Products/keep'
                else:
                    (root/'scratch/DerivedData/Logs').mkdir(parents=True)
                    (root/'scratch/DerivedData/Logs/unique').write_bytes(b'log')
                    (root/'logs').symlink_to(outside,target_is_directory=True); marker=outside/'keep'
                marker.write_bytes(b'untouched')
                with self.assertRaises(d.SafetyError): d.prepare_evidence_view(root)
                self.assertEqual(marker.read_bytes(),b'untouched')
                self.assertFalse((outside/'deriveddata').exists())

    def test_uncertain_create_cannot_claim_device_absent(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); (root/'receipts').mkdir()
            (root/'receipts/create-intent.json').write_text('{}')
            controller=object.__new__(d.Controller)
            controller.root=root; controller.budget=d.Budget.now()
            controller.s=d.Supervisor(root,controller.budget,sample=lambda:(9*1024**3,0))
            with self.assertRaises(d.SafetyError): controller.cleanup()
            self.assertFalse(json.loads((root/'receipts/cleanup.json').read_text())['owned_device_absent'])

    def test_changed_binary_cannot_be_used_as_verified_products(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); (root/'products').mkdir(); (root/'receipts').mkdir()
            binary=root/'products/App'; binary.write_bytes(b'original')
            (root/'receipts/products.json').write_text(json.dumps({'files':[{'path':'App','sha256':hashlib.sha256(b'original').hexdigest(),'bytes':8}]}))
            d.verify_products(root)
            binary.write_bytes(b'mutated!')
            with self.assertRaises(d.SafetyError): d.verify_products(root)

    def test_local_machine_is_rejected_before_any_command(self):
        with self.assertRaisesRegex(d.SafetyError, 'hosted'):
            d.require_host({}, system='Darwin', machine='x86_64')

    def test_reconstructed_deadline_does_not_restart_between_steps(self):
        b = d.Budget({'monotonic_start': 100, 'monotonic_deadline': 4300}, clock=lambda: 4000)
        with self.assertRaises(d.SafetyError):
            b.check(new_work=True)
        b.check(new_work=False)
        with self.assertRaises(d.SafetyError):
            d.Budget({'monotonic_start': 100, 'monotonic_deadline': 99999}, clock=lambda: 101)

    def test_low_disk_refuses_spawn(self):
        with tempfile.TemporaryDirectory() as t:
            s = d.Supervisor(Path(t), d.Budget.now(), sample=lambda: (2*1024**3, 0))
            with self.assertRaises(d.SafetyError):
                s.run([sys.executable, '-c', 'raise Exception("must not start")'], 'low', 2)
            self.assertEqual(s.launched, 0)

    def test_unknown_resource_sample_refuses_spawn(self):
        with tempfile.TemporaryDirectory() as t:
            def fail(): raise OSError('unknown')
            s = d.Supervisor(Path(t), d.Budget.now(), sample=fail)
            with self.assertRaises(d.SafetyError): s.run([sys.executable, '-V'], 'unknown', 2)
            self.assertEqual(s.launched, 0)

    def test_live_resource_drop_stops_owned_child_and_keeps_raw_exit(self):
        with tempfile.TemporaryDirectory() as t:
            values = iter([(9*1024**3, 0), (2*1024**3, 0)])
            s = d.Supervisor(Path(t), d.Budget.now(), sample=lambda: next(values, (2*1024**3, 0)), poll=.02)
            with self.assertRaises(d.SafetyError):
                s.run([sys.executable, '-c', 'import time; time.sleep(30)'], 'drop', 5)
            r = json.loads((Path(t)/'receipts/drop-command.json').read_text())
            self.assertTrue(r['started'])
            self.assertIsNotNone(r['raw_exit'])
            self.assertTrue(r['reaped'])

    def test_internal_timeout_reaps_real_child_without_retry(self):
        with tempfile.TemporaryDirectory() as t:
            s = d.Supervisor(Path(t), d.Budget.now(), sample=lambda: (9*1024**3, 0), poll=.02)
            with self.assertRaises(d.SafetyError):
                s.run([sys.executable, '-c', 'import time; time.sleep(30)'], 'slow', .08)
            r = json.loads((Path(t)/'receipts/slow-command.json').read_text())
            self.assertTrue(r['reaped'])
            self.assertEqual(s.launched, 1)

    def test_xctestrun_rejects_wrong_runner_env_and_escaped_product(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); (root/'Runner.app/PlugIns/LeafhourUITests.xctest').mkdir(parents=True)
            (root/'Leafhour.app').mkdir()
            target={'BlueprintName':'LeafhourUITests', 'TestBundlePath':'__TESTHOST__/PlugIns/LeafhourUITests.xctest',
                    'TestHostPath':'__TESTROOT__/Runner.app', 'UITargetAppPath':'__TESTROOT__/Leafhour.app',
                    'TestHostBundleIdentifier':d.RUNNER_ID, 'EnvironmentVariables':{'LEAFHOUR_GET328_CURRENT_ACCEPTANCE':'1'}}
            p=root/'qa.xctestrun'
            p.write_bytes(plistlib.dumps({'TestConfigurations':[{'TestTargets':[target]}]}))
            self.assertEqual(d.check_xctestrun(p)['test_host'], str((root/'Runner.app').resolve()))
            target['RetryTestsOnFailure']=True
            p.write_bytes(plistlib.dumps({'TestConfigurations':[{'TestTargets':[target]}]}))
            with self.assertRaises(d.SafetyError): d.check_xctestrun(p)
            del target['RetryTestsOnFailure']
            target['EnvironmentVariables']['LEAFHOUR_GET328_CURRENT_ACCEPTANCE']='0'
            p.write_bytes(plistlib.dumps({'TestConfigurations':[{'TestTargets':[target]}]}))
            with self.assertRaises(d.SafetyError): d.check_xctestrun(p)
            target['EnvironmentVariables']['LEAFHOUR_GET328_CURRENT_ACCEPTANCE']='1'
            target['UITargetAppPath']='/tmp/foreign.app'
            p.write_bytes(plistlib.dumps({'TestConfigurations':[{'TestTargets':[target]}]}))
            with self.assertRaises(d.SafetyError): d.check_xctestrun(p)

    def test_zero_duplicate_or_wrong_test_is_not_a_pass(self):
        case='VideoExperienceUITests/test41SystemTypeProfileKeepsTheRealTypographyPreviewAndResetUsable()'
        good={'testNodes':[{'nodeType':'Test Case','nodeIdentifier':case,'result':'Passed'}]}
        self.assertEqual(d.test_outcome(good, case, 0), 'passed')
        self.assertEqual(d.test_outcome(good, case, 65), 'infrastructure-failed')
        failed={'testNodes':[dict(good['testNodes'][0],result='Failed')]}
        self.assertEqual(d.test_outcome(failed, case, -9), 'infrastructure-failed')
        self.assertEqual(d.test_outcome(failed, case, 65), 'unclassified-test-failure')
        for data in ({'testNodes':[]}, {'testNodes':good['testNodes']*2}, {'testNodes':[dict(good['testNodes'][0],nodeIdentifier='Other/test()')]}):
            with self.assertRaises(d.SafetyError): d.test_outcome(data, case, 0)

    def test_runtime_architecture_must_be_real_dyld_header_not_filename(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); f=root/'System/Library/dyld/dyld_shared_cache_x86_64'; f.parent.mkdir(parents=True)
            f.write_bytes(b'arm64-not-universal')
            with self.assertRaises(d.SafetyError): d.runtime_architecture(root)
            f.write_bytes(b'dyld_v1  x86_64\x00'+b'\x00'*128)
            self.assertEqual(d.runtime_architecture(root)['architecture'], 'x86_64')


if __name__=='__main__': unittest.main()
