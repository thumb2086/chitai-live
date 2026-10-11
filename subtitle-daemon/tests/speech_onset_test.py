"""決定性實驗：把「模型暖機」和「錄音開頭沒人講話」分開量。

做法：每段錄音先用 rms 找出**第一個語音起點**，從那裡切開再餵。
  · 如果首字立刻降到幾百毫秒 → 模型沒問題，先前的 3.4 秒是量到了別的東西
  · 如果還是秒級        → 才是模型真的慢

這是直播字幕真正會遇到的情況：主播一開口就有人在說，不是錄音檔的片頭。
"""

import subprocess, tempfile, wave, os, sys, random
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import caption_daemon as cd

POD = Path(r"C:\Users\CPXru\Music\playlist-admin\podcasts")
SR = 16000
CHUNK_MS = 160
HOP = 1600                                     # 10ms 單位後取 160ms 判定窗

rz = cd.Recognizer.get(cd.MODEL_DIR)


def read(src: Path, start: float, dur: float) -> np.ndarray:
    w = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run(["ffmpeg","-v","quiet","-y","-ss",str(start),"-i",str(src),
                    "-t",str(dur),"-ac","1","-ar",str(SR),"-f","wav",w],
                   check=True, timeout=200)
    with wave.open(w,"rb") as f:
        n = f.getnframes()
        a = np.frombuffer(f.readframes(n), dtype=np.int16).astype(np.float32)/32768.0
    os.unlink(w)
    return a


def speech_onset(a: np.ndarray, thresh: float = 0.02, need: int = 3) -> int:
    """第一個連續 need 個窗都超過門檻的起點（秒）。"""
    rms = [float(np.sqrt(np.mean(a[i:i+HOP].astype(np.float64)**2)))
           for i in range(0, len(a)-HOP, HOP)]
    run = 0
    for i, r in enumerate(rms):
        run = run + 1 if r >= thresh else 0
        if run >= need:
            return max(0, (i - need + 1) * 0.16)
    return 0.0


AUDIO_EXT = (".mp3", ".m4a", ".wav", ".flac", ".ogg")
pool = []
for txt in POD.rglob("*.txt"):
    try:
        if not (20_000 < txt.stat().st_size < 300_000): continue
    except OSError: continue
    for ext in AUDIO_EXT:
        c = txt.with_suffix(ext)
        if c.exists() and c.stat().st_size > 500_000:
            pool.append(c); break
    if len(pool) >= 60: break

random.seed(7)
sample = random.sample(pool, min(12, len(pool)))

print("=" * 84)
print("  從「語音起點」切開後的首字延遲  ← 這才是直播的情境")
print("=" * 84)
print(f"  {'節目':<30}{'原起點':>8}{'首字':>9}{'首定稿':>9}")
print("  " + "-" * 58)

from_start, from_speech = [], []
for src in sample:
    head = read(src, 0.0, 40.0)
    on = speech_onset(head)
    if on > 12.0 or on == 0.0:
        continue
    # 從語音起點切 20 秒
    off_samples = int(on * SR)
    a = head[off_samples: off_samples + SR * 20]
    if len(a) < SR * 12:
        continue

    ses = cd.Session(rz)
    step = int(SR * CHUNK_MS / 1000)
    t_tok = t_fin = None
    for i in range(0, len(a), step):
        msgs = ses.feed(a[i:i+step])
        ms = int(i / SR * 1000)
        if t_tok is None and cd.clean(rz.rec.get_result(ses.stream)):
            t_tok = ms
        if t_fin is None and any(m["type"] == "final" for m in msgs):
            t_fin = ms
            break

    from_speech.append(t_tok)
    if t_fin: from_start.append(t_fin)
    name = src.parent.name[:14] + "/" + src.stem[:10]
    ts = f"{t_tok:>6} ms" if t_tok else "    未到"
    fs = f"{t_fin:>6} ms" if t_fin else "    未到"
    print(f"  {name:<30}{on:>7.1f}s{ts:>9}{fs:>9}")

ok = sorted(x for x in from_speech if x is not None)
print("  " + "-" * 58)
if ok:
    print(f"\n  首字延遲（從語音起點）: 中位 {ok[len(ok)//2]} ms   "
          f"最小 {ok[0]} ms   最大 {ok[-1]} ms   （{len(ok)} 段）")
okf = sorted(from_start)
if okf:
    print(f"  首個定稿             : 中位 {okf[len(okf)//2]} ms   最大 {okf[-1]} ms")
print(f"\n  對照：從錄音 0 秒開始量的中位是 3360 ms")
if ok:
    print(f"        從語音起點量的中位是 {ok[len(ok)//2]} ms")
    print(f"        差 {3360 - ok[len(ok)//2]} ms —— 那段差距是**錄音開頭的安靜**，不是模型")