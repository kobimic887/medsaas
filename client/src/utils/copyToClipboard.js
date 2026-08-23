/**
 * Copy text even when the first Clipboard API write is rejected.
 *
 * That first-click NotAllowedError is common on Simulation: Ketcher's iframe
 * holds document focus, so navigator.clipboard.writeText fails once, then
 * later clicks work. Always fall through to execCommand instead of surfacing
 * "SMILES could not be copied."
 */
export function copyWithExecCommand(text, doc = document) {
  const textarea = doc.createElement('textarea');
  textarea.value = String(text ?? '');
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.opacity = '0';
  doc.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  if (typeof textarea.setSelectionRange === 'function') {
    textarea.setSelectionRange(0, textarea.value.length);
  }
  try {
    const ok = doc.execCommand('copy');
    if (!ok) throw new Error('execCommand copy failed');
  } finally {
    textarea.remove();
  }
}

export async function copyToClipboard(text, env = globalThis) {
  const value = String(text ?? '');
  if (!value) throw new Error('Nothing to copy');

  const win = env.window ?? env;
  try {
    win.focus?.();
  } catch {
    // Some embedded contexts reject window.focus(); still try to copy.
  }

  const nav = env.navigator ?? win.navigator;
  const secure = win.isSecureContext === true;
  if (nav?.clipboard?.writeText && secure) {
    try {
      await nav.clipboard.writeText(value);
      return;
    } catch {
      // Fall through: first gesture after an iframe click often fails here.
    }
  }

  copyWithExecCommand(value, env.document ?? win.document);
}
