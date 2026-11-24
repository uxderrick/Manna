"""Shared paths and manifest helpers for the song-detection prototype."""
import csv
from pathlib import Path

DATA = Path.home() / "manna-song-data"
MANIFEST = DATA / "manifest.csv"
WAV_DIR = DATA / "cache" / "wav16k"
FEAT_DIR = DATA / "cache" / "features"
SR = 16000


def load_manifest():
    with MANIFEST.open(newline="") as f:
        return list(csv.DictReader(f))


def wav_path(row) -> Path:
    return WAV_DIR / (Path(row["path"]).stem + ".wav")


def split_of(row) -> str:
    """'va' = reference (goes in the key DB), 'vb' = other renditions (used as queries)."""
    return "va" if "/va/" in row["path"] else "vb"


def audio_rows():
    return [r for r in load_manifest() if r["source_type"] == "audio-ref"]
