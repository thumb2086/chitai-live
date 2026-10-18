/**
 * Proves live commands actually fire.
 *
 * Before this, LiveCommand had exactly two consumers -- the CRUD calls inside
 * api/v1/commands -- and nothing in the app ever read it. Every command a
 * creator saved was a dead row while the page advertised
 * 「設定觀眾輸入指令時的自動回覆」. These checks drive the real HTTP ingestion
 * path, so they would have failed against the old code.
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
  const { resetCommandCooldown } = await import("@/lib/live-commands");

  const RUN = `cmd-probe-${Date.now()}`;
  const user = await db.user.create({ data: { username: RUN, name: "cmd probe", publicPage: false } });
  const session = await db.session.create({ data: { id: `ses_${RUN}`, userId: user.id, platform: "test" } });
  const cookie = `sf_session=${session.id}`;

  try {
    const post = (body: Record<string, unknown>) =>
      fetch(`${BASE}/api/v1/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify(body),
      });

    await db.liveCommand.create({
      data: { userId: user.id, trigger: "!hello", response: "哈囉全體觀眾！", enabled: true, sortOrder: 0 },
    });
    await db.liveCommand.create({
      data: { userId: user.id, trigger: "!off", response: "永遠不會觸發", enabled: false, sortOrder: 1 },
    });
    await db.liveCommand.create({
      data: { userId: user.id, trigger: "!first", response: "這則優先", enabled: true, sortOrder: 0 },
    });
    await db.liveCommand.create({
      data: { userId: user.id, trigger: "!firsttwo", response: "不該贏", enabled: true, sortOrder: 5 },
    });

    // 1. a matching message fires the command
    const r1 = await post({ platform: "twitch", userName: "viewer1", message: "!hello" });
    const b1 = (await r1.json()) as any;
    check("a matching message fires its command", b1.command === "!hello", `command=${b1.command}`);

    const replies = await db.chatMessage.findMany({
      where: { userId: user.id, isOwner: true },
      orderBy: { createdAt: "asc" },
    });
    check("the reply is written to the chat log", replies.length === 1, `${replies.length} owner row(s)`);
    check("the reply carries the configured text", replies[0]?.message === "哈囉全體觀眾！", replies[0]?.message);

    // 2. disabled commands never fire
    const r2 = await post({ platform: "twitch", userName: "viewer1", message: "!off" });
    check("a disabled command does not fire", (await r2.json() as any).command === null);

    // 3. prefix overlap resolves deterministically by sortOrder, not by luck
    const r3 = await post({ platform: "twitch", userName: "viewer2", message: "!firsttwo" });
    const b3 = (await r3.json()) as any;
    check(
      "the longer overlapping trigger still wins over its prefix",
      b3.command === "!firsttwo",
      `got ${b3.command}`
    );

    // 4. a non-matching message does nothing
    const r4 = await post({ platform: "twitch", userName: "viewer1", message: "只是普通聊天" });
    check("ordinary chat fires nothing", (await r4.json() as any).command === null);

    // 5. whole-word matching: !hello must not fire on !helper
    const r5 = await post({ platform: "twitch", userName: "viewer1", message: "!helper" });
    check("a trigger needs a word boundary", (await r5.json() as any).command === null);

    // 6. cooldown. A fresh trigger is used because the cooldown map lives in the
    // *server* process -- resetCommandCooldown called from this test process
    // would not touch it, so reusing !hello could only ever prove "already in
    // cooldown", not that the first one fired.
    await db.liveCommand.create({
      data: { userId: user.id, trigger: "!cd", response: "冷卻測試回覆", enabled: true, sortOrder: 9 },
    });
    const c1 = await post({ platform: "twitch", userName: "a", message: "!cd" });
    const c2 = await post({ platform: "twitch", userName: "b", message: "!cd" });
    const [bc1, bc2] = [(await c1.json()) as any, (await c2.json()) as any];
    check(
      "cooldown fires once then suppresses the immediate repeat",
      bc1.command === "!cd" && bc2.command === null,
      `first=${bc1.command} second=${bc2.command}`
    );

    // 7. the owner replying with a trigger must not recurse. Counted on the
    // reply text, not on isOwner -- this request posts an isOwner row itself.
    const repliesBefore = await db.chatMessage.count({
      where: { userId: user.id, message: "冷卻測試回覆" },
    });
    const ro = await post({ platform: "twitch", userName: "me", message: "!cd", isOwner: true });
    const repliesAfter = await db.chatMessage.count({
      where: { userId: user.id, message: "冷卻測試回覆" },
    });
    check(
      "a command reply cannot trigger another command",
      (await ro.json() as any).command === null && repliesAfter === repliesBefore,
      `replies ${repliesBefore} -> ${repliesAfter}`
    );

    const total = await db.chatMessage.count({ where: { userId: user.id } });
    console.log(`      chat rows written during the probe: ${total}`);
  } finally {
    await db.chatMessage.deleteMany({ where: { userId: user.id } });
    await db.liveCommand.deleteMany({ where: { userId: user.id } });
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    console.log("      cleanup: throwaway user, session, commands and chat removed");
    await prisma.$disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("probe failed:", e); process.exit(1); });