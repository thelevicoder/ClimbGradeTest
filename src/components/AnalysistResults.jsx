import React from "react";
import { TrendingUp, Hand, Lightbulb, Ruler, Info } from "lucide-react";
import { motion } from "framer-motion";
import HoldGallery from "./HoldGallery";

const gradeNum = (grade) => {
  if (!grade) return -1;
  const m = grade.match(/\d+/);
  return m ? parseInt(m[0]) : -1;
};

const gradeColor = (grade) => {
  const n = gradeNum(grade);
  if (n <= 1) return "text-green-400";
  if (n <= 3) return "text-lime-400";
  if (n <= 5) return "text-yellow-400";
  if (n <= 7) return "text-orange-400";
  if (n <= 9) return "text-red-400";
  return "text-rose-400";
};

const gradeBg = (grade) => {
  const n = gradeNum(grade);
  if (n <= 1) return "bg-green-500/10 border-green-500/30";
  if (n <= 3) return "bg-lime-500/10 border-lime-500/30";
  if (n <= 5) return "bg-yellow-500/10 border-yellow-500/30";
  if (n <= 7) return "bg-orange-500/10 border-orange-500/30";
  if (n <= 9) return "bg-red-500/10 border-red-500/30";
  return "bg-rose-500/10 border-rose-500/30";
};

const gradeLabel = (grade) => {
  const n = gradeNum(grade);
  if (n <= 1) return "Beginner";
  if (n <= 3) return "Intermediate";
  if (n <= 5) return "Advanced";
  if (n <= 7) return "Expert";
  if (n <= 9) return "Elite";
  return "World Class";
};

function InfoCard({ icon: Icon, label, children, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: "easeOut" }}
      className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-orange-400" />
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-sm text-zinc-300 leading-relaxed">{children}</div>
    </motion.div>
  );
}

export default function AnalysisResults({ analysis, pickedColor, imageUrl }) {
  if (!analysis) return null;

  const grade = analysis.v_grade || analysis.grade || null;

  if (!grade) {
    return (
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-3">
        <p className="text-zinc-300 font-semibold">Analysis complete — raw response:</p>
        <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all overflow-auto max-h-64">
          {JSON.stringify(analysis, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* V-Grade Hero */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className={`rounded-2xl border p-8 text-center ${gradeBg(grade)}`}
      >
        {pickedColor && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-4 h-4 rounded-full border border-zinc-600" style={{ backgroundColor: pickedColor.hex }} />
            <span className="text-xs text-zinc-400 capitalize">{pickedColor.label} route</span>
          </div>
        )}
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-1">V-Scale Grade</p>
        <h2 className={`text-7xl font-black tracking-tight leading-none ${gradeColor(grade)}`}>
          {grade}
        </h2>
        <p className={`text-sm font-medium mt-2 ${gradeColor(grade)} opacity-70`}>
          {gradeLabel(grade)}
        </p>
        {analysis.estimated_wall_height_m && (
          <div className="flex items-center justify-center gap-2 mt-5 pt-5 border-t border-zinc-700/50 text-zinc-400">
            <Ruler className="w-4 h-4" />
            <span className="text-sm">
              Est. wall height: ~{analysis.estimated_wall_height_m}m
              <span className="text-zinc-500 ml-1">
                ({(analysis.estimated_wall_height_m * 3.281).toFixed(1)}ft)
              </span>
            </span>
          </div>
        )}
      </motion.div>

      {/* Grade Reasoning */}
      {analysis.grade_reasoning && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.3 }}
          className="flex gap-3 bg-zinc-900/40 border border-zinc-800/60 rounded-xl px-4 py-3"
        >
          <Info className="w-4 h-4 text-zinc-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-zinc-400 leading-relaxed">{analysis.grade_reasoning}</p>
        </motion.div>
      )}

      {/* Hold Gallery */}
      {analysis.holds && analysis.holds.length > 0 && imageUrl && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5"
        >
          <HoldGallery holds={analysis.holds} imageUrl={imageUrl} />
        </motion.div>
      )}

      {/* Details Grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {analysis.hold_analysis && (
          <InfoCard icon={Hand} label="Hold Analysis" delay={0.2}>
            {analysis.hold_analysis}
          </InfoCard>
        )}
        {analysis.move_description && (
          <InfoCard icon={TrendingUp} label="Move Breakdown" delay={0.3}>
            {analysis.move_description}
          </InfoCard>
        )}
      </div>

      {analysis.tips && (
        <InfoCard icon={Lightbulb} label="Beta Tips" delay={0.4}>
          {analysis.tips}
        </InfoCard>
      )}
    </div>
  );
}
