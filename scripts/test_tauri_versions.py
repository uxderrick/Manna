"""Reject unsupported JavaScript/native Tauri plugin combinations before packaging."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def mismatched_plugins(cargo_lock, bun_lock):
    native = re.findall(r'\[\[package\]\]\nname = "(tauri-plugin-[^"]+)"\nversion = "([^"]+)"', cargo_lock)
    mismatches = []
    for name, version in native:
        npm = '@tauri-apps/plugin-' + name.replace('tauri-plugin-', '', 1)
        resolved = re.search(re.escape('"' + npm + '": ["' + npm + '@') + r'([^"\s]+)', bun_lock)
        if resolved and resolved.group(1) != version:
            mismatches.append((npm, resolved.group(1), version))
    return mismatches


class TauriVersionsTests(unittest.TestCase):
    def test_locked_plugins_match_the_native_runtime(self):
        self.assertEqual(mismatched_plugins(
            (ROOT / 'src-tauri/Cargo.lock').read_text(),
            (ROOT / 'bun.lock').read_text()), [])

    def test_reports_a_mismatch_and_accepts_matching_versions(self):
        native = '[[package]]\nname = "tauri-plugin-updater"\nversion = "2.10.1"\n'
        self.assertEqual(mismatched_plugins(native,
            '"@tauri-apps/plugin-updater": ["@tauri-apps/plugin-updater@2.14.0", ""]'),
            [('@tauri-apps/plugin-updater', '2.14.0', '2.10.1')])
        self.assertEqual(mismatched_plugins(native,
            '"@tauri-apps/plugin-updater": ["@tauri-apps/plugin-updater@2.10.1", ""]'), [])


if __name__ == '__main__':
    unittest.main()
