# Development Keychain access — 2026-10-25

## Cause

The macOS development executable had an ad-hoc designated requirement bound to its changing code hash. Recompiles therefore changed its identity. Startup also read each saved provider key again when settings hydration ran more than once (including development Strict Mode and tutorial reloads). The old warning described every secure-store failure as a migration failure, even when no plaintext copy existed.

## Changes

- Provider credential reads are cached in memory per launch, within the existing per-key serialization. Denied access is not repeatedly retried by subsequent hydration. Successful saves update the cache; failed saves retain the existing value. OS secure storage and verified-before-delete migration remain unchanged.
- `bun run tauri dev` now uses a thin CLI wrapper. On macOS it uses an explicitly selected `MANNA_DEV_SIGNING_IDENTITY`, or the sole available Developer ID Application identity. Cargo runs the development executable through a signing runner before opening it. The stable identifier is `com.manna.app.development`. Its Keychain service remains `com.manna.app`, so existing keys are not moved or deleted.
- Existing custom runners are retained. Windows and release builds are unchanged. Without a suitable identity, the existing launch behavior is retained; unsigned developers may still see macOS prompts.
- The warning now describes unavailable keys rather than assuming a failed migration or claiming that plaintext copies exist.

## Verification

- 536 frontend tests passed, including duplicate-load, denied-access, edited-cache and dev-only signing cases. ESLint, TypeScript and production frontend build passed (the existing large-chunk warning remains).
- Real signed development launch succeeded. Its signature and team identity were verified without reading saved API keys.
- Two distinct generated C executables were compiled, signed and launched through the actual runner. Both signatures passed strict verification. Their code hashes differed and their designated requirements matched exactly.
- No Keychain access-control entries were edited and no credentials were exported. No SMS was sent. The real OS-store test remains skipped because it can request user authorization.

## Remaining manual check

Existing entries may require one approval per key for the new development identity. Enter the Keychain password locally and choose Always Allow. Then close and reopen Manna to confirm that authorization persists. The changed signing identity has been verified; absence of real permission prompts after the user's approval has not yet been verified. A locked Keychain or changed certificate can still require authorization.

Reference: Cargo target runner behavior: https://doc.rust-lang.org/cargo/reference/config.html#targettriplerunner
