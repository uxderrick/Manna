"""Prevent Mac installers from shipping without microphone access."""
import importlib.util
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('verify_mac', ROOT / 'scripts/verify-installed-mac.py')
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class MacMicrophoneTests(unittest.TestCase):
    def test_internal_build_includes_microphone_entitlement(self):
        config = json.loads((ROOT / 'src-tauri/tauri.conf.internal.json').read_text())
        path = config['bundle']['macOS'].get('entitlements')
        self.assertIsNotNone(path, 'Internal Mac builds must include microphone entitlements')
        entitlements = plistlib.loads((ROOT / 'src-tauri' / path).read_bytes())
        self.assertIs(entitlements.get('com.apple.security.device.audio-input'), True)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / 'Manna Internal.app'
        (self.app / 'Contents').mkdir(parents=True)
        self.info = self.app / 'Contents/Info.plist'
        self.info.write_bytes(plistlib.dumps({'NSMicrophoneUsageDescription': 'Listen to the sermon.'}))

    def check_entitlements(self, payload):
        from subprocess import CompletedProcess
        with patch.object(verify.subprocess, 'run', return_value=CompletedProcess([], 0, stdout=payload)):
            verify.verify_microphone_access(self.app)

    def test_unsigned_entitlements_output_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'microphone entitlement'):
            self.check_entitlements(b'')

    def test_missing_or_disabled_audio_input_is_rejected(self):
        for entitlements in ({}, {'com.apple.security.device.audio-input': False}):
            with self.subTest(entitlements=entitlements):
                with self.assertRaisesRegex(ValueError, 'microphone entitlement'):
                    self.check_entitlements(plistlib.dumps(entitlements))

    def test_microphone_usage_description_is_required(self):
        self.info.write_bytes(plistlib.dumps({}))
        with self.assertRaisesRegex(ValueError, 'usage description'):
            self.check_entitlements(plistlib.dumps({'com.apple.security.device.audio-input': True}))

    def test_valid_ad_hoc_microphone_entitlement_is_accepted(self):
        self.check_entitlements(plistlib.dumps({'com.apple.security.device.audio-input': True}))


if __name__ == '__main__':
    unittest.main()
