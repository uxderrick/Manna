# Transcript-based recaps — 2026-10-25

The recap command now takes a session ID and reads that session's final transcript lines from the local database in chronological order. The complete selected text is sent as the source, not the generated summary. The database lock is released before the AI request. The recap button no longer requires a summary. The separate SMS-alternatives generator keeps its existing summary source and validation.

Instructions preserve the speaker's vocabulary, examples, questions and emphasis while removing repetition and clear transcription errors. They prohibit new metaphors and invented weekly exercises, keep uncertain transcription out of the recap, and distinguish paraphrases from exact quotes. Existing Reflection/Prayer sections remain. Worship, announcements and private personal details are excluded from the requested output.

Existing drafts, transcripts and summaries are not rewritten by this change. Generation still changes only the in-memory draft until Save. Publishing remains a separate action. A missing transcript is rejected before any AI call. Inputs over 120,000 UTF-8 bytes are rejected without truncation; longer services need separate voice-preserving section processing rather than falling back to a rewritten summary.

Verification covers the actual prompt data, the frontend session-ID request, generation without a summary, final/partial line selection, chronological ordering, source-size limits, missing sessions, and unchanged stored data. Tests use generated text and local mock servers only. No real sermon transcript was sent to an external service. Today's saved recap was not regenerated or republished, so voice quality still needs a human check after regeneration.
