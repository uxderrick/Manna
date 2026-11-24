"""Export CLEWS to ONNX (fp32 and 8-bit) and measure size, speed and drift.

The exported graph takes a batch of fixed 20 s windows at 16 kHz
(shape [B, 320000]) and returns L2-normalised 1024-d embeddings. Shorter
clips are repeat-padded to 20 s by the caller, which is what CLEWS does
internally anyway. Manna's Rust side can run this through `ort`.

    ~/manna-song-data/.venv-ch/bin/python clews_export.py
"""
import time

import numpy as np

from common import DATA, SR

OUT = DATA / "models" / "clews-onnx"
WINDOW = int(20 * SR)


def repeat_pad(wav, n=WINDOW):
    """Repeat a clip until it is `n` samples long (CLEWS's pad_mode="repeat")."""
    if len(wav) >= n:
        return wav[:n]
    reps = int(np.ceil(n / max(len(wav), 1)))
    return np.tile(wav, reps)[:n]


def export():
    import torch

    from clews_layer import load_model

    model = load_model()

    class Embedder(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, x):  # (B, WINDOW)
            h = self.m.cqt(x).unsqueeze(1)  # (B, 1 shingle, C, T)
            z, _ = self.m.embed(h)
            z = z[:, 0]
            return z / (z.norm(dim=1, keepdim=True) + 1e-9)

    net = Embedder(model).eval()
    OUT.mkdir(parents=True, exist_ok=True)
    fp32 = OUT / "clews_fp32.onnx"
    dummy = torch.randn(2, WINDOW) * 0.1
    torch.onnx.export(
        net, dummy, fp32, input_names=["audio"], output_names=["embedding"],
        dynamic_axes={"audio": {0: "batch"}, "embedding": {0: "batch"}}, opset_version=17,
    )
    with torch.inference_mode():
        ref = net(dummy).numpy()
    return fp32, dummy.numpy(), ref


def quantize(fp32):
    from onnxruntime.quantization import QuantType, quantize_dynamic

    int8 = OUT / "clews_int8.onnx"
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8)
    return int8


def bench(path, x, ref):
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 6
    sess = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
    out = sess.run(None, {"audio": x.astype(np.float32)})[0]
    one = x[:1].astype(np.float32)
    sess.run(None, {"audio": one})
    t = time.time()
    for _ in range(3):
        sess.run(None, {"audio": one})
    per = (time.time() - t) / 3
    cos = float(np.mean(np.sum(out * ref, axis=1)))
    print(f"{path.name:18} {path.stat().st_size / 1e6:7.0f} MB   {per:5.2f} s per 20 s window   "
          f"cosine vs PyTorch {cos:.4f}")


if __name__ == "__main__":
    fp32, x, ref = export()
    int8 = quantize(fp32)
    for p in (fp32, int8):
        bench(p, x, ref)
