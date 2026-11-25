#!/usr/bin/env bash
# Run Manna in development on an Intel Mac.
#
# ONNX Runtime publishes no current build for Intel Macs, so this build
# leaves out semantic verse search and loads song detection's ONNX Runtime
# at run time from a Python `onnxruntime` wheel (1.20 or newer):
#
#   python3 -m venv ~/.manna-ort && ~/.manna-ort/bin/pip install onnxruntime==1.20.1
#
# Also needs the offline speech model (bun run download:whisper) and, for
# song detection by sound, models/songmatch/clews_int8.onnx.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${ORT_DYLIB_PATH:-}" ]]; then
  ORT_DYLIB_PATH="$(ls "$HOME"/.manna-ort/lib/python*/site-packages/onnxruntime/capi/libonnxruntime.*.dylib \
    "$HOME"/manna-song-data/.venv-ch/lib/python*/site-packages/onnxruntime/capi/libonnxruntime.*.dylib 2>/dev/null | head -1 || true)"
fi
if [[ -z "$ORT_DYLIB_PATH" ]]; then
  echo "No ONNX Runtime found: song detection will use lyrics only (see the top of this script)." >&2
else
  export ORT_DYLIB_PATH
  echo "ONNX Runtime: $ORT_DYLIB_PATH"
fi

# Some Command Line Tools installs ship a stale libc++ header folder that
# hides <cstdint>; use the SDK's headers for the C++ build (whisper.cpp).
export CXXFLAGS="-nostdinc++ -isystem $(xcrun --show-sdk-path)/usr/include/c++/v1 ${CXXFLAGS:-}"

exec bun tauri dev --features whisper,songmatch-dynamic -- --no-default-features
