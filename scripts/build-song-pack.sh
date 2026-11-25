#!/usr/bin/env bash
# Build (or add to) a song pack from recordings of whole songs, for import
# into Manna (Songs panel, "Import song pack").
#
#   ./scripts/build-song-pack.sh <audio files or folders>... --out church.mannasongs
#   ./scripts/build-song-pack.sh list church.mannasongs
#
# Each file is one song, titled by its file name ("No One Like the Lord.m4a")
# or by --titles titles.csv ("file name,title[,artist]"). MP3, M4A/AAC, WAV
# and FLAC are read. Needs models/songmatch/clews_int8.onnx.
#
# Intel Macs load ONNX Runtime from a Python onnxruntime wheel (see
# scripts/dev-intel-mac.sh); Apple silicon and other machines link it.
set -euo pipefail
cd "$(dirname "$0")/.."

cmd=(build)
if [[ "${1:-}" == "list" ]]; then cmd=(); fi

if [[ "$(uname -s)-$(uname -m)" == "Darwin-x86_64" ]]; then
  if [[ -z "${ORT_DYLIB_PATH:-}" ]]; then
    ORT_DYLIB_PATH="$(ls "$HOME"/.manna-ort/lib/python*/site-packages/onnxruntime/capi/libonnxruntime.*.dylib \
      "$HOME"/manna-song-data/.venv-ch/lib/python*/site-packages/onnxruntime/capi/libonnxruntime.*.dylib 2>/dev/null | head -1 || true)"
  fi
  [[ -n "$ORT_DYLIB_PATH" ]] || { echo "No ONNX Runtime found (see scripts/dev-intel-mac.sh)." >&2; exit 1; }
  export ORT_DYLIB_PATH
  features=onnx-dynamic
else
  features=onnx
fi

# Paths given relative to where the script was run from.
args=()
for a in "$@"; do
  if [[ -e "$OLDPWD/$a" && "$a" != /* ]]; then args+=("$OLDPWD/$a"); elif [[ "$a" == *.mannasongs && "$a" != /* ]]; then args+=("$OLDPWD/$a"); else args+=("$a"); fi
done

exec cargo run --quiet --release --manifest-path src-tauri/Cargo.toml -p manna-songpack --features "$features" -- ${cmd[@]+"${cmd[@]}"} "${args[@]}"
