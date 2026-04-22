# Release Runbook

How to cut a release, manage signing keys, and recover from failures.

## Cutting a release

1. Bump versions in all 3 files:
   - `package.json` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version` under `[package]`
2. Commit: `git commit -am "chore: bump to vX.Y.Z"`
3. Tag + push: `git tag vX.Y.Z && git push origin master vX.Y.Z`
4. Watch GitHub Actions (~1 hr): https://github.com/uxderrick/Manna/actions
5. Workflow publishes a GitHub Release when all matrix jobs succeed. Edit notes if needed.

Pre-release tags (e.g. `v0.1.0-rc1`) auto-publish as "prerelease" — hidden from the "latest" endpoint, safe for testing.

## First-time setup (one-off)

### 1. Generate updater key

```bash
cd src-tauri
bun x tauri signer generate -w ~/.tauri/manna.key
```

Use a strong passphrase. Record it in a password manager. **Do not commit the private key.**

### 2. GitHub Secrets

In repo Settings → Secrets and variables → Actions, add:

- `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/manna.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the passphrase

### 3. Public key in config

Paste contents of `~/.tauri/manna.key.pub` into the `pubkey` field of both:

- `src-tauri/tauri.conf.minimal.json`
- `src-tauri/tauri.conf.full.json`

Commit both.

### 4. Smoke test

Push a prerelease tag to verify the workflow end-to-end:

```bash
git tag v0.1.0-rc1 && git push origin v0.1.0-rc1
```

When green, tag the real release.

## Release artifacts

Each release publishes:

- `Manna-X.Y.Z-minimal-macos.dmg` — ~400 MB, no GPU required
- `Manna-X.Y.Z-full-macos.dmg` — ~2 GB, semantic detection + Whisper STT
- `Manna-X.Y.Z-minimal-windows.exe` — NSIS installer
- `latest-minimal.json` — Tauri updater manifest for minimal flavor
- `latest-full.json` — Tauri updater manifest for full flavor

Windows-full is not published for v1 (GitHub runners lack GPU for Qwen3 precompute in 6hr timeout).

## User-facing install docs

### macOS unsigned install

First launch may show "Manna can't be opened because it is from an unidentified developer" or "Manna is damaged".

**Workaround:**

```bash
xattr -d com.apple.quarantine /Applications/Manna.app
```

Then launch normally.

### Windows SmartScreen

First launch may show "Windows protected your PC".

**Workaround:**

1. Click "More info"
2. Click "Run anyway"

Subsequent launches skip this.

## Key rotation

If the updater private key is lost or suspected compromised:

1. Generate a new key pair (`bun x tauri signer generate -w ~/.tauri/manna.key`)
2. Update `pubkey` in both flavor config files
3. Ship a hotfix version with the new pubkey embedded. **Users on current version update to this hotfix using the OLD key** (still valid)
4. After hotfix is deployed, all users now trust the new pubkey
5. Update GitHub Secrets with new key + passphrase
6. Next release signs with the new key

If the key is lost without a hotfix, users must manually download new DMG/EXE from the releases page to get future updates.

## Failure recovery

### One matrix job fails, others succeed

Release aggregator still publishes. Released assets are missing one platform. Users on that platform either wait for a hotfix or fall back to prior version.

### Tag pushed by mistake

```bash
git push --delete origin vX.Y.Z
git tag -d vX.Y.Z
```

Delete the GitHub Release (if already created) via the UI.

### Bad release shipped

Mark it as "Pre-release" via the GitHub UI — hides it from `latest` endpoint so the updater stops offering it. Prepare hotfix `vX.Y.Z+1`.
