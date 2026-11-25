"""Does the reference library get better as the church keeps singing?

Simulates Manna's "learn from confirmed services" loop with CLEWS (ONNX):
the base library is songs/va. For each query recording q in songs/vb, the
library is extended with k OTHER renditions of q's song taken from songs/vb
(as if those services had been confirmed earlier), then q's 10 s windows
are matched. k = 0 is the base library alone.

Uses raw cosine similarity (no cohort normalisation), as the in-app engine
will; also reports the top-1 vs runner-up gap distribution for picking a
raw-cosine commit threshold.

    CLEWS_BACKEND=clews_int8_static ~/manna-song-data/.venv-ch/bin/python learning_eval.py
"""
from collections import defaultdict
from pathlib import Path

import numpy as np
import soundfile as sf

from clews_layer import ClewsIndex
from common import audio_rows, split_of, wav_path

WIN_S = 10.0
STEP_S = 20.0
MAX_Q = 12
PLAN_SIZE = 6


def main():
    idx = ClewsIndex()
    rows = audio_rows()
    lib = defaultdict(list)  # song -> list of (stem, embeddings)
    for r in rows:
        if split_of(r) == "va":
            idx.songs, idx.embs = [], []
            idx.add(r["song_slug"], Path(r["path"]).stem, sf.read(wav_path(r), dtype="float32")[0])
            lib[r["song_slug"]].append((Path(r["path"]).stem, idx.embs[0]))
    renditions = defaultdict(list)  # song -> vb (stem, embeddings, wav)
    for r in rows:
        if split_of(r) == "vb" and r["song_slug"] in lib:
            wav = sf.read(wav_path(r), dtype="float32")[0]
            idx.songs, idx.embs = [], []
            idx.add(r["song_slug"], Path(r["path"]).stem, wav)
            renditions[r["song_slug"]].append((Path(r["path"]).stem, idx.embs[0], wav))
    songs = sorted(lib)
    rng = np.random.default_rng(0)

    results = defaultdict(lambda: defaultdict(list))  # k -> metric -> values
    gaps_true, gaps_wrong = [], []
    for song, rends in renditions.items():
        for qi, (q_stem, _, q_wav) in enumerate(rends):
            others = [e for j, (_, e, _) in enumerate(rends) if j != qi]
            starts = np.arange(0, max(len(q_wav) / 16000 - WIN_S, 0) + 1e-6, STEP_S)[:MAX_Q]
            q_embs = [idx._embed(q_wav[int(s * 16000): int((s + WIN_S) * 16000)], WIN_S, WIN_S)[0] for s in starts]
            for k in range(0, len(others) + 1):
                bank = {s: [e for _, e in lib[s]] for s in songs}
                bank[song] = bank[song] + others[:k]
                mats = {s: np.concatenate(v) for s, v in bank.items()}
                for q in q_embs:
                    sims = {s: float(np.max(m @ q)) for s, m in mats.items()}
                    plan = [song, *rng.choice([s for s in songs if s != song], PLAN_SIZE - 1, replace=False)]
                    ranked_all = sorted(sims, key=sims.get, reverse=True)
                    ranked_plan = sorted(plan, key=sims.get, reverse=True)
                    results[k]["all_top1"].append(ranked_all[0] == song)
                    results[k]["plan_top1"].append(ranked_plan[0] == song)
                    results[k]["true_sim"].append(sims[song])
                    results[k]["qid"].append((q_stem, len(results[k]["qid"])))
                    if k == 0:
                        gap = sims[ranked_plan[0]] - sims[ranked_plan[1]]
                        (gaps_true if ranked_plan[0] == song else gaps_wrong).append(gap)

    print("Library grows with k extra performances of the song (10 s queries, CLEWS 8-bit, raw cosine)\n")
    print(f"{'k extra':>8} | {'queries':>7} | {'all 22 top-1':>12} | {'plan top-1':>10} | {'true-song similarity':>20}")
    for k in sorted(results):
        r = results[k]
        print(f"{k:>8} | {len(r['all_top1']):>7} | {np.mean(r['all_top1']):>12.0%} | {np.mean(r['plan_top1']):>10.0%} | "
              f"{np.median(r['true_sim']):>20.3f}")
    # Paired view: the same queries with and without one extra performance.
    n1 = len(results[1]["plan_top1"])
    if n1:
        sub0 = defaultdict(list)
        for (stem, _), a, p in zip(results[0]["qid"], results[0]["all_top1"], results[0]["plan_top1"]):
            sub0[stem].append((a, p))
        stems1 = {stem for stem, _ in results[1]["qid"]}
        base = [x for st in stems1 for x in sub0[st]]
        print(f"\nsame {len(base)} queries (songs with another performance available):")
        print(f"  base library only:      all 22 top-1 {np.mean([a for a, _ in base]):.0%}, plan top-1 {np.mean([p for _, p in base]):.0%}")
        print(f"  + 1 earlier performance: all 22 top-1 {np.mean(results[1]['all_top1']):.0%}, plan top-1 {np.mean(results[1]['plan_top1']):.0%}")
    gt, gw = np.array(gaps_true), np.array(gaps_wrong)
    print(f"\nplan top-1 vs runner-up cosine gap (base library): right picks median {np.median(gt):.3f}, "
          f"wrong picks median {np.median(gw):.3f}, wrong picks 95th pct {np.percentile(gw, 95):.3f}")
    for th in (0.02, 0.04, 0.06, 0.08, 0.10):
        print(f"  gap >= {th:.2f}: keeps {np.mean(gt >= th):.0%} of right picks, {np.mean(gw >= th):.0%} of wrong picks")


if __name__ == "__main__":
    main()
