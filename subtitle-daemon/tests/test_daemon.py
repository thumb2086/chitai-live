"""端對端測試 caption_daemon.py —— 用真實台灣 Podcast 餵進去。

測的不是「能不能轉錄」，而是**直播時真正會遇到的行為**：
  · 串流時有沒有持續吐 partial（而不是整段結束才一次吐出來）
  · 有沒有定稿（final），不然字幕會一直改、觀眾看不清楚
  · 定稿文字是不是繁體、有沒有標點
  · 端到端延遲：從音訊時間點到該訊息回來的牆鐘時間
  · 有沒有漏字：把 final+partial 串起來，跟逐字稿對一遍

最後一項最重要 —— 前面所有單點測試都沒驗過「串起來會不會漏」。
"""

import asyncio, json, os, subprocess, sys, time, wave, array, tempfile, re
from pathlib import Path
from aiohttp import ClientSession, WSMsgType
import numpy as np

BASE = Path(r"C:\Users\CPXru\AppData\Local\Temp\opencode\asr")
PODCASTS = Path(r"C:\Users\CPXru\Music\playlist-admin\podcasts")
PORT = 8799
URL = f"ws://127.0.0.1:{PORT}/ws"
HEALTH = f"http://127.0.0.1:{PORT}/health"
SR = 16000


def log(*a): print(*a, flush=True)


def find_pair():
    for txt in PODCASTS.rglob("*.txt"):
        try:
            if not (20_000 < txt.stat().st_size < 300_000): continue
        except OSError: continue
        for ext in (".mp3", ".m4a", ".wav"):
            c = txt.with_suffix(ext)
            if c.exists() and c.stat().st_size > 500_000:
                return txt, c
    raise SystemExit("找不到配對")


def decode_wav(p):
    # wave.open 只吃字串，給 WindowsPath 會 AttributeError
    with wave.open(str(p), "rb") as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        raw = w.readframes(n)
    a = array.array("h"); a.frombytes(raw)
    if ch == 2:
        a = array.array("h", [a[i] for i in range(0, len(a), 2)])
    return sr, a


CJK = re.compile(r"[\u4e00-\u9fff]")
LATIN = re.compile(r"[A-Za-z0-9]+")
PUNCT_ALL = "，。？！、；：…「」『』（）()《》〈〉—－-~·,.?!;:\"' 　\t\n\r"


def norm(s):
    return "".join(c for c in LATIN.sub("", s) if c not in PUNCT_ALL)


def align_ref(truth: str, hyp: str) -> str:
    """在**整份逐字稿**裡找出跟 hyp 對得上的那一段。

    ⚠️ 這是這支測試踩過最深的坑。
       逐字稿沒有時間戳（「哈囉各位聽眾大家好 / 歡迎收聽…」一句一行），
       所以「音訊第 N 秒」對應的是「逐字稿第 M 字」，兩者無關。

       我前幾輪都拿「逐字稿開頭」去比「錄音第 120 秒」，
       得到 98.7% / 100% 的 CER，然後誤以為是模型爛。
       實際上是**對齊方式根本不成立**。

       這裡改成把整份逐字稿當搜尋空間，用字元集合重合度找最佳起點。
       這樣即使音訊從集中間開始也能對上。
    """
    L = len(hyp)
    if L < 10:
        return ""
    best_off, best_v = 0, -1.0
    for off in range(0, max(1, len(truth) - L + 1), max(1, L // 4)):
        sub = truth[off:off + L]
        if len(sub) < L * 0.9:
            break
        a, b = set(sub), set(hyp)
        v = len(a & b) / max(1, len(a | b))
        if v > best_v:
            best_v, best_off = v, off
    return truth[best_off:best_off + L]


def cer_of(ref, hyp):
    if not ref or not hyp:
        return None
    prev = list(range(len(hyp) + 1))
    for i in range(1, len(ref) + 1):
        cur = [i] + [0] * len(hyp)
        for j in range(1, len(hyp) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1,
                         prev[j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1))
        prev = cur
    return prev[-1] / len(ref)


SIM_SEC = 40.0        # 模擬直播長度
CHUNK_S = 0.160       # 每 160ms 送一塊（對齊 x-asr 的 chunk）


async def run(daemon: subprocess.Popen, wav: Path, truth: str):
    sr, samples = decode_wav(wav)
    pcm = np_i16(samples)

    log(f"  音訊 {len(samples)/sr:.1f}s   逐字稿 {len(truth)} 字\n")

    events = []          # (牆鐘ms, 訊息)
    finals, partials = [], []

    # ⚠️ 必須在啟動 reader **之前**設好。
    #    daemon 連上就立刻送 {"type":"ready"}，那時 reader 已經在跑。
    #    我第一版把這裡寫成 t_wall0 = None，等開始送音訊才賦值，
    #    於是 reader 收到 ready 時算 (time.time() - None) → TypeError → task 當場死。
    #    後果：daemon 明明送了 15 則訊息，測試端記到 0 則。
    #    我因此連續三次誤判「daemon 沒輸出」—— 壞掉的是量測工具，不是被量的東西。
    t_wall0 = time.time()

    async with ClientSession() as http:
        async with http.ws_connect(URL) as ws:
            async def reader():
                async for msg in ws:
                    if msg.type != WSMsgType.TEXT: continue
                    o = json.loads(msg.data)
                    el = (time.time() - t_wall0) * 1000
                    events.append((el, o))
                    if o["type"] == "final":
                        finals.append((el, o))
                    elif o["type"] == "partial":
                        partials.append((el, o))

            rt = asyncio.create_task(reader())
            await asyncio.sleep(0.3)

            log("  ── 開始模擬串流 ──")
            total = int(len(pcm) / SR)
            step = int(SR * CHUNK_S)
            sent_bytes = 0
            for off in range(0, len(pcm), step):
                block = pcm[off:off + step]
                await ws.send_bytes(block.tobytes())
                sent_bytes += len(block.tobytes())
                # 真實串流是「錄音等於即時」，這裡 1:1 餵（不加速），
                # 否則量到的是「比即時快幾倍」而不是「跟得上」
                await asyncio.sleep(CHUNK_S)
            log(f"  已送出 {sent_bytes} bytes = {sent_bytes/2/SR:.1f}s 音訊，"
                f"client 端 pcm={len(pcm)} samples rms="
                f"{float(np.sqrt(np.mean(pcm.astype('float64')**2)))/32768:.4f}")

            await ws.send_str(json.dumps({"type": "flush"}))
            await asyncio.sleep(1.5)
            rt.cancel()

    # ── 驗 1：串流期間有沒有持續吐字 ──
    log(f"  partial {len(partials)} 筆   final {len(finals)} 筆   總訊息 {len(events)}")

    first = next((el for el, o in events if o["type"] in ("partial", "final")), None)
    if first is None:
        log("  ★ 整段沒有任何輸出 —— daemon 有問題")
        return
    log(f"  首個輸出在 {first:.0f} ms")

    if len(partials) < 3:
        log(f"  ★ partial 只有 {len(partials)} 筆 —— 不是串流行為，是整段才吐")
    else:
        gaps = [partials[i + 1][0] - partials[i][0] for i in range(len(partials) - 1)]
        log(f"  partial 間隔 中位 {sorted(gaps)[len(gaps)//2]:.0f} ms")

    if not finals:
        log("  ★ 沒有任何 final —— 字幕會一直跳、觀眾無法閱讀")

    # ── 驗 2：繁體 + 標點 ──
    # ⚠️ rewrite 段是「整句重送」，不是增量。
    #    直接把所有 final 串起來會把同一段文字重複計算，
    #    我第一版這樣做，CER 從 11% 跳成 80%，還以為模型壞了。
    #    這裡比照前端（captions-local.ts）的行為：rewrite 就地取代。
    acc = ""
    for _, o in finals:
        acc = o["text"] if o.get("rewrite") else acc + o["text"]
    ftext = acc
    log(f"\n  定稿字串（{len(ftext)} 字）:")
    log(f"   {ftext[:220]}")

    SIMP = set("这个说话时间应该发现认识经济车东门口问题听华国义台湾当过")
    got_simp = SIMP & set(ftext)
    log(f"  殘留簡體字: {''.join(sorted(got_simp)) if got_simp else '無 ✓'}")

    P = "，。？！、；："
    npun = sum(1 for c in ftext if c in P)
    log(f"  標點數: {npun}")
    log(f"  <unk>/雜訊: {ftext.count('<unk>') + ftext.count('<')}  {'✓' if '<' not in ftext else '✗'}")

    # ── 驗 3：端到端延遲 ──
    finals_ms = [el for el, o in events if o["type"] == "final"]
    if finals_ms:
        log(f"\n  final 最後一個在 {finals_ms[-1]:.0f} ms 音訊時間處回來")

    # ── 驗 4：有沒有漏字（最關鍵）──
    hyp = norm(ftext)
    truth_n = norm(truth)
    ref = align_ref(truth_n, hyp)

    log(f"\n  ── 完整度檢查 ──")
    log(f"  逐字稿(純中文) {len(truth_n)} 字   輸出 {len(hyp)} 字")
    if ref:
        cov = len(set(ref) & set(hyp)) / max(1, len(set(ref)))
        log(f"  對齊後參考段: 「{ref[:50]}」")
        log(f"  對齊輸出  : 「{hyp[:50]}」")
        log(f"  字元覆蓋率: {cov*100:.1f}%")
        e = cer_of(ref, hyp)
        if e is not None:
            log(f"  CER       : {e*100:.1f}%  ({round(e*len(ref))}/{len(ref)} 字)")
        else:
            log(f"  CER       : 無法計算")
    else:
        log(f"  ★ 輸出太短（{len(hyp)} 字），無法對齊")

    log(f"\n  ── 漏字檢查 ──")
    empty = sum(1 for _, o in finals if not o["text"].strip())
    log(f"  送進去: {SIM_SEC:.0f}s 音訊")
    log(f"  輸出  : final {sum(len(o['text']) for _,o in finals)} 字"
        f"（其中 {empty} 筆空字串）"
        f" / partial {sum(len(o['text']) for _,o in partials)} 字(含重覆)")

    # 定稿速度要用**實際語音秒數**算，不是整段長度。
    # 這支錄音有大量板書靜默（@0s 語音佔比僅 46%），
    # 拿 40 秒去除字會低估將近一半 → 看起來像漏字，其實沒有。
    step_s = 0.160
    rms = [float(np.sqrt(np.mean(pcm[i:i+1600].astype("float64") ** 2))) / 32768
           for i in range(0, len(pcm) - 1600, 1600)]
    voiced = sum(1 for r in rms if r >= 0.004) * step_s
    rate = sum(len(o["text"]) for _, o in finals) / max(1.0, voiced)
    log(f"  語音時間: {voiced:.1f}s / {SIM_SEC:.0f}s"
        f"（{voiced/SIM_SEC*100:.0f}% 在講話）")
    log(f"  定稿速度: {rate:.2f} 字/秒（中文口語約 4-6 字/秒）")
    if rate < 2.5:
        log(f"  ★ 就算扣掉靜音，定稿產出仍然過低")
    if empty:
        log(f"  ★ {empty} 筆空定稿 —— 前端會收到沒有文字的 final")

    # 定稿必須能**串起來讀**。如果模型中途改寫前文，
    # 增量片段會接不上（出現「做。四跟」這種），那字幕在直播上是不能看的。
    log("\n  ── 定稿連貫性（把每段原樣串起來，看能不能讀）──")
    log(f"    「{''.join(o['text'] for _, o in finals)}」")

    dup = 0
    for i in range(1, len(finals)):
        prev, cur = finals[i-1][1]["text"], finals[i][1]["text"]
        if cur and prev and cur[0] in prev[-3:]:
            dup += 1
    rw = sum(1 for _, o in finals if o.get("rewrite"))
    log(f"    模型中途改寫前文的次數: {rw} / {len(finals)} 段")
    log(f"    相鄰段重複開頭: {dup} 次")
    if rw or dup:
        log("    ★ 定稿片段之間接不順 —— 直播上字幕會跳")

    log("\n  ── 定稿逐句（rewrite 為整句重送）──")
    for _, o in finals[:10]:
        tag = " [改寫]" if o.get("rewrite") else ""
        log(f"    [{o['ms']:>6}ms]{tag} {o['text'][:50]}")


def np_i16(samples):
    import numpy as np
    return np.asarray(samples, dtype=np.int16)

async def main():
    txt, audio = find_pair()
    log(f"  逐字稿: {txt.name}")
    log(f"  音訊  : {audio.name}\n")

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    # ⚠️ 一定要從錄音**開頭**切。
    #
    # 這支教學錄音有大量板書靜默：@120s 只有 16% 時間是語音（≈32 字/40 秒），
    # 而 @0s 有 46%（≈92 字）。我原本從 120s 切，daemon 只吐 33 字 ——
    # 看起來像「daemon 漏掉 90%」，實際上**那一段本來就只講了 30 幾個字**。
    #
    # 這跟前面幾個 bug 是同一類：**沒先確認「正確答案應該是多少」就說結果不對**。
    subprocess.run(["ffmpeg","-v","quiet","-y","-ss","0","-i",str(audio),
                    "-t",str(SIM_SEC),"-ac","1","-ar",str(SR),"-f","wav",tmp], check=True)
    truth = txt.read_text(encoding="utf-8-sig", errors="replace")

    log("  啟動 daemon…")
    daemon = subprocess.Popen(
        [sys.executable, "-X", "utf8", str(BASE / "caption_daemon.py"),
         "--port", str(PORT), "--threads", "4"],
        cwd=str(BASE), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace")

    try:
        async with ClientSession() as http:
            for i in range(120):
                try:
                    async with http.get(HEALTH, timeout=2) as r:
                        if r.status == 200 and (await r.json()).get("ok"):
                            break
                except Exception:
                    pass
                await asyncio.sleep(1)
            else:
                raise SystemExit("daemon 60 秒內沒就緒")
            h = await (await http.get(HEALTH)).json()
            log(f"  就緒  模型={h['model']}  載入={h['load_s']}s\n")

        await run(daemon, Path(tmp), truth)
    finally:
        daemon.terminate()
        try:
            daemon.wait(timeout=5)
        except subprocess.TimeoutExpired:
            daemon.kill()
        os.unlink(tmp)
        out = daemon.stdout.read() if daemon.stdout else ""
        if out.strip():
            log("\n  ── daemon 輸出 ──")
            for l in out.strip().splitlines()[-12:]:
                log(f"    {l}")


asyncio.run(main())
