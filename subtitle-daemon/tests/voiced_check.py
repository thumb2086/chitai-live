"""daemon 只定稿 33 字 / 40 秒音訊 —— 是「漏字」還是「這段本來就沒講多少話」？

區分方法：量那一段音訊的**語音佔比**。
  · 如果大部分時間是靜音 → 33 字是正確的，daemon 沒漏
  · 如果 90% 時間都在講話 → 33 字就是漏字，daemon 有 bug

這一步不做，我沒辦法判斷該修 daemon 還是接受現況。
"""

import subprocess, tempfile, wave, os
from pathlib import Path
import numpy as np

POD = Path(r"C:\Users\CPXru\Music\playlist-admin\podcasts")
SR = 16000
src = POD / "T夜工智CoCo英文S" / "2026_0225_1800_T夜工智CoCo英文S. [1800-2200].mp3"

print("  逐段量語音佔比（每 160ms 一格，跟 daemon 的 chunk 一樣）\n")

for off in (0, 60, 120, 300):
    w = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run(["ffmpeg", "-v", "quiet", "-y", "-ss", str(off), "-i", str(src),
                    "-t", "40", "-ac", "1", "-ar", str(SR), "-f", "wav", w],
                   check=True, timeout=120)
    with wave.open(w, "rb") as f:
        n = f.getnframes()
        a = np.frombuffer(f.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    os.unlink(w)

    step = int(SR * 0.160)
    rms = []
    for i in range(0, len(a) - step, step):
        c = a[i:i + step]
        rms.append(float(np.sqrt(np.mean(c.astype(np.float64) ** 2))))
    rms = np.array(rms)

    for thr in (0.004, 0.010, 0.020):
        voiced = (rms >= thr).mean() * 100
        est = voiced / 100 * 40 * 5.0      # 中文口語約 5 字/秒
        print(f"  @{off:>3}s  門檻 {thr:.3f}  語音佔比 {voiced:5.1f}%  "
              f"→ 估計字數 {est:5.0f}")
    print(f"        rms: 中位 {np.median(rms):.4f}  p90 {np.percentile(rms,90):.4f}"
          f"  max {rms.max():.4f}")
    print()
