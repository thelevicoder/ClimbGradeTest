import React from "react";
import { Hand, Lightbulb, Ruler, Info, ListOrdered } from "lucide-react";
import { motion } from "framer-motion";
import HoldGallery from "./HoldGallery";

const gradeNum = (grade) => { const m = (grade||'').match(/\d+/); return m ? parseInt(m[0]) : -1; };
const gradeColor = (g) => { const n=gradeNum(g); if(n<=1)return"text-green-400"; if(n<=3)return"text-lime-400"; if(n<=5)return"text-yellow-400"; if(n<=7)return"text-orange-400"; if(n<=9)return"text-red-400"; return"text-rose-400"; };
const gradeBg    = (g) => { const n=gradeNum(g); if(n<=1)return"bg-green-500/10 border-green-500/30"; if(n<=3)return"bg-lime-500/10 border-lime-500/30"; if(n<=5)return"bg-yellow-500/10 border-yellow-500/30"; if(n<=7)return"bg-orange-500/10 border-orange-500/30"; if(n<=9)return"bg-red-500/10 border-red-500/30"; return"bg-rose-500/10 border-rose-500/30"; };
const gradeLabel = (g) => { const n=gradeNum(g); if(n<=1)return"Beginner"; if(n<=3)return"Intermediate"; if(n<=5)return"Advanced"; if(n<=7)return"Expert"; if(n<=9)return"Elite"; return"World Class"; };

function InfoCard({ icon: Icon, label, children, delay }) {
  return (
    <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ delay, duration:0.4 }}
      className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-orange-400" />
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-sm text-zinc-300 leading-relaxed">{children}</div>
    </motion.div>
  );
}

// Parse "Move 1: ..." style text into numbered steps
function BetaSteps({ text }) {
  if (!text) return null;

  // Try to split on "Move N:" pattern
  const movePattern = /Move\s+\d+:/gi;
  const parts = text.split(movePattern);
  const matches = [...text.matchAll(/Move\s+(\d+):/gi)];

  if (matches.length < 2) {
    // Not numbered — just render as text
    return <p className="text-sm text-zinc-300 leading-relaxed">{text}</p>;
  }

  const steps = matches.map((m, i) => ({
    num: m[1],
    text: (parts[i + 1] || '').trim(),
  }));

  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <motion.div
          key={i}
          initial={{ opacity:0, x:-8 }}
          animate={{ opacity:1, x:0 }}
          transition={{ delay: 0.05 * i, duration: 0.3 }}
          className="flex gap-3"
        >
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-400 text-xs font-bold flex items-center justify-center mt-0.5">
            {step.num}
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed pt-0.5">{step.text}</p>
        </motion.div>
      ))}
    </div>
  );
}

export default function AnalysisResults({ analysis, pickedColor, imageUrl }) {
  if (!analysis) return null;
  const grade = analysis.v_grade || null;

  if (!grade) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-3">
        <p className="text-zinc-300 font-semibold">Raw response:</p>
        <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all overflow-auto max-h-64">
          {JSON.stringify(analysis, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Grade hero */}
      <motion.div initial={{ opacity:0, scale:0.92 }} animate={{ opacity:1, scale:1 }} transition={{ duration:0.5 }}
        className={`rounded-2xl border p-8 text-center ${gradeBg(grade)}`}>
        {pickedColor && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-4 h-4 rounded-full border border-zinc-600" style={{ backgroundColor: pickedColor.hex }} />
            <span className="text-xs text-zinc-400 capitalize">{pickedColor.label} route</span>
          </div>
        )}
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-1">V-Scale Grade</p>
        <h2 className={`text-7xl font-black tracking-tight leading-none ${gradeColor(grade)}`}>{grade}</h2>
        <p className={`text-sm font-medium mt-2 ${gradeColor(grade)} opacity-70`}>{gradeLabel(grade)}</p>
        {analysis.estimated_wall_height_m && (
          <div className="flex items-center justify-center gap-2 mt-5 pt-5 border-t border-zinc-700/50 text-zinc-400">
            <Ruler className="w-4 h-4" />
            <span className="text-sm">Est. wall height: ~{analysis.estimated_wall_height_m}m
              <span className="text-zinc-500 ml-1">({(analysis.estimated_wall_height_m * 3.281).toFixed(1)}ft)</span>
            </span>
          </div>
        )}
      </motion.div>

      {/* Grade reasoning */}
      {analysis.grade_reasoning && (
        <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.05 }}
          className="flex gap-3 bg-zinc-900/40 border border-zinc-800/60 rounded-xl px-4 py-3">
          <Info className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-400 leading-relaxed">{analysis.grade_reasoning}</p>
        </motion.div>
      )}

      {/* Hold gallery */}
      {analysis.holds?.length > 0 && imageUrl && (
        <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.1 }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
          <HoldGallery
            holds={analysis.holds}
            imageUrl={imageUrl}
            wallTopY={analysis.wall_top_y ?? 0}
            wallBottomY={analysis.wall_bottom_y ?? 100}
          />
        </motion.div>
      )}

      {/* Step-by-step beta — most important section */}
      {analysis.move_description && (
        <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.15 }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <ListOrdered className="w-4 h-4 text-orange-400" />
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Step-by-Step Beta</span>
          </div>
          <BetaSteps text={analysis.move_description} />
        </motion.div>
      )}

      {/* Hold analysis + tips */}
      <div className="grid gap-4 sm:grid-cols-2">
        {analysis.hold_analysis && (
          <InfoCard icon={Hand} label="Hold Analysis" delay={0.2}>
            {analysis.hold_analysis}
          </InfoCard>
        )}
        {analysis.tips && (
          <InfoCard icon={Lightbulb} label="Beta Tips" delay={0.25}>
            {analysis.tips}
          </InfoCard>
        )}
      </div>
    </div>
  );
}