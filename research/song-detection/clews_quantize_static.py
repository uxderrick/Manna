"""Static 8-bit quantisation of the CLEWS ONNX model, calibrated on real songs.

Run after clews_export.py, from this folder:
    ~/manna-song-data/.venv-ch/bin/python clews_quantize_static.py
Calibrates on 26 windows from songs/va, then checks drift on 26 held-out
windows from songs/vb.
"""
import numpy as np, soundfile as sf, onnxruntime as ort
from common import audio_rows, split_of, wav_path, DATA
from clews_export import repeat_pad, WINDOW
from onnxruntime.quantization import quantize_static, CalibrationDataReader, QuantType, QuantFormat
import onnx
OUT = DATA/"models"/"clews-onnx"
rows=[r for r in audio_rows()]
rng=np.random.default_rng(1)
def windows(rs, k):
    out=[]
    for r in rs:
        w=sf.read(wav_path(r), dtype="float32")[0]
        for _ in range(k):
            s=rng.integers(0, max(len(w)-WINDOW,1)); out.append(repeat_pad(w[s:s+WINDOW]))
    return np.stack(out)
calib=windows([r for r in rows if split_of(r)=="va"][::2], 2)   # 26 calibration windows
test=windows([r for r in rows if split_of(r)=="vb"], 1)        # 26 held-out windows
class R(CalibrationDataReader):
    def __init__(s): s.it=iter(calib[i:i+1] for i in range(len(calib)))
    def get_next(s):
        x=next(s.it,None); return None if x is None else {"audio":x}
fp32=OUT/"clews_fp32.onnx"; st=OUT/"clews_int8_static.onnx"
keep=[n.name for n in onnx.load(str(fp32), load_external_data=False).graph.node if n.name.startswith("/cqt/")]
quantize_static(str(fp32), str(st), R(), quant_format=QuantFormat.QDQ, per_channel=True,
                weight_type=QuantType.QInt8, activation_type=QuantType.QUInt8, nodes_to_exclude=keep)
def emb(p, x):
    o=ort.SessionOptions(); o.intra_op_num_threads=6
    s=ort.InferenceSession(str(p), o, providers=["CPUExecutionProvider"])
    return np.concatenate([s.run(None,{"audio":x[i:i+4]})[0] for i in range(0,len(x),4)])
ref=emb(fp32,test)
for p in (OUT/"clews_int8.onnx", st):
    z=emb(p,test); cos=np.sum(z*ref,1)
    # does each int8 embedding still pick its own fp32 twin among the test set?
    nn=np.argmax(z@ref.T,1); same=np.mean(nn==np.arange(len(z)))
    print(f"{p.name:24} {p.stat().st_size/1e6:5.0f} MB  cosine on music mean {cos.mean():.3f} min {cos.min():.3f}  nearest-twin {same:.0%}")
