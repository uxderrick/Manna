"""Release safety checks against actual files and installer reports."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('draft', Path(__file__).with_name('release-draft.py'))
draft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(draft)
SHA = 'a' * 40
VERSION = '0.1.0-rc3'


class DraftTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / 'staged'

    def fixture(self, platform):
        extension = '.exe' if platform == 'windows' else '.dmg'
        installer = self.root / (f'Manna_{VERSION}_{platform}' + extension)
        installer.write_bytes(b'installer fixture')
        report = dict(passed=True, default_speech_provider='whisper', provider_calls=False,
                      resources_unchanged=True, speech={'ready':True,'transcript':'John chapter three verse sixteen'},
                      manifest={'speech':{'model':'Base English' if platform == 'windows' else 'Small English Q8'}},
                      results=[{'translation':t} for t in ('KJV','NIV','NLT')])
        # Independently calculated SHA256 for b'installer fixture'.
        checksum = 'b97d800ba8d0420dc6a0342045a15a97d785bd61d4cf9902d0c334ba32ec188b'
        if platform == 'windows':
            report.update(installer_sha256=checksum, publisher_verified=False)
        else:
            report.update(dmg_sha256=checksum, ad_hoc_signature_verified=True, notarization_verified=False, microphone_entitlement_verified=True)
        path = self.root / f'{platform}.json'
        path.write_text(json.dumps(report))
        return installer, path

    def stage(self, platform, source=SHA):
        installer, report = self.fixture(platform)
        return draft.stage(platform, installer, report, self.output, VERSION, source, 'https://github.com/uxderrick/Manna/actions/runs/123')

    def test_mac_without_microphone_verification_is_rejected(self):
        installer, report = self.fixture('mac')
        data = json.loads(report.read_text())
        del data['microphone_entitlement_verified']
        report.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'microphone entitlement'):
            draft.stage('mac', installer, report, self.output, VERSION, SHA, 'run')

    def test_changed_installer_is_rejected_before_staging(self):
        installer, report = self.fixture('windows')
        installer.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'hash'):
            draft.stage('windows', installer, report, self.output, VERSION, SHA, 'run')
        self.assertFalse(self.output.exists())

    def test_failed_installed_check_is_rejected(self):
        installer, report = self.fixture('windows')
        data = json.loads(report.read_text()); data['passed'] = False
        report.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'check'):
            draft.stage('windows', installer, report, self.output, VERSION, SHA, 'run')

    def test_wrong_speech_model_is_rejected(self):
        installer, report = self.fixture('windows')
        data = json.loads(report.read_text()); data['manifest']['speech']['model'] = 'Small English Q8'
        report.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'model'):
            draft.stage('windows', installer, report, self.output, VERSION, SHA, 'run')

    def test_different_version_with_same_prefix_is_rejected(self):
        installer, report = self.fixture('windows')
        renamed = installer.with_name('Manna_0.1.0-rc30_windows.exe')
        installer.rename(renamed)
        with self.assertRaisesRegex(ValueError, 'version'):
            draft.stage('windows', renamed, report, self.output, VERSION, SHA, 'run')

    def test_missing_translation_check_is_rejected(self):
        installer, report = self.fixture('windows')
        data = json.loads(report.read_text()); data['results'] = [{'translation':'KJV'}]
        report.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'check'):
            draft.stage('windows', installer, report, self.output, VERSION, SHA, 'run')

    def test_missing_platform_prevents_release(self):
        self.stage('windows')
        with self.assertRaises(ValueError):
            draft.assemble(self.output, self.root/'release', VERSION, SHA)

    def test_different_build_commit_prevents_release(self):
        self.stage('windows'); self.stage('mac', 'b'*40)
        with self.assertRaisesRegex(ValueError, 'source'):
            draft.assemble(self.output, self.root/'release', VERSION, SHA)

    def test_bundle_has_exact_installers_checksums_and_no_update_feed(self):
        self.stage('windows'); self.stage('mac')
        output = self.root/'release'
        draft.assemble(self.output, output, VERSION, SHA)
        names = {p.name for p in output.iterdir()}
        self.assertEqual(names, {'Manna-0.1.0-rc3-standard-windows-x64-unsigned.exe',
            'Manna-0.1.0-rc3-standard-macos-arm64-adhoc.dmg', 'checks-windows.json', 'checks-mac.json',
            'SHA256SUMS.txt', 'release-notes.md', 'release-manifest.json'})
        self.assertIn('b97d800ba8d0420dc6a0342045a15a97d785bd61d4cf9902d0c334ba32ec188b', (output/'SHA256SUMS.txt').read_text())
        self.assertIn('Windows speech speed', (output/'release-notes.md').read_text())
        self.assertEqual(json.loads((output/'release-manifest.json').read_text())['source_commit'], SHA)

    def test_mutated_staged_file_prevents_release(self):
        self.stage('windows'); self.stage('mac')
        next(self.output.glob('*.exe')).write_bytes(b'changed after tests')
        with self.assertRaisesRegex(ValueError, 'hash'):
            draft.assemble(self.output, self.root/'release', VERSION, SHA)

    def test_existing_release_cannot_be_modified(self):
        self.stage('windows'); self.stage('mac')
        output=self.root/'release'; draft.assemble(self.output, output, VERSION, SHA)
        with patch.object(draft, 'gh', return_value={'id':1,'draft':False}) as call:
            with self.assertRaisesRegex(ValueError, 'exists'):
                draft.upload(output, 'uxderrick/Manna')
            self.assertEqual(call.call_count, 1)

    def test_unlisted_asset_cannot_be_uploaded(self):
        self.stage('windows'); self.stage('mac')
        output=self.root/'release'; draft.assemble(self.output, output, VERSION, SHA)
        (output/'latest-standard.json').write_text('{}')
        with patch.object(draft, 'gh', return_value=None):
            with self.assertRaisesRegex(ValueError, 'files'):
                draft.upload(output, 'uxderrick/Manna')

    def test_new_release_is_created_as_draft_without_publishing(self):
        self.stage('windows'); self.stage('mac')
        output=self.root/'release'; draft.assemble(self.output, output, VERSION, SHA)
        with patch.object(draft, 'gh', side_effect=[None, None, 'draft-url']) as call:
            self.assertEqual(draft.upload(output, 'uxderrick/Manna'), 'draft-url')
            args=call.call_args.args
            self.assertEqual(args[:3], ('release','create','v0.1.0-rc3'))
            self.assertIn('--draft', args)
            self.assertIn('--latest=false', args)
            self.assertEqual(args[args.index('--target')+1], SHA)

    def test_existing_tag_cannot_point_release_at_another_commit(self):
        self.stage('windows'); self.stage('mac')
        output=self.root/'release'; draft.assemble(self.output, output, VERSION, SHA)
        with patch.object(draft, 'gh', side_effect=[None, {'object':{'sha':'b'*40}}]) as call:
            with self.assertRaisesRegex(ValueError, 'tag already exists'):
                draft.upload(output, 'uxderrick/Manna')
            self.assertEqual(call.call_count, 2)


if __name__ == '__main__':
    unittest.main()
