#!/bin/sh
set -eu
# Keep the designated requirement stable across rebuilds without changing Keychain permissions.
if [ -n "${MANNA_DEV_SIGNING_IDENTITY:-}" ]; then
  /usr/bin/codesign --force --sign "$MANNA_DEV_SIGNING_IDENTITY" \
    --identifier com.manna.app.development --timestamp=none "$1"
fi
exec "$@"
