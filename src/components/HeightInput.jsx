import React, { useState } from "react";
import { Ruler } from "lucide-react";
import { Slider } from "@/components/ui/slider";

export default function HeightInput({ heightCm, onHeightChange }) {
  const [unit, setUnit] = useState("imperial");

  const cmToFeetInches = (cm) => {
    const totalInches = Math.round(cm / 2.54);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return `${feet}'${inches}"`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-medium text-zinc-400 flex items-center gap-2">
          <Ruler className="w-4 h-4" />
          Your Height
        </label>
        <div className="flex bg-zinc-800 rounded-lg p-0.5">
          <button
            onClick={() => setUnit("imperial")}
            className={`text-xs px-3 py-1 rounded-md transition-all ${
              unit === "imperial" ? "bg-zinc-700 text-white" : "text-zinc-500"
            }`}
          >
            ft/in
          </button>
          <button
            onClick={() => setUnit("metric")}
            className={`text-xs px-3 py-1 rounded-md transition-all ${
              unit === "metric" ? "bg-zinc-700 text-white" : "text-zinc-500"
            }`}
          >
            cm
          </button>
        </div>
      </div>

      <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
        <div className="text-center mb-4">
          <span className="text-3xl font-bold text-white tracking-tight">
            {unit === "imperial" ? cmToFeetInches(heightCm) : `${heightCm} cm`}
          </span>
        </div>
        <Slider
          value={[heightCm]}
          onValueChange={([val]) => onHeightChange(val)}
          min={120}
          max={220}
          step={1}
          className="w-full"
        />
        <div className="flex justify-between mt-2">
          <span className="text-xs text-zinc-600">{unit === "imperial" ? "3'11\"" : "120 cm"}</span>
          <span className="text-xs text-zinc-600">{unit === "imperial" ? "7'3\"" : "220 cm"}</span>
        </div>
      </div>
    </div>
  );
}