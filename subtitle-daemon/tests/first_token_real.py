"""重測「首字延遲」—— 這次量的是**音訊時間**，不是牆鐘時間。

為什麼要重測
------------
我先前報過「首字延遲 89ms」，那是用這段程式量的：

    t = time.perf_counter()
    for chunk in 160ms 餵:
        decode()
        if get_result() 非空: got = 計時停止
    → 89ms

問題在於這個迴圈量的是**算出來要多久**，而且只要**任何時候**抓到一次非空結果就記下來。
它沒有回答直播字幕真正在意的問題：
    「主播開口之後，觀眾要等多久才看到第一個字？」

latency_split.py 已經顯示：教學錄音語音佔比 62%，但模型餵到 5120ms 才吐第一個字。
那 89ms 顯然量錯了對象。

這次的量法
----------
對每個片段用兩個時間基準分開量：
  · 首字音訊時間  = 從 0 餵到 get_result() 第一次非空，經過了幾 ms 音訊
  · 首個定稿時間  = 從 0 餵到第一個 final，經過了幾 ms 音訊
前者是「直播體感」，後者是「可以固定下來的字幕」。
"""

import subprocess, tempfile, wave, os, sys, random
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import caption_daemon as cd

POD = Path(r"C:\Users\CPXru\Music\playlist-admin\podcasts")
SR = 16000
CHUNK_MS = 160

rz = cd.Recognizer.get(cd.MODEL_DIR)

# 隨機抽 10 個不同節目的片段
AUDIO_EXT = (".mp3", ".m4a", ".wav", ".flac", ".ogg")
pool = []
for txt in POD.rglob("*.txt"):
    try:
        if not (20_000 < txt.stat().st_size < 300_000):
            continue
    except OSError:
        continue
    for ext in AUDIO_EXT:
        c = txt.with_suffix(ext)
        if c.exists() and c.stat().st_size > 500_000:
            pool.append(c)
            break
    if len(pool) >= 40:
        break

random.seed(42)
sample = random.sample(pool, min(10, len(pool)))


def clip(src: Path, start: float, dur: float) -> np.ndarray:
    w = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run(["ffmpeg", "-v", "quiet", "-y", "-ss", str(start), "-i", str(src),
                    "-t", str(dur), "-ac", "1", "-ar", str(SR), "-f", "wav", w],
                   check=True, timeout=200)
    with wave.open(w, "rb") as f:
        n = f.getnframes()
        a = np.frombuffer(f.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    os.unlink(w)
    return a


print("=" * 80)
print("  首字延遲（音訊時間基準）— 10 個不同節目，各 25 秒")
print("=" * 80)
print(f"  {'節目':<26}{'語音%':>7}{'首字':>9}{'首定稿':>9}")
print("  " + "-" * 52)

first_tok, first_final = [], []
for src in sample:
    a = clip(src, 0.0, 25.0)
    step = int(SR * CHUNK_MS / 1000)

    rms = [float(np.sqrt(np.mean(a[i:i+step].astype(np.float64) ** 2)))
           for i in range(0, len(a) - step, step)]
    voiced = sum(1 for r in rms if r >= 0.004) / len(rms) * 100

    ses = cd.Session(rz)
    t_tok = t_fin = None
    for i in range(0, len(a), step):
        msgs = ses.feed(a[i:i + step])
        ms = int(i / SR * 1000)
        if t_tok is None and cd.clean(rz.rec.get_result(ses.stream)):
            t_tok = ms
        if t_fin is None and any(m["type"] == "final" for m in msgs):
            t_fin = ms
            break

    name = src.parent.name[:12] + "/" + src.stem[:10]
    first_tok.append(t_tok)
    first_final.append(t_fin)
    ts = f"{t_tok:>6} ms" if t_tok else "     未到"
    fs = f"{t_fin:>6} ms" if t_fin else "     未到"
    print(f"  {name:<26}{voiced:>6.0f}%{ts:>9}{fs:>9}")

ok = [x for x in first_tok if x is not None]
okf = [x for x in first_final if x is not None]
print("  " + "-" * 52)
if ok:
    ok.sort(); okf.sort()
    print(f"\n  首字延遲（音訊時間）: 中位 {ok[len(ok)//2]} ms   "
          f"最小 {ok[0]} ms   最大 {ok[-1]} ms")
if okf:
    okf.sort()
    print(f"  首個定稿      : 中位 {okf[len(okf)//2]} ms   "
          f"最小 {okf[0]} ms   最大 {okf[-1]} ms")

print("""
  讀法
  ────
  這是「主播開口後，字幕要等多久才出現」的真實成本。
  Groq 那條路實測是 300-600ms（含視窗重疊的緩衝）。

  如果本機模型的首字是秒級，那它輸在「直播體感」，
  贏在「品質、標點、零成本、隱私」——
  也就是**適合當備援，不是適合當主力**。
""")