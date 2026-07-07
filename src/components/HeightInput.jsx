import React, { useState } from "react";
import { Slider } from "@/components/ui/slider";

export default function HeightInput({ heightCm, onHeightChange }) {
  const [unit, setUnit] = useState("imperial");

  const cmToFeetInches = (cm) => {
    const totalInches = Math.round(cm / 2.54);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return { feet, inches, display: `${feet}'${inches}"` };
  };

  const fi = cmToFeetInches(heightCm);

  return (
    <div className="space-y-4">
      {/* Unit toggle */}
      <div className="flex gap-1.5 bg-zinc-900 p-1 rounded-xl border border-zinc-800 w-fit">
        {[
          { key: 'imperial', label: 'ft / in' },
          { key: 'metric',   label: 'cm' },
        ].map(u => (
          <button
            key={u.key}
            onClick={() => setUnit(u.key)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              unit === u.key
                ? 'bg-zinc-700 text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {u.label}
          </button>
        ))}
      </div>

      {/* Display */}
      <div className="flex items-end gap-2">
        {unit === 'imperial' ? (
          <>
            <span className="text-5xl font-black tracking-tight text-white leading-none">{fi.feet}</span>
            <span className="text-xl font-bold text-zinc-500 mb-1">ft</span>
            <span className="text-5xl font-black tracking-tight text-white leading-none">{fi.inches}</span>
            <span className="text-xl font-bold text-zinc-500 mb-1">in</span>
          </>
        ) : (
          <>
            <span className="text-5xl font-black tracking-tight text-white leading-none">{heightCm}</span>
            <span className="text-xl font-bold text-zinc-500 mb-1">cm</span>
          </>
        )}
      </div>

      {/* Slider */}
      <div className="pt-1">
        <Slider
          value={[heightCm]}
          onValueChange={([val]) => onHeightChange(val)}
          min={120}
          max={220}
          step={1}
          className="w-full"
        />
        <div className="flex justify-between mt-2">
          <span className="text-[11px] text-zinc-700">{unit === 'imperial' ? "3'11\"" : '120 cm'}</span>
          <span className="text-[11px] text-zinc-700">{unit === 'imperial' ? "7'3\""  : '220 cm'}</span>
        </div>
      </div>
    </div>
  );
}
