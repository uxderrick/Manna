"""Stage tested standard installers and prepare a new, unpublished GitHub draft."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path


PLATFORMS = {'windows': ('Base English', 'windows-x64-unsigned.exe', 'installer_sha256'),
             'mac': ('Small English Q8', 'macos-arm64-adhoc.dmg', 'dmg_sha256')}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def identity(version, source):
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?', version):
        raise ValueError('Invalid release version')
    if not re.fullmatch(r'[0-9a-f]{40}', source):
        raise ValueError('Release source must be a full commit SHA')


def stage(platform, installer, report_path, destination, version, source, run_url):
    identity(version, source)
    model, suffix, hash_key = PLATFORMS[platform]
    report = json.loads(report_path.read_text(encoding='utf-8'))
    if (report.get('passed') is not True or report.get('resources_unchanged') is not True
            or report.get('provider_calls') is not False or report.get('default_speech_provider') != 'whisper'
            or not report.get('speech', {}).get('transcript') or report['speech'].get('ready') is not True
            or {row.get('translation') for row in report.get('results', [])} != {'KJV', 'NIV', 'NLT'}):
        raise ValueError('Installed offline check is incomplete or failed')
    if report.get('manifest', {}).get('speech', {}).get('model') != model:
        raise ValueError('Incorrect platform speech model')
    if f'_{version}_' not in installer.name or installer.suffix != ('.exe' if platform == 'windows' else '.dmg'):
        raise ValueError('Installer version or platform does not match release')
    if platform == 'mac' and report.get('microphone_entitlement_verified') is not True:
        raise ValueError('Mac microphone entitlement check is missing')
    actual = digest(installer)
    if report.get(hash_key) != actual:
        raise ValueError('Installer hash differs from installed test')
    name = f'Manna-{version}-standard-{suffix}'
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / name
    if target.exists() or (destination/f'checks-{platform}.json').exists():
        raise ValueError('Refusing to replace staged installer')
    shutil.copyfile(installer, target)
    receipt = dict(platform=platform, version=version, source_commit=source, workflow=run_url,
                   installer=name, sha256=actual, bytes=target.stat().st_size, installed_check=report)
    (destination/f'checks-{platform}.json').write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
    return receipt


def assemble(staged, destination, version, source):
    identity(version, source)
    receipts = []
    for platform in PLATFORMS:
        path = staged/f'checks-{platform}.json'
        if not path.is_file():
            raise ValueError(f'Missing {platform} installed test receipt')
        receipt = json.loads(path.read_text(encoding='utf-8'))
        if receipt['version'] != version or receipt['source_commit'] != source or receipt['platform'] != platform:
            raise ValueError('Installer source or version differs from release')
        expected = f'Manna-{version}-standard-{PLATFORMS[platform][1]}'
        if receipt['installer'] != expected or digest(staged/expected) != receipt['sha256']:
            raise ValueError('Staged installer name or hash changed')
        receipts.append(receipt)
    if destination.exists():
        raise ValueError('Refusing to overwrite a release bundle')
    destination.mkdir(parents=True)
    for receipt in receipts:
        shutil.copyfile(staged/receipt['installer'], destination/receipt['installer'])
        name = f"checks-{receipt['platform']}.json"
        shutil.copyfile(staged/name, destination/name)
    manifest = dict(version=version, tag=f'v{version}', source_commit=source, draft=True,
                    prerelease=True, public_release_ready=False, installers=receipts)
    (destination/'release-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    notes = f'''# Manna {version} — internal standard package candidate

**Draft only. Not ready for public distribution.**

Source commit: `{source}`.

Windows x64 includes Base English. Apple Silicon includes Small English Q8.
Both include MiniLM and KJV/NIV/NLT detection. Existing speech choices are preserved.

## Verification

Each installer passed its platform's installed offline speech and scripture check.
The accompanying checks-*.json files identify the exact tested files and workflow runs.
SHA256SUMS.txt covers every release file except itself.

## Open release blockers

- Windows publisher signing is pending. The EXE is unsigned.
- This Mac CI candidate is an internal ad-hoc build, not Developer ID signed or notarized.
- Windows speech speed in the compatible CPU mode is not ready for comfortable live use.
- NDI eligibility and Bible/media redistribution permissions remain unresolved.
- Real microphone, reconnection and projector checks on target laptops remain necessary.

No update manifest is generated. Existing in-app update feeds are unchanged.
Publishing is a separate manual action after explicit approval and blocker review.
'''
    (destination/'release-notes.md').write_text(notes, encoding='utf-8')
    checksums = ''.join(f'{digest(path)}  {path.name}\n' for path in sorted(destination.iterdir()))
    (destination/'SHA256SUMS.txt').write_text(checksums, encoding='utf-8')
    return manifest


def gh(*args):
    result = subprocess.run(['gh', *args], capture_output=True, text=True)
    if result.returncode:
        reading = args[:2] == ('release', 'view') or args[0] == 'api'
        if reading and ('HTTP 404' in result.stderr or 'release not found' in result.stderr.lower()):
            return None
        raise RuntimeError(f'GitHub request failed: {result.stderr.strip()}')
    return json.loads(result.stdout) if result.stdout.strip().startswith(('{', '[')) else result.stdout.strip()


def upload(bundle, repository):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid GitHub repository')
    manifest = json.loads((bundle/'release-manifest.json').read_text(encoding='utf-8'))
    identity(manifest['version'], manifest['source_commit'])
    if manifest.get('draft') is not True or manifest.get('public_release_ready') is not False:
        raise ValueError('Only internal drafts are supported')
    tag = f"v{manifest['version']}"
    if manifest['tag'] != tag:
        raise ValueError('Release tag differs from version')
    # Existing drafts and published releases are both immutable to this helper.
    if gh('release', 'view', tag, '--repo', repository, '--json', 'id,isDraft') is not None:
        raise ValueError('Release already exists; refusing to modify it')
    if gh('api', f'repos/{repository}/git/ref/tags/{tag}') is not None:
        raise ValueError('Release tag already exists; refusing to reuse it')
    expected_files = {'SHA256SUMS.txt', 'release-manifest.json', 'release-notes.md', 'checks-windows.json', 'checks-mac.json'}
    expected_files.update(f"Manna-{manifest['version']}-standard-{data[1]}" for data in PLATFORMS.values())
    if {p.name for p in bundle.iterdir()} != expected_files:
        raise ValueError('Unexpected or missing release files')
    listed = set()
    for line in (bundle/'SHA256SUMS.txt').read_text().splitlines():
        expected, name = line.split('  ', 1)
        if name in listed or Path(name).name != name or digest(bundle/name) != expected:
            raise ValueError('Release file hash changed')
        listed.add(name)
    if listed != expected_files - {'SHA256SUMS.txt'}:
        raise ValueError('Missing release file hashes')
    assets = [str(path) for path in sorted(bundle.iterdir())]
    return gh('release', 'create', tag, *assets, '--repo', repository, '--target', manifest['source_commit'],
              '--draft', '--prerelease', '--latest=false', '--title', f"Manna {manifest['version']} — internal candidate",
              '--notes-file', str(bundle/'release-notes.md'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    staging = commands.add_parser('stage')
    staging.add_argument('--platform', choices=list(PLATFORMS), required=True)
    staging.add_argument('--installer', type=Path, required=True)
    staging.add_argument('--report', type=Path, required=True)
    staging.add_argument('--run-url', required=True)
    for command in (staging, commands.add_parser('assemble')):
        command.add_argument('--version', required=True)
        command.add_argument('--source', required=True)
        command.add_argument('--output', type=Path, required=True)
    commands.choices['assemble'].add_argument('--staged', type=Path, required=True)
    sending = commands.add_parser('upload')
    sending.add_argument('--bundle', type=Path, required=True)
    sending.add_argument('--repo', required=True)
    args = parser.parse_args()
    if args.command == 'stage':
        stage(args.platform, args.installer, args.report, args.output, args.version, args.source, args.run_url)
    elif args.command == 'assemble':
        assemble(args.staged, args.output, args.version, args.source)
    else:
        print(upload(args.bundle, args.repo))


if __name__ == '__main__':
    main()
