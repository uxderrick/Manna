"""CLEWS (Sony, ICML 2025) as an evaluator layer.

Code and checkpoints are MIT-licensed (github.com/sony/clews, Zenodo record
15045900), so unlike CoverHunter this model could ship. Its training data
(Discogs-VI / SHS100K, YouTube audio) carries non-commercial research terms;
whether those reach the weights is not stated by the authors.

The model takes raw 16 kHz audio, cuts it into "shingles", computes a CQT
with nnAudio, and maps each shingle to a 1024-d embedding. Shingles shorter
than the 20 s training length are padded by repetition. Reference songs are
embedded as overlapping shingles the same length as the query.

The checkpoint is a pickle, so it is loaded with an unpickler that only
accepts torch / numpy / omegaconf / container types.
"""
import pickle
import sys
import types

import numpy as np

from common import DATA, SR

REPO = DATA / "models" / "clews"
WEIGHTS = DATA / "models" / "clews-weights" / "dvi-clews"
ALLOWED_MODULES = ("torch", "collections", "numpy", "omegaconf", "lightning", "typing", "_codecs", "enum", "pathlib")
ALLOWED_BUILTINS = {"dict", "list", "tuple", "set", "frozenset", "int", "long", "float", "complex", "str", "unicode", "bytes", "bytearray", "bool", "slice", "object"}


class _SafeUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module in ("builtins", "__builtin__") and name in ALLOWED_BUILTINS:
            return super().find_class(module, name)
        if module.split(".")[0] in ALLOWED_MODULES:
            return super().find_class(module, name)
        raise pickle.UnpicklingError(f"blocked global {module}.{name}")


safe_pickle = types.ModuleType("safe_pickle")
safe_pickle.Unpickler = _SafeUnpickler
safe_pickle.load = lambda f, **kw: _SafeUnpickler(f, **kw).load()
safe_pickle.__name__ = "pickle"


def load_model():
    import torch
    from omegaconf import OmegaConf

    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    from models import clews  # noqa: PLC0415  (repo module)

    conf = OmegaConf.load(WEIGHTS / "configuration.yaml")
    model = clews.Model(conf.model, sr=conf.data.samplerate)
    ckpt = torch.load(WEIGHTS / "checkpoint_best.ckpt", map_location="cpu", pickle_module=safe_pickle)
    state = ckpt.get("model", ckpt)
    state = {k.removeprefix("_forward_module.").removeprefix("module."): v for k, v in state.items()}
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing or unexpected:
        print(f"clews: missing={missing[:5]} unexpected={unexpected[:5]}", file=sys.stderr)
    model.eval()
    torch.set_num_threads(6)
    return model


REF_SHINGLE_S = 20.0  # CLEWS training length
REF_HOP_S = 10.0
CACHE = DATA / "cache" / "clews"


class ClewsIndex:
    """References are embedded once as 20 s shingles every 10 s (cached on
    disk); a query of any length is one shingle. Song score = best cosine
    similarity between the query and any shingle of that song."""

    def __init__(self):
        self.model = load_model()
        self.songs, self.embs = [], []
        CACHE.mkdir(parents=True, exist_ok=True)

    def _embed(self, wav, length_s, hop_s):
        import torch

        with torch.inference_mode():
            x = torch.from_numpy(np.ascontiguousarray(wav, dtype=np.float32)).unsqueeze(0)
            z = self.model(x, shingle_len=length_s, shingle_hop=hop_s)[0].numpy()
        return z / (np.linalg.norm(z, axis=1, keepdims=True) + 1e-9)

    def add(self, song, name, wav):
        path = CACHE / f"{name}.npy"
        if path.exists():
            z = np.load(path)
        else:
            z = self._embed(wav, REF_SHINGLE_S, REF_HOP_S)
            np.save(path, z)
            print(f"clews: embedded {name} ({len(z)} shingles)", file=sys.stderr, flush=True)
        self.songs += [song] * len(z)
        self.embs.append(z)

    def score(self, wav):
        n = len(wav)
        if n < SR * 2:
            return {}
        ref = np.concatenate(self.embs) if isinstance(self.embs, list) else self.embs
        self.embs = ref
        sims = ref @ self._embed(wav, n / SR, n / SR)[0]
        best = {}
        for song, s in zip(self.songs, sims.tolist()):
            if s > best.get(song, -1):
                best[song] = s
        return best
