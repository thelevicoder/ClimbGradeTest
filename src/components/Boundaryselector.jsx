import React, { useEffect, useRef, useState, useCallback } from "react";

const imageCache = {};
function loadImage(url) {
  if (imageCache[url]) return Promise.resolve(imageCache[url]);
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imageCache[url] = img; res(img); };
    img.onerror = rej;
    img.src = url;
  });
}

export default function BoundarySelector({ imageUrl, leftBoundary, rightBoundary, onBoundaryChange }) {
  const canvasRef = useRef(null);
  const imgRef    = useRef(null);
  const dragging  = useRef(null); // 'left' | 'right' | null
  const [canvasW, setCanvasW] = useState(1);
  const [canvasH, setCanvasH] = useState(1);

  // Draw image + boundary lines
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.drawImage(img, 0, 0, W, H);

    // Darken areas outside boundaries
    const lx = (leftBoundary  / 100) * W;
    const rx = (rightBoundary / 100) * W;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0,  0, lx, H);          // left excluded zone
    ctx.fillRect(rx, 0, W - rx, H);      // right excluded zone

    // Light overlay on included zone
    ctx.fillStyle = 'rgba(251,146,60,0.05)';
    ctx.fillRect(lx, 0, rx - lx, H);

    // Left boundary line
    ctx.strokeStyle = 'rgba(34,197,94,1)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H); ctx.stroke();

    // Right boundary line
    ctx.strokeStyle = 'rgba(239,68,68,1)';
    ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx, H); ctx.stroke();
    ctx.setLineDash([]);

    // Handle circles
    const handleY = H / 2;
    [[lx, 'rgba(34,197,94,1)', 'L'], [rx, 'rgba(239,68,68,1)', 'R']].forEach(([x, color, label]) => {
      ctx.fillStyle   = color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x, handleY, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle    = '#fff';
      ctx.font         = 'bold 11px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, handleY);
    });

    // Labels
    ctx.font      = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(34,197,94,0.9)';
    ctx.fillText('Left boundary', lx, 18);
    ctx.fillStyle = 'rgba(239,68,68,0.9)';
    ctx.fillText('Right boundary', rx, 18);
  }, [leftBoundary, rightBoundary]);

  // Load image, size canvas
  useEffect(() => {
    loadImage(imageUrl).then(img => {
      imgRef.current = img;
      const container = canvasRef.current?.parentElement;
      if (!container) return;
      const w = container.clientWidth;
      const h = Math.min(w * (img.naturalHeight / img.naturalWidth), 420);
      setCanvasW(w);
      setCanvasH(Math.round(h));
    });
  }, [imageUrl]);

  // Redraw on any change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current || canvasW <= 1) return;
    canvas.width  = canvasW;
    canvas.height = canvasH;
    draw();
  }, [canvasW, canvasH, draw]);

  const getXPct = useCallback((clientX) => {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const px     = (clientX - rect.left) * scaleX;
    return Math.max(0, Math.min(100, (px / canvas.width) * 100));
  }, []);

  const getNearestHandle = useCallback((clientX) => {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const px     = (clientX - rect.left) * scaleX;
    const lx     = (leftBoundary  / 100) * canvas.width;
    const rx     = (rightBoundary / 100) * canvas.width;
    const dL     = Math.abs(px - lx);
    const dR     = Math.abs(px - rx);
    if (dL < 30 && dL <= dR) return 'left';
    if (dR < 30)              return 'right';
    return null;
  }, [leftBoundary, rightBoundary]);

  const onMouseDown = useCallback((e) => {
    const h = getNearestHandle(e.clientX);
    if (h) { dragging.current = h; e.preventDefault(); }
  }, [getNearestHandle]);

  const onMouseMove = useCallback((e) => {
    if (!dragging.current) return;
    const pct = getXPct(e.clientX);
    if (dragging.current === 'left')  onBoundaryChange(Math.min(pct, rightBoundary - 5), rightBoundary);
    if (dragging.current === 'right') onBoundaryChange(leftBoundary, Math.max(pct, leftBoundary + 5));
  }, [getXPct, leftBoundary, rightBoundary, onBoundaryChange]);

  const onMouseUp = useCallback(() => { dragging.current = null; }, []);

  // Touch support
  const onTouchStart = useCallback((e) => {
    const h = getNearestHandle(e.touches[0].clientX);
    if (h) { dragging.current = h; e.preventDefault(); }
  }, [getNearestHandle]);

  const onTouchMove = useCallback((e) => {
    if (!dragging.current) return;
    e.preventDefault();
    const pct = getXPct(e.touches[0].clientX);
    if (dragging.current === 'left')  onBoundaryChange(Math.min(pct, rightBoundary - 5), rightBoundary);
    if (dragging.current === 'right') onBoundaryChange(leftBoundary, Math.max(pct, leftBoundary + 5));
  }, [getXPct, leftBoundary, rightBoundary, onBoundaryChange]);

  const onTouchEnd = useCallback(() => { dragging.current = null; }, []);

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 text-center">
        Drag the <span className="text-green-400 font-semibold">green (L)</span> and <span className="text-red-400 font-semibold">red (R)</span> handles to crop out other routes on the same wall
      </p>
      <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 select-none">
        <canvas
          ref={canvasRef}
          className="w-full block cursor-col-resize"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ touchAction: 'none' }}
        />
      </div>
      <div className="flex gap-3 text-xs">
        <div className="flex-1 rounded-lg px-3 py-2 bg-green-500/10 border border-green-500/30 text-green-400 text-center">
          Left: {Math.round(leftBoundary)}% from left edge
        </div>
        <div className="flex-1 rounded-lg px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-center">
          Right: {Math.round(rightBoundary)}% from left edge
        </div>
      </div>
    </div>
  );
}