/**
 * Verifies the payment settings store secrets encrypted, never echo them back,
 * and that a client can no longer grant itself a paid plan.
 *
 * Usage: npx tsx scripts/test-payment-gate.ts
 */
import fs from "node:fs";

/**
 * Loads the real key the server used, otherwise the assertions about decryption
 * would run against a different key than the one that produced the ciphertext.
 */
function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (v && !v.startsWith("[") && !process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");
process.env.PAYMENT_ENCRYPTION_KEY ||= "test-only-key-not-used-anywhere-real";

const base = "http://localhost:3000";
const H = { Cookie: "sf_session=dev-session-1", "Content-Type": "application/json" };

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const j = async (url: string, init?: RequestInit) => {
  const res = await fetch(base + url, { headers: H, ...init });
  return { status: res.status, body: await res.json().catch(() => null) as any };
};

const KEY = "SUPERSECRETHASHKEY123";
const IV = "SUPERSECRETHASHIV456";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { isEncryptedSecret, decryptSecretIfEncrypted } = await import("../src/lib/secret-crypto");

  // ---- the self-service upgrade hole ----
  const sub0 = await j("/api/v1/membership");
  const plan = sub0.body.subscription.planKey;

  const forged = await j("/api/v1/membership", {
    method: "POST",
    body: JSON.stringify({ _meta: "changePlan", planKey: plan === "free" ? "pro" : "free", billingMode: "monthly" }),
  });
  let invId = "";
  if (forged.body?.invoices?.length) invId = forged.body.invoices[0].id;

  if (invId) {
    const pay = await j("/api/v1/membership", {
      method: "POST",
      body: JSON.stringify({ _meta: "payInvoice", id: invId }),
    });
    check("client cannot settle its own invoice", pay.status === 501, `status ${pay.status}`);
    const stillPending = (await j("/api/v1/membership")).body.invoices.find((x: any) => x.id === invId);
    check("invoice stays pending after the attempt", stillPending?.status === "pending", stillPending?.status);
  } else {
    console.log("  (no invoice produced to test against)");
    check("client cannot settle its own invoice", false, "no test fixture");
  }

  // ---- secrets encrypted at rest ----
  await prisma.paymentSetting.deleteMany({ where: { userId: "dev-user-1" } });

  const put = await j("/api/v1/payment-settings", {
    method: "PUT",
    body: JSON.stringify({
      ecpayEnabled: true,
      ecpayMerchant: "1234567",
      ecpayHashKey: KEY,
      ecpayHashIv: IV,
      minAmount: 30,
    }),
  });
  check("saves gateway settings", put.status === 200, `status ${put.status}`);
  check("reports the key as present", put.body?.settings?.hasEcpayKey === true);
  check("reports the iv as present", put.body?.settings?.hasEcpayIv === true);
  check("gateway reports ready", put.body?.settings?.ecpayReady === true);

  const row = await prisma.paymentSetting.findFirst({ where: { userId: "dev-user-1" } });
  check("hash key is NOT plaintext in the database", isEncryptedSecret(row!.ecpayHashKey), row!.ecpayHashKey.slice(0, 12) + "…");
  check("hash IV is NOT plaintext in the database", isEncryptedSecret(row!.ecpayHashIv));
  check("ciphertext does not contain the secret", !row!.ecpayHashKey.includes(KEY));
  check("encrypts, but still decrypts back to the original", decryptSecretIfEncrypted(row!.ecpayHashKey) === KEY);

  // ---- secrets never leave the server ----
  const get = await j("/api/v1/payment-settings");
  const raw = JSON.stringify(get.body);
  check("GET does not leak the hash key", !raw.includes(KEY));
  check("GET does not leak the hash IV", !raw.includes(IV));
  check("GET does not leak ciphertext either", !/v1:[A-Za-z0-9_-]{8,}/.test(raw));

  // ---- omitted fields keep the stored value ----
  await j("/api/v1/payment-settings", { method: "PUT", body: JSON.stringify({ ecpayMerchant: "7654321" }) });
  const row2 = await prisma.paymentSetting.findFirst({ where: { userId: "dev-user-1" } });
  check("omitting a secret preserves it", decryptSecretIfEncrypted(row2!.ecpayHashKey) === KEY);
  check("other fields still update", row2!.ecpayMerchant === "7654321", row2!.ecpayMerchant);

  await prisma.paymentSetting.deleteMany({ where: { userId: "dev-user-1" } });
  console.log("cleanup: payment settings removed");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
