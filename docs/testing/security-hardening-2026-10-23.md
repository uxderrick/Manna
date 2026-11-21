# Security fixes — 23 October 2026

All seven findings from the audit are implemented. These changes are not committed, pushed, or released yet.

## Changes

| Finding | Fix |
| --- | --- |
| Deleting a recording session | The native command holds the recording-state lock through deletion and rejects active, stopping, or unfinished capture. Both session lists disable deletion for the live session. |
| AssemblyAI key verification | The permanent key goes in the Authorization header. It is absent from the URL. Verification requires a JSON Begin frame and rejects error, closed, and unexpected frames. The probe uses the same speech model as recording. |
| Unlimited image downloads | Downloaded bytes are capped at 20 MiB, with or without Content-Length. Invalid image content is rejected. File extensions come from image bytes, and filenames use UUIDs. Downloaded SVG is rejected; local image import is unchanged. |
| Plaintext provider keys | Eight provider credentials use macOS Keychain or Windows Credential Manager. Native writes verify the saved value. Existing JSON copies are removed only after success. Failed migration retains the old key and shows a warning. Save buttons wait for success. Other windows cannot use the credential commands. |
| Vite vulnerabilities | Vite is resolved to 7.3.7. |
| Tauri vulnerability | Tauri is resolved to 2.12.5. The earlier minimum patched version, 2.11.6, failed to compile with current dependency versions. The native package now declares Rust 1.90 as required by Tauri. |
| rustls vulnerabilities | rustls is resolved to 0.23.46. |

The extra JavaScript dependency scan also found older dependency advisories. Compatible patches were applied, including Fabric 7.4.0. The component-generator package brought in an unpatched tooling dependency chain. Manna only used its stylesheet, so that exact stylesheet is now local at `src/styles/shadcn.css`, with its MIT notice. The generator dependency was removed. The generated CSS hash is unchanged: `main-BFgpLt4W.css`.

The API keys covered are Deepgram, AssemblyAI, Claude, DeepSeek, Genius, Pexels, Unsplash, and Brave. Unsupported operating systems fail explicitly instead of pretending to save a key. The old JSON copy remains available if migration fails.

## Verification

- Frontend: 527 tests passed across 98 files.
- Native workspace: 415 tests passed; 9 optional tests were skipped. Live paid-provider tests were not enabled.
- macOS Keychain: a separate test saved, read, and removed one temporary generated key. It passed. No saved provider credential was read or changed by this test.
- Packaging: 27 checks passed; 1 platform-specific check was skipped.
- TypeScript, lint, frontend production build, and native compilation passed.
- Clippy completed with repository warnings. It is not a warning-free result.
- Both `npm audit` and `bun audit` reported zero known JavaScript dependency advisories at test time. This is not a claim that the whole app has no possible vulnerability.

Tests use generated values and localhost fixtures. They did not upload transcripts or make paid API calls. Unrelated work was preserved when applying the security patch from the separate checkout.

## Remaining device check

Only the macOS target is installed on this machine. Windows Credential Manager is implemented with keyring's Windows native backend, but a real Windows save/restart/delete check still needs a Windows machine. No Linux credential backend is enabled.

For a quick app check, open Settings → API Keys, save one key, and confirm that “Saved” appears. On the next normal app start, existing provider keys move to secure storage automatically. Do not share the key or the contents of settings files in chat.

## References

- [AssemblyAI streaming authentication and Begin events](https://www.assemblyai.com/docs/streaming/api-spec/streaming-websocket)
- [Keyring native credential backends](https://docs.rs/keyring/3.6.3/keyring/)
- [Vite advisory: GHSA-p9ff-h696-f583](https://github.com/vitejs/vite/security/advisories/GHSA-p9ff-h696-f583)
- [Vite advisory: GHSA-rq7h-c2jc-7f22](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22)
- [Tauri channel advisory](https://github.com/tauri-apps/tauri/security/advisories/GHSA-w28w-mhc8-qvjv)
- [rustls RUSTSEC-2026-0285](https://rustsec.org/advisories/RUSTSEC-2026-0285.html)
- [rustls RUSTSEC-2026-0346](https://rustsec.org/advisories/RUSTSEC-2026-0346.html)
