# Multiple SMS messages per session — 2026-10-25

An accepted contact-list send now offers **Send another message**. This previews the current SMS draft and cost with a fresh reference; it never sends automatically. The one-part SMS limit remains. Actual submission still requires the separate Send SMS action.

The preview request carries the previous send reference. The backend checks that it is still the current accepted send. Stale references and uncertain submissions are rejected, including direct command calls that bypass the UI. Retries continue to reuse the original payload/reference, and an already accepted send is never submitted again.

Each send has a private `list-send-{session}-{uuid}.json` record. The original `list-send-{session}.json` remains the current-record pointer/snapshot for compatibility. When creating another preview, older single-record installations are archived before the current record is replaced. Existing messages and provider references are not deleted. The dialog shows the current send; a separate history browser was not added.

Tests cover deliberate second sends with different provider request keys, safe retries, stale previous references, unknown outcomes, preservation of legacy records, invalid archive IDs, current-draft preview without automatic sending, action visibility and the one-part limit. All provider responses are generated local mock responses. No real contact-list preview, paid API call, SMS send or delivery check was performed.

Verification: 422 native tests passed (9 ignored). Final frontend/lint/build results are recorded in the task response. Existing Tauri plugin-version and large frontend chunk warnings are outside this change.
