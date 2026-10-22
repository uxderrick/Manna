"""Install a fresh app from a DMG and verify signing and detection commands."""
import argparse
import importlib.util
import json
import plistlib
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("standard", Path(__file__).with_name("prepare-standard-package.py"))
standard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(standard)



def verify_microphone_access(installed):
    result = subprocess.run(
        ["codesign", "-d", "--entitlements", "-", "--xml", str(installed)],
        check=True, capture_output=True)
    if not result.stdout.strip():
        raise ValueError("Installed app is missing its microphone entitlement")
    if plistlib.loads(result.stdout).get("com.apple.security.device.audio-input") is not True:
        raise ValueError("Installed app is missing its microphone entitlement")
    with (installed / "Contents/Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if not str(info.get("NSMicrophoneUsageDescription", "")).strip():
        raise ValueError("Installed app is missing its microphone usage description")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dmg", type=Path)
    parser.add_argument("--install-dir", type=Path, default=ROOT / "artifacts/installed")
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts/standard-mac-check.json")
    parser.add_argument("--app-name", default="Manna Internal")
    parser.add_argument("--identifier", default="com.manna.internal")
    parser.add_argument("--team-id", help="Require this Developer ID publisher and hardened runtime")
    parser.add_argument("--require-notarized", action="store_true", help="Verify stapled tickets and Gatekeeper acceptance")
    parser.add_argument("--speech-audio", type=Path, help="Generated 16 kHz mono i16 PCM smoke-test phrase, 1–30 seconds")
    args = parser.parse_args()
    if Path(args.app_name).name != args.app_name or args.app_name in (".", ".."):
        raise ValueError("Application name must be a single file name")
    if args.require_notarized and not args.team_id:
        raise ValueError("Notarization verification requires --team-id")
    installed = args.install_dir.resolve() / f"{args.app_name}.app"
    if installed.exists():
        raise ValueError(f"Refusing to overwrite an existing installation: {installed}")
    args.install_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="manna-installed-check-") as temporary:
        mount = Path(temporary) / "volume"
        mount.mkdir()
        subprocess.run(["hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", str(mount), str(args.dmg.resolve())], check=True, capture_output=True)
        try:
            subprocess.run(["ditto", str(mount / f"{args.app_name}.app"), str(installed)], check=True)
        finally:
            subprocess.run(["hdiutil", "detach", str(mount)], check=True, capture_output=True)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(installed)], check=True, capture_output=True)
        verify_microphone_access(installed)
        if args.team_id:
            for target in (installed, args.dmg.resolve()):
                subprocess.run(["codesign", "--verify", "--strict", str(target)], check=True, capture_output=True)
                signature = subprocess.run(["codesign", "-dv", "--verbose=4", str(target)], check=True, text=True, capture_output=True).stderr
                if f"TeamIdentifier={args.team_id}" not in signature or "Authority=Developer ID Application:" not in signature or "Timestamp=" not in signature:
                    raise ValueError(f"Missing expected timestamped Developer ID signature: {target}")
                if target == installed and "(runtime)" not in signature:
                    raise ValueError("Installed app does not enable hardened runtime")
        if args.require_notarized:
            for target in (installed, args.dmg.resolve()):
                subprocess.run(["xcrun", "stapler", "validate", str(target)], check=True, capture_output=True)
            subprocess.run(["spctl", "--assess", "--type", "execute", "--verbose=2", str(installed)], check=True, capture_output=True)
            subprocess.run(["spctl", "--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", str(args.dmg.resolve())], check=True, capture_output=True)
        resources = installed / "Contents/Resources"
        manifest = json.loads((resources / "standard-package.json").read_text())
        standard.validate(resources, manifest)
        with (installed / "Contents/Info.plist").open("rb") as stream:
            info = plistlib.load(stream)
        if info["CFBundleIdentifier"] != args.identifier:
            raise ValueError("Unexpected application identity")
        executable = installed / "Contents/MacOS" / info["CFBundleExecutable"]
        command = [str(executable), "--verify-package"]
        if args.speech_audio:
            command += ["--verify-whisper-audio", str(args.speech_audio.resolve())]
        process = subprocess.run(command, cwd=temporary, text=True, capture_output=True, timeout=180)
        output = process.stdout + "\n" + process.stderr
        if process.returncode:
            raise RuntimeError(f"Installed application failed ({process.returncode}): {output[-6000:]}")
        line = next((line for line in process.stdout.splitlines() if line.startswith("MANNA_PACKAGE_CHECK=")), None)
        if not line:
            raise ValueError("Installed application did not return a verification report")
        report = json.loads(line.split("=", 1)[1])
        if report["resources"] != str(resources) or not report["passed"]:
            raise ValueError("Verification did not use the installed resources")
        if manifest.get("speech"):
            if report.get("default_speech_provider") != "whisper" or not report.get("speech", {}).get("ready"):
                raise ValueError("Packaged offline speech is not the available Mac default")
            if args.speech_audio and not report["speech"].get("transcript"):
                raise ValueError("Installed offline speech did not transcribe the smoke-test audio")
        for translation in ("NIV", "NLT"):
            count = manifest["translations"][translation]
            if f"Loaded {translation} semantic index ({count} vectors)" not in output:
                raise ValueError(f"Installed app did not load the {translation} semantic index")
        standard.validate(resources, manifest)
        if list(resources.rglob("*-wal")) or list(resources.rglob("*-shm")):
            raise ValueError("Application wrote SQLite journals into its resources")
        report.update(dmg=str(args.dmg.resolve()), dmg_sha256=standard.digest(args.dmg), installed=str(installed), ad_hoc_signature_verified=not bool(args.team_id), developer_id_team=args.team_id, notarization_verified=args.require_notarized, resources_unchanged=True, provider_calls=False, microphone_entitlement_verified=True, microphone_capture_tested=False)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"passed": True, "installed": str(installed), "report": str(args.report)}))


if __name__ == "__main__":
    main()
