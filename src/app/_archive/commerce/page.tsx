"use client";

import { useState } from "react";
import { Plus, Trash2, Package, ShoppingCart, Save } from "lucide-react";
import { Loading, ErrorBox, useAsync } from "@/components/ui";

/**
 * Merchandise store admin.
 *
 * Markup mirrors livio's `.commerce-admin-*` family: an access banner, a
 * collapsible create form, product cards with a media column, and an orders
 * split into a list plus a detail pane.
 */

type Product = {
  id: string; name: string; description: string; price: number;
  currency: string; stock: number; imageUrl: string; active: boolean;
};
type Order = {
  id: string; buyerName: string; quantity: number; amount: number;
  status: string; createdAt: string; product: { name: string } | null;
};

const emptyDraft = { id: "", name: "", description: "", price: 0, stock: -1, imageUrl: "", active: true };

const STATUS_LABEL: Record<string, string> = {
  pending: "待出貨", paid: "已付款", shipped: "已出貨", cancelled: "已取消",
};

export default function CommercePage() {
  const [draft, setDraft] = useState(emptyDraft);
  const [tab, setTab] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync<{ products: Product[]; orders: Order[] }>(
    () => fetch("/api/v1/commerce").then((r) => { if (!r.ok) throw new Error("載入失敗"); return r.json(); }),
    []
  );

  const products = data?.products ?? [];
  const allOrders = data?.orders ?? [];
  const orders = allOrders.filter((o) => !tab || o.status === tab);
  const revenue = allOrders.filter((o) => o.status !== "cancelled").reduce((a, o) => a + o.amount, 0);
  const activeCount = products.filter((p) => p.active).length;
  const detail = orders.find((o) => o.id === selected) ?? orders[0] ?? null;

  const call = async (payload: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/v1/commerce", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`操作失敗 (${res.status})`);
      await reload();
      setDraft(emptyDraft);
    } catch (e: any) { setErr(e?.message || "操作失敗"); }
    finally { setBusy(false); }
  };

  return (
    <div className="commerce-admin-sections">
      <section className="commerce-admin-hero">
        <h1>周邊商店</h1>
        <p className="subtitle">
          經營實體周邊與數位商品。商品會顯示在公開斗內頁，觀眾下單後訂單出現在右側清單，由你手動更新出貨狀態。
        </p>
      </section>

      {error && <ErrorBox message={error} />}
      {err && <ErrorBox message={err} />}

      <section className={`commerce-admin-access ${activeCount ? "is-ready" : "is-blocked"}`}>
        <div>
          <h2>{activeCount ? `${activeCount} 項商品上架中` : "目前沒有上架商品"}</h2>
          <p>
            {activeCount
              ? `共 ${products.length} 項商品，累計營收 NT$ ${revenue.toLocaleString()}。`
              : "上架至少一項商品後，觀眾才能在斗內頁購買。"}
          </p>
        </div>
        <span className="commerce-admin-status status-active">
          {products.length} 項商品 · {allOrders.length} 筆訂單
        </span>
      </section>

      <div className="commerce-admin-sections">
        {/* ------------------------------------------------ products */}
        <section className="commerce-admin-section">
          <div className="commerce-admin-section-heading">
            <div>
              <h2>商品管理</h2>
              <p>編輯會即時反映在公開斗內頁。</p>
            </div>
            <span className="commerce-admin-status status-active">
              <Package size={14} /> {activeCount} 上架 / {products.length - activeCount} 下架
            </span>
          </div>

          <details className="commerce-admin-create" open={Boolean(draft.id)}>
            <summary>{draft.id ? "編輯商品" : "新增商品"}</summary>
            <div className="commerce-admin-form">
              <div className="commerce-admin-form-grid">
                <label className="field">
                  <span>商品名稱</span>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：頻道 LOGO 馬克杯" />
                </label>
                <label className="field">
                  <span>售價 (TWD)</span>
                  <input type="number" min={0} value={draft.price} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} />
                </label>
                <label className="field commerce-admin-wide">
                  <span>商品描述</span>
                  <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  <small>會顯示在斗內頁的商品名稱下方。</small>
                </label>
                <label className="field">
                  <span>庫存</span>
                  <input type="number" min={-1} value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: Number(e.target.value) })} />
                  <small>-1 代表無限制。</small>
                </label>
                <label className="field">
                  <span>上架販售</span>
                  <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                  <small>取消勾選會從斗內頁隱藏，但不會刪除訂單紀錄。</small>
                </label>
              </div>

              <div className="commerce-admin-image-form">
                <label className="field">
                  <span>圖片網址</span>
                  <input value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} placeholder="https://…" />
                  <small>商品列表的縮圖，建議使用正方形圖片。</small>
                </label>
                <div className="action-row">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || !draft.name.trim()}
                    onClick={() => call({ _meta: draft.id ? "updateProduct" : "addProduct", ...draft })}
                  >
                    <Save size={15} /> {draft.id ? "儲存變更" : "新增商品"}
                  </button>
                  {draft.id && (
                    <button type="button" className="ghost-button" onClick={() => setDraft(emptyDraft)}>
                      取消編輯
                    </button>
                  )}
                </div>
              </div>
            </div>
          </details>

          {loading ? (
            <Loading />
          ) : products.length === 0 ? (
            <div className="commerce-admin-empty">
              <h2>還沒有商品</h2>
              <p>用上面的表單新增第一項商品。</p>
            </div>
          ) : (
            <div className="commerce-admin-product-list">
              {products.map((p) => (
                <article key={p.id} className="commerce-admin-product-card">
                  <div className="commerce-admin-product-media">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <Package size={40} />}
                  </div>
                  <div className="commerce-admin-product-body">
                    <div className="commerce-admin-section-heading">
                      <div>
                        <h3>{p.name}</h3>
                        {p.description && <p>{p.description}</p>}
                      </div>
                      <div className="commerce-admin-order-badges">
                        <span className={`commerce-admin-status ${p.active ? "status-active" : "status-archived"}`}>
                          {p.active ? "上架中" : "已下架"}
                        </span>
                      </div>
                    </div>

                    <dl className="commerce-admin-payment-summary">
                      <div>
                        <dt>售價</dt>
                        <dd>NT$ {p.price.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>庫存</dt>
                        <dd>{p.stock < 0 ? "無限制" : p.stock}</dd>
                      </div>
                    </dl>

                    <div className="commerce-admin-image-form">
                      <p className="settings-note">
                        {p.imageUrl ? "縮圖已設定。" : "尚未設定縮圖，會顯示預設圖示。"}
                      </p>
                      <div className="action-row">
                        <button type="button" className="ghost-button" onClick={() => setDraft({ ...p })}>
                          編輯
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={busy}
                          onClick={() => call({ _meta: "deleteProduct", id: p.id })}
                        >
                          <Trash2 size={14} /> 刪除
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* ------------------------------------------------ orders */}
        <section className="commerce-admin-store-panel">
          <div className="commerce-admin-section-heading">
            <div>
              <h2>訂單</h2>
              <p>出貨狀態由你手動更新，沒有自動通知觀眾。</p>
            </div>
            <span className="commerce-admin-status status-active">
              <ShoppingCart size={14} /> {orders.length} 筆
            </span>
          </div>

          <div className="commerce-admin-order-list" style={{ marginBottom: 14 }}>
            <div className="action-row">
              {[{ v: "", l: "全部" }, { v: "pending", l: "待出貨" }, { v: "paid", l: "已付款" }, { v: "shipped", l: "已出貨" }, { v: "cancelled", l: "已取消" }].map((t) => (
                <button
                  key={t.v}
                  type="button"
                  className={`commerce-admin-status ${tab === t.v ? "status-active" : "status-archived"}`}
                  onClick={() => { setTab(t.v); setSelected(null); }}
                >
                  {t.l}
                </button>
              ))}
            </div>

            {orders.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`commerce-admin-order-row ${detail?.id === o.id ? "is-selected" : ""}`}
                onClick={() => setSelected(o.id)}
              >
                <span>
                  <strong>{o.buyerName || "匿名"}</strong>
                  <small>
                    {o.product?.name ?? "已下架商品"} × {o.quantity} ·{" "}
                    {new Date(o.createdAt).toLocaleDateString("zh-TW")}
                  </small>
                </span>
                <span>
                  <strong>NT$ {o.amount.toLocaleString()}</strong>
                  <small>{STATUS_LABEL[o.status] ?? o.status}</small>
                </span>
              </button>
            ))}

            {orders.length === 0 && (
              <div className="commerce-admin-order-empty">
                <p>沒有符合條件的訂單。</p>
              </div>
            )}
          </div>

          {detail ? (
            <div className="commerce-admin-order-detail">
              <div className="commerce-admin-order-summary">
                <div>
                  <h4>訂單內容</h4>
                  <div className="commerce-admin-order-items">
                    <p>{detail.product?.name ?? "已下架商品"} × {detail.quantity}</p>
                    <p>NT$ {detail.amount.toLocaleString()}</p>
                  </div>
                </div>
                <div className="commerce-admin-payment-summary">
                  <dl>
                    <div>
                      <dt>訂單者</dt>
                      <dd>{detail.buyerName || "匿名"}</dd>
                    </div>
                    <div>
                      <dt>下單時間</dt>
                      <dd>{new Date(detail.createdAt).toLocaleString("zh-TW")}</dd>
                    </div>
                    <div>
                      <dt>目前狀態</dt>
                      <dd>{STATUS_LABEL[detail.status] ?? detail.status}</dd>
                    </div>
                    <div>
                      <dt>訂單編號</dt>
                      <dd>{detail.id}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="action-row">
                <label className="field">
                  <span>更新出貨狀態</span>
                  <select
                    value={detail.status}
                    disabled={busy}
                    onChange={(e) => call({ _meta: "setOrderStatus", id: detail.id, status: e.target.value })}
                  >
                    {Object.entries(STATUS_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={busy}
                  onClick={() => call({ _meta: "deleteOrder", id: detail.id })}
                >
                  <Trash2 size={14} /> 刪除訂單
                </button>
              </div>

              <p className="settings-note" style={{ marginTop: 12 }}>
                刪除訂單會永久移除紀錄，無法復原。
              </p>
            </div>
          ) : (
            !loading && (
              <div className="commerce-admin-order-empty">
                <p>選取左側任一訂單查看詳細內容。</p>
              </div>
            )
          )}

          <div className="commerce-admin-reconciliation">
            <h4>對帳提醒</h4>
            <p>
              本頁只顯示資料庫中的訂單。若觀眾已付款但這裡沒有對應訂單，代表金流或斗內 webhook 尚未接上，
              請勿手動建立訂單來「補帳」。
            </p>
          </div>
        </section>
      </div>

      <p className="settings-note" style={{ textAlign: "center" }}>
        <Plus size={13} /> 商品上架後會出現在你的公開斗內頁。
      </p>
    </div>
  );
}
