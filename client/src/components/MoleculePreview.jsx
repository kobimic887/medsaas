import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  moleculePreviewCache,
  moleculePreviewKey,
} from '@/utils/moleculePreview';

export function MoleculePreview({ smiles, width = PREVIEW_WIDTH, height = PREVIEW_HEIGHT, cache = moleculePreviewCache }) {
  const key = moleculePreviewKey(smiles, { width, height });
  const [preview, setPreview] = useState(() => ({ key, src: cache.peek(smiles, { width, height }) }));
  // Switching structures replaces state before paint, so a previous molecule's
  // image (or its late-arriving render) can never be shown under a new SMILES.
  let current = preview;
  if (preview.key !== key) {
    current = { key, src: cache.peek(smiles, { width, height }) };
    setPreview(current);
  }

  useEffect(() => {
    const cached = cache.peek(smiles, { width, height });
    if (cached) {
      setPreview(previous => (previous.key === key && previous.src === cached ? previous : { key, src: cached }));
      return undefined;
    }
    let cancelled = false;
    cache.load(smiles, { width, height }).then(
      src => { if (!cancelled) setPreview({ key, src }); },
      () => { if (!cancelled) setPreview({ key, failed: true }); },
    );
    return () => { cancelled = true; };
  }, [cache, key, smiles, width, height]);

  return (
    <div
      className="flex items-center justify-center rounded border border-gray-200 bg-white"
      style={{ width, height }}
      data-preview-state={current.src ? 'ready' : current.failed ? 'error' : 'loading'}
    >
      {current.src ? (
        <img src={current.src} width={width} height={height} alt="2D molecule structure" />
      ) : (
        <span role="status" className="px-2 text-center text-xs text-gray-600">
          {current.failed ? 'Structure preview unavailable' : 'Drawing structure…'}
        </span>
      )}
    </div>
  );
}

const TOOLTIP_WIDTH = PREVIEW_WIDTH + 28; // Drawing width plus padding and border

function exactSmiles(smiles) {
  const trimmed = typeof smiles === 'string' ? smiles.trim() : '';
  return trimmed && trimmed !== 'N/A' ? trimmed : '';
}

function previewPosition(element) {
  const rect = element.getBoundingClientRect();
  // Show on the right if there is space, otherwise on the left.
  let x = rect.right + 10;
  if (x + TOOLTIP_WIDTH > window.innerWidth) x = rect.left - TOOLTIP_WIDTH - 10;
  return {
    x: Math.max(10, x),
    y: Math.max(130, Math.min(window.innerHeight - 130, rect.top + rect.height / 2)),
  };
}

// Hover and keyboard focus show a transient preview. A dedicated trigger's
// click/tap/Enter pins it, so touch users can see a structure without hover.
// Escape, a second activation, pressing elsewhere, scrolling or moving focus
// away closes a pinned preview.
export function useStructurePreview() {
  const tooltipId = useId();
  const [preview, setPreview] = useState(null);
  const previewRef = useRef(null);
  const triggerRef = useRef(null);
  const update = useCallback(next => {
    previewRef.current = next;
    setPreview(next);
  }, []);
  const open = useCallback((smiles, element, label, pinned) => {
    triggerRef.current = element;
    update({ smiles, label, pinned, ...previewPosition(element) });
  }, [update]);

  const show = useCallback((smiles, event, label) => {
    const exact = exactSmiles(smiles);
    if (!exact || previewRef.current?.pinned) return;
    open(exact, event.currentTarget, label, false);
  }, [open]);
  const hide = useCallback(() => {
    if (!previewRef.current?.pinned) update(null);
  }, [update]);
  const close = useCallback(() => update(null), [update]);
  const toggle = useCallback((smiles, event, label) => {
    const exact = exactSmiles(smiles);
    if (!exact) return;
    const current = previewRef.current;
    if (current?.pinned && current.smiles === exact && current.label === label) close();
    else open(exact, event.currentTarget, label, true);
  }, [close, open]);

  const isOpen = Boolean(preview);
  useEffect(() => {
    if (!isOpen) return undefined;
    // Focus can scroll its row into view. Keep transient previews beside that
    // row; pinned previews dismiss on scroll. Never leave a tooltip at old coordinates.
    const onScroll = () => {
      const current = previewRef.current;
      if (!current) return;
      const trigger = triggerRef.current;
      if (current.pinned || !trigger?.isConnected) { close(); return; }
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) { close(); return; }
      update({ ...current, ...previewPosition(trigger) });
    };
    const onKeyDown = event => { if (event.key === 'Escape') close(); };
    const onPointerDown = event => {
      if (!triggerRef.current?.contains(event.target)) close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [isOpen, close, update]);

  // Props for a dedicated preview trigger (a button whose click does nothing
  // else). `hover: false` leaves hover to an enclosing element that already
  // shows the same preview, so leaving the button does not hide it.
  const triggerProps = (smiles, label, { hover = true } = {}) => {
    const exact = exactSmiles(smiles);
    const expanded = Boolean(exact && preview?.smiles === exact && preview.label === label);
    return {
      'aria-expanded': expanded,
      'aria-describedby': expanded ? tooltipId : undefined,
      // Touch must not fire hover: emulated mouseenter would show the tooltip
      // before the tap's click and make the click close it (or iOS drop it).
      ...(hover && {
        onPointerEnter: event => { if (event.pointerType !== 'touch') show(smiles, event, label); },
        onPointerLeave: event => { if (event.pointerType !== 'touch') hide(); },
      }),
      onFocus: event => show(smiles, event, label),
      onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); },
      onClick: event => toggle(smiles, event, label),
    };
  };

  return { preview, tooltipId, show, hide, close, toggle, triggerProps };
}

export function MoleculePreviewTooltip({ preview, id }) {
  if (!preview) return null;
  return (
    <div
      id={id}
      role="tooltip"
      data-pinned={preview.pinned ? 'true' : undefined}
      className="pointer-events-none fixed z-50 bg-white border-2 border-gray-300 rounded-lg p-3 shadow-lg"
      style={{
        left: `${preview.x}px`,
        top: `${preview.y}px`,
        width: `${TOOLTIP_WIDTH}px`,
        transform: 'translateY(-50%)',
        maxWidth: 'calc(100vw - 20px)',
      }}
    >
      <div className="text-xs text-gray-600 mb-2 font-medium">
        {preview.label} Preview
      </div>
      <MoleculePreview smiles={preview.smiles} />
      <div className="text-xs text-gray-500 mt-2 font-mono break-all">
        {preview.smiles.length > 25 ? `${preview.smiles.substring(0, 25)}...` : preview.smiles}
      </div>
    </div>
  );
}
