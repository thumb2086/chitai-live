"""中文 ASR 基準：只統計「對齊可信」的樣本。

⚠️ 為什麼要篩選
──────────────
資料集裡部分集的**逐字稿內容與音檔主題不符**
（檔名都是 EP114「左派」，但逐字稿開頭講的是「健保」）。

那些樣本的 CER 必然是 90%+ —— 但那量到的是「資料錯配」，
不是模型品質。混進平均會讓所有模型看起來一樣爛。

所以：用 Jaccard 相似度判斷對齊可信度，只統計 >= 0.5 的樣本。
（0.85~0.88 = 明確對上；0.26 = 不同集）
"""

import os, re, random, subprocess, tempfile, wave, array, time
from pathlib import Path
from opencc import OpenCC
import sherpa_onnx

BASE = Path(r"C:\Users\CPXru\AppData\Local\Temp\opencode\asr")
PODCASTS = Path(r"C:\Users\CPXru\Music\playlist-admin\podcasts")

MODELS = [
    ("zipctc-287MB",    "sherpa-onnx-zipformer-ctc-zh-int8-2025-07-03",                "offline_ctc"),
    ("sensevoice-158MB","sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09",     "sensevoice"),
    ("paraformer-218MB","sherpa-onnx-paraformer-zh-int8-2025-10-07",                    "paraformer"),
    ("small-stream-20MB","sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01","stream_ctc"),
]
N_TRY = 14          # 抽多少組來篩（錯配會被濾掉）
SEG_SEC = 30
WINDOWS = 6
STEP = 25.0
MIN_SIM = 0.50      # 對齊可信門檻


def build(kind, d):
    model = next(str(d / f) for f in ("model.int8.onnx","encoder.int8.onnx","encoder.onnx","model.onnx")
                 if (d / f).exists())
    c = dict(tokens=str(d / "tokens.txt"), num_threads=4, sample_rate=16000)
    if kind == "stream_ctc":
        return sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc(model=model, feature_dim=80, **c)
    if kind == "offline_ctc":
        return sherpa_onnx.OfflineRecognizer.from_zipformer_ctc(model=model, **c)
    if kind == "paraformer":
        return sherpa_onnx.OfflineRecognizer.from_paraformer(paraformer=model, **c)
    if kind == "sensevoice":
        return sherpa_onnx.OfflineRecognizer.from_sense_voice(model=model, language="zh", use_itn=True, **c)
    raise ValueError(kind)


def transcribe(rec, wav):
    with wave.open(str(wav), "rb") as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        raw = w.readframes(n)
    a = array.array("h"); a.frombytes(raw)
    if ch == 2:
        a = array.array("h", [a[i] for i in range(0, len(a), 2)])
    flt = [s / 32768.0 for s in a]
    st = rec.create_stream()
    st.accept_waveform(sr, flt)
    if isinstance(rec, sherpa_onnx.OnlineRecognizer):
        st.input_finished()
        while rec.is_ready(st):
            rec.decode_stream(st)
        return rec.get_result(st).strip()

    # ⚠️ offline 架構：decode_stream() 回傳 **None**，文字在 stream.result.text
    #    （OnlineStream 才是 rec.get_result(stream)）
    #    我前兩版都寫 getattr(decode_stream(st), "text", "")，
    #    getattr(None,"text","") → ""，於是三個離線模型全部靜默輸出空字串。
    #    看起來像「它們品質超差所以被篩掉」，實際上是一行取值錯誤。
    rec.decode_stream(st)
    return st.result.text.strip()


LATIN = re.compile(r"[A-Za-z0-9]+")
PUNCT = "，。？！、；：…「」『』（）()《》〈〉—－-~·,.?!;:\"' 　\t\n\r"
def norm(s): return "".join(c for c in LATIN.sub("", s) if c not in PUNCT)


def cer(ref, hyp):
    ref, hyp = list(ref), list(hyp)
    if not ref: return None
    d = [[0]*(len(hyp)+1) for _ in range(len(ref)+1)]
    for i in range(len(ref)+1): d[i][0] = i
    for j in range(len(hyp)+1): d[0][j] = j
    for i in range(1, len(ref)+1):
        for j in range(1, len(hyp)+1):
            c = 0 if ref[i-1] == hyp[j-1] else 1
            d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+c)
    return d[-1][-1] / len(ref)


def extract(audio, start, dur):
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    r = subprocess.run(["ffmpeg","-v","quiet","-y","-ss",str(start),"-i",str(audio),
                        "-t",str(dur),"-ac","1","-ar","16000","-f","wav",out],
                       capture_output=True, timeout=180)
    if r.returncode != 0 or not os.path.exists(out): return None
    try:
        with wave.open(out,"rb") as w:
            if w.getnframes()==0: return None
    except Exception: return None
    return out


def best_align(t, h):
    """在整份逐字稿裡找與 h 最相似的一段，回 (offset, 相似度, 參考片段)。"""
    L = len(h)
    if L < 10: return 0, 0.0, ""
    bestoff, bestv = 0, -1.0
    step = max(1, L // 4)
    for off in range(0, max(1, len(t) - L + 1), step):
        sub = t[off:off+L]
        if len(sub) < L * 0.9: break
        a, b = set(sub), set(h)
        v = len(a & b) / max(1, len(a | b))
        if v > bestv: bestv, bestoff = v, off
    return bestoff, bestv, t[bestoff:bestoff+L]


# ── 配對（同名 + 同資料夾）──
AUDIO_EXT = (".mp3",".wav",".m4a",".flac",".ogg")
cands = []
for txt in PODCASTS.rglob("*.txt"):
    try:
        if not (20_000 < txt.stat().st_size < 300_000): continue
    except OSError: continue
    for ext in AUDIO_EXT:
        c = txt.with_suffix(ext)
        if c.exists() and c.stat().st_size > 500_000:
            try: t = norm(txt.read_text(encoding="utf-8-sig", errors="replace"))
            except Exception: break
            if len(t) >= 300:
                cands.append((txt.parent.name + "/" + txt.stem[:16], c, t))
            break
    if len(cands) >= 120: break

random.seed(11)
pool = random.sample(cands, min(N_TRY, len(cands)))
cc = OpenCC("s2twp")

print("="*76)
print(f"  中文 ASR 基準（僅統計對齊可信的樣本，門檻相似度 {MIN_SIM}）")
print("="*76)
print(f"  候選組: {len(cands)}   抽樣: {len(pool)}\n")

# ── 第一步：用 20MB 模型篩出哪些樣本「音檔與逐字稿確實配套」──
print("  [步驟 1] 篩選配套樣本（用 small-stream-20MB 當探針）…\n")
probe = build("stream_ctc", BASE / MODELS[3][1])

segs = {}
valid = []
for name, audio, t in pool:
    paths = [(k*STEP, extract(audio, k*STEP, SEG_SEC)) for k in range(WINDOWS)]
    paths = [(s,p) for s,p in paths if p]
    if not paths:
        continue
    bestsim = 0.0
    for s, p in paths:
        h = norm(cc.convert(transcribe(probe, p)))
        if len(h) < 10: continue
        _, v, _ = best_align(t, h)
        bestsim = max(bestsim, v)
    mark = "✓" if bestsim >= MIN_SIM else "✗"
    print(f"    {mark} 相似度 {bestsim:.2f}  {name}")
    if bestsim >= MIN_SIM:
        segs[name] = paths
        valid.append((name, audio, t))
    else:
        for _, p in paths: os.unlink(p)

print(f"\n  通過篩選: {len(valid)}/{len(pool)} 組\n")
if not valid:
    raise SystemExit("沒有可用樣本")

# ── 第二步：所有候選模型在「已篩選」的樣本上比 ──
print("  [步驟 2] 模型對決\n")
results = {}
for key, dirname, kind in MODELS:
    d = BASE / dirname
    if not d.is_dir():
        continue
    t0 = time.time()
    try:
        rec = build(kind, d)
    except Exception as e:
        print(f"  [{key}] 載入失敗 {str(e)[:70]}")
        continue
    load_s = time.time() - t0

    tot_e = 0.0; tot_n = 0
    lines = []
    for name, audio, t in valid:
        best = None
        for start, p in segs[name]:
            raw = transcribe(rec, p)
            h = norm(cc.convert(raw))
            off, sim, ref = best_align(t, h)
            if sim < MIN_SIM: continue
            e = cer(ref, h)
            if e is not None and (best is None or e < best[0]):
                best = (e, h, off, sim, raw)
            if e is not None and e < 0.2:
                break
        if best:
            e, h, off, sim, raw = best
            tot_e += e * len(h); tot_n += len(h)
            lines.append((name, e, off, sim, raw, h))

    w = (tot_e/tot_n*100) if tot_n else None
    results[key] = w
    print(f"  [{key}] 載入 {load_s:.2f}s")
    for name, e, off, sim, raw, h in lines:
        has_punct = any(c in raw for c in "，。？！、")
        print(f"       CER {e*100:5.1f}%  {'標點✓' if has_punct else '標點✗'}  {name[:24]}")
        print(f"           {h[:44]}")
    if w is not None:
        print(f"       加權 CER = {w:.1f}%")
    print()

for name in segs:
    for _, p in segs[name]:
        try: os.unlink(p)
        except OSError: pass

print("="*76)
print("  總結（僅對齊可信的樣本）")
print("="*76)
ranked = sorted([(v,k) for k,v in results.items() if v is not None])
for w, k in ranked:
    print(f"  {w:5.1f}%  {k}")
if ranked:
    print(f"\n  最佳: {ranked[0][1]}  CER {ranked[0][0]:.1f}%")