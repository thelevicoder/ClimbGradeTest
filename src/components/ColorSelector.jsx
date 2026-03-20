import React from "react";
import { Check } from "lucide-react";

const HOLD_COLORS = [
  { name: "Red", value: "red", bg: "bg-red-500", ring: "ring-red-400" },
  { name: "Blue", value: "blue", bg: "bg-blue-500", ring: "ring-blue-400" },
  { name: "Green", value: "green", bg: "bg-green-500", ring: "ring-green-400" },
  { name: "Yellow", value: "yellow", bg: "bg-yellow-400", ring: "ring-yellow-300" },
  { name: "Orange", value: "orange", bg: "bg-orange-500", ring: "ring-orange-400" },
  { name: "Purple", value: "purple", bg: "bg-purple-500", ring: "ring-purple-400" },
  { name: "Pink", value: "pink", bg: "bg-pink-400", ring: "ring-pink-300" },
  { name: "White", value: "white", bg: "bg-white", ring: "ring-white" },
  { name: "Black", value: "black", bg: "bg-zinc-900 border border-zinc-600", ring: "ring-zinc-500" },
  { name: "Neon Green", value: "neon green", bg: "bg-lime-400", ring: "ring-lime-300" },
  { name: "Teal", value: "teal", bg: "bg-teal-500", ring: "ring-teal-400" },
  { name: "Gray", value: "gray", bg: "bg-zinc-400", ring: "ring-zinc-300" },
];

export default function ColorSelector({ selected, onSelect }) {
  return (
    <div>
      <label className="text-sm font-medium text-zinc-400 mb-3 block">Hold Color</label>
      <div className="grid grid-cols-6 sm:grid-cols-12 gap-3">
        {HOLD_COLORS.map((color) => (
          <button
            key={color.value}
            onClick={() => onSelect(color.value)}
            className={`relative w-10 h-10 rounded-full ${color.bg} transition-all duration-200 ${
              selected === color.value
                ? `ring-2 ${color.ring} ring-offset-2 ring-offset-zinc-900 scale-110`
                : "hover:scale-105 opacity-70 hover:opacity-100"
            }`}
            title={color.name}
          >
            {selected === color.value && (
              <Check className={`w-4 h-4 absolute inset-0 m-auto ${
                color.value === "white" || color.value === "yellow" || color.value === "neon green"
                  ? "text-zinc-800"
                  : "text-white"
              }`} />
            )}
          </button>
        ))}
      </div>
      {selected && (
        <p className="text-xs text-zinc-500 mt-2 capitalize">{selected} holds selected</p>
      )}
    </div>
  );
}