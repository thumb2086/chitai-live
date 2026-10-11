"""AI Gateway —— 本機 OpenAI 相容服務的進入點。

一個行程同時提供兩種介面
-----------------------
  · OpenAI HTTP（groq-router 打這裡）      POST /v1/audio/transcriptions
  · 串流 WebSocket（livestream-dashboard） WS   /ws

為什麼不開兩個行程：161MB 的模型每個行程都要載一份，
記憶體在這台機器上是瓶頸（Minecraft 的堆上限 17GB / 總共 18GB）。
共用一個 Recognizer 實例，記憶體省一半，而且不會有兩份模型狀態不同步的問題。

用法
----
    GATEWAY_TOKEN=sk-xxx python gateway.py --port 8765
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# caption_daemon 匯入時就會設好 fd 2 的原生 log 攔截、找模型路徑，
# 這兩件事都必須在 sherpa_onnx 被載入之前完成，所以先 import 它。
import caption_daemon as cd
import openai_server as oai
from aiohttp import web


def build_app(port: int) -> web.Application:
    app = cd.create_app(port)
    # OpenAI 契約的路由（放在 caption_daemon 自己的路由之後，
    # 不會蓋掉 /health 和 /ws —— 名字不同，沒有衝突）
    app.add_routes([
        web.get("/v1/models", oai.v1_models),
        web.post("/v1/audio/transcriptions", oai.v1_transcriptions),
        web.post("/v1/audio/speech", oai.v1_speech),
    ])
    return app


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--threads", type=int, default=cd.THREADS)
    ap.add_argument("--provider", default=cd.PROVIDER, choices=["cpu", "cuda"])
    args = ap.parse_args()

    # 必須在 create_app 之前寫回模組層級 —— create_app 會讀 THREADS/PROVIDER
    # 放進 app["threads"]，on_startup 也用同一組值建 Recognizer。
    cd.THREADS = args.threads
    cd.PROVIDER = args.provider

    cd.force_utf8_output()
    cd.log("=" * 62)
    cd.log("  本機 AI Gateway（OpenAI 相容）")
    cd.log("=" * 62)
    cd.log(f"  模型   : {cd.MODEL_DIR.name}")
    cd.log(f"  推論   : {cd.PROVIDER} / {cd.THREADS} 執行緒")
    cd.log(f"  認證   : {'已啟用 (GATEWAY_TOKEN)' if oai.AUTH_TOKEN else '未啟用（區網用）'}")
    cd.log(f"  串流   : ws://{args.host}:{args.port}/ws")
    cd.log(f"  OpenAI : http://{args.host}:{args.port}/v1/audio/transcriptions")

    web.run_app(build_app(args.port), host=args.host, port=args.port,
                print=None, access_log=None)


if __name__ == "__main__":
    main()