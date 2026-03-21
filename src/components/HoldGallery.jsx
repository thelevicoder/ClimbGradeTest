import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

const POSITION_ORDER = { start: 0, low: 1, mid: 2, high: 3, top: 4 };

const POSITION_COLORS = {
  start:   "bg-green-500/20 text-green-400 border-green-500/30",
  low:     "bg-blue-500/20 text-blue-400 border-blue-500/30",
  mid:     "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high:    "bg-orange-500/20 text-orange-400 border-orange-500/30",
  top:     "bg-red-500/20 text-red-400 border-red-500/30",
};

const TYPE_ICONS = {
  jug:      "🤜",
  crimp:    "🤏",
  sloper:   "🖐️",
  pinch:    "✌️",
  pocket:   "👆",
  foothold: "🦶",
};

// Cache loaded images
const imageCache = {};
function loadImage(url) {
  if (imageCache[url]) return Promise.resolve(imageCache[url]);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imageCache[url] = img; resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

function HoldCard({ hold, imageUrl, index }) {
  const canvasRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    loadImage(imageUrl).then((img) => {
      const W = img.naturalWidth;
      const H = img.naturalHeight;

      // Padding around each hold crop (percentage points of full image)
      const padPct = 6;

      const cropX = Math.max(0, hold.x - hold.width / 2 - padPct);
      const cropY = Math.max(0, hold.y - hold.height / 2 - padPct);
      const cropW = Math.min(100 - cropX, hold.width + padPct * 2);
      const cropH = Math.min(100 - cropY, hold.height + padPct * 2);

      // Convert to pixels
      const px = (cropX / 100) * W;
      const py = (cropY / 100) * H;
      const pw = (cropW / 100) * W;
      const ph = (cropH / 100) * H;

      const CANVAS_SIZE = 200;
      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;

      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#18181b";
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Fit crop into canvas preserving aspect ratio
      const scale = Math.min(CANVAS_SIZE / pw, CANVAS_SIZE / ph);
      const drawW = pw * scale;
      const drawH = ph * scale;
      const drawX = (CANVAS_SIZE - drawW) / 2;
      const drawY = (CANVAS_SIZE - drawH) / 2;

      ctx.drawImage(img, px, py, pw, ph, drawX, drawY, drawW, drawH);

      // Orange circle around the hold
      const holdCenterX = drawX + ((hold.x - cropX) / cropW) * drawW;
      const holdCenterY = drawY + ((hold.y - cropY) / cropH) * drawH;
      const rx = (hold.width / cropW) * drawW / 2 + 6;
      const ry = (hold.height / cropH) * drawH / 2 + 6;

      ctx.strokeStyle = "rgba(251, 146, 60, 0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.ellipse(holdCenterX, holdCenterY, Math.max(rx, 10), Math.max(ry, 8), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      setLoaded(true);
    }).catch(() => setError(true));
  }, [hold, imageUrl]);

  const posColor = POSITION_COLORS[hold.position_in_route] || POSITION_COLORS.mid;
  const typeIcon = TYPE_ICONS[hold.type] || "🪨";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden flex-shrink-0 w-48"
    >
      <div className="relative w-full h-36 bg-zinc-800/80">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-xs">
            Failed to load
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className={`w-full h-full transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            />
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin" />
              </div>
            )}
          </>
        )}
        <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/70 backdrop-blur-sm text-white text-xs font-bold flex items-center justify-center">
          {index + 1}
        </div>
        <div className="absolute top-2 right-2 text-base leading-none bg-black/50 backdrop-blur-sm rounded-md px-1 py-0.5">
          {typeIcon}
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-white capitalize">{hold.type}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${posColor}`}>
            {hold.position_in_route}
          </span>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3">
          {hold.description}
        </p>
      </div>
    </motion.div>
  );
}

// Full wall overview with hold markers, cropped to wall boundaries
function WallOverview({ holds, imageUrl, wallTopY, wallBottomY }) {
  const canvasRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    loadImage(imageUrl).then((img) => {
      const W = img.naturalWidth;
      const H = img.naturalHeight;

      // Crop pixels
      const cropTopPx  = (wallTopY / 100) * H;
      const cropBotPx  = (wallBottomY / 100) * H;
      const cropHPx    = cropBotPx - cropTopPx;

      // Render at display width, proportional height
      const DRAW_W = 600;
      const scale   = DRAW_W / W;
      const DRAW_H  = cropHPx * scale;

      canvas.width  = DRAW_W;
      canvas.height = DRAW_H;

      const ctx = canvas.getContext("2d");
      // Draw cropped wall
      ctx.drawImage(img, 0, cropTopPx, W, cropHPx, 0, 0, DRAW_W, DRAW_H);

      // Draw hold markers
      holds.forEach((hold, i) => {
        // X is straight % of full width → same % of DRAW_W
        const cx = (hold.x / 100) * DRAW_W;

        // Y is % of full image height — subtract wall top crop
        const holdAbsPx = (hold.y / 100) * H;
        const holdRelPx = holdAbsPx - cropTopPx;
        const cy = holdRelPx * scale;

        const rx = Math.max((hold.width  / 100) * DRAW_W / 2, 10);
        const ry = Math.max((hold.height / 100) * DRAW_H / 2, 8);

        // Orange ellipse
        ctx.strokeStyle = "rgba(251, 146, 60, 0.9)";
        ctx.lineWidth   = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Number label
        ctx.fillStyle    = "rgba(251, 146, 60, 1)";
        ctx.font         = "bold 11px sans-serif";
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), cx + rx + 9, cy);
      });

      setLoaded(true);
    }).catch(console.error);
  }, [holds, imageUrl, wallTopY, wallBottomY]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Wall Overview</p>
      <div className="relative rounded-xl overflow-hidden bg-zinc-800">
        <canvas
          ref={canvasRef}
          className={`w-full transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
        {!loaded && (
          <div className="h-48 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function HoldGallery({ holds, imageUrl, wallTopY = 0, wallBottomY = 100 }) {
  if (!holds || holds.length === 0) return null;

  // Filter out volumes just in case
  const filtered = holds.filter(h => h.type !== "volume");

  // Sort start → top, then by Y within same position
  const sorted = [...filtered].sort((a, b) => {
    const ao = POSITION_ORDER[a.position_in_route] ?? 2;
    const bo = POSITION_ORDER[b.position_in_route] ?? 2;
    if (ao !== bo) return ao - bo;
    return b.y - a.y;
  });

  return (
    <div className="space-y-5">
      <WallOverview
        holds={sorted}
        imageUrl={imageUrl}
        wallTopY={wallTopY}
        wallBottomY={wallBottomY}
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Individual Holds</p>
          <span className="text-xs text-zinc-600">{sorted.length} holds identified</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {sorted.map((hold, i) => (
            <HoldCard
              key={i}
              hold={hold}
              imageUrl={imageUrl}
              index={i}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(POSITION_COLORS).map(([pos, color]) => (
          <span key={pos} className={`text-xs px-2 py-0.5 rounded-full border capitalize ${color}`}>
            {pos}
          </span>
        ))}
      </div>
    </div>
  );
}