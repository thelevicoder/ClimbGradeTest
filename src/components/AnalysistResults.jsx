import React, { useState } from "react";
import { Hand, Lightbulb, Ruler, Info, ListOrdered, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { motion } from "framer-motion";
import HoldGallery from "./HoldGallery";
import ClimbingAnimation from "./ClimbingAnimation";

const gradeNum   = g => { const m=(g||'').match(/\d+/); return m?parseInt(m[0]):-1; };
const gradeColor = g => { const n=gradeNum(g); if(n<=1)return"text-green-400"; if(n<=3)return"text-lime-400"; if(n<=5)return"text-yellow-400"; if(n<=7)return"text-orange-400"; if(n<=9)return"text-red-400"; return"text-rose-400"; };
const gradeBg    = g => { const n=gradeNum(g); if(n<=1)return"bg-green-500/10 border-green-500/30"; if(n<=3)return"bg-lime-500/10 border-lime-500/30"; if(n<=5)return"bg-yellow-500/10 border-yellow-500/30"; if(n<=7)return"bg-orange-500/10 border-orange-500/30"; if(n<=9)return"bg-red-500/10 border-red-500/30"; return"bg-rose-500/10 border-rose-500/30"; };
const gradeLabel = g => { const n=gradeNum(g); if(n<=1)return"Beginner"; if(n<=3)return"Intermediate"; if(n<=5)return"Advanced"; if(n<=7)return"Expert"; if(n<=9)return"Elite"; return"World Class"; };

function InfoCard({ icon: Icon, label, children, delay }) {
  return (
    <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay,duration:0.4}}
      className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-orange-400"/>
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-sm text-zinc-300 leading-relaxed">{children}</div>
    </motion.div>
  );
}

function BetaSteps({ text }) {
  if (!text) return null;
  const lines = text.split('\n').filter(Boolean);
  return (
    <div className="space-y-3">
      {lines.map((line, i) => {
        const isCrux    = line.includes('CRUX');
        const isFinish  = line.startsWith('Finish:');
        const numMatch  = line.match(/^Move (\d+):/);
        const num       = numMatch ? numMatch[1] : null;
        const rest      = num ? line.replace(/^Move \d+:\s*/, '') : line.replace(/^Finish:\s*/, '');
        return (
          <motion.div key={i} initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{delay:0.04*i,duration:0.3}}
            className={`flex gap-3 ${isCrux ? 'bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 -mx-1' : ''}`}>
            <div className={`flex-shrink-0 w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center mt-0.5
              ${isCrux   ? 'bg-orange-500 text-white'
              : isFinish ? 'bg-red-500/20 border border-red-500/40 text-red-400'
                         : 'bg-orange-500/20 border border-orange-500/40 text-orange-400'}`}>
              {isFinish ? '🏁' : num || '→'}
            </div>
            <div className="flex-1">
              <p className="text-sm text-zinc-300 leading-relaxed">
                {isCrux && <span className="text-orange-400 font-semibold text-xs uppercase mr-2">Crux</span>}
                {rest.replace(' ← CRUX MOVE', '')}
              </p>
            </div>
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
    <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.2}}
      className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-zinc-800/50 transition-colors">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-orange-400"/>
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Grade Breakdown</span>
          <span className="text-xs text-zinc-600 ml-2">Score: {numericScore}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-zinc-500"/> : <ChevronDown className="w-4 h-4 text-zinc-500"/>}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-2">
          <div className="grid grid-cols-5 gap-2 text-xs text-zinc-500 pb-1 border-b border-zinc-800">
            <span>Move</span><span>From → To</span><span>Distance</span><span>Reach</span><span className="text-right">Score</span>
          </div>
          {breakdown.map((m, i) => (
            <div key={i} className={`grid grid-cols-5 gap-2 text-xs py-1 rounded ${m.isCrux ? 'text-orange-400 font-semibold' : 'text-zinc-400'}`}>
              <span>{m.move}{m.isCrux ? ' 🔥' : ''}</span>
              <span className="truncate">{m.from.split('(')[0]} → {m.to.split('(')[0]}</span>
              <span>{m.distCm}cm</span>
              <span className="capitalize">{m.reach}{m.dynamic ? ' (dyn)' : ''}</span>
              <span className="text-right">{m.score}</span>
            </div>
          ))}
          <div className="grid grid-cols-5 gap-2 text-xs pt-2 border-t border-zinc-800 text-zinc-300 font-semibold">
            <span>Total</span><span/><span/><span/><span className="text-right">{numericScore}</span>
          </div>
          <p className="text-xs text-zinc-600 pt-1">
            Score = (hold difficulty × wall angle) + reach difficulty + lateral difficulty. Grade mapped from total weighted score.
          </p>
        </div>
      )}
    </motion.div>
  );
}

export default function AnalysisResults({ analysis, pickedColor, imageUrl, userHeightCm, startIndices, endIndices }) {
  if (!analysis) return null;
  const grade = analysis.v_grade || null;

  if (!grade) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5">
        <pre className="text-xs text-zinc-400 whitespace-pre-wrap">{JSON.stringify(analysis,null,2)}</pre>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Grade hero */}
      <motion.div initial={{opacity:0,scale:0.92}} animate={{opacity:1,scale:1}} transition={{duration:0.5}}
        className={`rounded-2xl border p-8 text-center ${gradeBg(grade)}`}>
        {pickedColor && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-4 h-4 rounded-full border border-zinc-600" style={{backgroundColor:pickedColor.hex}}/>
            <span className="text-xs text-zinc-400 capitalize">{pickedColor.label} route</span>
          </div>
        )}
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-1">V-Scale Grade</p>
        <h2 className={`text-7xl font-black tracking-tight leading-none ${gradeColor(grade)}`}>{grade}</h2>
        <p className={`text-sm font-medium mt-2 ${gradeColor(grade)} opacity-70`}>{gradeLabel(grade)}</p>
        {analysis.estimated_wall_height_m && (
          <div className="flex items-center justify-center gap-2 mt-5 pt-5 border-t border-zinc-700/50 text-zinc-400">
            <Ruler className="w-4 h-4"/>
            <span className="text-sm">Est. wall height: ~{analysis.estimated_wall_height_m}m
              <span className="text-zinc-500 ml-1">({(analysis.estimated_wall_height_m*3.281).toFixed(1)}ft)</span>
            </span>
          </div>
        )}
      </motion.div>

      {/* Grade reasoning */}
      {analysis.grade_reasoning && (
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.05}}
          className="flex gap-3 bg-zinc-900/40 border border-zinc-800/60 rounded-xl px-4 py-3">
          <Info className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5"/>
          <p className="text-xs text-zinc-400 leading-relaxed">{analysis.grade_reasoning}</p>
        </motion.div>
      )}

      {/* Grade breakdown (collapsible) */}
      <GradeBreakdown breakdown={analysis.grade_breakdown} numericScore={analysis.numeric_score}/>

      {/* Climbing animation */}
      {analysis.holds?.length > 0 && imageUrl && startIndices?.length > 0 && endIndices?.length > 0 && (
        <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.08}}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
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
        </motion.div>
      )}

      {/* Hold gallery */}
      {analysis.holds?.length > 0 && imageUrl && (
        <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.1}}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
          <HoldGallery holds={analysis.holds} imageUrl={imageUrl}
            wallTopY={analysis.wall_top_y??0} wallBottomY={analysis.wall_bottom_y??100}/>
        </motion.div>
      )}

      {/* Step-by-step beta */}
      {analysis.move_description && (
        <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.15}}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <ListOrdered className="w-4 h-4 text-orange-400"/>
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Step-by-Step Beta</span>
          </div>
          <BetaSteps text={analysis.move_description}/>
        </motion.div>
      )}

      {/* Hold analysis + tips */}
      <div className="grid gap-4 sm:grid-cols-2">
        {analysis.hold_analysis && (
          <InfoCard icon={Hand} label="Hold Analysis" delay={0.2}>{analysis.hold_analysis}</InfoCard>
        )}
        {analysis.tips && (
          <InfoCard icon={Lightbulb} label="Beta Tips" delay={0.25}>{analysis.tips}</InfoCard>
        )}
      </div>
    </div>
  );
}