import { useEffect, useRef, useState } from 'react';

export default function ProteinFoldViewer({ structure }) {
  const frame = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let sent = false;
    const onMessage = event => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'viewerReady' && !sent) {
        sent = true;
        frame.current.contentWindow.postMessage({ type: 'loadDockingResult', proteinText: structure.text, proteinFormat: structure.format, proteinName: structure.name }, window.location.origin);
      }
      if (event.data?.type === 'resultLoadError') setError('The structure could not be displayed. You can still download it.');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [structure]);
  return <div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <iframe ref={frame} src="/molstar/index.html" title="Predicted structure in Molstar" className="h-[520px] w-full rounded border" onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'requestViewerReady' }, window.location.origin)} />
  </div>;
}
