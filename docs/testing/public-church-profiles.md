# Public church profiles — verification

Changes separate optional EWC integrations from public copy/paste sharing and keep church artwork device-local.

## Automated checks

- Connection-status tests cover fresh, malformed, incomplete and configured local files. Responses contain only capability booleans; no credentials or network access.
- UI tests cover absent, failed and configured connections, independent recap/SMS actions and copy controls.
- Asset tests cover historical paths, private portrait availability, neutral fallbacks and uploaded images.
- Native asset tests cover an absent pack, supported files only, rejected empty packs and no overwrite of existing files.
- Full frontend/native test runs, lint, type checking and a production frontend build are required. Scan the build for all ten original private image hashes and paths.

## Manual smoke test (after the next app launch)

1. On the existing EWC device, open a saved service plan and confirm the welcome, giving, title portrait, Jesus and closing slides still show the original artwork.
2. Download a saved title slide and confirm the portrait and logo match the On Screen view.
3. In recap/SMS review, confirm the existing configured direct actions remain available. Do not send or publish just to test their visibility.
4. In a fresh application profile without configurations or artwork, confirm neutral slides, no named portrait/EWC artist shortcut, and Copy actions with no direct Publish/Send buttons or Comms360 settings.
5. Copy a recap and SMS into another text editor and confirm the text matches the draft.

No live publishing, SMS, paid AI calls or app restarts are part of the automated checks. Existing release installers must be rebuilt before these changes can be distributed.

## Results — 2026-10-23

- Frontend: 521 tests passed. ESLint and TypeScript passed. Production frontend build passed (existing large JavaScript chunk warning remains).
- Native workspace: 407 tests passed, 8 ignored. The sandbox initially blocked localhost test servers; the same full suite passed with localhost permitted. No live provider calls were enabled.
- Packaging scripts: 27 passed, 1 Windows-only test skipped. The new public-asset checks also passed against the finished frontend build.
- All ten original image paths and content hashes are absent from public/build assets. Their originals are verified in the ignored pack and both local application-data folders.
- Existing main-app publishing and SMS configurations are both detected; credentials were not displayed or changed. The separate internal app has no connection configuration.
- No installer rebuild, commit, push or release publication was performed. Manual installed-app smoke checks above remain for the next launch.
- Separate STT/database edits appeared in the shared workspace during this work and were left untouched.
