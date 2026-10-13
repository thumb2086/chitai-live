# `_archive/` — 已從選單移除的頁面

2026-10-14 起，這些頁面不再出現在側邊選單與首頁卡片。

## 為什麼是搬走而不是刪掉

這批頁面不是「壞掉」或「沒做完」，而是**我們決定不做**了（功能過多、過於花俏，
或與「金流全面改子熙幣」的方向衝突）。刪掉之後要找回來只能靠翻 git 歷史，
而搬走只是換個位置 —— `git mv` 回去就恢復了，diff 也看得清楚。

放在 `_archive/`（底線開頭的資料夾）是 Next.js 的**私有資料夾**慣例：
整個資料夾與所有子資料夾自動脫離路由系統，所以它們**不會**變成可訪問的頁面。
不需要另外去改任何路由設定。

## 怎麼找回來

```powershell
git mv src/app/_archive/<名稱> src/app/dashboard/<名稱>
```
然後把它加回 `src/components/Sidebar.tsx` 的 `SECTIONS` 即可。

## 內容清單與原因

| 頁面 | 移除原因 |
|---|---|
| `donation-cards` | 斗內花招。Livio 都沒有，卡牌動畫對我們規模不划算 |
| `shared-donation-rooms` | 共用斗內房間。需要多創作者協同時才有意義 |
| `donation-video` + `review` | 斗內影片 + 審核佇列。帶寬與審核成本高 |
| `donation-ticker` | 斗內跑馬燈。和進度條、通知功能重疊 |
| `follower-alert` | 追隨與訂閱提醒。平台的 EventSub 自己會發通知 |
| `leaderboard` | 斗內排行榜。等有真的排行榜需求再拿回來 |
| `commerce` | 周邊商店。電商是另一個產品，不該塞在直播後台 |
| `meetups` | 台聚活動（辦線下活動）。同上，另一個產品 |
| `testing` | **測試頁面不該出現在正式選單。** 這是明顯的疏漏，不是取捨 |
| `scoreboard` | 即時比分板。已併入「直播數據」的規劃 |
| `live-viewers` | 同時觀看人數。同上 |
| `stats` | 頻道數據。同上 |
| `payment-settings` | 第三方金流（綠界／歐付寶／PayPal）。改用子熙幣 |
| `membership` + `billing` + `usage` | 訂閱制。改用子熙幣儲值扣點 |
| `subscription` | 同上 |

## 注意

**API 路由沒有搬走**（`src/app/api/` 一律不動）。這些頁面打到的後端端點
仍然存在，萬一之後要找回來不用重做後端。

`/dashboard/membership` 的 API（`/api/v1/membership`）也還在，
`Sidebar.tsx` 的方案緞帶仍然讀它 —— 那是階段 C（金流改子熙幣）才要處理的。

## 相關文件

`改造計劃-RAG與介面簡化.md`（專案根目錄）