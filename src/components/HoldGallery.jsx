import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

const POSITION_ORDER = { start: 0, low: 1, mid: 2, high: 3, top: 4 };

const POSITION_COLORS = {
  start: "bg-green-500/20 text-green-400 border-green-500/30",
  low:   "bg-blue-500/20 text-blue-400 border-blue-500/30",
  mid:   "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  high:  "bg-orange-500/20 text-orange-400 border-orange-500/30",
  top:   "bg-red-500/20 text-red-400 border-red-500/30",
};

const TYPE_ICONS = {
  jug:      "🤜",
  crimp:    "🤏",
  sloper:   "🖐️",
  pinch:    "✌️",
  pocket:   "👆",
  volume:   "📦",
  foothold: "🦶",
};

function HoldCard({ hold, imageUrl, index }) {
  const canvasRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Padding around the hold crop (in percentage points)
      const pad = 4;
      const x = Math.max(0, hold.x - hold.width / 2 - pad);
      const y = Math.max(0, hold.y - hold.height / 2 - pad);
      const w = Math.min(100 - x, hold.width + pad * 2);
      const h = Math.min(100 - y, hold.height + pad * 2);

      // Convert percentages to pixel coordinates
      const px = (x / 100) * img.naturalWidth;
      const py = (y / 100) * img.naturalHeight;
      const pw = (w / 100) * img.naturalWidth;
      const ph = (h / 100) * img.naturalHeight;

      // Draw square crop
      const size = Math.max(pw, ph);
      canvas.width = 200;
      canvas.height = 200;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, px, py, pw, ph, 0, 0, 200, 200);
      setLoaded(true);
    };
    img.src = imageUrl;
  }, [hold, imageUrl]);

  const posColor = POSITION_COLORS[hold.position_in_route] || POSITION_COLORS.mid;
  const typeIcon = TYPE_ICONS[hold.type] || "🪨";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden flex-shrink-0 w-48"
    >
      {/* Cropped hold image */}
      <div className="relative w-full h-36 bg-zinc-800">
        <canvas
          ref={canvasRef}
          className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          style={{ imageRendering: "auto" }}
        />
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin" />
          </div>
        )}
        {/* Hold number badge */}
        <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/70 text-white text-xs font-bold flex items-center justify-center">
          {index + 1}
        </div>
        {/* Type icon */}
        <div className="absolute top-2 right-2 text-lg">
          {typeIcon}
        </div>
      </div>

      {/* Hold info */}
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

export default function HoldGallery({ holds, imageUrl }) {
  if (!holds || holds.length === 0) return null;

  // Sort by position in route (start → top)
  const sorted = [...holds].sort((a, b) => {
    const ao = POSITION_ORDER[a.position_in_route] ?? 2;
    const bo = POSITION_ORDER[b.position_in_route] ?? 2;
    return ao - bo;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">
          Route Holds
        </h3>
        <span className="text-xs text-zinc-500">{holds.length} holds identified</span>
      </div>

      {/* Horizontal scrollable row */}
      <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin scrollbar-track-zinc-900 scrollbar-thumb-zinc-700">
        {sorted.map((hold, i) => (
          <HoldCard
            key={i}
            hold={hold}
            imageUrl={imageUrl}
            index={i}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 pt-1">
        {Object.entries(POSITION_COLORS).map(([pos, color]) => (
          <span key={pos} className={`text-xs px-2 py-0.5 rounded-full border capitalize ${color}`}>
            {pos}
          </span>
        ))}
      </div>
    </div>
  );
}
