"""CPU vs CUDA 實測 —— 這台機器有 RTX 3060 Ti，不能靠猜。

我先前把 CUDA DLL 從打包裡砍掉，理由是「CPU 模式用不到」。
那個理由只證明了「現在沒開 CUDA」，沒證明「開了沒比較快」。

三個要量：
  1. CUDA provider 到底能不能跑（dll、cudnn、版本對不對）
  2. 單窗耗時差多少
  3. 首次載入時間（GPU 要初始化，直播中途才啟動會很明顯）

⚠️ 一個常見誤解要先排除：模型很小（int8，2.4 秒視窗只要 271ms），
   GPU 的「資料傳輸 + kernel 啟動」固定成本可能反而超過計算本身。
   所以「有 GPU 就一定快」不是必然 —— 要數字說話。
"""

import os, statistics, subprocess, sys, tempfile, time, wave
from pathlib import Path
import numpy as np

BASE = Path(r"C:\Users\CPXru\AppData\Local\Temp\opencode\asr")
D = BASE / "sherpa-onnx-x-asr-160ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05"
POD = Path(r"C:\Users\CPXru\Music\playlist-admin\podcasts")
SR = 16000
WIN = 2.4
REPEAT = 15

pick = lambda *n: next(str(D / f) for f in n if (D / f).exists())
common = dict(tokens=pick("tokens.txt"), sample_rate=16000)

print("=" * 76)
print("  CUDA 能不能用？")
print("=" * 76)
import onnxruntime as ort
print(f"  onnxruntime {ort.__version__}")
print(f"  providers: {ort.get_available_providers()}")

try:
    import sherpa_onnx
    r = sherpa_onnx.OnlineRecognizer.from_transducer(
        encoder=pick("encoder.int8.onnx"), decoder=pick("decoder.onnx"),
        joiner=pick("joiner.int8.onnx"), num_threads=4,
        provider="cuda", **common)
    print("  ✓ sherpa-onnx provider='cuda' 建立成功")
    del r
except Exception as e:
    print(f"  ★ provider='cuda' 失敗: {type(e).__name__}: {str(e)[:160]}")
    print()
    print("  常見原因：onnxruntime-gpu 的 CUDA/cuDNN 版本和驅動對不上。")
    sys.exit(0)

# 準備真實音訊
src = None
for t in POD.rglob("*.txt"):
    try:
        if not (20_000 < t.stat().st_size < 300_000): continue
    except OSError: continue
    for e in (".mp3", ".m4a", ".wav"):
        c = t.with_suffix(e)
        if c.exists() and c.stat().st_size > 500_000:
            src = c; break
    if src: break

w = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
subprocess.run(["ffmpeg","-v","quiet","-y","-ss","30","-i",str(src),"-t","20",
                "-ac","1","-ar",str(SR),"-f","wav",w], check=True, timeout=180)
with wave.open(w,"rb") as f:
    n = f.getnframes()
    a = np.frombuffer(f.readframes(n), dtype=np.int16).astype(np.float32)/32768.0
os.unlink(w)
step = int(SR * 0.160)
clips = [a[i*1600: i*1600 + int(WIN*SR)] for i in range(REPEAT)]

print()
print("=" * 76)
print(f"  速度對比（{WIN}s 視窗 × {REPEAT} 次取中位）")
print("=" * 76)
print(f"  {'provider':<12}{'載入':>9}{'單窗':>10}{'RTF':>9}{'餘裕':>9}")
print("  " + "-"*50)

results = {}
for provider in ("cpu", "cuda"):
    try:
        t0 = time.time()
        rec = sherpa_onnx.OnlineRecognizer.from_transducer(
            encoder=pick("encoder.int8.onnx"), decoder=pick("decoder.onnx"),
            joiner=pick("joiner.int8.onnx"), num_threads=4,
            provider=provider, **common)
        load_s = time.time() - t0

        def once(c):
            st = rec.create_stream()
            st.accept_waveform(SR, c.tolist())
            st.input_finished()
            while rec.is_ready(st):
                rec.decode_stream(st)
            return rec.get_result(st).strip()

        once(clips[0])                       # 暖身
        ts = []
        for c in clips:
            t = time.perf_counter(); once(c); ts.append((time.perf_counter()-t)*1000)
        med = statistics.median(ts)
        results[provider] = (load_s, med)

        print(f"  {provider:<12}{load_s:>7.2f}s{med:>8.0f}ms{med/(WIN*1000):>9.4f}"
              f"{1200/med:>8.1f}×")
    except Exception as e:
        print(f"  {provider:<12}★ 失敗: {str(e)[:60]}")
    print()
    del rec

if "cpu" in results and "cuda" in results:
    c_load, c_ms = results["cpu"]
    g_load, g_ms = results["cuda"]
    speed = c_ms / g_ms
    print("=" * 76)
    print(f"  GPU 比 CPU 快 {speed:.2f}×   （載入 {c_load:.2f}s → {g_load:.2f}s）")
    print("=" * 76)
    if speed < 1.3:
        print("""
  結論：**不建議開 CUDA**。

  差異在噪音範圍內。原因是這個模型太小 —— 2.4 秒視窗 CPU 只要 271ms，
  GPU 的資料傳輸 + kernel 啟動固定成本反而佔大頭。

  而且代價很實在：
    · 打包多 517 MB（onnxruntime_providers_cuda.dll + nvrtc + thrust/cub）
    · CUDA / cuDNN 版本必須和驅動對上，不然使用者開機直接失敗
    · 首次載入多等數秒

  真正的延遲瓶頸不是推論速度（預算 1200ms，CPU 只用 271ms），
  而是**模型暖機 3.4 秒** —— 那個 GPU 幫不上忙，是模型架構決定的。
""")
    else:
        print(f"""
  結論：GPU 明顯較快（{speed:.1f}×），值得保留成可選選項。

  但要注意推論速度**不是**延遲瓶頸（CPU 已只用掉 271ms / 1200ms 預算），
  真正的 3.4 秒是模型暖機，GPU 幫不上。
  所以開 GPU 的實際收益是「省 CPU」，不是「字幕更快」。
""")