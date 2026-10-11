"""追查那 2 次「改寫」到底是什麼觸發的。

現在的規則：句尾標點 + 後面有 SETTLE_CHARS(4) 個字才定稿。
所以 23040ms 那次定稿「老師為什麼」時，邊界上**不可能**是句尾標點
（那樣要求的字數不夠）。它是被規則 3「時間保險」強制定稿的。

如果是時間保險強制的，邊界本來就還沒確定 → 下一輪模型補了「。」
→ 前綴不符 → 改寫。這在邏輯上是必然的，不是 bug。

所以要問的是：**強制定稿時，能不能避免和模型打架？**
答案是不能 —— 強制的目的就是「不等了，先送出去」。
那能改的是「改寫之後要怎麼處理」。

這個腳本把每次 feed 的完整文字、rest、boundary、觸發原因都印出來，
確認改寫前一刻模型到底改了什麼。
"""

import sys, subprocess, tempfile, wave, os
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import caption_daemon as cd

POD = Path(r"C:\Users\CPXru\Music\playlist-admin\podcasts")
SR = 16000
src = None
for txt in POD.rglob("*.txt"):
    try:
        if not (20_000 < txt.stat().st_size < 300_000): continue
    except OSError: continue
    for ext in (".mp3", ".m4a", ".wav"):
        c = txt.with_suffix(ext)
        if c.exists() and c.stat().st_size > 500_000:
            src = c; break
    if src: break

w = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
subprocess.run(["ffmpeg","-v","quiet","-y","-ss","0","-i",str(src),"-t","40",
                "-ac","1","-ar",str(SR),"-f","wav",w], check=True, timeout=180)
with wave.open(w,"rb") as f:
    n = f.getnframes()
    a = np.frombuffer(f.readframes(n), dtype=np.int16).astype(np.float32)/32768.0
os.unlink(w)

rz = cd.Recognizer.get(cd.MODEL_DIR)
ses = cd.Session(rz)
step = int(SR * 0.160)
prev = ""

print("=" * 88)
print("  改寫發生處的逐幀追蹤")
print("=" * 88)

for i in range(0, len(a), step):
    msgs = ses.feed(a[i:i + step])
    text = cd.clean(rz.rec.get_result(ses.stream))
    ms = int(i / SR * 1000) + 160

    rw = [m for m in msgs if m.get("rewrite")]
    fin = [m for m in msgs if m["type"] == "final"]

    if fin or rw:
        why = msgs[0].get("why") or ("rewrite" if msgs[0].get("rewrite") else "標點")
        print(f"\n  [{ms:>6}ms] {why}")
        print(f"      送出  : {msgs[0]['text'][:50]!r}")
        print(f"      _floor: {ses._floor[-46:]!r}")
        print(f"      text  : {text[-46:]!r}")
        # 找出模型這輪改了什麼
        common = 0
        while (common < min(len(text), len(ses._floor))
               and text[common] == ses._floor[common]):
            common += 1
        print(f"      前綴相符到第 {common} 字；不符處 model={text[common:common+6]!r} floor={ses._floor[common:common+6]!r}")

print()
print("=" * 88)
print(f"  總改寫次數: {ses._rewrites}   強制定稿: {ses._forced}   丟標點: {ses._orphan_punct}")
print("=" * 88)