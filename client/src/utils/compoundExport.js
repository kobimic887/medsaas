// Quote every cell (commas, quotes and line breaks are valid in identifiers).
// The leading apostrophe protects spreadsheet imports without changing the
// stored chemical string. Consumers reading raw CSV can remove that one guard.
export function compoundCsvCell(value) {
  const text = String(value ?? '');
  let start = 0;
  while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/.test(text[start]))) start++;
  const safe = /^[=+\-@]/.test(text.slice(start)) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function compoundOrderCsv(order) {
  const headers = ['ID', 'SMILES', 'Source', 'Pack size (mg)', 'Quantity', 'Unit price (EUR)', 'Unit price (USD)', 'Line total (USD)'];
  const rows = (order.items || []).map((item) => [item.code, item.smiles, item.source || item.catalogSource, item.amountMg, item.quantity, item.eur, (item.unitAmountCents / 100).toFixed(2), ((item.lineTotalCents ?? item.totalCents ?? item.unitAmountCents * item.quantity) / 100).toFixed(2)]);
  return [headers, ...rows].map((row) => row.map(compoundCsvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCompoundCsv(order, filename) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', compoundOrderCsv(order)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
