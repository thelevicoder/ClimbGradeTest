import React, { useRef, useEffect, useState, useCallback } from "react";
import { Crosshair, RefreshCw } from "lucide-react";

export default function ImageColorPicker({ imageUrl, onColorPicked, pickedColor }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [clickPos, setClickPos] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ w: 1, h: 1 });
  const [naturalSize, setNaturalSize] = useState({ w: 1, h: 1 });

  const drawImage = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    if (!imgLoaded) return;
    const img = imgRef.current;
    const container = canvasRef.current?.parentElement;
    if (!img || !container) return;

    const maxW = container.clientWidth;
    const ratio = img.naturalHeight / img.naturalWidth;
    const w = maxW;
    const h = Math.min(maxW * ratio, 420);

    setCanvasSize({ w, h });
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });

    const canvas = canvasRef.current;
    canvas.width = w;
    canvas.height = h;
    drawImage();
  }, [imgLoaded, drawImage]);

  const sampleColor = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    const ctx = canvas.getContext("2d");
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const r = pixel[0], g = pixel[1], b = pixel[2];

    setClickPos({ x: (x / canvas.width) * rect.width + rect.left - rect.left, y: (y / canvas.height) * rect.height + rect.top - rect.top, canvasX: x, canvasY: y });
    onColorPicked({ r, g, b, hex: rgbToHex(r, g, b), label: rgbToLabel(r, g, b) });
  };

  const rgbToHex = (r, g, b) =>
    "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

  const rgbToLabel = (r, g, b) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2 / 255;
    const saturation = max === min ? 0 : (max - min) / 255;

    if (lightness > 0.85) return "white";
    if (lightness < 0.15) return "black";
    if (saturation < 0.15) return "gray";

    const hue = (() => {
      if (max === min) return 0;
      let h;
      if (max === r) h = ((g - b) / (max - min) + 6) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      return (h / 6) * 360;
    })();

    if (hue < 15 || hue >= 345) return "red";
    if (hue < 45) return "orange";
    if (hue < 70) return "yellow";
    if (hue < 165) return "green";
    if (hue < 195) return "teal";
    if (hue < 255) return "blue";
    if (hue < 285) return "purple";
    if (hue < 345) return "pink";
    return "red";
  };

  return (
    <div className="w-full space-y-3">
      <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 cursor-crosshair select-none">
        {/* Hidden image for CORS-safe drawing */}
        <img
          ref={imgRef}
          src={imageUrl}
          crossOrigin="anonymous"
          alt="wall"
          className="hidden"
          onLoad={() => setImgLoaded(true)}
        />
        <canvas
          ref={canvasRef}
          className="w-full block"
          onClick={sampleColor}
          style={{ touchAction: "none" }}
          onTouchEnd={(e) => {
            e.preventDefault();
            const touch = e.changedTouches[0];
            sampleColor({ clientX: touch.clientX, clientY: touch.clientY });
          }}
        />

        {/* Crosshair indicator */}
        {clickPos && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: clickPos.x - 12,
              top: clickPos.y - 12,
            }}
          >
            <div className="w-6 h-6 rounded-full border-2 border-white shadow-lg shadow-black/50 animate-ping opacity-50 absolute inset-0" />
            <div
              className="w-6 h-6 rounded-full border-2 border-white shadow-lg"
              style={{ backgroundColor: pickedColor?.hex || "transparent" }}
            />
          </div>
        )}

        {/* Overlay hint */}
        {!pickedColor && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-white">
              <Crosshair className="w-4 h-4 text-orange-400" />
              Tap a hold to sample its color
            </div>
          </div>
        )}
      </div>

      {/* Sampled color display */}
      {pickedColor && (
        <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg border-2 border-zinc-600 shadow-lg flex-shrink-0"
              style={{ backgroundColor: pickedColor.hex }}
            />
            <div>
              <p className="text-sm font-semibold text-white capitalize">{pickedColor.label} hold</p>
              <p className="text-xs text-zinc-500 font-mono">{pickedColor.hex.toUpperCase()} · RGB({pickedColor.r}, {pickedColor.g}, {pickedColor.b})</p>
            </div>
          </div>
          <button
            onClick={() => { onColorPicked(null); setClickPos(null); }}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}