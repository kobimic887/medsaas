import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import CompoundStructure from '@/components/CompoundStructure';
import { API_CONFIG, getAuthToken } from '@/utils/constants';
import { IS_STAGING_BUILD } from '@/utils/appEnv';
import { basketSignature, isOwnedCartItem, readShopCart, shopMoney, writeShopCart } from '@/utils/compoundShop';
import { requestCompoundCheckout } from '@/utils/compoundCheckout';
import { downloadCompoundCsv } from '@/utils/compoundExport';

function cartSignature(items) {
  try { return basketSignature(items); } catch { return JSON.stringify(items); }
}

export default function ReviewOrder() {
  const navigate = useNavigate();
  const [cart, setCart] = useState(() => readShopCart(localStorage));
  const [reviewed, setReviewed] = useState(null);
  const reviewedRef = useRef(null);
  const requestRef = useRef(null);
  const requestIdRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const signature = cartSignature(cart);
  const quote = reviewed?.signature === signature ? reviewed.quote : null;

  const loadQuoteOrCheckout = async (reviewOnly = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const requestId = ++requestIdRef.current;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setBusy(true);
    setMessage('');
    try {
      const result = await requestCompoundCheckout({ storage: localStorage, reviewed: reviewedRef.current, reviewOnly, signal: controller.signal, buildApiUrl: API_CONFIG.buildApiUrl, authToken: getAuthToken() });
      if (requestId !== requestIdRef.current) return;
      if (result.kind === 'review' || result.kind === 'prices_changed') {
        reviewedRef.current = result.reviewed;
        setReviewed(result.reviewed);
        if (result.kind === 'prices_changed') setMessage('Prices changed. Review the new total, then select Continue to Stripe to accept it.');
      } else if (result.kind === 'expired') {
        reviewedRef.current = null;
        setReviewed(null);
        setMessage('The payment session expired. Your cart is saved. Refresh the quote before starting a new checkout.');
      } else if (result.kind === 'order') navigate(`/dashboard/compound-orders?order_id=${encodeURIComponent(result.orderId)}`);
      else if (result.kind === 'redirect') window.location.href = result.url;
    } catch (error) {
      if (requestId === requestIdRef.current) setMessage(error.name === 'AbortError' ? 'The request timed out. Your cart is saved; please try again.' : error.message);
    } finally {
      window.clearTimeout(timeout);
      if (requestId === requestIdRef.current) { requestRef.current = null; setBusy(false); }
    }
  };

  useEffect(() => {
    const sync = () => {
      const next = readShopCart(localStorage);
      if (cartSignature(next) === cartSignature(cart)) return;
      requestRef.current?.abort();
      ++requestIdRef.current;
      reviewedRef.current = null;
      setReviewed(null);
      setBusy(false);
      setCart(next);
    };
    const onStorage = (event) => { if (event.key === null || event.key === (IS_STAGING_BUILD ? 'pxstg__moleculeCart' : 'moleculeCart')) sync(); };
    window.addEventListener('cartUpdated', sync);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('cartUpdated', sync); window.removeEventListener('storage', onStorage); };
  }, [signature]);

  useEffect(() => {
    reviewedRef.current = null;
    setReviewed(null);
    if (cart.length && cart.every(isOwnedCartItem)) loadQuoteOrCheckout(true);
    else { setBusy(false); setMessage(cart.length ? 'Remove unavailable legacy items before reviewing your order.' : ''); }
    return () => { requestRef.current?.abort(); ++requestIdRef.current; };
  }, [signature]);

  const updateCart = (items) => { writeShopCart(localStorage, items); window.dispatchEvent(new Event('cartUpdated')); };
  const downloadQuote = () => {
    if (!quote || cartSignature(readShopCart(localStorage)) !== reviewedRef.current?.signature) {
      reviewedRef.current = null;
      setReviewed(null);
      setMessage('Your cart changed. Refresh the quote before downloading it.');
      return;
    }
    downloadCompoundCsv(quote, 'pyxis-order-quote.csv');
  };

  return <div className="mx-auto max-w-6xl space-y-6 py-6 text-slate-900 dark:text-slate-100">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-bold">Review order</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Check the structures, packs and server-verified prices before payment.</p></div><Link to="/dashboard/simulation" className="rounded-lg border border-teal-600 px-4 py-2">Find compounds</Link></header>
    {message && <p role="alert" className="rounded-lg border border-amber-400 p-4">{message}</p>}
    {busy && <p role="status">Checking your order…</p>}
    {!cart.length ? <p>Your cart is empty. Add a pack from Home to get started.</p> : <>
      <div className="space-y-3">{cart.map((item, index) => <article key={item.entryId || index} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="min-w-0 flex-1"><strong className="break-all">{item.code || item.name || 'Unavailable item'}</strong><p className="text-sm">{item.catalogSource} · {item.amountMg || item.amount} mg per pack</p><div className="mt-2 flex items-center gap-3"><label className="text-sm">Quantity <select aria-label={`Quantity for ${item.code || item.name}`} value={item.quantity || 1} disabled={busy} onChange={(event) => updateCart(readShopCart(localStorage).map((line) => line.entryId === item.entryId ? { ...line, quantity: Number(event.target.value) } : line))} className="ml-2 rounded border bg-white p-2 text-slate-900">{Array.from({ length: 10 }, (_, n) => <option key={n + 1}>{n + 1}</option>)}</select></label><button type="button" disabled={busy} className="text-sm text-red-700 underline dark:text-red-300" onClick={() => updateCart(readShopCart(localStorage).filter((_, lineIndex) => lineIndex !== index))}>Remove</button></div></div>
      </article>)}</div>
      {quote && <section aria-label="Verified order quote" className="space-y-4 rounded-xl border border-teal-500 p-4">
        <h2 className="text-xl font-semibold">Verified order quote</h2>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Structure</th><th className="p-2">Compound</th><th className="p-2">Pack</th><th className="p-2">Quantity</th><th className="p-2">Unit EUR / USD</th><th className="p-2">Total USD</th></tr></thead><tbody>{quote.items.map((item) => <tr key={item.key || `${item.source}:${item.rowId}:${item.amountMg}`} className="border-t border-slate-200 dark:border-slate-700"><td className="p-2"><CompoundStructure smiles={item.smiles} code={item.code} /></td><td className="p-2"><strong>{item.code}</strong><p>{item.source}{item.source === 'virtual' ? ' · made to order' : ''}</p><details className="mt-2"><summary className="cursor-pointer">SMILES</summary><p className="max-w-sm break-all font-mono text-xs">{item.smiles}</p></details></td><td className="p-2">{item.amountMg} mg</td><td className="p-2">{item.quantity}</td><td className="p-2">€{item.eur} / {shopMoney(item.unitAmountCents)}</td><td className="p-2">{shopMoney(item.lineTotalCents ?? item.totalCents ?? item.unitAmountCents * item.quantity)}</td></tr>)}</tbody></table></div>
        <p className="text-lg font-bold">Order total: {shopMoney(quote.totalCents)} USD</p>
        <p>{quote.shippingNote || quote.config?.shippingNote || 'Shipping is included in listed USD prices.'}</p>
        <p>Your card will be charged when you pay in Stripe. Fulfillment is confirmed separately.</p>
        <button type="button" disabled={busy} onClick={downloadQuote} className="rounded-lg border border-teal-600 px-4 py-2">Download quote CSV</button>
        <p className="text-xs text-slate-600 dark:text-slate-300">For approval before checkout. Offers expire 24 hours after search; prices and availability are rechecked at checkout. Spreadsheet-sensitive fields receive a leading apostrophe in the CSV; remove that guard when reading raw SMILES.</p>
      </section>}
      <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || cart.some((item) => !isOwnedCartItem(item))} onClick={() => loadQuoteOrCheckout(true)} className="rounded-lg border border-teal-600 px-4 py-2">Refresh quote</button><button type="button" disabled={busy || !quote} onClick={() => loadQuoteOrCheckout()} className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Continue to Stripe</button></div>
      <p className="text-sm">Up to 3 distinct compounds per order. Payment happens only after you continue to Stripe and complete checkout.</p>
    </>}
  </div>;
}
