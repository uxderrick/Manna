# Manna

Manna is a desktop app for running church services. It listens to the sermon, finds matching Bible passages, and helps an operator present scriptures, songs, slides, and announcements. Each session keeps its transcript, detections, notes, recordings, and saved slides for review and sharing.

Built with React, TypeScript, Tauri 2, and Rust. Manna is a fork of [openbezal/rhema](https://github.com/openbezal/rhema), extended with service planning, session review, offline speech, and church presentation workflows. Internal Rust crates retain the `rhema-` prefix.

## Current status

Source version: **0.1.0-rc3**. Documentation reviewed: **21 October 2026**.

| Platform | Current verification |
| --- | --- |
| Apple Silicon Mac | A signed and notarized RC3 installer passed installed-resource, offline speech, and scripture-detection checks. Physical microphone/projector checks and another-machine testing remain separate. See [offline Mac RC3](docs/testing/offline-mac-rc3.md). |
| Windows x64 | An unsigned RC3 installer passed installed offline speech and detection checks. Publisher signing and local speech performance remain release blockers. The portable CPU build was too slow in the recorded runner tests; low-end HP/Lenovo support is not established. See [Windows candidate results](docs/testing/windows-offline-package.md). |
| Intel Mac / Linux | No equivalent installed RC3 verification is recorded in these release reports. |
| Browser | The full app depends on the native desktop backend. Opening the Vite interface in a browser does not provide a complete Manna installation. The separately hosted sermon recap website is a different project. |

These are candidate verification results, not a claim that every platform or feature has passed live-service testing. For current work, see the [backlog](docs/BACKLOG.md) and [release findings](docs/reports/2026-10-20-release-readiness.md). Older changelog entries and design plans describe earlier versions.

## What Manna does

### Live scripture detection

- Transcribes microphone or audio-device input with local Whisper, Deepgram, or AssemblyAI.
- Detects direct references, quotations, and paraphrases. Local semantic search uses an embedding model: a model that compares the meaning of phrases rather than exact words.
- Searches compatible **KJV, NIV, and NLT** indexes together. Other translations can be displayed when present in the Bible database; they do not all have semantic indexes.
- Keeps Bible selection, Queue, and Detections in sync when translations change. Presenting a queued scripture opens its book and chapter, selects the verse, and scrolls to it.
- Warms detection resources before use and handles speech-provider reconnection and input-device errors. Very loose paraphrases can still fail to match; results need operator judgment.

### Presentation and service plans

The workspace has resizable panels, separate **Preview** and **On Screen** views, a scripture/song queue, and a pinned service plan. Manual presentation and automatic scripture presentation are available in Settings.

- Select words in **On Screen**, then choose a highlight color to update live output. A clear-highlighting action removes highlights in one click.
- Present songs by stanza or line. Display capitalization for God, Christ, Lord, Saviour, Savior, and Redeemer preserves the saved original lyrics.
- Add slides from a visual gallery. Editable titles and announcements, prayer points, welcome/closing slides, giving slides, images, notes, and looping blank backgrounds support service preparation.
- Edit slide text inside Manna, reuse backgrounds, reorder visual plan cards, and configure church branding and giving details in **Settings → Church Profile**.
- Use a projector window or optional NDI broadcast output. OSC and HTTP remote-control support is also implemented.

### Sessions, notes, and sharing

Sessions persist locally and can be reopened for review. Session tools include:

- Transcript review and editing, detections, statistics, notes, and optional local audio recording with transcript-linked seeking.
- DeepSeek summaries that separate worship songs from sermon content. Generating a summary does not rewrite the saved transcript.
- Detection of an **announced** sermon title during the live session. Eligible automatic session names and empty title slides can use it; manual names and slide edits remain protected.
- A saved **Slides** gallery, including downloads, plus summary copy, Markdown export, and Print / PDF.
- Sharing drafts and artwork, website recap publishing, and configured SMS distribution. Website publishing requires device-specific configuration. Original sermon-audio publishing is separate from automated recap narration on the website.

## What works offline?

Local features require their database, models, and other resources to be present.

| Feature | Connection or credentials |
| --- | --- |
| Bible lookup, quotation matching, and semantic scripture search | Local; semantic search requires a compatible model and indexes. |
| Speech transcription with Whisper | Local in a Whisper-enabled build with the platform model installed. No speech API key is needed. |
| Speech transcription with Deepgram or AssemblyAI | Internet and the selected provider's API key. |
| Saved songs, service plans, slides, session review, local recording, and projector output | Local; output hardware and files must be available. |
| AI summaries, live AI notes, announced-title identification, and AI sharing drafts | Internet and a DeepSeek API key. |
| Online images and song lookup | Internet; provider credentials where required. |
| Website publishing and SMS | Internet and separate publishing/messaging configuration. |

Fresh Whisper-enabled Mac and Windows installations default to Whisper. Explicit saved provider choices are preserved. Builds without local-speech support use the cloud-provider path.

The current signed Mac package includes **Whisper Small English Q8**. The Windows candidate includes **Whisper Base English**. These are English models, not a verified multilingual speech solution.

## Using the app

### Before a service

1. Open **Settings → Audio** and select and test the input device.
2. Choose **Settings → Speech Recognition**: local Whisper or a configured cloud provider.
3. Select the Bible translation and projector in Settings.
4. Set the church profile, slide backgrounds, and optional API credentials.
5. Create a session and prepare its queue and service-plan slides.

### During a service

1. Complete the preflight checks and select **Start Service**.
2. Review detected scriptures and send the required passage to **On Screen**, or use configured automatic presentation.
3. Present queued scriptures, songs, and service-plan slides as needed.
4. Apply live highlights or use the Blank control for the configured background.
5. Add notes and monitor speech/input errors before ending the session.

### After a service

End the session to stop transcription and finalize its recording. Review the transcript, summary, detections, statistics, and saved slides. Export the summary or prepare a sharing draft. Publish a recap only when website publishing is configured on that device.

## Development setup

### Prerequisites

Install Bun, a current stable Rust toolchain, and the system dependencies for Tauri 2 on your platform. Python is used by data preparation and package verification. Local speech builds also need the native Whisper build tools; Windows packaging uses an x64 Visual Studio developer shell.

The Bible database, speech models, embedding models, and vector indexes are **not included in a fresh Git checkout**. Existing release candidates bundle verified resource sets. A reproducible download pipeline for the standard package is still separate release work.

### Clone and install dependencies

```sh
git clone https://github.com/uxderrick/Manna.git
cd Manna
bun install
```

### Prepare development resources

For a basic Bible database and direct/quotation detection:

```sh
bun run setup:minimal
```

This does **not** prepare the full standard package or every translation index. Semantic search additionally needs a compatible ONNX model, tokenizer, verse vectors, and verse IDs. The standard package uses **MiniLM-L6-v2**, with KJV/NIV/NLT indexes. Source development also supports Qwen3 INT8/FP32 and selects an available compatible model.

If the local MiniLM model and KJV vectors already exist, prepare NIV/NLT indexes with:

```sh
.venv/bin/python data/prepare-translation-indexes.py --family minilm
```

This script uses existing local model and Bible data; it is not a model downloader. See [translation-index guidance](embeddings/translation-indexes/README.md) and [standard-package resource checks](docs/testing/standard-mac-package.md).

To download the speech model currently expected on the host platform:

```sh
bun run download:whisper
```

`setup:semantic` and `setup:all` are the older Qwen-oriented preparation recipes. They export/precompute models and can require substantial time and hardware resources. They are not required to run an installer that already bundles its resources. Their existence does not establish a supported low-end hardware configuration.

### Run the desktop app

```sh
bun run tauri dev
```

Tauri starts Vite on port 3000 and the native backend. `bun run dev` starts only the web interface; desktop commands, audio capture, local storage, detection, and output-window behavior still need the native app.

### Optional credentials

Enter keys in **Settings → API Keys**. Deepgram, AssemblyAI, and DeepSeek have verification controls. Developers can also use a root `.env` file; saved app credentials take precedence where supported. Do not commit credentials.

| Variable | Purpose |
| --- | --- |
| `DEEPGRAM_API_KEY` | Deepgram cloud speech. |
| `ASSEMBLYAI_API_KEY` | AssemblyAI cloud speech. |
| `DEEPSEEK_API_KEY` | AI summaries, notes, and title identification. |
| `PEXELS_API_KEY`, `UNSPLASH_API_KEY`, `BRAVE_API_KEY` | Optional image search providers. |
| `GENIUS_API_KEY` | Optional online song lookup. |

A local Whisper service does not require cloud speech keys. Website publishing and Comms360 SMS use separate device configuration; do not assume an API key in this table enables them.

For optional NDI library preparation:

```sh
bun run download:ndi-sdk
```

## Checks and packaging

### Frontend checks

```sh
bun run typecheck
bun run lint
bun run test:run
bun run build
```

### Native and microphone recovery checks

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml --workspace
bun run test:microphone-recovery
```

The microphone recovery script uses offline/local test fixtures, including local WebSocket servers. It does not make paid speech calls. Physical unplug/replug, microphone permissions, live speech accuracy, and projector output still need hardware checks. See [microphone recovery](docs/testing/microphone-recovery.md).

### Installer commands

| Command | Purpose and limits |
| --- | --- |
| `bun run package:prepare` | Validate and stage the existing resources pinned by `data/standard-package.lock.json`; does not download or regenerate them. |
| `bun run package:mac:internal` | Separate ad-hoc internal Mac app using standard detection resources; not the signed offline-speech release candidate. |
| `bun run package:mac:signed` | Prepare the Mac candidate with local speech for the documented Keychain signing/notarization process. The script alone does not complete signing or notarization. |
| `bun run package:windows [SOURCE_DIRECTORY]` | Prepare and build the Windows standard installer on Windows; publisher signing and live speech performance require the checks below. |
| `bun run tauri build` | Generic Tauri build. Use the platform packaging instructions to include the intended verified resources and release settings. |

Before distributing a candidate, follow the platform-specific records:

- [Mac offline RC3 and signed-installer verification](docs/testing/offline-mac-rc3.md).
- [Mac signing and notarization procedure](docs/testing/signed-mac-package.md).
- [Windows offline installer, measurements, and remaining blockers](docs/testing/windows-offline-package.md).
- [Standard detection resource staging and verification](docs/testing/standard-mac-package.md).
- [Release research and follow-ups](docs/reports/2026-10-20-release-readiness.md).

## Architecture

| Part | Implementation |
| --- | --- |
| Interface | React 19, TypeScript, Vite 7, Tailwind CSS 4, Zustand, shadcn/ui, Vaul, Sonner. |
| Desktop backend | Tauri 2 and Rust; native commands handle audio, storage, detection, and output. |
| Local data | SQLite Bible resources plus a writable session database in app data. |
| Detection | Direct-reference parsing, quotation search, ONNX semantic inference, and compatible translation indexes. |
| Speech | Local Whisper or Deepgram/AssemblyAI streaming, with shared cloud reconnection handling. |
| Optional services | DeepSeek, image/song providers, configured website publishing, and SMS. |

```text
src/
  components/          Workspace, service plans, session review, settings, projection UI
  hooks/               Native events and feature coordination
  stores/              App state and persistence
  lib/                 Rendering, search, presentation, sharing, and workflow helpers
  broadcast-output.tsx Projector/broadcast window
src-tauri/
  src/commands/        Native app operations
  crates/              Audio, STT, Bible, detection, broadcast, API, and notes crates
  tauri.conf*.json     Base and platform/package configuration
data/                  Data preparation, schemas, and pinned resource manifests
scripts/               Packaging, installed verification, and data tools
docs/                  Backlog, design history, reports, and operator checks
models/                Local model resources; binary files are not in Git
embeddings/            Local verse vectors and translation indexes
```

## Contributing and license

Use the [backlog](docs/BACKLOG.md) for planned work and the linked verification records for the current release limits. Historical design plans are context, not a current feature checklist.

See [LICENSE](LICENSE). Upstream attribution: [openbezal/rhema](https://github.com/openbezal/rhema).

## Preparing an internal release draft

Use **Actions → Release (draft only) → Run workflow** on the branch/commit you want to test. Enable `prepare_draft`, then supply the existing verified resource release and archive SHA256. The app version in `package.json` must match `src-tauri/tauri.conf.json`. Use a new version for each new draft; existing tags, drafts and published releases are never overwritten.

This workflow builds the standard Windows x64 package with Base English and an Apple Silicon **Manna Internal** DMG with Small English Q8. Both include MiniLM and KJV/NIV/NLT detection resources. The Mac job downloads the speech model from its pinned revision and verifies its locked checksum. The Windows build uses the existing verified resource archive. It does not rebuild Bible data or indexes from network sources.

Each platform runs source tests and installs its package into a fresh directory to check local speech and scripture detection. The release helper binds each installer to its installed-test hash, version, source commit and workflow run. Both platforms must pass before a new **draft prerelease** is created with installers, test receipts, a manifest and `SHA256SUMS.txt`.

These CI packages are internal candidates: Windows is unsigned; Mac uses an ad-hoc identity and a separate internal app identifier. The existing Developer ID signed/notarized Mac installer is not changed. No signing secrets are exported or used, no update feed is generated, and no workflow publishes the draft automatically. A version tag alone does not start this release workflow.

Before manually publishing anything, resolve publisher signing, NDI eligibility, Bible/media permissions, Windows speech performance and real-device microphone/projector testing. A draft being created is not public-release approval. Do not publish the current internal candidates as the finished release.

The same Actions entry still supports the separate Windows build, installed-EXE retest and speech diagnostics options. Leave `prepare_draft` off when using those options. A run with no options selected runs only the Python packaging/release checks.

The new workflow must be present in the commit used for a release. Until it is merged into the repository's default branch, select the working branch explicitly; older commits still contain the old release workflow.

### Church profiles in public releases

Public installations use **copy and paste** for recap and SMS sharing. They do
not need a publishing or SMS account to edit and copy drafts. AI draft generation
still needs the user's own DeepSeek key; manually written drafts do not.
Existing device-local publishing and Comms360 configurations keep their direct
actions. The app checks local configuration only; it never sends on startup.

EWC artwork is no longer part of `public/` or new installers. This workstation's
originals are preserved in the ignored `.private-church-assets/` folder and in
`church-assets/` under the application-data folders for both `com.manna.app` and
`com.manna.internal`. Back up that folder privately. Do not add it to a release
or commit it. Development imports missing artwork from the local pack; release
builds read only the installed device-local copy. To restore it on another EWC
device, use **Settings → Church profile → Identity & branding → Restore legacy
church artwork**, choose the pack folder, and reopen Manna between services.
This imports only known artwork files, never credentials, contacts or sessions.
Existing files are not overwritten. Saved plan/gallery image paths continue to
resolve to these local files; devices without the pack use neutral fallbacks.

Older commits and already-built installers still contain their original assets.
These changes require new installers; they do not rewrite Git history or replace
existing release downloads.
