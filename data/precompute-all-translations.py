"""Precompute Qwen3 embeddings for selected Bible translations."""
import json, os, struct, sys
import numpy as np
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'rhema.db')
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'embeddings')
os.makedirs(OUT_DIR, exist_ok=True)

INCLUDE = {'NIV', 'NKJV'}

print('Loading Qwen3-Embedding-0.6B model...', flush=True)
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('Qwen/Qwen3-Embedding-0.6B')
print(f'Model loaded on: {model.device}, dim: {model.get_sentence_embedding_dimension()}', flush=True)

conn = sqlite3.connect(DB_PATH)
translations = conn.execute('SELECT id, abbreviation FROM translations').fetchall()
todo = [(tid, abbr) for tid, abbr in translations if abbr in INCLUDE]
print(f'Will process {len(todo)} translations: {[a for _, a in todo]}', flush=True)

for trans_id, abbrev in todo:
    out_emb = os.path.join(OUT_DIR, f'kjv-qwen3-0.6b-{abbrev.lower()}.bin')
    out_ids = os.path.join(OUT_DIR, f'kjv-qwen3-0.6b-{abbrev.lower()}-ids.bin')

    if os.path.exists(out_emb) and os.path.getsize(out_emb) > 0:
        print(f'[{abbrev}] Already exists, skipping', flush=True)
        continue

    rows = conn.execute(
        'SELECT id, text FROM verses WHERE translation_id = ? ORDER BY id',
        (trans_id,)
    ).fetchall()

    if not rows:
        print(f'[{abbrev}] No verses found, skipping', flush=True)
        continue

    ids = [r[0] for r in rows]
    texts = [r[1] for r in rows]

    print(f'[{abbrev}] Computing embeddings for {len(texts)} verses...', flush=True)
    embeddings = model.encode(texts, batch_size=64, normalize_embeddings=True, show_progress_bar=True)

    embeddings.astype(np.float32).tofile(out_emb)
    with open(out_ids, 'wb') as f:
        for vid in ids:
            f.write(struct.pack('<q', vid))

    print(f'[{abbrev}] Done! {len(ids)} verses, {os.path.getsize(out_emb) / 1024 / 1024:.0f}MB', flush=True)

conn.close()
print('All translations complete!', flush=True)
