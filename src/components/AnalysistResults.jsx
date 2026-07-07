import React, { useState } from "react";
import { Hand, Lightbulb, ListOrdered, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { motion } from "framer-motion";
import HoldGallery from "./HoldGallery";
import ClimbingAnimation from "./ClimbingAnimation";

const gradeNum = g => { const m = (g || '').match(/\d+/); return m ? parseInt(m[0]) : -1; };

function gradeColor(g) {
  const n = gradeNum(g);
  if (n <= 1) return '#22a870';
  if (n <= 3) return '#4a9e3f';
  if (n <= 5) return '#c49a10';
  if (n <= 7) return '#c97320';
  if (n <= 9) return '#c43a3a';
  return '#8b3fc8';
}

function gradeLabel(g) {
  const n = gradeNum(g);
  if (n <= 1) return 'Beginner';
  if (n <= 3) return 'Intermediate';
  if (n <= 5) return 'Advanced';
  if (n <= 7) return 'Expert';
  if (n <= 9) return 'Elite';
  return 'World Class';
}

// Teal dark card (matches ScanPage TealCard)
function TealCard({ children, className = '' }) {
  return (
    <div className={`bg-[#3d6b5e] rounded-3xl p-5 ${className}`}>
      {children}
    </div>
  );
}

function TealCardHeading({ children }) {
  return <p className="text-white font-bold text-sm mb-3">{children}</p>;
}

function BetaSteps({ text }) {
  if (!text) return null;
  const lines = text.split('\n').filter(Boolean);
  return (
    <div className="space-y-2.5">
      {lines.map((line, i) => {
        const isCrux   = line.includes('CRUX');
        const isFinish = line.startsWith('Finish:');
        const numMatch = line.match(/^Move (\d+):/);
        const num      = numMatch ? numMatch[1] : null;
        const rest     = num ? line.replace(/^Move \d+:\s*/, '') : line.replace(/^Finish:\s*/, '');

        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.03 * i, duration: 0.25 }}
            className={`flex gap-3 ${isCrux ? 'bg-white/10 rounded-xl p-3 -mx-1' : ''}`}
          >
            <div className={`
              flex-shrink-0 w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center mt-0.5
              ${isCrux   ? 'bg-[#4ec9d6] text-white'
              : isFinish ? 'bg-white/20 text-white'
                         : 'bg-[#2e5148] text-white/70'}
            `}>
              {isFinish ? '✓' : num || '→'}
            </div>
            <p className="text-sm text-white/85 leading-relaxed flex-1">
              {isCrux && <span className="text-[#4ec9d6] font-bold text-[10px] uppercase tracking-widest mr-1.5">Crux </span>}
              {rest.replace(' ← CRUX MOVE', '')}
            </p>
          </motion.div>
        );
      })}
    </div>
  );
}

function GradeBreakdown({ breakdown, numericScore }) {
  const [open, setOpen] = useState(false);
  if (!breakdown || breakdown.length === 0) return null;

  return (
    <TealCard>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#4ec9d6]" />
          <span className="text-white font-bold text-sm">Grade Breakdown</span>
          <span className="text-white/40 text-xs font-mono ml-1">score {numericScore}</span>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-white/50" />
          : <ChevronDown className="w-4 h-4 text-white/50" />
        }
      </button>

      {open && (
        <div className="mt-4 space-y-1.5">
          <div className="grid grid-cols-5 gap-2 text-[10px] font-bold uppercase tracking-wider text-white/40 pb-2 border-b border-white/10">
            <span>#</span><span className="col-span-2">Move</span><span>Reach</span><span className="text-right">Score</span>
          </div>
          {breakdown.map((m, i) => (
            <div key={i} className={`grid grid-cols-5 gap-2 text-[11px] py-0.5 ${
              m.isCrux ? 'text-[#4ec9d6] font-semibold' : 'text-white/60'
            }`}>
              <span>{m.move}{m.isCrux ? ' 🔥' : ''}</span>
              <span className="col-span-2 truncate font-mono text-[10px]">
                {m.from.split('(')[0].trim()} → {m.to.split('(')[0].trim()}
              </span>
              <span className="capitalize">{m.reach}{m.dynamic ? '*' : ''}</span>
              <span className="text-right font-mono">{m.score}</span>
            </div>
          ))}
          <div className="grid grid-cols-5 gap-2 text-[11px] pt-2 border-t border-white/10 text-white font-bold">
            <span>Total</span><span className="col-span-3" /><span className="text-right font-mono">{numericScore}</span>
          </div>
        </div>
      )}
    </TealCard>
  );
}

export default function AnalysisResults({ analysis, pickedColor, imageUrl, userHeightCm, startIndices, endIndices }) {
  if (!analysis) return null;
  const grade = analysis.v_grade || null;

  if (!grade) {
    return (
      <TealCard>
        <pre className="text-xs text-white/50 whitespace-pre-wrap">{JSON.stringify(analysis, null, 2)}</pre>
      </TealCard>
    );
  }

  const color = gradeColor(grade);
  const label = gradeLabel(grade);

  return (
    <div className="space-y-4">

      {/* ── Grade hero card — light mint ────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="bg-[#e4f5ec] rounded-3xl px-8 py-8 text-center"
      >
        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="text-2xl select-none">🧗</span>
          <p className="text-[#2d5a4a] font-bold text-base">Final Route Grade:</p>
        </div>

        <h2
          className="font-black leading-none tracking-tight"
          style={{ fontSize: 'clamp(72px, 20vw, 108px)', color }}
        >
          {grade}
        </h2>

        <p className="font-semibold text-sm mt-2" style={{ color: `${color}cc` }}>
          {label}
        </p>

        {pickedColor && (
          <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-[#c0e0cf]">
            <span
              className="inline-block w-3 h-3 rounded-full border border-[#2d5a4a]/20"
              style={{ backgroundColor: pickedColor.hex }}
            />
            <span className="text-[#4a8070] text-xs font-semibold capitalize">{pickedColor.label} route</span>
          </div>
        )}

        {analysis.estimated_wall_height_m && (
          <p className="text-[#6a9e8e] text-xs mt-2">
            Est. wall height: {analysis.estimated_wall_height_m}m ({(analysis.estimated_wall_height_m * 3.281).toFixed(1)} ft)
          </p>
        )}
      </motion.div>

      {/* ── Grade reasoning ─────────────────────────────────────── */}
      {analysis.grade_reasoning && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
        >
          <TealCard>
            <div className="flex gap-3">
              <Zap className="w-4 h-4 text-[#4ec9d6] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-white/60 leading-relaxed font-mono">{analysis.grade_reasoning}</p>
            </div>
          </TealCard>
        </motion.div>
      )}

      {/* ── Grade breakdown ─────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <GradeBreakdown breakdown={analysis.grade_breakdown} numericScore={analysis.numeric_score} />
      </motion.div>

      {/* ── Route preview animation ─────────────────────────────── */}
      {analysis.holds?.length > 0 && imageUrl && startIndices?.length > 0 && endIndices?.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
          <TealCard>
            <TealCardHeading>Route Preview</TealCardHeading>
            <ClimbingAnimation
              imageUrl={imageUrl}
              holds={analysis.holds}
              wallTopY={analysis.wall_top_y ?? 0}
              wallBottomY={analysis.wall_bottom_y ?? 100}
              startIndices={startIndices}
              endIndices={endIndices}
              userHeightCm={userHeightCm || 170}
              estimatedWallHeightM={analysis.estimated_wall_height_m || 4.0}
              moves={analysis.grade_breakdown || []}
            />
          </TealCard>
        </motion.div>
      )}

      {/* ── Hold gallery ────────────────────────────────────────── */}
      {analysis.holds?.length > 0 && imageUrl && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <TealCard>
            <TealCardHeading>Detected Holds</TealCardHeading>
            <HoldGallery
              holds={analysis.holds}
              imageUrl={imageUrl}
              wallTopY={analysis.wall_top_y ?? 0}
              wallBottomY={analysis.wall_bottom_y ?? 100}
            />
          </TealCard>
        </motion.div>
      )}

      {/* ── Beta steps ──────────────────────────────────────────── */}
      {analysis.move_description && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
          <TealCard>
            <div className="flex items-center gap-2 mb-4">
              <ListOrdered className="w-4 h-4 text-[#4ec9d6]" />
              <TealCardHeading>Step-by-Step Beta</TealCardHeading>
            </div>
            <BetaSteps text={analysis.move_description} />
          </TealCard>
        </motion.div>
      )}

      {/* ── Hold analysis + tips ─────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {analysis.hold_analysis && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}>
            <TealCard>
              <div className="flex items-center gap-2 mb-3">
                <Hand className="w-4 h-4 text-[#4ec9d6]" />
                <TealCardHeading>Hold Analysis</TealCardHeading>
              </div>
              <p className="text-sm text-white/80 leading-relaxed">{analysis.hold_analysis}</p>
            </TealCard>
          </motion.div>
        )}
        {analysis.tips && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <TealCard>
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-[#4ec9d6]" />
                <TealCardHeading>Beta Tips</TealCardHeading>
              </div>
              <p className="text-sm text-white/80 leading-relaxed">{analysis.tips}</p>
            </TealCard>
          </motion.div>
        )}
      </div>

    </div>
  );
}
