#!/usr/bin/env python3
"""Build signed latest-<flavor>.json for Tauri updater.

Usage (from CI):
  python3 scripts/build-updater-manifest.py \\
    --version 0.1.0 \\
    --flavor minimal \\
    --installers installers/ \\
    --notes "$(cat notes.md)" \\
    --output latest-minimal.json
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def sign(installer: Path) -> str:
    """Run `tauri signer sign` on an installer; return the detached signature."""
    key_content = os.environ["TAURI_SIGNING_PRIVATE_KEY"]
    password = os.environ["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]
    key_path = Path(".tauri-signing-key")
    key_path.write_text(key_content)
    try:
        subprocess.run(
            [
                "bun",
                "x",
                "tauri",
                "signer",
                "sign",
                "--private-key",
                str(key_path),
                "--password",
                password,
                str(installer),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        sig_path = installer.with_suffix(installer.suffix + ".sig")
        if not sig_path.exists():
            raise RuntimeError(f"Expected signature at {sig_path}, not found")
        return sig_path.read_text().strip()
    finally:
        if key_path.exists():
            key_path.unlink()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True, help="Semver without leading v")
    ap.add_argument("--flavor", required=True, choices=["minimal", "full"])
    ap.add_argument(
        "--installers",
        required=True,
        type=Path,
        help="Dir containing renamed installers",
    )
    ap.add_argument("--notes", required=True, help="Release notes (markdown)")
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument(
        "--base-url",
        default="https://github.com/uxderrick/Manna/releases/download",
    )
    args = ap.parse_args()

    platforms: dict[str, dict[str, str]] = {}

    for installer in args.installers.rglob(f"*-{args.flavor}-macos.dmg"):
        platforms["darwin-aarch64"] = {
            "signature": sign(installer),
            "url": f"{args.base_url}/v{args.version}/{installer.name}",
        }
        break

    for installer in args.installers.rglob(f"*-{args.flavor}-windows.exe"):
        platforms["windows-x86_64"] = {
            "signature": sign(installer),
            "url": f"{args.base_url}/v{args.version}/{installer.name}",
        }
        break

    if not platforms:
        print(
            f"No installers found for flavor={args.flavor} in {args.installers}",
            file=sys.stderr,
        )
        return 1

    manifest = {
        "version": args.version,
        "notes": args.notes,
        "pub_date": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "platforms": platforms,
    }
    args.output.write_text(json.dumps(manifest, indent=2))
    print(f"Wrote {args.output} with platforms: {list(platforms.keys())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
