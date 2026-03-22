import React, { useEffect, useRef, useState, useCallback } from "react";

const UNSELECTED  = { stroke: 'rgba(251,146,60,0.8)',  fill: 'rgba(251,146,60,0.15)',  text: 'rgba(255,255,255,0.9)' };
const START_COLOR = { stroke: 'rgba(34,197,94,1)',      fill: 'rgba(34,197,94,0.25)',   text: '#fff' };
const END_COLOR   = { stroke: 'rgba(239,68,68,1)',      fill: 'rgba(239,68,68,0.25)',   text: '#fff' };

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
  const canvasRef  = useRef(null);
  const imgRef     = useRef(null);
  const sizeRef    = useRef({ w: 1, h: 1 }); // actual canvas pixel dimensions
  const [mode, setMode]       = useState('start');
  const [ready, setReady]     = useState(false);

  // ── Draw everything ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;

    const { w: CW, h: CH } = sizeRef.current;
    canvas.width  = CW;
    canvas.height = CH;
    const ctx = canvas.getContext('2d');

    // Source crop: full width, wall slice only
    const srcY = (wallTopY  / 100) * img.naturalHeight;
    const srcH = ((wallBottomY - wallTopY) / 100) * img.naturalHeight;
    ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, 0, CW, CH);

    // Slight dim
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, CW, CH);

    // Hold circles
    holds.forEach((hold, i) => {
      const isStart = startIndices.includes(i);
      const isEnd   = endIndices.includes(i);
      const C       = isStart ? START_COLOR : isEnd ? END_COLOR : UNSELECTED;

      // X: direct % of full image width → same % of canvas width (no crop horizontally)
      const cx = (hold.x / 100) * CW;
      // Y: hold.y is % of full image height, need to remap into cropped wall slice
      const wallSpan = wallBottomY - wallTopY;
      const cy = ((hold.y - wallTopY) / wallSpan) * CH;

      // Radius based on hold pixel size
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

      // Label
      ctx.fillStyle    = C.text;
      ctx.font         = `bold ${isStart || isEnd ? 12 : 10}px sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isStart ? 'S' : isEnd ? 'F' : String(i + 1), cx, cy);
    });
  }, [holds, wallTopY, wallBottomY, startIndices, endIndices]);

  // ── Size canvas correctly (no distortion) ─────────────────────────────────
  useEffect(() => {
    loadImage(imageUrl).then(img => {
      imgRef.current = img;
      const container = canvasRef.current?.parentElement;
      if (!container) return;

      // The cropped wall slice has this aspect ratio:
      const srcW      = img.naturalWidth;
      const srcH      = img.naturalHeight * (wallBottomY - wallTopY) / 100;
      const aspect    = srcH / srcW; // height / width

      // Fit into container, max height 550px — scale BOTH dimensions together
      const maxW = container.clientWidth;
      const maxH = 550;
      let w = maxW;
      let h = w * aspect;
      if (h > maxH) { h = maxH; w = h / aspect; }

      sizeRef.current = { w: Math.round(w), h: Math.round(h) };
      setReady(true); // trigger redraw
    });
  }, [imageUrl, wallTopY, wallBottomY]);

  // Redraw whenever state changes
  useEffect(() => {
    if (ready) draw();
  }, [ready, draw]);

  // ── Hit detection ─────────────────────────────────────────────────────────
  const findNearestHold = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect   = canvas.getBoundingClientRect();
    // Map from CSS pixels → canvas pixels
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const tapX   = (clientX - rect.left) * scaleX;
    const tapY   = (clientY - rect.top)  * scaleY;

    const wallSpan = wallBottomY - wallTopY;
    let closest = -1, closestDist = Infinity;
    holds.forEach((hold, i) => {
      const cx = (hold.x / 100) * canvas.width;
      const cy = ((hold.y - wallTopY) / wallSpan) * canvas.height;
      const dist = Math.sqrt((tapX - cx) ** 2 + (tapY - cy) ** 2);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    });
    return closestDist <= 45 ? closest : -1;
  }, [holds, wallTopY, wallBottomY]);

  const handleClick = useCallback((e) => {
    const idx = findNearestHold(e.clientX, e.clientY);
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
  }, [findNearestHold, mode, startIndices, endIndices, onStartChange, onEndChange]);

  const handleTouch = useCallback((e) => {
    e.preventDefault();
    handleClick({ clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY });
  }, [handleClick]);

  return (
    <div className="space-y-3">
      {/* Mode buttons */}
      <div className="flex gap-2">
        {[
          { key: 'start', label: '🟢 Set Start Holds', count: startIndices.length, max: 2, active: 'bg-green-500/20 border-green-500 text-green-400' },
          { key: 'end',   label: '🔴 Set Finish Hold', count: endIndices.length,   max: 2, active: 'bg-red-500/20 border-red-500 text-red-400' },
        ].map(btn => (
          <button key={btn.key} onClick={() => setMode(btn.key)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
              mode === btn.key ? btn.active : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}>
            {btn.label}
            <span className="ml-2 text-xs opacity-70">({btn.count}/{btn.max})</span>
          </button>
        ))}
      </div>

      <p className="text-xs text-zinc-500 text-center">
        {mode === 'start'
          ? `Tap up to 2 start holds (green). Two-hand start = tap both.`
          : `Tap the finish hold (red). Tap a second for a match finish.`}
      </p>

      {/* Canvas — no fixed height class, let canvas natural size control it */}
      <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 cursor-crosshair">
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: 'auto' }}
          onClick={handleClick}
          onTouchEnd={handleTouch}
        />
        {!ready && (
          <div className="absolute inset-0 h-48 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin"/>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="flex gap-3 text-xs">
        <div className={`flex-1 rounded-lg px-3 py-2 border ${startIndices.length > 0 ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
          <span className="font-semibold">Start: </span>
          {startIndices.length === 0 ? 'Not set'
           : startIndices.length === 1 ? `Hold ${startIndices[0]+1}`
           : `Holds ${startIndices[0]+1} & ${startIndices[1]+1} (two-hand)`}
        </div>
        <div className={`flex-1 rounded-lg px-3 py-2 border ${endIndices.length > 0 ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
          <span className="font-semibold">Finish: </span>
          {endIndices.length === 0 ? 'Not set'
           : endIndices.length === 1 ? `Hold ${endIndices[0]+1}`
           : `Holds ${endIndices[0]+1} & ${endIndices[1]+1} (match)`}
        </div>
      </div>
    </div>
  );
}