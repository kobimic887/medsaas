import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { API_CONFIG, getAuthToken } from '@/utils/constants';
import { cartAfterConfirmedOrder, readShopCart, writeShopCart, shopMoney } from '@/utils/compoundShop';

const STATUS_LABELS = { awaiting_payment: 'Awaiting payment', pending: 'Awaiting payment', checkout_pending: 'Awaiting payment', paid: 'Paid', payment_authorized: 'Payment authorized', canceled: 'Canceled', expired: 'Checkout expired', payment_failed: 'Payment failed', refunded: 'Refunded' };
export default function CompoundOrders() {
  const { search } = useLocation();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const params = new URLSearchParams(search);
  const canceled = params.get('canceled') === 'true';
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    let attempts = 0;
    const query = new URLSearchParams(search);
    const orderId = query.get('order_id');
    const sessionId = query.get('session_id');
    const load = async () => {
      try {
        let returnedOrder;
        if (orderId) {
          const response = await fetch(API_CONFIG.buildApiUrl(`/compound-shop/orders/${encodeURIComponent(orderId)}${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`), { signal: controller.signal, headers: { Authorization: `Bearer ${getAuthToken()}` } });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'Unable to verify your order.');
          returnedOrder = body.order || body;
          const items = readShopCart(localStorage);
          let snapshot = [];
          try { snapshot = JSON.parse(localStorage.getItem(`compoundOrderCart:${orderId}`) || '[]'); } catch { /* keep cart */ }
          const remaining = cartAfterConfirmedOrder(items, returnedOrder, Array.isArray(snapshot) ? snapshot : []);
          if (remaining.length !== items.length) {
            writeShopCart(localStorage, remaining);
            window.dispatchEvent(new Event('cartUpdated'));
          }
        }
        const response = await fetch(API_CONFIG.buildApiUrl('/compound-shop/orders'), { signal: controller.signal, headers: { Authorization: `Bearer ${getAuthToken()}` } });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to load compound orders.');
        if (controller.signal.aborted) return;
        const loaded = Array.isArray(body.orders) ? body.orders : [];
        const returnedId = returnedOrder?.orderId || returnedOrder?.id || returnedOrder?._id;
        setOrders(returnedOrder ? [returnedOrder, ...loaded.filter((order) => (order.orderId || order.id || order._id) !== returnedId)] : loaded);
        setError('');
        if (sessionId && returnedOrder && !['paid', 'payment_authorized', 'canceled', 'expired', 'payment_failed', 'refunded'].includes(returnedOrder.status) && attempts++ < 10) timer = window.setTimeout(load, 3000);
      } catch (error) { if (error.name !== 'AbortError') setError(error.message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [search, refresh]);
  return <main className="mx-auto max-w-6xl space-y-6 py-6 text-slate-900 dark:text-slate-100">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-3xl font-bold">Compound orders</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Payment and fulfillment for your Pyxis compound purchases.</p></div>
      <div className="flex gap-3"><Link to="/dashboard/simulation" className="rounded-lg border border-teal-600 px-4 py-2">Find compounds</Link><button type="button" onClick={() => { setLoading(true); setRefresh((value) => value + 1); }} className="rounded-lg bg-teal-700 px-4 py-2 text-white">Refresh orders</button></div>
    </header>
    {canceled && <p role="status" className="rounded-lg border border-amber-400 p-4">Checkout was canceled. Your cart is still saved.</p>}
    {error && <p role="alert" className="rounded-lg border border-red-400 p-4 text-red-700 dark:text-red-300">{error}</p>}
    {loading && <p role="status">Loading orders…</p>}
    {!loading && !error && !orders.length && <p className="rounded-xl border border-slate-300 p-6 dark:border-slate-700">No compound orders yet. Choose a pack in the catalog and review your cart to get started.</p>}
    {orders.map((order) => <article key={order.orderId || order.id || order._id} className="space-y-4 rounded-xl border border-slate-300 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <header className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h2 className="break-all font-semibold">Order {order.orderId || order.id || order._id}</h2><p className="text-sm text-slate-500 dark:text-slate-400">{order.createdAt ? new Date(order.createdAt).toLocaleString() : ''}</p></div><strong>{STATUS_LABELS[order.status] || String(order.status || 'Awaiting payment').replaceAll('_', ' ')}</strong></header>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="py-2">Compound</th><th>Pack</th><th>Quantity</th><th className="text-right">Total USD</th></tr></thead><tbody>
        {(order.items || []).map((item, index) => <tr key={index} className="border-b border-slate-100 dark:border-slate-800"><td className="py-3">{item.code}</td><td>{item.amountMg} mg</td><td>{item.quantity}</td><td className="text-right">{shopMoney(item.lineTotalCents ?? item.totalCents ?? item.unitAmountCents * item.quantity)}</td></tr>)}
      </tbody></table></div>
      <div className="flex flex-wrap justify-between gap-3"><p>Fulfillment: {String(order.fulfillmentStatus || 'pending').replaceAll('_', ' ')}</p><strong>{shopMoney(order.totalCents)} USD</strong></div>
      <p className="text-sm text-slate-600 dark:text-slate-300">{order.shippingNote}</p>
      {order.status === 'payment_authorized' && <p className="text-sm">Your card has been authorized. Payment has not yet been captured.</p>}
      {order.status === 'paid' && <p className="text-sm">Payment received. Fulfillment and delivery confirmation follow separately.</p>}
    </article>)}
  </main>;
}
