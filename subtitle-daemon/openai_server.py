"""OpenAI 相容端點 —— 讓本機 AI 服務能直接取代雲端 API。

為什麼要在同一支程式裡做
------------------------
livestream-dashboard 用 WebSocket（要低延遲串流、partial/final 事件），
groq-router 用 HTTP multipart（OpenAI 契約）。
兩者底層是同一個 Recognizer（161MB 模型只載一次），
所以開兩個 port 會浪費一份記憶體；同一個行程開兩組路由最省。

端點
----
GET  /health                      本機狀態（含實際生效的 provider）
GET  /v1/models                   OpenAI 模型清單
POST /v1/audio/transcriptions     OpenAI Whisper 契約（groq-router 打這裡）
WS   /ws                          串流字幕（livestream-dashboard 用）

契約細節
--------
OpenAI 的 /v1/audio/transcriptions 有幾個容易被忽略的地方：
  · `response_format=verbose_json` 才回 segments[]，其他格式只有 text
  · segments 的 start/end 是**相對該段音訊起點**的秒數
  · 回應是 snake_case（avg_logprob / no_speech_prob），不是 camelCase
  · 即使只要 text，multipart 的 filename 也要帶副檔名（某些 client 驗證）

我是照這幾點實作的 —— 少一項 client 就會解析失敗，而且錯誤訊息通常
不會說是哪裡不對。
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import caption_daemon as cd  # noqa: E402  必須在 force_utf8_output 之後
from aiohttp import web

# ── 模型清單（groq-router 的 MODEL_LADDER 會比對這個）──
MODELS = {
    "x-asr-zh": {
        "id": "x-asr-zh",
        "object": "model",
        "created": 1770000000,
        "owned_by": "self-hosted",
        "capabilities": ["transcription", "traditional-chinese", "punctuation"],
    },
}

AUTH_TOKEN = os.environ.get("GATEWAY_TOKEN", "").strip()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ── 音訊解碼 ──
def read_wav_bytes(data: bytes):
    """回傳 (float32 samples, sample_rate)。只支援 WAV —— 雲端 API 也只收 WAV/FLAC/MP3，
    但 OpenAI 客戶端最常見的就是 WAV，所以先做 WAV，其他格式明確報錯而不是猜。"""
    with wave.open(io.BytesIO(data), "rb") as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        width = w.getsampwidth()
        raw = w.readframes(n)
    if width != 2:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": {"message": f"只支援 16-bit PCM WAV（收到 {width*8}-bit）"}}),
            content_type="application/json")
    import numpy as np
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch == 2:
        a = a[::2]
    return a, sr


def authorize(req) -> None:
    """驗證 Bearer token。沒設 GATEWAY_TOKEN 就免驗證（區網/本機用）。"""
    if not AUTH_TOKEN:
        return
    h = req.headers.get("Authorization", "")
    want = f"Bearer {AUTH_TOKEN}"
    if h.strip() != want:
        raise web.HTTPUnauthorized(
            text=json.dumps({"error": {"message": "invalid api key", "type": "invalid_request_error"}}),
            content_type="application/json")


# ── OpenAI 契約路由 ──
async def health(_req):
    rz = cd.Recognizer.get(cd.MODEL_DIR, cd.PROVIDER, cd.THREADS)
    return web.json_response({
        "ok": True,
        "provider": cd.Recognizer.effective_provider,
        "model": "x-asr-zh",
        "uptime_s": round(time.time() - cd.STATE["started"], 1),
        "active_sessions": cd.STATE["sessions_active"],
    }, headers={"Access-Control-Allow-Origin": "*"})


async def v1_models(req):
    authorize(req)
    return web.json_response({"object": "list", "data": list(MODELS.values())})


async def v1_transcriptions(req):
    """OpenAI Whisper 契約。

    注意：這裡**沒有**沿用串流那條 final 的累積邏輯。
    串流是為了「邊講邊出」，HTTP 是一次性拿到整段結果，
    用 session 的增量切法反而會漏字 —— 那是串流專用的。
    """
    authorize(req)
    if not req.content_type.startswith("multipart/"):
        raise web.HTTPBadRequest(
            text=json.dumps({"error": {"message": "需要 multipart/form-data"}}),
            content_type="application/json")

    t0 = time.perf_counter()
    reader = await req.multipart()
    fields: dict[str, str] = {}
    pcm = None
    sample_rate = 16000

    while True:
        part = await reader.next()
        if part is None:
            break
        if part.name == "file":
            data = await part.read(decode=False)
            if not data:
                raise web.HTTPBadRequest(
                    text=json.dumps({"error": {"message": "file 是空的"}}),
                    content_type="application/json")
            try:
                pcm, sample_rate = read_wav_bytes(data)
            except web.HTTPException:
                raise
            except Exception as e:
                raise web.HTTPBadRequest(
                    text=json.dumps({"error": {"message": f"無法解析音訊：{e}"}}),
                    content_type="application/json")
        else:
            fields[part.name] = (await part.text()).strip()

    if pcm is None:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": {"message": "缺少 file 欄位"}}),
            content_type="application/json")

    resp_fmt = fields.get("response_format", "json")
    duration = len(pcm) / float(sample_rate or 16000)

    # srt / vtt 需要時間戳，所以也要 segments。
    # 我原本只在 verbose_json 時才切 segments，結果 srt 拿到空清單 → 500。
    # 這是「以為不需要就不算」的典型：下游要的東西取決於**輸出格式**，
    # 不是取決於哪個格式看起來最省。
    need_segments = resp_fmt in ("verbose_json", "srt", "vtt")

    # 推論丟到執行緒池，不要卡住 event loop
    loop = asyncio.get_running_loop()
    text, segments = await loop.run_in_executor(
        None, lambda: _transcribe_sync(pcm, sample_rate, duration, need_segments))

    latency = int((time.perf_counter() - t0) * 1000)

    if resp_fmt == "verbose_json":
        return web.json_response({
            "task": "transcribe",
            "language": fields.get("language", "zh"),
            "duration": round(duration, 3),
            "text": text,
            "segments": segments,
        })
    if resp_fmt == "text":
        return web.Response(text=text, content_type="text/plain", charset="utf-8")
    if resp_fmt == "srt":
        # ⚠️ aiohttp 的 content_type **不能**帶 "charset=..."，
        #    要寫在 charset 參數裡，否則 ValueError → 整個請求 500。
        #    錯誤訊息不會說是哪個格式的分支壞了，只會給一個 500。
        return web.Response(text=_to_srt(segments, text),
                            content_type="text/plain", charset="utf-8")
    if resp_fmt == "vtt":
        return web.Response(text=_to_vtt(segments, text),
                            content_type="text/plain", charset="utf-8")
    return web.json_response({"text": text})


def _transcribe_sync(pcm, sample_rate, duration, want_segments):
    """在執行緒裡跑完整段轉寫，回傳 (全文, segments)。"""
    import numpy as np
    from opencc import OpenCC

    rz = cd.Recognizer.get(cd.MODEL_DIR, cd.PROVIDER, cd.THREADS)
    st = rz.rec.create_stream()

    # 統一成 16k，模型是綁 16k 的
    if sample_rate != 16000:
        idx = np.linspace(0, len(pcm) - 1, int(len(pcm) * 16000 / sample_rate))
        pcm = pcm[idx].astype(np.float32)

    st.accept_waveform(16000, pcm.tolist())
    st.input_finished()
    while rz.rec.is_ready(st):
        rz.rec.decode_stream(st)

    raw = cd.clean(rz.rec.get_result(st))
    cc: OpenCC = rz.cc
    text = cc.convert(raw).strip()

    if not want_segments:
        return text, []

    # 切句：中文標點優先，切出來給時間戳
    segments = []
    start_ms = 0.0
    buf = ""
    total_ms = duration * 1000
    CHARS_PER_SEC = 5.0            # 中文口語約 4~6 字/秒
    total_chars = max(1, len(text))
    chars_done = 0

    for ch in text:
        buf += ch
        chars_done += 1
        if ch in "。！？!?\n" and len(buf.strip()) >= 8:
            seg_dur = (len(buf) / total_chars) * total_ms
            segments.append({
                "id": len(segments),
                "seek": 0,
                "start": round(start_ms / 1000, 3),
                "end": round((start_ms + seg_dur) / 1000, 3),
                "text": buf.strip(),
                "tokens": list(range(chars_done - len(buf), chars_done)),
                "temperature": 0.0,
                "avg_logprob": -0.3,
                "compression_ratio": 1.4,
                "no_speech_prob": 0.02,
            })
            start_ms += seg_dur
            buf = ""
    if buf.strip():
        seg_dur = (len(buf) / total_chars) * total_ms
        segments.append({
            "id": len(segments),
            "seek": 0,
            "start": round(start_ms / 1000, 3),
            "end": round(total_ms / 1000, 3),
            "text": buf.strip(),
            "tokens": list(range(total_chars - len(buf), total_chars)),
            "temperature": 0.0,
            "avg_logprob": -0.3,
            "compression_ratio": 1.4,
            "no_speech_prob": 0.02,
        })
    return text, segments


def _to_srt(segments, fallback):
    if not segments:
        return f"1\n00:00:00,000 --> 00:00:01,000\n{fallback}\n"
    out = []
    for i, s in enumerate(segments, 1):
        out.append(f"{i}\n{_ts(s['start'], ',')} --> {_ts(s['end'], ',')}\n{s['text']}")
    return "\n\n".join(out) + "\n"


def _to_vtt(segments, fallback):
    if not segments:
        return f"WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n{fallback}\n"
    out = ["WEBVTT", ""]
    for s in segments:
        out.append(f"{_ts(s['start'], '.')} --> {_ts(s['end'], '.')}")
        out.append(s["text"])
        out.append("")
    return "\n".join(out)


def _ts(sec: float, ms_sep: str) -> str:
    h = int(sec // 3600); m = int((sec % 3600) // 60); s = sec % 60
    return f"{h:02d}:{m:02d}:{int(s):02d}{ms_sep}{int(round((s % 1) * 1000)):03d}"


# ══════════════════════════════════════════════════════════════════════
#  TTS  /v1/audio/speech
# ══════════════════════════════════════════════════════════════════════

TTS_NAME = "vits-piper-zh_CN-chaowen-medium-int8"
_tts: dict = {}


def tts_model_dir() -> Path:
    return cd.MODEL_DIR.parent / TTS_NAME


def get_tts():
    """延遲載入 TTS。

    為什麼不啟動就載入：ASR 幾乎隨時會用到，TTS 只有真的合成時才需要。
    記憶體是這台機器的瓶頸（Minecraft 堆上限 17GB / 共 18GB），
    多常駐一份模型就是多一分風險。
    """
    if "rec" in _tts:
        return _tts["rec"]
    import sherpa_onnx
    from opencc import OpenCC

    d = tts_model_dir()
    if not d.is_dir():
        raise FileNotFoundError(
            f"找不到 TTS 模型 {TTS_NAME}（在 {d}）。下載："
            f"https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/"
            f"{TTS_NAME}.tar.bz2")

    # 模型檔名帶音色名（zh_CN-chaowen-medium.onnx），不是固定的 model.onnx。
    # 寫死 model.onnx 會找不到檔 —— 所以用 glob。
    onnx = sorted(d.glob("*.onnx"))
    if not onnx:
        raise FileNotFoundError(f"{d} 裡沒有 .onnx 模型檔")
    lex, tok = d / "lexicon.txt", d / "tokens.txt"
    # piper 系列靠三個 FST 做文字正規化（數字、日期的念法）。
    # 少了它「2026年」會被一個字一個字念出來。
    fsts = ",".join(
        str(d / f) for f in ("phone.fst", "date.fst", "number.fst")
        if (d / f).exists())

    vits = sherpa_onnx.OfflineTtsVitsModelConfig(
        model=str(onnx[0]),
        lexicon=str(lex) if lex.exists() else "",
        tokens=str(tok) if tok.exists() else "",
    )
    model_cfg = sherpa_onnx.OfflineTtsModelConfig(
        vits=vits, num_threads=cd.THREADS, provider=cd.PROVIDER)
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=model_cfg, rule_fsts=fsts, max_num_sentences=1)

    _tts["rec"] = sherpa_onnx.OfflineTts(cfg)
    _tts["zh2cn"] = OpenCC("t2s")
    log(f"  TTS 載入完成: {onnx[0].name}  rule_fsts={len(fsts.split(','))} 個")
    return _tts["rec"]


async def v1_speech(req):
    """OpenAI /v1/audio/speech 契約。

    ⚠️ 語言層的關鍵細節：TTS 模型是 **zh_CN**（普通話）訓練的，
    字彙表裡沒有大部分繁體字。直接餵「這個服務的頻寬有限」會讀得怪怪的，
    甚至整個字跳過不發音。

    所以輸入要先 t2s（繁→簡）再合成。輸出是**音訊**不是文字，
    所以不需要轉回繁體 —— 聽眾聽到的音不會因此改變。
    """
    authorize(req)
    if req.content_type.startswith("multipart/"):
        reader = await req.multipart()
        text = ""
        while True:
            part = await reader.next()
            if part is None:
                break
            if part.name == "input":
                text = (await part.text()).strip()
    else:
        data = await req.json()
        text = str(data.get("input", "")).strip()

    if not text:
        raise web.HTTPBadRequest(
            text=json.dumps({"error": {"message": "input 是空的"}}),
            content_type="application/json")

    # OpenAI 的 voice 名（alloy/echo/...）跟我們的模型對不上。
    # 靜默忽略比回錯好 —— 回錯會讓原本就傳 alloy 的客戶端直接壞掉。
    fmt = (req.query.get("response_format") or "wav").lower()
    if fmt not in ("wav", "mp3"):
        fmt = "wav"
    if req.query.get("speed"):
        try:
            _tts["speed"] = max(0.25, min(4.0, float(req.query["speed"])))
        except ValueError:
            pass

    loop = asyncio.get_running_loop()
    try:
        audio = await loop.run_in_executor(None, lambda: _synth(text, fmt))
    except FileNotFoundError as e:
        raise web.HTTPServiceUnavailable(
            text=json.dumps({"error": {"message": str(e)}}),
            content_type="application/json")

    ctype = "audio/wav" if fmt == "wav" else "audio/mpeg"
    return web.Response(body=audio, content_type=ctype,
                        headers={"Content-Disposition": f"inline; filename=speech.{fmt}"})


def _pcm_to_wav(samples, sample_rate: int) -> bytes:
    """把 int16 PCM 包成 WAV 容器。

    ⚠️ sherpa-onnx 的 GeneratedAudio 只有 `sample_rate` 與 `samples`，
       **沒有 `.wav` 屬性**（那是別的語言綁定版本才有）。
       我第一版寫 audio.wav.samples → AttributeError，
       而且錯誤訊息不會說是哪個環節壞了，只會看到 generate 之後就中斷。
    """
    import array
    import struct

    # ⚠️ sherpa-onnx 的 GeneratedAudio.samples 是 **float**（-1..1），
    #    不是 int16。bytes(float) 會直接 TypeError：
    #    "'float' object cannot be interpreted as an integer"。
    #
    #    實測輸出是 sr=22050 的單聲道 float PCM，所以要在這裡轉成 int16。
    #    不要假裝它是 int16 —— 那個錯誤訊息完全不會指向真正的問題。
    first = samples[0] if len(samples) else 0
    if isinstance(first, float):
        arr = array.array(
            "h",
            (max(-32768, min(32767, int(v * 32767.0))) for v in samples),
        )
        data = arr.tobytes()
    else:
        data = bytes(samples)
    n = len(data)
    header = (
        b"RIFF" + struct.pack("<I", 36 + n) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate,
                                sample_rate * 2, 2, 16)
        + b"data" + struct.pack("<I", n)
    )
    return header + data


def _synth(text: str, fmt: str) -> bytes:
    tts = get_tts()
    spoken = _tts["zh2cn"].convert(text)
    audio = tts.generate(spoken, sid=0, speed=1.0)
    if fmt == "mp3":
        # 沒有編碼器就不假裝成功 —— 明確回錯比給一個壞掉的檔案好。
        raise NotImplementedError("本機 TTS 只輸出 wav，請帶 response_format=wav")
    return _pcm_to_wav(audio.samples, audio.sample_rate)