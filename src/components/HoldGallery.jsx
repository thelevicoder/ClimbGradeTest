import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

const POSITION_ORDER  = { start:0, low:1, mid:2, high:3, top:4 };
const POSITION_COLORS = {
  start: "bg-green-500/20 text-green-400 border-green-500/30",
  low:   "bg-blue-500/20 text-blue-400 border-blue-500/30",
  mid:   "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high:  "bg-orange-500/20 text-orange-400 border-orange-500/30",
  top:   "bg-red-500/20 text-red-400 border-red-500/30",
};
const TYPE_ICONS = { jug:"🤜", crimp:"🤏", sloper:"🖐️", pinch:"✌️", pocket:"👆", foothold:"🦶" };

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

// ── Individual hold crop card ─────────────────────────────────────────────────
function HoldCard({ hold, imageUrl, index }) {
  const canvasRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [error,  setError]  = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    loadImage(imageUrl).then(img => {
      const IW = img.naturalWidth;
      const IH = img.naturalHeight;
      const pad = 7; // % padding around hold

      // Crop region in % of full image
      const cropX = Math.max(0,   hold.x - hold.width  / 2 - pad);
      const cropY = Math.max(0,   hold.y - hold.height / 2 - pad);
      const cropW = Math.min(100 - cropX, hold.width  + pad * 2);
      const cropH = Math.min(100 - cropY, hold.height + pad * 2);

      // To pixels
      const px = (cropX / 100) * IW;
      const py = (cropY / 100) * IH;
      const pw = (cropW / 100) * IW;
      const ph = (cropH / 100) * IH;

      // Canvas is always 192×144 (4:3) — fit crop inside preserving aspect ratio
      const CW = 192, CH = 144;
      canvas.width  = CW;
      canvas.height = CH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, CW, CH);

      const scale  = Math.min(CW / pw, CH / ph);
      const drawW  = pw * scale;
      const drawH  = ph * scale;
      const drawX  = (CW - drawW) / 2;
      const drawY  = (CH - drawH) / 2;
      ctx.drawImage(img, px, py, pw, ph, drawX, drawY, drawW, drawH);

      // Orange ellipse around the hold center
      const hcx = drawX + ((hold.x - cropX) / cropW) * drawW;
      const hcy = drawY + ((hold.y - cropY) / cropH) * drawH;
      const erx = Math.max((hold.width  / cropW) * drawW / 2 + 5, 10);
      const ery = Math.max((hold.height / cropH) * drawH / 2 + 5, 8);

      ctx.strokeStyle = 'rgba(251,146,60,0.9)';
      ctx.lineWidth   = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.ellipse(hcx, hcy, erx, ery, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Start / finish badge
      if (hold.is_start) {
        ctx.fillStyle = 'rgba(34,197,94,0.9)';
        ctx.beginPath(); ctx.arc(CW-14, 14, 10, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('S', CW-14, 14);
      } else if (hold.is_end) {
        ctx.fillStyle = 'rgba(239,68,68,0.9)';
        ctx.beginPath(); ctx.arc(CW-14, 14, 10, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('F', CW-14, 14);
      }

      setLoaded(true);
    }).catch(() => setError(true));
  }, [hold, imageUrl]);

  const posColor = POSITION_COLORS[hold.position_in_route] || POSITION_COLORS.mid;

  return (
    <motion.div
      initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden flex-shrink-0 w-48"
    >
      {/* Fixed-ratio image area */}
      <div className="relative bg-zinc-800/80" style={{ aspectRatio: '4/3' }}>
        {error
          ? <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-xs">Failed</div>
          : <>
              <canvas
                ref={canvasRef}
                style={{ display:'block', width:'100%', height:'100%' }}
                className={`transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
              />
              {!loaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin"/>
                </div>
              )}
            </>
        }
        <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/70 text-white text-xs font-bold flex items-center justify-center">
          {index + 1}
        </div>
        <div className="absolute top-2 right-2 bg-black/50 rounded px-1 py-0.5 text-sm leading-none">
          {TYPE_ICONS[hold.type] || '🪨'}
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-semibold text-white capitalize">{hold.type}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${posColor}`}>
            {hold.position_in_route}
          </span>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3">{hold.description}</p>
      </div>
    </motion.div>
  );
}

// ── Wall overview with all holds marked ──────────────────────────────────────
function WallOverview({ holds, imageUrl, wallTopY, wallBottomY }) {
  const canvasRef = useRef(null);
  const sizeRef   = useRef({ w: 1, h: 1 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    loadImage(imageUrl).then(img => {
      const IW = img.naturalWidth;
      const IH = img.naturalHeight;

      // Source slice
      const srcY = (wallTopY    / 100) * IH;
      const srcH = ((wallBottomY - wallTopY) / 100) * IH;

      // Fit to container width, preserve aspect, max height 600px
      const container = canvas.parentElement;
      const maxW = container ? container.clientWidth : 600;
      const maxH = 600;
      const aspect = srcH / IW;
      let w = maxW, h = w * aspect;
      if (h > maxH) { h = maxH; w = h / aspect; }
      w = Math.round(w); h = Math.round(h);

      sizeRef.current = { w, h };
      canvas.width  = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, srcY, IW, srcH, 0, 0, w, h);

      const wallSpan = wallBottomY - wallTopY;

      // Draw hold markers
      holds.forEach((hold, i) => {
        const cx = (hold.x / 100) * w;
        const cy = ((hold.y - wallTopY) / wallSpan) * h;
        const rx = Math.max((hold.width  / 100) * w  / 2, 10);
        const ry = Math.max((hold.height / 100) * h / 2, 8);

        const isStart = hold.is_start;
        const isEnd   = hold.is_end;
        const color   = isStart ? 'rgba(34,197,94,1)' : isEnd ? 'rgba(239,68,68,1)' : 'rgba(251,146,60,0.9)';

        ctx.strokeStyle = color;
        ctx.lineWidth   = isStart || isEnd ? 2.5 : 1.8;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx + 4, ry + 4, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Number
        ctx.fillStyle    = color;
        ctx.font         = 'bold 11px sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        const label = isStart ? 'S' : isEnd ? 'F' : String(i + 1);
        ctx.fillText(label, cx + rx + 10, cy);
      });

      setReady(true);
    }).catch(console.error);
  }, [holds, imageUrl, wallTopY, wallBottomY]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Wall Overview</p>
      <div className="relative rounded-xl overflow-hidden bg-zinc-800">
        {/* Let the canvas set its own height via style */}
        <canvas
          ref={canvasRef}
          style={{ display:'block', width:'100%', height:'auto' }}
          className={`transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
        />
        {!ready && (
          <div className="h-48 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin"/>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function HoldGallery({ holds, imageUrl, wallTopY=0, wallBottomY=100 }) {
  if (!holds || holds.length === 0) return null;

  const filtered = holds.filter(h => h.type !== 'volume');
  const sorted   = [...filtered].sort((a, b) => {
    const ao = POSITION_ORDER[a.position_in_route] ?? 2;
    const bo = POSITION_ORDER[b.position_in_route] ?? 2;
    return ao !== bo ? ao - bo : b.y - a.y;
  });

  return (
    <div className="space-y-5">
      <WallOverview holds={sorted} imageUrl={imageUrl} wallTopY={wallTopY} wallBottomY={wallBottomY}/>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Individual Holds</p>
          <span className="text-xs text-zinc-600">{sorted.length} holds</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {sorted.map((hold, i) => (
            <HoldCard key={i} hold={hold} imageUrl={imageUrl} index={i}/>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(POSITION_COLORS).map(([pos, color]) => (
          <span key={pos} className={`text-xs px-2 py-0.5 rounded-full border capitalize ${color}`}>{pos}</span>
        ))}
      </div>
    </div>
  );
}