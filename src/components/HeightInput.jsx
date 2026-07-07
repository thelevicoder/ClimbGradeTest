import React, { useState } from "react";
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
    <div className="space-y-4">
      {/* Unit toggle */}
      <div className="flex gap-1 bg-[#254540] p-1 rounded-full w-fit">
        {[
          { key: 'imperial', label: 'ft / in' },
          { key: 'metric',   label: 'cm' },
        ].map(u => (
          <button
            key={u.key}
            onClick={() => setUnit(u.key)}
            className={`px-5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${
              unit === u.key
                ? 'bg-[#4ec9d6] text-white'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {u.label}
          </button>
        ))}
      </div>

      {/* Height display */}
      <div className="flex items-end gap-2">
        <span className="text-5xl font-black text-white leading-none tracking-tight">
          {unit === 'imperial' ? cmToFeetInches(heightCm) : heightCm}
        </span>
        {unit === 'metric' && (
          <span className="text-xl font-bold text-white/50 mb-1">cm</span>
        )}
      </div>

      {/* Slider */}
      <div>
        <Slider
          value={[heightCm]}
          onValueChange={([val]) => onHeightChange(val)}
          min={120}
          max={220}
          step={1}
          className="w-full"
        />
        <div className="flex justify-between mt-2">
          <span className="text-xs text-white/30">{unit === 'imperial' ? "3'11\"" : '120 cm'}</span>
          <span className="text-xs text-white/30">{unit === 'imperial' ? "7'3\""  : '220 cm'}</span>
        </div>
      </div>
    </div>
  );
}
