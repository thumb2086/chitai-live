/**
 * Tests for the payment gateway primitives.
 *
 * The CheckMacValue test vector is generated from the same algorithm it verifies,
 * so it is a regression guard rather than an independent oracle. The property
 * that actually matters for security is covered separately: any change to a
 * signed field, or the keys themselves, must reject.
 *
 * Usage: npx tsx scripts/test-payments.ts
 */
import {
  computeCheckMacValue,
  verifyCheckMacValue,
  normalizeFormBody,
} from "../src/lib/payment-providers";
import { encryptSecret, decryptSecretIfEncrypted, isEncryptedSecret, decryptSecret } from "../src/lib/secret-crypto";

// secret-crypto needs a key; the value is arbitrary and never leaves the process.
process.env.PAYMENT_ENCRYPTION_KEY ||= "test-only-key-not-used-anywhere-real";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const HASH_KEY = "HashKeyTest";
const HASH_IV = "HashIVTest";

console.log("=== CheckMacValue ===");
const order: Record<string, string> = {
  MerchantID: "1234567",
  TradeNo: "SF20261003001AB",
  TradeAmt: "150",
  ItemName: "熾台 Pro 方案",
  TradeDate: "2026-10-03 12:00:00",
  RtnCode: "1",
};
const mac = computeCheckMacValue(order, HASH_KEY, HASH_IV);

check("produces a 64-char uppercase SHA256", /^[0-9A-F]{64}$/.test(mac), mac.slice(0, 16) + "…");
check("round-trips through verify", verifyCheckMacValue({ ...order, CheckMacValue: mac }, HASH_KEY, HASH_IV));

console.log("\n=== key ordering must not matter ===");
const shuffled = Object.fromEntries(Object.entries(order).reverse());
check(
  "same hash regardless of param order",
  computeCheckMacValue(shuffled, HASH_KEY, HASH_IV) === mac
);

console.log("\n=== tampering must be rejected ===");
const tamperCases: [string, Record<string, string>, string, string][] = [
  ["amount changed", { ...order, TradeAmt: "1" }, HASH_KEY, HASH_IV],
  ["merchant changed", { ...order, MerchantID: "7654321" }, HASH_KEY, HASH_IV],
  ["order id changed", { ...order, TradeNo: "OTHER" }, HASH_KEY, HASH_IV],
  ["extra field injected", { ...order, Injected: "x" }, HASH_KEY, HASH_IV],
  ["field removed", (() => { const c = { ...order }; delete c.ItemName; return c; })(), HASH_KEY, HASH_IV],
  ["wrong hash key", order, "wrongKey", HASH_IV],
  ["wrong hash iv", order, HASH_KEY, "wrongIv"],
  ["swapped hash key/iv", order, HASH_IV, HASH_KEY],
];
for (const [name, params, hk, hiv] of tamperCases) {
  check(`rejects: ${name}`, !verifyCheckMacValue({ ...params, CheckMacValue: mac }, hk, hiv));
}
check("rejects a missing signature", !verifyCheckMacValue(order, HASH_KEY, HASH_IV));
check("rejects an empty signature", !verifyCheckMacValue({ ...order, CheckMacValue: "" }, HASH_KEY, HASH_IV));
check(
  "rejects a truncated signature",
  !verifyCheckMacValue({ ...order, CheckMacValue: mac.slice(0, 32) }, HASH_KEY, HASH_IV)
);

console.log("\n=== CJK content ===");
const cjk: Record<string, string> = { ...order, ItemName: "直播斗內感謝方案", TradeRemark: "tester's ~ok~ name" };
const cjkMac = computeCheckMacValue(cjk, HASH_KEY, HASH_IV);
check("CJK + '~' payload verifies", verifyCheckMacValue({ ...cjk, CheckMacValue: cjkMac }, HASH_KEY, HASH_IV));
check("'~' actually changes the hash", cjkMac !== mac);
const quoted = computeCheckMacValue({ ...cjk, TradeRemark: "it's fine" }, HASH_KEY, HASH_IV);
check("apostrophe payload verifies", verifyCheckMacValue({ ...cjk, TradeRemark: "it's fine", CheckMacValue: quoted }, HASH_KEY, HASH_IV));

console.log("\n=== normalizeFormBody ===");
check("flattens a flat object", normalizeFormBody({ a: "1", b: "2" }).a === "1");
check("takes the last of a repeated key", normalizeFormBody({ a: ["1", "2"] }).a === "2");
check("coerces numbers", normalizeFormBody({ n: 5 }).n === "5");
check("handles null body", JSON.stringify(normalizeFormBody(null)) === "{}");

console.log("\n=== secret encryption ===");
const secret = "a-very-long-hash-key-value-1234567890";
const enc = encryptSecret(secret);
check("marks the value as encrypted", isEncryptedSecret(enc));
check("round-trips", decryptSecretIfEncrypted(enc) === secret);
check("passes plaintext through untouched", decryptSecretIfEncrypted("plain-hash") === "plain-hash");
check(
  "ciphertext differs from plaintext",
  !enc.includes(secret) && enc.length > secret.length
);
const enc2 = encryptSecret(secret);
check("fresh IV each time", enc !== enc2, "two encryptions of the same value differ");
check("both still decrypt", decryptSecretIfEncrypted(enc2) === secret);
check(
  "wrong key cannot decrypt",
  (() => {
    const prev = process.env.PAYMENT_ENCRYPTION_KEY;
    process.env.PAYMENT_ENCRYPTION_KEY = "a-different-key";
    try {
      decryptSecret(enc);
      return false;
    } catch {
      return true;
    } finally {
      process.env.PAYMENT_ENCRYPTION_KEY = prev;
    }
  })()
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
