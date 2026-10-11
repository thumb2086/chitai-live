"""3.4 秒的首字延遲，是**只有開頭一次**，還是每一句都要等？

這決定「夠不夠即時」。
  · 我前面的量測每段都新建 Session → 每次都是冷啟動
  · 真實直播是一條**連續不斷**的 stream，只有第一句是冷的

如果同一個 Session 裡的第 2、3、4 句都很快，
那 3.4 秒就只是「按下開始錄音到第一個字」的開機成本，之後就能跟住。

做法：餵一段 90 秒的連續音訊，在**同一個 Session** 裡量每一句的首字時間。
"""

import subprocess, tempfile, wave, os, sys, re
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import caption_daemon as cd

POD = Path(r"C:\Users\CPXru\Music\playlist-admin\podcasts")
SR = 16000
CHUNK_MS = 160

rz = cd.Recognizer.get(cd.MODEL_DIR)

# 挑一段連續講話密度高的錄音（接近直播）
src = None
for d in POD.iterdir():
    if d.is_dir() and "T夜工智" in d.name:
        for f in sorted(d.glob("*.mp3")):
            src = f
            break
    if src: break

w = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
subprocess.run(["ffmpeg","-v","quiet","-y","-ss","0","-i",str(src),"-t","95",
                "-ac","1","-ar",str(SR),"-f","wav",w], check=True, timeout=240)
with wave.open(w,"rb") as f:
    n = f.getnframes()
    a = np.frombuffer(f.readframes(n), dtype=np.int16).astype(np.float32)/32768.0
os.unlink(w)

print("=" * 78)
print("  連續串流中的「每一句多久冒出字」")
print("=" * 78)
print(f"  音訊: {src.name}")
print(f"  長度: {len(a)/SR:.0f} 秒\n")

ses = cd.Session(rz)
step = int(SR * CHUNK_MS / 1000)

# 追蹤：每個 final 發生的時刻 + 距離上一個 final 的間隔
finals = []
prev_text = ""
prev_len = 0
timeline = []          # (音訊秒, 已定稿字數)
silent_gap = 0

for i in range(0, len(a), step):
    msgs = ses.feed(a[i:i+step])
    ms = int(i / SR * 1000)

    # 模型字數增加 = 有新字冒出來
    cur = len(cd.clean(rz.rec.get_result(ses.stream)))
    if cur > prev_len:
        timeline.append((ms / 1000, cur - prev_len))
        prev_len = cur

    for m in msgs:
        if m["type"] == "final":
            finals.append((ms, len(m["text"]), m.get("why", "")))
    # 語音停頓（模型字數不變超過 0.6 秒）= 換句的時機

print(f"  {'秒':>7}{'新增字數':>9}   {'（相隔時間）':<12}")
print("  " + "-" * 46)
prev_t = 0.0
for t, d in timeline[:28]:
    gap = t - prev_t
    prev_t = t
    print(f"  {t:>7.2f}{d:>9}   {f'(+{gap:.2f}s)':<12}")

print()
if finals:
    print(f"  定稿 {len(finals)} 段")
    gaps = [(finals[i][0] - finals[i-1][0]) / 1000 for i in range(1, len(finals))]
    if gaps:
        gaps_sorted = sorted(gaps)
        print(f"  定稿間隔: 中位 {gaps_sorted[len(gaps_sorted)//2]:.1f}s   "
              f"最小 {min(gaps):.1f}s   最大 {max(gaps):.1f}s")
    print(f"  首個定稿在 {finals[0][0]/1000:.1f}s")
    print("\n  每段定稿:")
    for ms, ln, why in finals[:10]:
        print(f"    {ms/1000:>6.1f}s  {ln:>3} 字  {why}")

    if timeline:
        first = timeline[0][0]
        print(f"\n  關鍵數字：首字 {first:.2f}s（冷啟動），"
              f"之後每 {gaps_sorted[len(gaps_sorted)//2]:.1f}s 一句")
        if timeline[1][0] - timeline[0][0] < 2.0:
            print("  → 第 2 句起就跟上節奏，3.4 秒只是開機成本")
        else:
            print("  → 第 2 句仍然慢，代表是持續性延遲而非開機成本")