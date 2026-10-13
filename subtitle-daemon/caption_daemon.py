"""本機即時字幕 daemon —— x-asr 160ms 串流 + OpenCC 繁體。

為什麼不需要切窗
────────────────
原本 livestream-dashboard 的做法是「2.4s 視窗 / 1.2s 步進」反覆重疊送，
因為雲端 Groq whisper **只能用離線 API**，必須湊一段音訊才能送。

x-asr 是**真串流**模型：音訊餵進去就持續出結果，不需要知道「講者講完了嗎」。
所以整套視窗/步進/去重的機制在這裡全部不需要 ——
這不只是省 code，是省掉「重疊段落要合併、邊界會認錯字」那一整類問題。

協定
────
  客戶端 → 伺服器：binary frame = Int16 LE PCM, 16kHz, mono（AudioWorklet 原始輸出）
  伺服器 → 客戶端：JSON text frame
      {"type":"ready"}                       模型已載入
      {"type":"partial","text":"…","ms":1234} 未定稿，會被後續修正
      {"type":"final","text":"…","ms":4567}  已定稿（偵測到句尾標點或靜音）
      {"type":"error","detail":"…"}

  靜音時前端不要送 frame（省頻寬），本機偵測到靜音會自動 flush final。

繁體
────
模型輸出**簡體**，一律經 OpenCC `s2twp` 轉繁體。
`s2twp` 不是 `s2t`：前者連「軟體/軟件」「資訊/信息」這類詞都會跟著台灣用法走。

啟動
────
    python caption_daemon.py
    預設 127.0.0.1:8765，/health 可查狀態
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import threading
import time
from pathlib import Path
from queue import Full, Queue


def force_utf8_output():
    """打包成 exe 後，Windows 會用主控台預設編碼（cp950/big5）輸出，
    中文全部變成亂碼 —— log 對主播就沒用了（要靠 log 排查問題）。

    ⚠️ 必須在**任何輸出之前**呼叫。
       MODEL_DIR 是在模組層級算出來的（find_model_dir 失敗會 SystemExit），
       如果把這個呼叫留在 main() 裡，那條錯誤訊息就會用預設編碼印出來 ——
       而那恰恰是最需要看得懂的訊息（「模型在哪裡、去哪下」）。
       我第一版就是這樣，錯誤訊息整片亂碼。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


force_utf8_output()


# ── 原生日誌攔截 ──
#
# 必須在 `import sherpa_onnx` **之前**就導走 fd 2。
# onnxruntime 的原生碼會在載入時快取 console handle，等之後再 dup2 就抓不到了
# （實測：Python 的 print 抓得到，onnxruntime 的訊息抓不到）。
#
# 我需要這些訊息是因為 GPU 降級是**靜默**的：
#     Please compile with -DSHERPA_ONNX_ENABLE_GPU=ON. ... Fallback to cpu!
# 傳 provider="cuda" 不會回傳錯誤，看起來像成功了，實際上還在跑 CPU。
# 這種「參數有送 ≠ 有生效」的情況，只能靠讀原生 log 才知道。
import tempfile as _tempfile
import threading as _threading

_NATIVE_LOG_PATH = os.path.join(
    _tempfile.gettempdir(), f"ai-gateway-native-{os.getpid()}.log")
_NATIVE_LOG = open(_NATIVE_LOG_PATH, "w+b", buffering=0)
# 讀取端必須是**獨立的檔案 handle**：
#   · 不能 seek+read —— dup2 出來的 fd 與 fd 2 共用同一個檔案位移，
#     tee 一 seek 就把寫入位置拉走，內容位置全錯。
#   · 不能 os.pread —— **Windows 的 Python 沒有這個函式**，
#     呼叫丟 AttributeError，被 except 吞掉 → tee 執行緒靜默死掉，
#     連帶 fd 2 永遠還不回來。使用者只會看到一片空白。
#     症狀就是「exit=2 但一行輸出都沒有」，我踩了兩次才定位到。
_CONSOLE_FD = os.dup(2)
os.dup2(_NATIVE_LOG.fileno(), 2)

_natives = {"read": 0, "done": False}


def _tee_loop():  # pragma: no cover
    """把被攔下的原生輸出**同步轉發**到主控台。

    為什麼要 tee 而不是直接 dup2：dup2 是靜默轉向，
    所有輸出都進暫存檔，使用者看不到任何東西。
    """
    import time as _t
    try:
        r = open(_NATIVE_LOG_PATH, "rb")
    except Exception:
        return
    while not _natives["done"]:
        try:
            r.seek(_natives["read"])
            data = r.read(65536)
            if data:
                _natives["read"] += len(data)
                os.write(_CONSOLE_FD, data)
                continue
        except Exception:
            pass
        _t.sleep(0.1)
    try:
        r.close()
    except Exception:
        pass


_tee = _threading.Thread(target=_tee_loop, daemon=True)
_tee.start()


def restore_console_and_read_native_log() -> str:
    """把 fd 2 還給主控台（停掉 tee），並回傳原生庫寫過的內容。"""
    import time as _t
    _t.sleep(0.25)                     # 讓 tee 把最後一段轉發完
    _natives["done"] = True
    try:
        os.dup2(_CONSOLE_FD, 2)
    except Exception:
        pass
    try:
        # 同樣不能用 os.pread（Windows 沒有），也會動到共用的位移 → 用獨立 handle
        with open(_NATIVE_LOG_PATH, "rb") as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        return ""


try:
    import numpy as np
    from aiohttp import WSMsgType, web

    try:
        import sherpa_onnx
        from opencc import OpenCC
    except ImportError as e:  # pragma: no cover
        restore_console_and_read_native_log()
        print(f"★ 缺依賴: {e}\n  pip install sherpa-onnx opencc-python-reimplemented",
              file=sys.stderr)
        sys.exit(1)
except Exception:  # pragma: no cover
    # 匯入階段就炸掉時一定要把主控台還回來，否則使用者只會看到空白
    restore_console_and_read_native_log()
    raise


# ── 設定 ────────────────────────────────────────────────────────────────
MODEL_NAME = "sherpa-onnx-x-asr-160ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05"


def find_model_dir() -> Path:
    """在幾個合理的位置找模型，打包成 exe 後也能找到。

    順序很重要：
      1. 執行檔旁邊的 models/ 或同層目錄 —— 這是使用者實際會拿到的那份
      2. 原始開發目錄 —— 還沒打包時在用
      3. 環境變數 —— 想把模型放在別的磁碟時

    為什麼模型不放進 exe 裡：模型 161MB，用 --onefile 會每次啟動都解壓到
    temp，開機要多等 10 秒以上，而且每次都佔一份 161MB 的暫存。
    放旁邊則是秒開。
    """
    base = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) \
        else Path(__file__).resolve().parent
    candidates = [
        base / MODEL_NAME,
        base / "models" / MODEL_NAME,
        base.parent / MODEL_NAME,
        Path(__file__).resolve().parent / MODEL_NAME,
    ]
    env = os.environ.get("CAPTION_MODEL_DIR")
    if env:
        candidates.insert(0, Path(env))

    for c in candidates:
        if (c / "tokens.txt").exists():
            return c

    raise SystemExit(
        f"★ 找不到模型目錄 {MODEL_NAME}\n"
        f"  找過：\n" + "".join(f"    {c}\n" for c in candidates) +
        f"  可以用環境變數 CAPTION_MODEL_DIR 指定"
    )


MODEL_DIR = find_model_dir()

# 推論設定。openai_server.py 會讀這幾個，所以要放在 module 層級 ——
# 只寫在 main() 的 argparse 裡是區域變數，其他模組看不到。
THREADS = int(os.environ.get("CAPTION_THREADS", "4"))
PROVIDER = os.environ.get("CAPTION_PROVIDER", "cpu")

SAMPLE_RATE = 16000
CHUNK_MS = 160            # x-asr 是 160ms chunk 模型
SILENCE_RMS = 0.004       # 低於此視為靜音 → flush final
SILENCE_MS = 420          # 連續靜音多久才 flush（避免句中換氣就斷句）
PARTIAL_MS = 300          # 多久推一次 partial
MAX_UTTERANCE_MS = 15000  # 超過就強制切一句，防止整段沒標點累積成一長串


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def _capture_stderr(fn):
    """跑一次 fn，把它寫到 fd 2 的內容抓下來。

    ⚠️ 為什麼不能用「建立 recognizer 的瞬間才攔」的做法
    ----------------------------------------------------
    sherpa-onnx 的 GPU 降級警告是 onnxruntime 的 **C++ 層**輸出的：
        Please compile with -DSHERPA_ONNX_ENABLE_GPU=ON. ... Fallback to cpu!

    我實測過：`_sherpa_onnx.pyd` 載入之後再 `os.dup2` 攔 fd 2，
    Python 自己的 print / os.write 都攔得到，**onnxruntime 的訊息攔不到**。
    推測是原生碼在載入時就快取了 console handle。

    所以正確做法是**在任何 sherpa/onnxruntime 呼叫之前**就導走 fd 2，
    等 recognizer 建好再把 fd 2 還回去，然後讀暫存檔。

    回傳 (fn 的回傳值, 擷取到的文字)。
    """
    import tempfile

    with tempfile.TemporaryFile() as cap:
        saved = os.dup(2)
        try:
            os.dup2(cap.fileno(), 2)
            result = fn()
        finally:
            os.dup2(saved, 2)
            os.close(saved)
        cap.seek(0)
        text = cap.read().decode("utf-8", "replace")
    return result, text


# ── 模型 ────────────────────────────────────────────────────────────────
class Recognizer:
    """單例，載入一次給所有連線共用（161MB 不能每次重載）。"""

    _inst: "Recognizer | None" = None
    # 實際生效的 provider（可能是使用者要求的 cuda 被降級成 cpu）
    effective_provider: str = "cpu"

    def __init__(self, model_dir: Path, threads: int = 4,
                 provider: str = "cpu"):
        def pick(*names: str) -> str:
            for n in names:
                p = model_dir / n
                if p.exists():
                    return str(p)
            raise FileNotFoundError(f"{model_dir} 缺少 {'/'.join(names)}")

        t0 = time.time()
        kw = dict(tokens=pick("tokens.txt"),
                  encoder=pick("encoder.int8.onnx", "encoder.onnx"),
                  decoder=pick("decoder.onnx", "decoder.int8.onnx"),
                  joiner=pick("joiner.int8.onnx", "joiner.onnx"),
                  num_threads=threads, sample_rate=SAMPLE_RATE,
                  decoding_method="greedy_search")

        # ── GPU：必須偵測「靜默降級」 ──
        #
        # 這台機器有 RTX 3060 Ti，onnnxruntime 也報得出 CUDAExecutionProvider，
        # 但 pip 裝的 sherpa-onnx **沒有編譯 GPU 支援**。傳 provider="cuda"
        # 不會報錯 —— 它會在 C++ 裡印一行然後退回 CPU：
        #
        #     Please compile with -DSHERPA_ONNX_ENABLE_GPU=ON.
        #     Available providers: CPUExecutionProvider. Fallback to cpu!
        #
        # 所以「參數有送」不等於「有生效」。
        # 我第一次量 CPU vs GPU 得到 333ms vs 332ms —— 幾乎一樣，
        # 原因就是兩個都在跑 CPU，卻誤以為 GPU 沒比較快。
        #
        # 這裡把 stderr 攔下來讀，確認實際生效的是什麼。
        if provider != "cpu":
            self.rec = sherpa_onnx.OnlineRecognizer.from_transducer(
                provider=provider, **kw)
            # 讀原生 log 確認有沒有被降級（訊息在上面 import 之前就攔住了）
            native = restore_console_and_read_native_log()
            if "allback to cpu" in native or "Available providers" in native:
                log(f"  ⚠ 你要求了 {provider}，但這個 sherpa-onnx 沒有編譯 GPU 支援，"
                    f"已自動改用 CPU")
                for line in native.strip().splitlines()[:2]:
                    log(f"    {line}")
                Recognizer.effective_provider = "cpu"
            else:
                Recognizer.effective_provider = provider
                log(f"  ✓ 使用 {provider}")
        else:
            self.rec = sherpa_onnx.OnlineRecognizer.from_transducer(**kw)
            restore_console_and_read_native_log()
            Recognizer.effective_provider = "cpu"

        self.load_s = time.time() - t0
        self.cc = OpenCC("s2twp")
        log(f"  模型載入 {self.load_s:.2f}s  ({model_dir.name})"
            f"  [provider={Recognizer.effective_provider}]")

    @classmethod
    def get(cls, model_dir: Path, threads: int = 4,
            provider: str = "cpu") -> "Recognizer":
        if cls._inst is None:
            cls._inst = cls(model_dir, threads, provider)
        return cls._inst


SENT_END = "。！？!?…"
# 最短定稿長度。中文直播字幕一行的舒適閱讀上限約 15-18 字，
# 太短的定稿會讓畫面一行一行跳出來，觀眾根本來不及讀。
MIN_FINAL_CHARS = 14
# ── 切點「靜置」要求 ──
#
# 實測模型會在**下一輪**回頭把句號補在已定稿的邊界上：
#     [20000ms] 第四頁跟第五頁現在開始做
#     [23040ms] 老師為什麼            ← 這一輪模型才把「。」補在「開始做」後面
#     [23200ms] [改寫] 整句重送        ← 前綴比對失敗，因為中間多了個「。」
#
# 也就是說「看見句號」不代表「邊界已經確定」：模型要再多看幾幀才決定
# 那個句號該不該存在。
#
# 要求切點後面已經有 SETTLE_CHARS 個字，才能定稿 —— 那段「已經講過去」的區域
# 模型不太會再改。實測能把改寫次數壓到接近 0，代價是定稿晚一點。
SETTLE_CHARS = 4
# 強制定稿時要**留在 pending 的尾巴長度**。
# 尾端是模型還在寫的地方，切在那裡一定會被後續改寫。
TAIL_HOLD_CHARS = 3
MAX_FINAL_CHARS = 26
# 時間保險：進行中的字「待了」這麼久還沒定稿就強制定稿。
# 沒有這條，長句會等到整句講完（實測最長 19.4 秒）。
FINAL_AFTER_MS = 3000
# 沒標點時的軟切點（靠近標點比較自然）
SOFT_BREAK_AT = set("，、；：,;:")
# x-asr 偶爾吐的特殊標記，會直接顯示在字幕上，必須濾掉
NOISE = ("<unk>", "<|", "<>", "<s>", "</s>", "<no-speech>", "▁", "<pad>")


def clean(text: str) -> str:
    for n in NOISE:
        text = text.replace(n, "")
    return re_sub_ws(text)


def re_sub_ws(s: str) -> str:
    return " ".join(s.split())


class Session:
    """一條 WebSocket 連線 = 一個字幕工作階段。"""

    def __init__(self, rz: Recognizer):
        self.rz = rz
        self.stream = rz.rec.create_stream()
        self.audio_ms = 0            # 已送進去的音訊長度
        self.silence_ms = 0          # 連續靜音長度
        self.last_partial = 0.0
        self.pending = ""            # 還沒定稿的字
        self.utterance_ms = 0
        self.pending_ms = 0          # 這段進行中的字已經待了多久（時間保險用）
        self._feeds = 0              # DEBUG: 收到幾批
        self._bytes = 0             # DEBUG: 收到幾位元組
        self._chars = 0              # DEBUG: 累積產出幾字
        self._fed_logged = False
        self._rewrites = 0            # DEBUG: 模型中途改寫前文的次數
        self._forced = 0              # DEBUG: 被時間/長度保險強制定稿的次數
        self._orphan_punct = 0        # DEBUG: 開頭標點被丟掉的次數
        self._tail_cuts = 0           # DEBUG: 切在「模型還在改」的尾端的次數
        self._floor = ""             # 已定稿的累計文字（用前綴比對，不是字元偏移）

    def reset(self):
        self.stream = self.rz.rec.create_stream()
        self.audio_ms = self.silence_ms = self.utterance_ms = 0
        self.pending = ""

    def feed(self, pcm: np.ndarray):
        """餵一批 samples（float32, -1..1），回傳要送給前端的訊息 list。"""
        out: list[dict] = []
        if pcm.size == 0:
            return out

        rms = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2)))
        dur_ms = int(len(pcm) / SAMPLE_RATE * 1000)
        self.audio_ms += dur_ms
        self._feeds += 1
        self._bytes += int(pcm.size * 2)

        # 靜音只**記錄**，不定稿。
        # 這是我留到最後沒抓到的 bug：靜音觸發的 _finalize() 在
        # 「取結果之前」就呼叫了，拿到的 text 是**上一輪**的殘留。
        # 而且它會推進 _floor，導致下一輪 rest 的開頭剛好是被跳過的標點。
        if rms < SILENCE_RMS:
            self.silence_ms += dur_ms
        else:
            self.silence_ms = 0
            self.utterance_ms += dur_ms
        # 這批有沒有讓「進行中」變長？有才累加時間保險的計時。
        if self.pending:
            self.pending_ms += dur_ms

        self.stream.accept_waveform(SAMPLE_RATE, pcm.tolist())
        while self.rz.rec.is_ready(self.stream):
            self.rz.rec.decode_stream(self.stream)

        now = time.time()
        text = clean(self.rz.rec.get_result(self.stream))
        self._chars = max(self._chars, len(text))

        if os.environ.get("CAPTION_DEBUG") and self._feeds % 10 == 0:
            log(f"    [dbg] feeds={self._feeds} audio={self.audio_ms}ms rms={rms:.4f} "
                f"字={len(text)} 已定稿={len(self._floor)} 尾={text[-16:]!r}")

        # ⚠️ 這裡是我第一版最大的邏輯錯誤。
        #
        # 我原本的定稿條件是「句尾標點，且後面還有字」：
        #     idx = text.rfind("。")
        #     if idx >= 0 and idx < len(text) - 1: 定稿 text[:idx+1]
        #
        # 問題是 transducer 的 get_result() 回傳的是**目前為止的完整假設**，
        # 不是「這一輪新增加的增量」。而且**尾端那一段永遠不會有標點**
        #（還在講），所以 idx == len(text) - 1 的情況永遠成立不了 → 幾乎不定稿。
        #
        # 實測：餵 40 秒音訊（正常中文口語約 160-240 字），
        #       只定稿 24 字，0.60 字/秒，且出現同一段被拆成
        #       「這樣的時候你會」/「你是」這種斷句。
        #
        # 修法：**用字數增量當定稿訊號**，不依賴標點。
        #     · 已定稿長度 + 新增到 >= MIN_FINAL_CHARS → 定稿新增那段
        #     · 標點只當「優先立刻定稿」的加速器
        #     · 靜音 / 超時 → 強制 flush 剩下的
        #
        # 這也符合串流字幕的實際需求：寧可 1 秒就定稿讓觀眾看得懂，
        # 不要等到整句講完。

        if not text:
            return out

        # 定稿邊界：已定稿位置之後，找一個**夠長**的切點。
        #
        # ⚠️ 這裡我踩到一個更隱蔽的坑：
        #    transducer 的「尾端會被改寫」不只是尾巴，是**模型整句重估**。
        #    所以 `self._floor` 不能假設前 N 字永遠不變。
        #    實測定稿序列出現過：
        #        「…來開始做」 → 「做。四跟」 → 「。四跟五」
        #    標點從句中「跑到」句首去了 —— 因為 _floor 記的是字元偏移，
        #    而模型中途插了一個標點進去，後面全部右移，
        #    于是 offset N 在兩次呼叫之間指向了不同的字。
        #
        # 修法：**不做字元偏移，改用「前綴是否一致」判斷**。
        #     text.startswith(_floor) → 前面沒動 → 只送增量
        #     否則 → 重新同步（送出目前為止的全部當定稿，前端以 final 為準覆寫）
        # 這個做法犧牲了一點「定稿不可改」的性質，但換來不會錯位。
        floor = self._floor
        if floor and not text.startswith(floor):
            # 前面被改寫了 → 以目前為準整句重送
            self._rewrites += 1
            done = text
            self._floor = text
            self.utterance_ms = 0
            self.last_partial = now
            out.append({"type": "final", "text": self.rz.cc.convert(done),
                        "ms": self.audio_ms, "rewrite": True})
            return out

        # ── 這裡是「碎片」真正的來源，跟切點無關 ──
        #
        # 我一直以為碎片是因為切點選錯。實測證明不是：
        #   送出 113 則、丟棄 79 則空字串 —— 有 41% 的定稿是**空字串**。
        #
        # 為什麼會有 79 則空的？因為 transducer 在句尾標點剛出現的那一輪，
        # text 會先回「…來開始做。」，我把它定稿掉；
        # 下一輪模型重估，把句尾的「。」**移除**（因為後面還有語音，
        # 標點太早了），於是 text 變回「…來開始做」——
        # 但 _floor 已經記到「做。」，startswith 失敗 → 走改寫路徑送出整句。
        #
        # 而更常見的是：重估後 text 比 _floor 短（模型刪了字），
        # startswith 失敗，我送整句；接著 text 又長回來，又送整句。
        # 於是同一句話被反覆「定稿」，每次都帶不同的尾巴。
        #
        # 修法：**定稿後不要急著推進 _floor 到模型可能撤回的位置。**
        #     只在「模型已經把這段推進到下一句」時才推進，
        #     判斷依據是**標點後面還有內容**，而不是標點本身。
        rest = text[len(floor):]
        if not rest.strip():
            return out

        # ── 標點開頭的定稿段 ──
        #
        # 實測會出現這種：
        #     [20000ms] 第四頁跟第五頁現在開始做
        #     [23040ms] 。老師為什麼
        # 「。」跑到下一段開頭，因為模型是在**下一輪**才把這個句號補上去的
        # —— 上一輪切的時候它還不存在。
        #
        # ⚠️ 剝掉標點之後，**只能用原文推進 _floor**，不能用剝過的版本。
        #    _floor 是拿來跟模型輸出做 startswith 比對的；
        #    一旦它比模型少一個「。」，下一輪比對就會失敗 → 觸發整句重送。
        #    我第一版直接把 rest 換成剝過的字串，結果每段都多一次 [改寫]，
        #    反而比原本更糟（觀眾會看到字幕整句跳回去）。
        #
        # 為什麼丟掉而不是搬到上一段：
        #   · 上一段的 final 已經送出去了，delta 形式無法回頭補
        #   · partial 每次都帶模型完整假設（含標點），所以**直播畫面不會少任何標點**
        #   · 受影響的只有存檔用的定稿段，而存檔本來就會把各段串起來看
        orphan = ""
        if rest and rest[0] in SENT_END + "".join(SOFT_BREAK_AT):
            stripped = rest.lstrip(SENT_END + "".join(SOFT_BREAK_AT))
            if not stripped.strip():
                # 只有標點、還沒有新的字 → 先留著，等下一輪
                self.pending = text
                return out
            orphan, rest = rest[: len(rest) - len(stripped)], stripped
            self._orphan_punct += 1

        # 切點：只認**句尾標點**，而且要夠長才切。
        #
        # ⚠️ 我之前加了「沒有標點就按字數硬切」的後備方案，結果反而更糟：
        #    定稿被切成一堆 1-3 字的碎片（「做」/「。四跟」/「五」）。
        #    為什麼？因為 transducer 剛吐一個標點時，句尾往往就是句尾，
        #    我若為了湊長度繼續往後找，會一路跑到下一句的中間，
        #    於是切出來的是「。四跟」這種**標點開頭**的碎片。
        #
        # 寧可讓一句話多等 1 秒，也不要切出讀不成句的碎片 ——
        # 字幕是給人讀的，碎片比延遲更傷。
        # ── 定稿邊界：字數 / 時間雙軌 ──
        #
        # 為什麼不能再只靠句尾標點：
        # 實測 8 段真實錄音，「首個定稿」中位 5.8 秒、最長 **19.4 秒**，
        # 而且有 2 段 20 秒內完全沒定稿。原因就是長句沒有句尾標點，
        # `_floor` 就一直不動，字幕存檔要等整句講完。
        #
        # 但也不能一累積夠字就硬切（我試過，會切出「做」/「。四跟」/「五」
        # 這種讀不成句的碎片）。所以現在是三層優先：
        #   1. 有句尾標點 → 在那裡切（最自然）
        #   2. 沒有句尾標點，但**軟標點**（，、；：）已經夠長 → 在軟標點切
        #   3. 兩個標點都沒有，但這段已經「講太久 / 待太久」→ 到上限就切
        #
        # 第 3 條是時間保險：寧可切成兩段，也不要讓字幕卡住 19 秒。
        boundary = -1

        # 1) 句尾標點 —— 且後面要有 SETTLE_CHARS 個字，邊界才算「確定」
        for i, c in enumerate(rest):
            if c in SENT_END:
                if i + 1 >= MIN_FINAL_CHARS and i + 1 + SETTLE_CHARS <= len(rest):
                    boundary = i + 1
                break

        # 2) 軟標點：語意沒斷但可以換行的地方
        #
        # ⚠️ 這裡原本沒有「後面還要有字」的要求，結果 12 次定稿有 10 次切在尾端
        #    —— 因為軟標點（，、；：）幾乎每隔幾個字就出現一個，
        #    切下去正好落在模型還在寫的地方，下一輪就會被改寫。
        #
        #    軟標點是「暫停點」，不是「結束點」，用它定稿本來就早。
        #    要求後面至少有 SETTLE_CHARS 個字，等模型把這句寫過去再切。
        if boundary < 0:
            for i, c in enumerate(rest):
                if c in SOFT_BREAK_AT and i + 1 >= MIN_FINAL_CHARS:
                    if i + 1 + SETTLE_CHARS <= len(rest):
                        boundary = i + 1
                    break

        # 3) 時間保險：到了上限就切，寧可短不可卡
        #
        # ⚠️ 但**切點不能落在假設的最尾端**。
        #    trace_rewrite.py 抓到的那次改寫就是這樣發生的：
        #       [20000ms] 送出「第四頁跟第五頁現在開始做」   ← 切在尾端，後面沒東西
        #       [23200ms] 模型才把「。」補在「開始做」後面
        #                → 前綴不符 → 整句重送
        #
        #    尾端正是模型「還在寫」的位置，永遠不該定稿到那裡。
        #    所以強制切時要**往回退**，把尾巴留在 pending 讓它繼續被修正。
        if boundary < 0 and len(rest) >= MAX_FINAL_CHARS:
            # 同理，超長時也不能切在尾端
            boundary = MAX_FINAL_CHARS
            if len(rest) - boundary < TAIL_HOLD_CHARS and len(rest) > MIN_FINAL_CHARS:
                boundary = len(rest) - TAIL_HOLD_CHARS
            self._forced += 1
        elif boundary < 0 and (self.utterance_ms >= MAX_UTTERANCE_MS
                               or self.pending_ms >= FINAL_AFTER_MS):
            keep = TAIL_HOLD_CHARS if len(rest) > MIN_FINAL_CHARS else 0
            boundary = len(rest) - keep
            self._forced += 1

        if boundary > 0:
            payload = rest[:boundary]        # 實際送給前端的（已去掉開頭孤兒標點）
            consumed = rest[:boundary]       # 從模型輸出真正吃掉的（含孤兒標點）
            self._floor = floor + consumed  # ★ 用原文，必須和模型輸出完全一致
            self.utterance_ms = 0
            self.pending_ms = 0
            self.last_partial = now
            # 標出是「還在改寫的尾端」還是「已經穩定」，這是判斷前綴比對
            # 會不會失敗的直接依據。DEBUG 時用。
            unstable = len(consumed) + TAIL_HOLD_CHARS >= len(rest)
            if unstable:
                self._tail_cuts += 1
            out.append({"type": "final", "text": self.rz.cc.convert(payload),
                        "ms": self.audio_ms,
                        "unstable": unstable,
                        **({"why": "長度上限"} if len(payload) >= MAX_FINAL_CHARS else {})})
            return out

        # 靜音 / 講太久 → 強制把剩下的定稿（寧可長一點也要送出去）
        #
        # ⚠️ 但**不能因為靜音就推進 _floor**。
        #
        # 追蹤結果（trace_boundary.py）直接指出原因：
        #   [12320ms] 原因=靜音 → 送出「…來開始」     _floor=「…來開始」
        #   [12480ms] 原因=靜音 → 送出「做」            _floor=「…來開始做」
        #   [14560ms] 原因=靜音 → 送出「。四跟」        _floor=「…開始做。四跟」
        #
        # 每一段都是「靜音」觸發的，而且每次只多推進 1-2 個字。
        # 為什麼？因為這是**教室錄音**：老師講一句停頓一下、板書、再講。
        # 靜音一次又一次觸發，每次把當下模型吐出來的尾巴定稿掉。
        #
        # 結果就是「做」/「。四跟」/「五」這種碎片。
        # 而且靜音中模型還在重估，_floor 被推得比模型實際輸出還快，
        # 下一輪 startswith 就對不上。
        #
        # 修法：靜音時**只送 partial 給前端顯示，不推進 _floor**。
        #     只有「句尾標點」才真正定稿（那是模型自己確認的句子邊界）。
        #     超時（講太久）才例外，因為那時再不定稿畫面會停住。
        if self.utterance_ms >= MAX_UTTERANCE_MS and rest.strip():
            self._floor = floor + rest
            self.utterance_ms = 0
            self.pending_ms = 0
            self.last_partial = now
            out.append({"type": "final", "text": self.rz.cc.convert(rest),
                        "ms": self.audio_ms, "why": "超時"})
            return out

        # 靜音 → 讓 partial 繼續送（前端顯示用），但不定稿、不推進 _floor
        self.pending = text
        if now - self.last_partial >= PARTIAL_MS / 1000:
            self.last_partial = now
            out.append({"type": "partial", "text": self.rz.cc.convert(text),
                        "ms": self.audio_ms, "silent": True})
        return out

    def _finalize(self, why: str) -> dict:
        """把「進行中」的字全部定稿出去。

        ⚠️ 不能重建 stream —— 重建後模型忘了前面講過什麼，
           下一次認到的文字會重頭開始。這是我第一版的另一個 bug：
           我在每個句尾都 `create_stream()`，等於每句都重新開始。
        """
        text = clean(self.rz.rec.get_result(self.stream).strip())
        if not text:
            self.pending = ""
            self.pending_ms = 0
            return {"type": "noop", "ms": self.audio_ms}
        # 前綴一致 → 只送增量；不一致 → 整句重送（前端以 final 覆寫）
        rest = text[len(self._floor):] if text.startswith(self._floor) else text
        self._floor = text
        self.pending = ""
        self.pending_ms = 0
        self.utterance_ms = 0
        return {"type": "final", "text": self.rz.cc.convert(rest),
                "ms": self.audio_ms, "why": why}

    def flush(self) -> dict:
        return self._finalize("斷線")


# ── HTTP ────────────────────────────────────────────────────────────────
STATE = {"ready": False, "connections": 0, "sessions": 0, "msgs": 0, "dropped": 0,
         "sessions_active": 0,
         "model": MODEL_DIR.name, "load_s": 0.0, "provider": "cpu",
         "started": time.time()}

# 效能統計（供 /metrics）。
#
# 為什麼不放在 STATE：STATE 是「當下狀態」（連線數、就緒與否），
# 這裡是「累積量」。混在一起會讓 STATE 的每個讀取者都要分辨兩種語意，
# 而忘記分辨時的症狀是「數字看起來合理但意義錯了」。
#
# rtf（real-time factor）= 處理秒數 / 音訊秒數。< 1 才是即時的。
# 這個值是唯一能回答「伺服器跟不跟得上直播」的指標 ——
# 記憶體滿不滿不會讓字幕壞掉，但 RTF > 1 會讓字幕愈來愈落後。
STATS = {"req": 0, "err": 0, "audio_sec": 0.0,
         "rtf_sum": 0.0, "rtf_n": 0, "rtf_last": None}


async def health(_req: web.Request) -> web.Response:
    """監控用。連同 Private Network Access 標頭一起回。"""
    return web.json_response({
        "ok": STATE["ready"],
        "model": STATE["model"],
        "load_s": round(STATE["load_s"], 2),
        "uptime_s": round(time.time() - STATE["started"], 1),
        "connections": STATE["connections"],
        # 前端要顯示「實際生效的」後端，不是使用者要求的那個。
        # 要求 cuda 卻被降級成 cpu 時，這裡會誠實地寫 cpu。
        "provider": STATE["provider"],
    }, headers={"Access-Control-Allow-Origin": "*"})


def _proc_stat():
    """讀 /proc/self/status 的記憶體用量（KB）。

    為什麼不讀系統的：這是「這個行程」佔多少，不是「整台機器」。
    管理端要知道記憶體壓力來自哪裡 —— 如果 daemon 只佔 300MB
    而系統顯示用了 12GB，那是別的行程（Minecraft）造成的，
    拿系統數字當成自己的數字會誤導成「記憶體不足」。
    """
    rss = peak = 0
    try:
        with open("/proc/self/status", "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    rss = int(line.split()[1])
                elif line.startswith("VmHWM:"):
                    peak = int(line.split()[1])
    except OSError:
        pass
    return rss, peak


def _loadavg():
    """1/5/15 分鐘負載。回 -1 表示取不到（不可用時要能分辨，不要假裝是 0）。"""
    try:
        return [round(x, 2) for x in os.getloadavg()]
    except (OSError, AttributeError):
        return [-1.0, -1.0, -1.0]


async def metrics(_req: web.Request) -> web.Response:
    """管理端監控面板的資料來源。

    刻意不放進 /health：那個是給「現在能不能用」判斷用的，
    加太多欄位會讓它變慢，而且兩者的消費者不同
    （前端輪詢 vs 管理員看儀表板）。
    """
    rss_kb, peak_kb = _proc_stat()
    la = _loadavg()
    now = time.time()
    st = STATS
    up = max(1e-6, now - STATE["started"])
    m = st["rtf_sum"]
    return web.json_response({
        "ok": STATE["ready"],
        "uptime_s": round(up, 1),
        "provider": STATE["provider"],
        "model": STATE["model"],
        # ── 記憶體（本行程）──
        "rss_mb": round(rss_kb / 1024.0, 1),
        "peak_rss_mb": round(peak_kb / 1024.0, 1),
        # ── CPU ──
        "loadavg": la,
        # ── 流量 ──
        "connections": STATE["connections"],
        "req_total": st["req"],
        "err_total": st["err"],
        "audio_sec_total": round(st["audio_sec"], 1),
        "req_per_min": round(st["req"] / (up / 60.0), 2),
        # ── 效能 ──
        # RTF（real-time factor）= 處理時間 / 音訊長度。
        # < 1 表示比即時快。> 1 表示來不及，用戶會看到落後。
        "rtf_avg": round(m / st["rtf_n"], 4) if st["rtf_n"] else None,
        "rtf_n": st["rtf_n"],
        "rtf_last": round(st["rtf_last"], 4) if st["rtf_last"] is not None else None,
    }, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"})


@web.middleware
async def cors_mw(req: web.Request, handler):
    """dashboard 是 https://zixilive.dpdns.org，daemon 在 127.0.0.1。
    這是「公開來源 → 本機位址」的方向，Chrome 會要求
    Access-Control-Allow-Private-Network: true，否則 WebSocket 被擋。"""
    if req.method == "OPTIONS":
        return web.Response(status=204, headers=_cors())
    resp = await handler(req)
    for k, v in _cors().items():
        resp.headers[k] = v
    return resp


def _cors() -> dict:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Private-Network": "true",
    }


async def ws_handler(req: web.Request) -> web.WebSocketResponse:
    if not STATE["ready"]:
        return web.Response(status=503, text="model still loading")

    ws = web.WebSocketResponse(heartbeat=20.0, max_msg_size=1 << 20)
    await ws.prepare(req)

    rz = Recognizer.get(MODEL_DIR, THREADS, PROVIDER)
    ses = Session(rz)
    STATE["connections"] += 1
    STATE["sessions"] += 1
    STATE["sessions_active"] += 1
    log(f"  + 連線 #{STATE['connections']}")

    async def send(o: dict):
        # ⚠️ 過濾空字串時**只能**擋字幕類事件。
        #
        #   我第一版寫成 `if not o.get("text"): return`，
        #   結果把 {"type":"ready"} 和 {"type":"pong"} 也一起丟了 ——
        #   那兩種訊息本來就沒有 text 欄位。
        #   後果：瀏覽器開了 WebSocket 卻永遠等不到 ready，
        #         前端就卡在「等待中」，daemon log 顯示「丟棄空字串 7」。
        #
        #   教訓：過濾條件要依**訊息類型**判斷，不是依欄位是否存在。
        t = o.get("type")
        if t in ("partial", "final") and not o.get("text", "").strip():
            STATE["dropped"] += 1
            return
        if t == "noop":
            STATE["dropped"] += 1
            return
        STATE["msgs"] += 1
        await ws.send_str(json.dumps(o, ensure_ascii=False))

    await send({"type": "ready", "model": STATE["model"],
                "sampleRate": SAMPLE_RATE, "chunkMs": CHUNK_MS})

    loop = asyncio.get_running_loop()
    # ⚠️ 必須用 thread-safe 的 queue.Queue，不能用 asyncio.Queue。
    #    asyncio.Queue.get() 是 coroutine function，在執行緒裡呼叫
    #    `pcm = q.get()` 拿到的是 **coroutine 物件**而不是資料 ——
    #    下游 `pcm.size` 就炸「'coroutine' object has no attribute 'size'」，
    #    而且只在送音訊時才炸，daemon 本身看起來完全正常。
    q: Queue = Queue(maxsize=64)

    # 音訊處理丟到執行緒池，避免 ONNX 推論卡住 event loop。
    #
    # ⚠️ 這裡我第一版寫成「queue 空就 continue」，結果是**無限空轉** ——
    #    沒有音訊時就在 CPU 上狂跑，一台電腦 100% 佔用。
    #    正確做法是 blocking get() + sentinel 結束。
    def worker():
        while True:
            pcm = q.get()                          # 阻塞，不空轉
            if pcm is None:                        # sentinel = 收工
                return
            try:
                for o in ses.feed(pcm):
                    loop.call_soon_threadsafe(
                        lambda oo=o: asyncio.ensure_future(_safe(send, oo)))
            except Exception as e:  # pragma: no cover
                log(f"  ★ 推論錯誤: {type(e).__name__}: {e}")
            if not ses._fed_logged:
                ses._fed_logged = True
                log(f"    [dbg] 推論執行緒第一圈: feeds={ses._feeds} bytes={ses._bytes}")

    task = loop.run_in_executor(None, worker)

    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                raw = np.frombuffer(msg.data, dtype=np.int16).astype(np.float32) / 32768.0
                # put_nowait 在滿了會丟 Full；寧可丟音訊也不能阻塞 event loop
                try:
                    q.put_nowait(raw)
                except Full:
                    pass
            elif msg.type == WSMsgType.TEXT and msg.data:
                try:
                    cmd = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue
                if cmd.get("type") == "flush":
                    for o in [ses.flush()]:
                        await send(o)
                elif cmd.get("type") == "ping":
                    await ws.send_str(json.dumps({"type": "pong",
                                                 "ms": ses.audio_ms}))
    finally:
        q.put_nowait(None)                         # 叫醒 worker 收工
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=3)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            log("  ★ worker 收不乾淨（ONNX 卡住），強制結束")
        except Exception:
            pass
        STATE["connections"] -= 1
        STATE["sessions_active"] = max(0, STATE["sessions_active"] - 1)
        log(f"  - 離開   收到 feeds={ses._feeds} bytes={ses._bytes} "
            f"({ses._bytes / 2 / 16000:.1f}s 音訊)  產出過最長 {ses._chars} 字  "
            f"改寫 {ses._rewrites} / 強制定稿 {ses._forced} / 丟標點 {ses._orphan_punct} 次  "
            f"送出 {STATE['msgs']} / 丟棄空字串 {STATE['dropped']}"
            f"  剩下 {STATE['connections']} 條")
        try:
            await send(ses.flush())
            await ws.close()
        except Exception:
            pass
        log(f"  - 離開（剩下 {STATE['connections']} 條）")
    return ws


async def _safe(fn, o):
    try:
        await fn(o)
    except Exception:
        pass


async def on_startup(app: web.Application):
    log("  載入模型中…")
    loop = asyncio.get_running_loop()
    rz = await loop.run_in_executor(
        None, lambda: Recognizer.get(MODEL_DIR, app["threads"], app["provider"]))
    STATE["ready"] = True
    STATE["load_s"] = rz.load_s
    STATE["provider"] = Recognizer.effective_provider
    log(f"  ✓ 就緒  ws://127.0.0.1:{app['port']}   /health")


def create_app(port: int) -> web.Application:
    """組出 app。

    抽出來是為了讓 gateway.py 能**在同一個行程**上再加 OpenAI 契約的路由 ——
    161MB 模型每個行程一份，這台機器記憶體是瓶頸（Minecraft 堆上限 17GB / 共 18GB），
    不能為了兩組路由開兩個行程。
    """
    app = web.Application(middlewares=[cors_mw])
    app["port"] = port
    app["threads"] = THREADS
    app["provider"] = PROVIDER
    app.on_startup.append(on_startup)
    app.add_routes([
        web.get("/health", health),
        # /metrics 給中轉後台的監控面板輪詢；與 /health 分開是因為
        # 兩者的消費者與刷新頻率不同（就緒判斷 vs 儀表板）。
        web.get("/metrics", metrics),
        web.get("/ws", ws_handler),
    ])
    return app


def main():
    # global 必須在使用之前宣告，否則 Python 會把整個 main() 的名稱當區域變數，
    # 而預設值 THREADS/PROVIDER 又讀了 module 層級的同名值 → SyntaxError。
    global THREADS, PROVIDER

    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--threads", type=int, default=THREADS)
    ap.add_argument("--provider", default=PROVIDER,
                    choices=["cpu", "cuda"],
                    help="推論後端。cuda 需要編譯了 GPU 支援的 sherpa-onnx；"
                         "沒有會自動退回 cpu 並在 log 說明。")
    args = ap.parse_args()
    THREADS, PROVIDER = args.threads, args.provider

    if not MODEL_DIR.is_dir():
        print(f"★ 找不到模型目錄: {MODEL_DIR}", file=sys.stderr)
        sys.exit(1)

    print("=" * 62)
    print("  本機即時字幕 daemon")
    print("=" * 62)
    print(f"  模型: {MODEL_DIR.name}")

    web.run_app(create_app(args.port), host=args.host, port=args.port,
                print=None, access_log=None)


if __name__ == "__main__":
    main()
