/**
 * Proves the chat worker integration still works, and that the worker key can no
 * longer be used to destroy real chat.
 *
 * Also guards the fix for the auth bypass: the old check was
 * `body.apiKey === process.env.CHAT_WORKER_KEY`, which is `undefined ===
 * undefined` -> true when the variable is unset.
 *
 * Needs the server on :3000.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const BASE = process.env.APP_URL ?? "http://localhost:3000";
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const db = prisma as any;

  const conn = await db.platformConnection.findFirst({
    where: { channelName: { not: null } },
    select: { platform: true, channelName: true, userId: true },
  });

  if (!conn) {
    console.log("SKIP  no PlatformConnection with a channelName; cannot exercise the worker path");
    await prisma.$disconnect();
    return;
  }
  console.log(`      using ${conn.platform}/${conn.channelName}`);

  const key = process.env.CHAT_WORKER_KEY ?? "";
  // `message` is required by the route before any auth check, so it has to be
  // present or these probes get a 400 and never reach the code under test.
  const base = {
    userName: "worker-probe",
    platform: conn.platform,
    channelName: conn.channelName,
    message: "worker-probe-msg",
  };

  const post = (body: Record<string, unknown>) =>
    fetch(`${BASE}/api/v1/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  // 1. the previous bypass: no apiKey at all
  const noKey = await post(base);
  check("omitting apiKey is refused", noKey.status === 401, `status ${noKey.status}`);

  // 2. a wrong key
  const badKey = await post({ ...base, apiKey: `${key}x` });
  check("a wrong apiKey is refused", badKey.status === 401, `status ${badKey.status}`);

  // 3. an empty apiKey
  const empty = await post({ ...base, apiKey: "" });
  check("an empty apiKey is refused", empty.status === 401, `status ${empty.status}`);

  // 4. the real key still works -- this must not regress
  const before = await db.chatMessage.count({ where: { userId: conn.userId, userName: "worker-probe" } });
  const realKey = await post({ ...base, apiKey: key });
  check("the real worker key still authenticates", realKey.status === 200, `status ${realKey.status}`);
  const after = await db.chatMessage.count({ where: { userId: conn.userId, userName: "worker-probe" } });
  check("and its message was stored", after === before + 1, `${before} -> ${after}`);

  // 5. the worker key must NOT be able to wipe real chat
  const totalBefore = await db.chatMessage.count({ where: { userId: conn.userId } });
  const clear = await post({ ...base, apiKey: key, message: "__clear__" });
  check("worker cannot run __clear__", clear.status === 403, `status ${clear.status}`);
  const totalAfter = await db.chatMessage.count({ where: { userId: conn.userId } });
  check("chat history is untouched by the worker", totalAfter === totalBefore, `${totalBefore} -> ${totalAfter}`);

  // cleanup our probe rows
  await db.chatMessage.deleteMany({ where: { userId: conn.userId, userName: "worker-probe" } });

  await prisma.$disconnect();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("probe failed:", e); process.exit(1); });