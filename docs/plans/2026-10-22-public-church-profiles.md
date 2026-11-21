# Public church profiles and private EWC assets

Goal: use one app with copy/export for public users and preserve the existing EWC setup locally.

1. Add a read-only connection-status command. Read existing local publishing/SMS configuration without returning keys or making network calls. Hide direct publishing, audio upload, SMS sending and provider settings when unconfigured. Keep drafts/copy available on failures.
2. Preserve EWC artwork in an ignored local pack, then remove it from public frontend assets. Resolve historical slide paths through a fixed local asset map so saved plans/gallery downloads continue to work. Supply neutral welcome/closing/Jesus defaults for fresh installations. Allow the private pack to be imported from Settings.
3. Keep the named portrait and EWC artist shortcut available only with the private setup. Do not create another app repository or remove existing session data.
4. Test absent/malformed/configured connections; fresh/legacy church profiles; private asset copying, missing assets and historical paths. Run frontend tests/lint/typecheck/build and native tests. Verify the built frontend does not contain the private images.

Constraints: no paid API calls, SMS sends, website publishing, release publication, app restart, credentials printed, or commits without request. Keep unrelated files unchanged. Existing backend sends already require their saved configuration; do not weaken their validation. Existing publishing is an optional EWC integration, not a generic website connector.
