import React, { useEffect, useRef, useState, useCallback } from "react";

const MAX_START = 2;
const MAX_END = 1; // can be 2 for match finish — let user toggle

// Colors
const UNSELECTED = { stroke: 'rgba(251,146,60,0.7)', fill: 'rgba(251,146,60,0.15)', text: 'rgba(255,255,255,0.8)' };
const START_COLOR = { stroke: 'rgba(34,197,94,1)', fill: 'rgba(34,197,94,0.25)', text: '#fff' };
const END_COLOR   = { stroke: 'rgba(239,68,68,1)',  fill: 'rgba(239,68,68,0.25)',  text: '#fff' };

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

export default function HoldSelector({ imageUrl, holds, wallTopY, wallBottomY, startIndices, endIndices, onStartChange, onEndChange }) {
  const canvasRef = useRef(null);
  const [mode, setMode] = useState('start'); // 'start' | 'end'
  const [canvasSize, setCanvasSize] = useState({ w: 1, h: 1 });
  const imgRef = useRef(null);

  // Draw the wall + all hold circles
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');

    // Draw cropped wall image
    const srcTopY  = (wallTopY  / 100) * img.naturalHeight;
    const srcBotY  = (wallBottomY / 100) * img.naturalHeight;
    const srcH     = srcBotY - srcTopY;
    ctx.drawImage(img, 0, srcTopY, img.naturalWidth, srcH, 0, 0, W, H);

    // Dim overlay
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);

    // Draw each hold
    holds.forEach((hold, i) => {
      const isStart = startIndices.includes(i);
      const isEnd   = endIndices.includes(i);
      const colors  = isStart ? START_COLOR : isEnd ? END_COLOR : UNSELECTED;

      // Convert hold coords (% of full image) → canvas coords (cropped wall)
      const cx = (hold.x / 100) * W;
      const wallH = wallBottomY - wallTopY;
      const holdRelY = hold.y - wallTopY;
      const cy = (holdRelY / wallH) * H;

      const rx = Math.max((hold.width  / 100) * W / 2, 10);
      const ry = Math.max((hold.height / 100) * H / 2, 8);

      // Circle
      ctx.strokeStyle = colors.stroke;
      ctx.fillStyle   = colors.fill;
      ctx.lineWidth   = isStart || isEnd ? 2.5 : 1.5;
      ctx.setLineDash(isStart || isEnd ? [] : [4, 3]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 4, ry + 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      const label = isStart ? 'S' : isEnd ? 'F' : String(i + 1);
      const fontSize = isStart || isEnd ? 11 : 10;
      ctx.fillStyle = colors.text;
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy);
    });
  }, [holds, wallTopY, wallBottomY, startIndices, endIndices]);

  // Load image and set canvas size
  useEffect(() => {
    loadImage(imageUrl).then(img => {
      imgRef.current = img;
      const container = canvasRef.current?.parentElement;
      if (!container) return;
      const maxW = container.clientWidth;
      const wallH = wallBottomY - wallTopY;
      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight * (wallH / 100);
      const ratio = srcH / srcW;
      const w = maxW;
      const h = Math.min(maxW * ratio, 500);
      setCanvasSize({ w, h });
    });
  }, [imageUrl, wallTopY, wallBottomY]);

  // Redraw when anything changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;
    canvas.width  = canvasSize.w;
    canvas.height = canvasSize.h;
    draw();
  }, [canvasSize, draw]);

  // Handle tap/click — find nearest hold
  const handleClick = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const tapX = (e.clientX - rect.left)  * scaleX;
    const tapY = (e.clientY  - rect.top)  * scaleY;

    const wallH = wallBottomY - wallTopY;

    // Find closest hold to tap point
    let closest = -1;
    let closestDist = Infinity;
    holds.forEach((hold, i) => {
      const cx = (hold.x / 100) * canvas.width;
      const holdRelY = hold.y - wallTopY;
      const cy = (holdRelY / wallH) * canvas.height;
      const dist = Math.sqrt((tapX - cx) ** 2 + (tapY - cy) ** 2);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    });

    // Only register if tap was within 40px of a hold
    if (closest === -1 || closestDist > 40) return;

    if (mode === 'start') {
      if (startIndices.includes(closest)) {
        // Deselect
        onStartChange(startIndices.filter(i => i !== closest));
      } else if (startIndices.length < MAX_START) {
        onStartChange([...startIndices, closest]);
      } else {
        // Replace oldest
        onStartChange([startIndices[1], closest]);
      }
    } else {
      if (endIndices.includes(closest)) {
        onEndChange(endIndices.filter(i => i !== closest));
      } else if (endIndices.length < 2) {
        onEndChange([...endIndices, closest]);
      } else {
        onEndChange([endIndices[1], closest]);
      }
    }
  }, [holds, wallTopY, wallBottomY, mode, startIndices, endIndices, onStartChange, onEndChange]);

  const handleTouch = useCallback((e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    handleClick({ clientX: touch.clientX, clientY: touch.clientY });
  }, [handleClick]);

  const startCount = startIndices.length;
  const endCount   = endIndices.length;

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode('start')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
            mode === 'start'
              ? 'bg-green-500/20 border-green-500 text-green-400'
              : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
          }`}
        >
          🟢 Set Start Holds
          <span className="ml-2 text-xs opacity-70">({startCount}/2)</span>
        </button>
        <button
          onClick={() => setMode('end')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
            mode === 'end'
              ? 'bg-red-500/20 border-red-500 text-red-400'
              : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
          }`}
        >
          🔴 Set Finish Hold
          <span className="ml-2 text-xs opacity-70">({endCount}/2)</span>
        </button>
      </div>

      {/* Instruction */}
      <p className="text-xs text-zinc-500 text-center">
        {mode === 'start'
          ? `Tap up to 2 start holds (green). Two-hand start = tap both. ${startCount > 0 ? 'Tap again to deselect.' : ''}`
          : `Tap the finish hold (red). Tap a second for a match finish. ${endCount > 0 ? 'Tap again to deselect.' : ''}`
        }
      </p>

      {/* Canvas */}
      <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 cursor-crosshair">
        <canvas
          ref={canvasRef}
          className="w-full block"
          onClick={handleClick}
          onTouchEnd={handleTouch}
          style={{ touchAction: 'none' }}
        />
        {holds.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
            No holds detected
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="flex gap-3 text-xs">
        <div className={`flex-1 rounded-lg px-3 py-2 border ${startCount > 0 ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
          <span className="font-semibold">Start: </span>
          {startCount === 0 ? 'Not set' : startCount === 1 ? `Hold ${startIndices[0]+1}` : `Holds ${startIndices[0]+1} & ${startIndices[1]+1} (two-hand)`}
        </div>
        <div className={`flex-1 rounded-lg px-3 py-2 border ${endCount > 0 ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-zinc-900 border-zinc-800 text-zinc-500'}`}>
          <span className="font-semibold">Finish: </span>
          {endCount === 0 ? 'Not set' : endCount === 1 ? `Hold ${endIndices[0]+1}` : `Holds ${endIndices[0]+1} & ${endIndices[1]+1} (match)`}
        </div>
      </div>
    </div>
  );
}