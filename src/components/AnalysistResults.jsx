import React, { useState } from "react";
import { Hand, Lightbulb, ListOrdered, ChevronDown, ChevronUp, Zap, Mountain } from "lucide-react";
import { motion } from "framer-motion";
import HoldGallery from "./HoldGallery";
import ClimbingAnimation from "./ClimbingAnimation";

const gradeNum = g => { const m = (g || '').match(/\d+/); return m ? parseInt(m[0]) : -1; };

function gradeTheme(g) {
  const n = gradeNum(g);
  if (n < 0)  return { text: 'text-white',       glow: '#ffffff',  label: 'Unknown',      ring: 'ring-white/20',       bar: 'bg-white' };
  if (n <= 1) return { text: 'text-emerald-400', glow: '#34d399',  label: 'Beginner',     ring: 'ring-emerald-500/30', bar: 'bg-emerald-500' };
  if (n <= 3) return { text: 'text-lime-400',    glow: '#a3e635',  label: 'Intermediate', ring: 'ring-lime-500/30',    bar: 'bg-lime-500' };
  if (n <= 5) return { text: 'text-yellow-400',  glow: '#facc15',  label: 'Advanced',     ring: 'ring-yellow-500/30',  bar: 'bg-yellow-500' };
  if (n <= 7) return { text: 'text-orange-400',  glow: '#fb923c',  label: 'Expert',       ring: 'ring-orange-500/30',  bar: 'bg-orange-500' };
  if (n <= 9) return { text: 'text-red-400',     glow: '#f87171',  label: 'Elite',        ring: 'ring-red-500/30',     bar: 'bg-red-500' };
  return             { text: 'text-violet-400',  glow: '#a78bfa',  label: 'World Class',  ring: 'ring-violet-500/30',  bar: 'bg-violet-500' };
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
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.04 * i, duration: 0.3 }}
            className={`flex gap-3 ${isCrux ? 'bg-orange-500/8 border border-orange-500/20 rounded-xl p-3 -mx-1' : ''}`}
          >
            <div className={`
              flex-shrink-0 w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center mt-0.5
              ${isCrux   ? 'bg-orange-500 text-white'
              : isFinish ? 'bg-red-500/20 border border-red-500/40 text-red-400'
                         : 'bg-zinc-800 border border-zinc-700 text-zinc-500'}
            `}>
              {isFinish ? '✓' : num || '→'}
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed flex-1">
              {isCrux && <span className="text-orange-400 font-bold text-[10px] uppercase tracking-widest mr-2">Crux</span>}
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
    <div className="bg-zinc-950 border border-zinc-800/60 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-zinc-900/50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Zap className="w-4 h-4 text-zinc-500" />
          <span className="text-xs font-bold tracking-widest uppercase text-zinc-500">Grade Breakdown</span>
          <span className="text-[11px] text-zinc-700 font-mono">score {numericScore}</span>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-zinc-600" />
          : <ChevronDown className="w-4 h-4 text-zinc-600" />
        }
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-1.5">
          <div className="grid grid-cols-5 gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600 pb-2 border-b border-zinc-800/60">
            <span>#</span><span className="col-span-2">Move</span><span>Reach</span><span className="text-right">Score</span>
          </div>
          {breakdown.map((m, i) => (
            <div key={i} className={`grid grid-cols-5 gap-2 text-[11px] py-1 rounded-lg ${
              m.isCrux ? 'text-orange-400 font-semibold' : 'text-zinc-500'
            }`}>
              <span>{m.move}{m.isCrux ? ' 🔥' : ''}</span>
              <span className="col-span-2 truncate font-mono text-[10px]">
                {m.from.split('(')[0].trim()} → {m.to.split('(')[0].trim()}
              </span>
              <span className="capitalize">{m.reach}{m.dynamic ? '*' : ''}</span>
              <span className="text-right font-mono">{m.score}</span>
            </div>
          ))}
          <div className="grid grid-cols-5 gap-2 text-[11px] pt-2 border-t border-zinc-800/60 text-zinc-300 font-bold">
            <span>Total</span><span className="col-span-3" /><span className="text-right font-mono">{numericScore}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCard({ icon: Icon, label, children, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className="bg-zinc-950 border border-zinc-800/60 rounded-2xl p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-zinc-600" />
        <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-500">{label}</span>
      </div>
      <p className="text-sm text-zinc-300 leading-relaxed">{children}</p>
    </motion.div>
  );
}

export default function AnalysisResults({ analysis, pickedColor, imageUrl, userHeightCm, startIndices, endIndices }) {
  if (!analysis) return null;
  const grade = analysis.v_grade || null;

  if (!grade) {
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5">
        <pre className="text-xs text-zinc-500 whitespace-pre-wrap">{JSON.stringify(analysis, null, 2)}</pre>
      </div>
    );
  }

  const theme = gradeTheme(grade);

  return (
    <div className="space-y-4">

      {/* ── Grade hero ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden rounded-3xl bg-zinc-950 border border-zinc-800/60 px-8 py-10 text-center"
      >
        {/* Radial glow behind grade */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 60% 55% at 50% 60%, ${theme.glow}18 0%, transparent 70%)`,
          }}
        />

        {/* Route color chip */}
        {pickedColor && (
          <div className="relative flex items-center justify-center gap-2 mb-6">
            <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: pickedColor.hex }} />
            <span className="text-[11px] font-semibold text-zinc-500 capitalize tracking-widest uppercase">
              {pickedColor.label} route
            </span>
          </div>
        )}

        {/* Difficulty label */}
        <p className="relative text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-600 mb-2">V-Scale Grade</p>

        {/* The grade */}
        <h2 className={`relative font-black leading-none tracking-tight ${theme.text}`}
          style={{ fontSize: 'clamp(80px, 22vw, 120px)' }}
        >
          {grade}
        </h2>

        {/* Difficulty label */}
        <p className={`relative text-sm font-semibold mt-3 ${theme.text} opacity-60`}>
          {theme.label}
        </p>

        {/* Wall height */}
        {analysis.estimated_wall_height_m && (
          <div className="relative flex items-center justify-center gap-2 mt-6 pt-5 border-t border-zinc-800/60">
            <Mountain className="w-3.5 h-3.5 text-zinc-600" />
            <span className="text-xs text-zinc-600">
              ~{analysis.estimated_wall_height_m}m wall
              <span className="text-zinc-700 ml-1.5">({(analysis.estimated_wall_height_m * 3.281).toFixed(1)} ft)</span>
            </span>
          </div>
        )}
      </motion.div>

      {/* ── Grade reasoning ─────────────────────────────────────────── */}
      {analysis.grade_reasoning && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="bg-zinc-950 border border-zinc-800/60 rounded-2xl px-4 py-3.5 flex gap-3"
        >
          <Zap className="w-3.5 h-3.5 text-zinc-700 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-zinc-500 leading-relaxed font-mono">{analysis.grade_reasoning}</p>
        </motion.div>
      )}

      {/* ── Grade breakdown ─────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <GradeBreakdown breakdown={analysis.grade_breakdown} numericScore={analysis.numeric_score} />
      </motion.div>

      {/* ── Climbing animation ──────────────────────────────────────── */}
      {analysis.holds?.length > 0 && imageUrl && startIndices?.length > 0 && endIndices?.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
          className="bg-zinc-950 border border-zinc-800/60 rounded-2xl overflow-hidden"
        >
          <div className="px-5 pt-4 pb-1">
            <p className="text-[10px] font-bold tracking-widest uppercase text-zinc-600">Route Preview</p>
          </div>
          <div className="p-5 pt-3">
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
          </div>
        </motion.div>
      )}

      {/* ── Hold gallery ────────────────────────────────────────────── */}
      {analysis.holds?.length > 0 && imageUrl && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-zinc-950 border border-zinc-800/60 rounded-2xl overflow-hidden"
        >
          <div className="px-5 pt-4 pb-1">
            <p className="text-[10px] font-bold tracking-widest uppercase text-zinc-600">Holds</p>
          </div>
          <div className="p-5 pt-3">
            <HoldGallery
              holds={analysis.holds}
              imageUrl={imageUrl}
              wallTopY={analysis.wall_top_y ?? 0}
              wallBottomY={analysis.wall_bottom_y ?? 100}
            />
          </div>
        </motion.div>
      )}

      {/* ── Beta steps ──────────────────────────────────────────────── */}
      {analysis.move_description && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22 }}
          className="bg-zinc-950 border border-zinc-800/60 rounded-2xl p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <ListOrdered className="w-3.5 h-3.5 text-zinc-600" />
            <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-500">Step-by-Step Beta</span>
          </div>
          <BetaSteps text={analysis.move_description} />
        </motion.div>
      )}

      {/* ── Hold analysis + tips ─────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {analysis.hold_analysis && (
          <InfoCard icon={Hand} label="Hold Analysis" delay={0.26}>{analysis.hold_analysis}</InfoCard>
        )}
        {analysis.tips && (
          <InfoCard icon={Lightbulb} label="Beta Tips" delay={0.3}>{analysis.tips}</InfoCard>
        )}
      </div>

    </div>
  );
}
