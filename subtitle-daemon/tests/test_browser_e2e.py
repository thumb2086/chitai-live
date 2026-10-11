"""最終驗收：真實瀏覽器 + 真實音訊 → 繁體字幕上畫面。

前面所有測試都只驗到「有一半是腳本在測」：
  · 瀏覽器測 → 只驗連線，沒送音訊（feeds=0）
  · 音訊測   → 只驗 daemon，沒有真的瀏覽器

這個把兩者接起來：在 **HTTPS 頁面**裡，用 **Web Audio 從本機音檔取樣**，
真的餵進 ws://127.0.0.1:8765，然後讀畫面上的字幕文字。

驗的東西
────────
  · 瀏覽器能送 PCM 進本機 daemon（不是靠腳本代送）
  · daemon 回的繁體字幕真的出現在 DOM 上
  · 標點有沒有進到畫面
  · 前端渲染有沒有把 <unk> 之類的東西漏出來

音訊來源：用 file:// 的 mp3 會被 CORS 擋，所以把 wav 轉成 data: URL 塞進頁面。
data: URL 不受 CORS 限制。
"""

import asyncio, base64, subprocess, tempfile, os, sys, json
from pathlib import Path
from playwright.async_api import async_playwright

BASE = Path(r"C:\Users\CPXru\AppData\Local\Temp\opencode\asr")
POD = Path(r"C:\Users\CPXru\Music\playlist-admin\podcasts")
SR = 16000

# 找一個有語音的片段
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

w = BASE / "_browser_test.wav"
subprocess.run(["ffmpeg", "-v", "quiet", "-y", "-ss", "0", "-i", str(src),
                "-t", "25", "-ac", "1", "-ar", str(SR), "-f", "wav", str(w)],
               check=True, timeout=180)
print(f"  音訊: {src.name}  前 25 秒  ({w.stat().st_size/1024:.0f} KB)")

data_url = "data:audio/wav;base64," + base64.b64encode(w.read_bytes()).decode()
print(f"  data URL 長度: {len(data_url)/1024:.0f} KB")

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>captions</title>
<style>
body{font-family:"Microsoft JhengHei",sans-serif;background:#0a0a0a;color:#fff;padding:24px}
#cap{font-size:26px;line-height:1.7;min-height:100px;background:#1a1a1a;padding:16px}
.st{color:#0f0;font-size:13px;margin-bottom:10px;font-family:Consolas,monospace}
</style></head><body>
<div class="st" id="st">狀態: 初始化</div>
<div id="cap"></div>
<script>
const st = document.getElementById('st'), cap = document.getElementById('cap');
const say = s => { st.textContent = '狀態: ' + s; };
window.__log = [];
window.__done = false;

(async () => {
  const AUDIO = "%%DATA%%";
  const SR = 16000;                        // 頁面內要用，不能靠 Python 變數
  const ctx = new AudioContext({ sampleRate: SR });
  await ctx.resume();

  // 解碼音訊
  const buf = await (await fetch(AUDIO)).arrayBuffer();
  const audio = await ctx.decodeAudioData(buf);
  const pcm = audio.getChannelData(0);
  say(`解碼 ${(pcm.length/SR).toFixed(1)}s / ${audio.sampleRate}Hz / ${audio.numberOfChannels}ch`);

  const ws = new WebSocket('ws://127.0.0.1:8765/ws');
  ws.binaryType = 'arraybuffer';
  let done = '';
  window.__wsState = [ws.readyState];

  ws.onopen = () => {
    window.__wsState.push('open');
    say('WebSocket 已開啟，等待 ready…');
  };
  ws.onclose = ev => {
    window.__wsState.push('close:' + ev.code + ':' + (ev.reason || ''));
    say('WebSocket 關閉 code=' + ev.code + ' reason=' + (ev.reason || '(空)'));
    window.__done = true;
  };
  ws.onmessage = ev => {
    if (typeof ev.data !== 'string') return;
    const d = JSON.parse(ev.data);
    if (d.type === 'ready') {
      say(`daemon 就緒 ${d.model.slice(0,42)}…  chunk=${d.chunkMs}ms`);
      stream();
    } else if (d.type === 'final') {
      // rewrite 是「整句重送」，必須取代而不是追加。
      // 這裡原本寫 done += d.text，結果改寫時整句重複一次 ——
      // 是測試頁的錯，不是 daemon 的錯（正式程式 captions-local.ts 有處理）。
      if (d.rewrite) done = d.text; else done += d.text;
      cap.textContent = done;              // 定稿就固定下來
      say(`定稿 ${done.length} 字`);
    } else if (d.type === 'partial') {
      cap.textContent = done + d.text;     // 顯示「定稿+進行中」
      say(`進行中  定稿${done.length}字 + 預覽${d.text.length}字`);
    }
  };
  ws.onerror = () => { say('WS ERROR'); window.__done = true; };

  async function stream() {
    const CH = 16000 * 0.160;              // 160ms
    for (let i = 0; i < pcm.length; i += CH) {
      const slice = pcm.slice(i, i + CH);
      const i16 = new Int16Array(slice.length);
      for (let k = 0; k < slice.length; k++) {
        i16[k] = Math.max(-32768, Math.min(32767, slice[k] * 32767));
      }
      ws.send(i16.buffer);
      await new Promise(r => setTimeout(r, 160));   // 1:1 餵，模擬即時
    }
    ws.send(JSON.stringify({type:'flush'}));
    await new Promise(r => setTimeout(r, 1500));
    say(`結束  最終字幕 ${done.length} 字`);
    ws.close();
    window.__done = true;
  }
})();
setTimeout(() => { window.__done = true; }, 45000);
</script></body></html>"""

html = PAGE.replace("%%DATA%%", data_url)

E2E_PORT = 9444


async def serve():
    """用 HTTPS 提供頁面 —— 必須是 secure context 才測得到 PNA。"""
    import datetime, ssl, tempfile
    from aiohttp import web
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    tmp = Path(tempfile.mkdtemp(prefix="e2e-"))
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nm = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.datetime.now(datetime.timezone.utc)
    crt = (x509.CertificateBuilder().subject_name(nm).issuer_name(nm)
           .public_key(k.public_key()).serial_number(x509.random_serial_number())
           .not_valid_before(now - datetime.timedelta(days=1))
           .not_valid_after(now + datetime.timedelta(days=1)).sign(k, hashes.SHA256()))
    (tmp / "c.pem").write_bytes(crt.public_bytes(serialization.Encoding.PEM))
    (tmp / "k.pem").write_bytes(k.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption()))

    async def handler(_r):
        return web.Response(text=html, content_type="text/html")

    app = web.Application()
    app.add_routes([web.get("/", handler)])
    runner = web.AppRunner(app)
    await runner.setup()
    c = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    c.load_cert_chain(str(tmp / "c.pem"), str(tmp / "k.pem"))
    await web.TCPSite(runner, "127.0.0.1", E2E_PORT, ssl_context=c).start()
    return runner


async def main():
    runner = await serve()
    async with async_playwright() as pw:
        b = await pw.chromium.launch(headless=True, channel="chrome",
                                      args=["--no-sandbox", "--disable-gpu",
                                            "--autoplay-policy=no-user-gesture-required"])
        ctx = await b.new_context(ignore_https_errors=True)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(f"[{m.type}] {m.text}") if m.type == "error" else None)

        # 頁面必須**由 HTTPS 伺服器提供**，才能真正觸發 PNA 路徑。
        # set_content() 會把 origin 變成 about:blank（opaque origin），
        # 那種情況下 PNA 根本不適用 —— 測了等於沒測。
        # 我第一版就是這樣，結果拿到 0 字還以為是 daemon 壞了。
        #
        # pna_server.py 已經在 9443 跑著，但它的內容是固定的測試頁。
        # 所以這裡把頁面內容暫時寫到一個檔案，用 pna_server 的路徑載入 ——
        # 需要 pna_server 支援 /e2e 路由。改用最直接的方式：
        # 直接開一個專用伺服器。
        await page.goto(f"https://127.0.0.1:{E2E_PORT}/", wait_until="domcontentloaded")
        print(f"  頁面已載入 https://127.0.0.1:{E2E_PORT}/（HTTPS origin）")
        print(f"  頁面 origin = {await page.evaluate('location.origin')}")
        print(f"  secureContext = {await page.evaluate('isSecureContext')}\n")

        try:
            await page.wait_for_function("window.__done === true", timeout=50000)
        except Exception:
            print("  ★ 逾時未完成")

        st = await page.inner_text("#st")
        cap = await page.inner_text("#cap")
        wss = await page.evaluate("window.__wsState")

        print("  ── 結果 ──")
        print(f"    狀態: {st}")
        print(f"    字幕: {cap}")
        print(f"    WS 狀態歷程: {wss}")
        print()
        print(f"  字幕長度: {len(cap)} 字")
        simp = set("这个说话时间应该发现认识经济车东门口问题听华国义台湾当过实现")
        bad = simp & set(cap)
        print(f"  殘留簡體: {''.join(sorted(bad)) if bad else '無 ✓'}")
        P = "，。？！、；："
        print(f"  標點數: {sum(1 for c in cap if c in P)}")
        print(f"  <unk>: {cap.count('<unk>')}")
        if errs:
            print("\n  console/page errors:")
            for e in errs[:8]:
                print(f"    {e[:110]}")
        await b.close()
        await runner.cleanup()

asyncio.run(main())
