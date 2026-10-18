// _boot.ts — jiti 測試的共用啟動墊片
// 先裝 `@/` 別名攔截器，再交給呼叫端跑真正的斷言。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("./_alias.cjs");
export {};
