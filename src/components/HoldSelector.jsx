import React, { useEffect, useRef, useState, useCallback } from "react";

const UNSELECTED  = { stroke: 'rgba(251,146,60,0.85)', fill: 'rgba(251,146,60,0.15)', text: 'rgba(255,255,255,0.9)' };
const START_COLOR = { stroke: 'rgba(34,197,94,1)',      fill: 'rgba(34,197,94,0.25)',  text: '#fff' };
const END_COLOR   = { stroke: 'rgba(239,68,68,1)',      fill: 'rgba(239,68,68,0.25)',  text: '#fff' };

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

export default function HoldSelector({
  imageUrl, holds, wallTopY, wallBottomY,
  startIndices, endIndices, onStartChange, onEndChange,
}) {
  const canvasRef = useRef(null);
  const imgRef    = useRef(null);
  const [mode,    setMode]    = useState('start');
  const [aspect,  setAspect]  = useState(0.75); // h/w ratio for wrapper
  const [ready,   setReady]   = useState(false);

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;

    const CW = canvas.width;
    const CH = canvas.height;
    const ctx = canvas.getContext('2d');

    // Source: full width, cropped to wall slice vertically
    const srcY = (wallTopY  / 100) * img.naturalHeight;
    const srcH = ((wallBottomY - wallTopY) / 100) * img.naturalHeight;
    ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, 0, CW, CH);

    // Dim
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, CW, CH);

    // Circles
    holds.forEach((hold, i) => {
      const isStart = startIndices.includes(i);
      const isEnd   = endIndices.includes(i);
      const C       = isStart ? START_COLOR : isEnd ? END_COLOR : UNSELECTED;

      const cx = (hold.x / 100) * CW;
      const cy = ((hold.y - wallTopY) / (wallBottomY - wallTopY)) * CH;
      const rx = Math.max((hold.width  / 100) * CW / 2 + 5, 12);
      const ry = Math.max((hold.height / 100) * CH / 2 + 5, 10);

      ctx.strokeStyle = C.stroke;
      ctx.fillStyle   = C.fill;
      ctx.lineWidth   = isStart || isEnd ? 2.5 : 1.5;
      ctx.setLineDash(isStart || isEnd ? [] : [5, 3]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle    = C.text;
      ctx.font         = `bold ${isStart || isEnd ? 12 : 10}px sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isStart ? 'S' : isEnd ? 'F' : String(i + 1), cx, cy);
    });
  }, [holds, wallTopY, wallBottomY, startIndices, endIndices]);

  // ── Load image, compute aspect ratio, then draw ────────────────────────
  useEffect(() => {
    setReady(false);
    loadImage(imageUrl).then(img => {
      imgRef.current = img;
      const srcH   = img.naturalHeight * (wallBottomY - wallTopY) / 100;
      const srcW   = img.naturalWidth;
      const ratio  = srcH / srcW; // height / width

      setAspect(ratio);

      // Size canvas to reasonable pixel resolution (max 800w)
      const CW = Math.min(800, img.naturalWidth);
      const CH = Math.round(CW * ratio);
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width  = CW;
        canvas.height = CH;
      }
      setReady(true);
    });
  }, [imageUrl, wallTopY, wallBottomY]);

  // Redraw whenever state changes
  useEffect(() => { if (ready) draw(); }, [ready, draw]);

  // ── Hit detection ──────────────────────────────────────────────────────
  const findNearest = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const tx = (clientX - rect.left)  * scaleX;
    const ty = (clientY - rect.top)   * scaleY;
    const span = wallBottomY - wallTopY;
    let best = -1, bestD = Infinity;
    holds.forEach((h, i) => {
      const cx = (h.x / 100) * canvas.width;
      const cy = ((h.y - wallTopY) / span) * canvas.height;
      const d  = Math.sqrt((tx-cx)**2 + (ty-cy)**2);
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD <= 50 ? best : -1;
  }, [holds, wallTopY, wallBottomY]);

  const handleClick = useCallback((e) => {
    const idx = findNearest(e.clientX, e.clientY);
    if (idx === -1) return;
    if (mode === 'start') {
      if (startIndices.includes(idx)) onStartChange(startIndices.filter(i => i !== idx));
      else if (startIndices.length < 2) onStartChange([...startIndices, idx]);
      else onStartChange([startIndices[1], idx]);
    } else {
      if (endIndices.includes(idx)) onEndChange(endIndices.filter(i => i !== idx));
      else if (endIndices.length < 2) onEndChange([...endIndices, idx]);
      else onEndChange([endIndices[1], idx]);
    }
  }, [findNearest, mode, startIndices, endIndices, onStartChange, onEndChange]);

  const handleTouch = useCallback((e) => {
    e.preventDefault();
    handleClick({ clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY });
  }, [handleClick]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {[
          { key:'start', label:'🟢 Set Start Holds', count:startIndices.length, ac:'bg-green-500/20 border-green-500 text-green-400' },
          { key:'end',   label:'🔴 Set Finish Hold',  count:endIndices.length,   ac:'bg-red-500/20 border-red-500 text-red-400' },
        ].map(b => (
          <button key={b.key} onClick={() => setMode(b.key)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${mode===b.key ? b.ac : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}>
            {b.label} <span className="ml-1 text-xs opacity-70">({b.count}/2)</span>
          </button>
        ))}
      </div>

      <p className="text-xs text-zinc-500 text-center">
        {mode==='start' ? 'Tap up to 2 start holds (green). Two-hand start = tap both.'
                        : 'Tap the finish hold (red). Tap a second for a match finish.'}
      </p>

      {/* Aspect-ratio wrapper — bulletproof, no distortion */}
      <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 cursor-crosshair"
           style={{ paddingBottom: `${(aspect * 100).toFixed(2)}%` }}>
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          onTouchEnd={handleTouch}
          style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%' }}
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin"/>
          </div>
        )}
      </div>

      <div className="flex gap-3 text-xs">
        <div className={`flex-1 rounded-lg px-3 py-2 border ${startIndices.length>0 ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
          <span className="font-semibold">Start: </span>
          {startIndices.length===0 ? 'Not set' : startIndices.length===1 ? `Hold ${startIndices[0]+1}` : `Holds ${startIndices[0]+1} & ${startIndices[1]+1} (two-hand)`}
        </div>
        <div className={`flex-1 rounded-lg px-3 py-2 border ${endIndices.length>0 ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
          <span className="font-semibold">Finish: </span>
          {endIndices.length===0 ? 'Not set' : endIndices.length===1 ? `Hold ${endIndices[0]+1}` : `Holds ${endIndices[0]+1} & ${endIndices[1]+1} (match)`}
        </div>
      </div>
    </div>
  );
}