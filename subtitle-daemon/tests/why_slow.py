"""為什麼首字要 3.4 秒？先看模型自己的參數，再看解碼實際從哪一刻才開始。

三個可能，每個都有不同的修法：
  A. encoder 需要 T 幀右文脈 → 這是**固定成本**，只能換模型
  B. is_ready() 前段一直 false，decode 根本沒跑 → 是**設定/取樣率**問題
  C. decode 有跑、有輸出，但輸出被我自己擋掉 → 是**我的邏輯**問題

C 最該先排除，因為那是我的 bug。
"""

import sys, subprocess, tempfile, wave, os
from pathlib import Path
import numpy as np
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).resolve().parent))
import caption_daemon as cd

D = cd.MODEL_DIR
SR = 16000

print("=" * 76)
print("  1) encoder 的 metadata（模型自己宣告的需求）")
print("=" * 76)
enc_path = next(str(D / f) for f in ("encoder.int8.onnx", "encoder.onnx")
                if (D / f).exists())
so = ort.SessionOptions()
so.log_severity_level = 3
sess = ort.InferenceSession(enc_path, sess_options=so, providers=["CPUExecutionProvider"])
meta = sess.get_modelmeta().custom_metadata_map
for k, v in sorted(meta.items()):
    print(f"    {k:24} = {v}")

decode_chunk_len = int(meta.get("decode_chunk_len", 0))
T = int(meta.get("T", 0))
hop = 0.010          # sherpa-onnx fbank 預設 10ms hop
print()
if T and decode_chunk_len:
    right_ctx_ms = T * hop * 1000
    print(f"    T (右文脈)          = {T} 幀 ≈ {right_ctx_ms:.0f} ms")
    print(f"    decode_chunk_len    = {decode_chunk_len} 幀 ≈ {decode_chunk_len*hop*1000:.0f} ms")
    print(f"    → 第一個 encoder 輸出最早要 {max(right_ctx_ms, decode_chunk_len*hop*1000):.0f} ms 音訊")
print()

print("=" * 76)
print("  2) 實際餵音訊，看前 6 秒每一步：is_ready / decode 次數 / 輸出字數")
print("=" * 76)

POD = Path(r"C:\Users\CPXru\Music\playlist-admin\podcasts")
src = None
for d in POD.iterdir():
    if d.is_dir() and "博音" in d.name:
        for f in sorted(d.glob("*.mp3")):
            src = f
            break
    if src: break

w = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
subprocess.run(["ffmpeg","-v","quiet","-y","-ss","0","-i",str(src),"-t","8",
                "-ac","1","-ar",str(SR),"-f","wav",w], check=True, timeout=120)
with wave.open(w,"rb") as f:
    n = f.getnframes()
    a = np.frombuffer(f.readframes(n), dtype=np.int16).astype(np.float32)/32768.0
os.unlink(w)

rz = cd.Recognizer.get(cd.MODEL_DIR)
ses = cd.Session(rz)
step = int(SR * 0.160)

print(f"  {'音訊ms':>8}{'is_ready':>10}{'decodes':>9}{'累計字數':>9}   輸出")
for i in range(0, len(a), step):
    blk = a[i:i+step]
    ses.stream.accept_waveform(SR, blk.tolist())
    dec = 0
    while rz.rec.is_ready(ses.stream):
        rz.rec.decode_stream(ses.stream)
        dec += 1
    ms = int(i / SR * 1000) + 160
    t = cd.clean(rz.rec.get_result(ses.stream))
    if ms <= 1600 or (dec and ms < 5000):
        print(f"  {ms:>8}{'—':>10}{dec:>9}{len(t):>9}   {t[:26]!r}")

print()
print("=" * 76)
print("  3) 結論")
print("=" * 76)
print(f"  右文脈成本 ≈ {T*hop*1000:.0f} ms")
print("  若前 1.5 秒 is_ready 一直是 false → encoder 還在累積文脈")
print("  若一開始就 true 但字數為 0     → 模型真的還沒吐字（語音/內容問題）")