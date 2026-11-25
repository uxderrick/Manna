"""Decode every manifest audio file to 16 kHz mono WAV (the rate Manna captures at).

Uses macOS `afconvert`, so mp3/m4a work without ffmpeg. Output goes to
~/manna-song-data/cache/wav16k/<stem>.wav and is skipped when already present.
"""
import subprocess
from concurrent.futures import ThreadPoolExecutor

from common import WAV_DIR, load_manifest, wav_path


def convert(row):
    out = wav_path(row)
    if out.exists():
        return "cached", out
    tmp = out.with_suffix(".tmp.wav")
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", row["path"], str(tmp)],
        check=True,
        capture_output=True,
    )
    tmp.rename(out)
    return "converted", out


def main():
    WAV_DIR.mkdir(parents=True, exist_ok=True)
    rows = [r for r in load_manifest() if r["source_type"] == "audio-ref"]
    with ThreadPoolExecutor(6) as pool:
        for status, out in pool.map(convert, rows):
            print(f"{status:9} {out.name}")
    print(f"{len(rows)} files ready in {WAV_DIR}")


if __name__ == "__main__":
    main()
