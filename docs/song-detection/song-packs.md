# Song packs: teaching Manna songs by sound

Song detection recognises a song from its words (lyrics, works for every
song in the library) and from its sound (melody and harmony). Sound needs a
recording of each song to compare with. A **song pack** carries those
recordings' fingerprints in one file, so they can be made once and imported
into any Manna install.

A pack holds no audio: only fingerprints (about 1 KB per 10 s of song), and
each song's title, which is how it is matched to the songs in a library.

## 1. Collect recordings

One file per song, the whole song. MP3, M4A/AAC, WAV or FLAC.

The best recordings are your own church's (services, rehearsals, your
livestreams): same singers, same arrangement. Name each file after the song,
as it is titled in Manna: `No One Like the Lord.m4a`. Track numbers
(`03 - `) and underscores are ignored.

Or keep the file names and add a `titles.csv`:

```csv
file,title,artist
VID-20251103-WA0004.m4a,No One Like the Lord,
service-2025-11-02-song3.mp3,Way Maker,
```

## 2. Build the pack

Needs `models/songmatch/clews_int8.onnx` (and on an Intel Mac, ONNX
Runtime from Python; see `scripts/dev-intel-mac.sh`).

```sh
./scripts/build-song-pack.sh ~/Music/church-songs --out church.mannasongs
./scripts/build-song-pack.sh new-song.m4a --out church.mannasongs   # adds to it
./scripts/build-song-pack.sh list church.mannasongs
```

Folders are searched recursively. Building into an existing pack adds to it;
a file with the same name replaces its earlier recording. On an Intel i5 a
4-minute song takes about 10 s.

## 3. Import into Manna

Detections panel → Songs → **Import song pack** (in the status line). Each
pack song is attached to the library song with the same title (ignoring
case and punctuation; "(Live)" and similar may differ; a shortened title
such as "Oceans" finds "Oceans ...Spirit lead me" when only one song fits).
Your church's own copy is preferred over a bundled hymnal's.

Songs not in the library are listed: add them (paste or import their
lyrics), then import the pack again. Importing again replaces, never
duplicates.

Songs presented with Go Live keep teaching Manna too: what was sung is
saved as another recording of that song (up to 3 per song).
