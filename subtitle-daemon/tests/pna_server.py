"""PNA 測試的伺服器端（獨立行程，供瀏覽器連）。

跑：python pna_server.py
開：https://127.0.0.1:9443/

頁面會做一件關鍵的事：從 **HTTPS 頁面**嘗試連 **ws://127.0.0.1:8765**。
這是 Chrome Private Network Access 會管的組合。
"""

import asyncio
import datetime
import ssl
import tempfile
from pathlib import Path
from aiohttp import web

PORT_WEB = 9443

PAGE = """<!doctype html><html><head><meta charset="utf-8">
<title>PNA</title><style>
body{font-family:Consolas,monospace;background:#111;color:#0f0;padding:20px;font-size:15px}
b{color:#ff0}
</style></head><body>
<h3>Private Network Access 測試</h3>
<pre id="o">…</pre>
<script>
const o = document.getElementById('o');
const L = [];
const say = s => { L.push(s); o.textContent = L.join('\\n'); };
window.__done = false;
say('page origin  = ' + location.origin);
say('page protocol = ' + location.protocol);
say('target       = ws://127.0.0.1:8765/ws');
say('');
say('如果下一行是「WS OPEN」→ 瀏覽器允許 HTTPS 頁面連本機 daemon');
say('如果是「WS ERROR」→ 被 Private Network Access 擋下');
say('');
try {
  const ws = new WebSocket('ws://127.0.0.1:8765/ws');
  ws.onopen = () => say('>> WS OPEN');
  ws.onerror = () => say('>> WS ERROR（被擋）');
  ws.onclose = e => say('>> WS CLOSE code=' + e.code + ' reason=' + (e.reason||'(空)'));
  ws.onmessage = m => {
    if (typeof m.data === 'string') {
      const d = JSON.parse(m.data);
      if (d.type === 'ready') {
        say('>> 收到 ready: ' + d.model);
        window.__done = true;
      }
    }
  };
} catch (e) { say('>> THROW ' + e); window.__done = true; }
setTimeout(() => { window.__done = true; }, 6000);
</script></body></html>"""


def make_selfsigned(tmpdir: Path):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(k.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=1))
            .sign(k, hashes.SHA256()))
    c, kp = tmpdir / "c.pem", tmpdir / "k.pem"
    kp.write_bytes(k.private_bytes(serialization.Encoding.PEM,
                                    serialization.PrivateFormat.TraditionalOpenSSL,
                                    serialization.NoEncryption()))
    c.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return c, kp


async def main():
    tmpdir = Path(tempfile.mkdtemp(prefix="pna-"))
    crt, key = make_selfsigned(tmpdir)

    async def handler(_r):
        return web.Response(text=PAGE, content_type="text/html")

    app = web.Application()
    app.add_routes([web.get("/", handler)])
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(crt), str(key))
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", PORT_WEB, ssl_context=ctx).start()
    print(f"  ready  https://127.0.0.1:{PORT_WEB}/", flush=True)

    # ⚠️ 必須「永久停住」。
    #    我第一版寫完 start() 就讓 main() 回傳 → asyncio.run() 關閉 event loop
    #    → AppRunner 被回收 → socket 關閉 → 印出 "ready" 但 port 沒有在 listen。
    #    症狀是「伺服器說自己好了，連線卻被拒」。
    #    這種「自報 ready 與實際狀態不符」最難查，因為 log 本身是對的。
    await asyncio.Event().wait()


asyncio.run(main())
