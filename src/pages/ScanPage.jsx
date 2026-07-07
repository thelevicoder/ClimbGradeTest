import React, { useState } from "react";
import { Mountain, RotateCcw, Search, Zap, ChevronRight } from "lucide-react";
import { api } from "@/api/client";
import { motion, AnimatePresence } from "framer-motion";

import PhotoUploader    from "../components/PhotoUploader";
import ImageColorPicker from "../components/ImageColorPicker";
import HeightInput      from "../components/HeightInput";
import BoundarySelector from "../components/BoundarySelector";
import HoldSelector     from "../components/HoldSelector";
import AnalysisResults  from "../components/AnalysistResults";

const STEPS = ['Photo', 'Color', 'Setup', 'Route', 'Grade'];

function getStepIndex({ imageUrl, pickedColor, detectedHolds, analysis }) {
  if (analysis)      return 4;
  if (detectedHolds) return 3;
  if (pickedColor)   return 2;
  if (imageUrl)      return 1;
  return 0;
}

function StepBar({ current }) {
  return (
    <div className="flex items-center px-5 pt-3 pb-5">
      {STEPS.map((label, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center gap-1.5">
            <div className={`
              w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300
              ${i < current
                ? 'bg-orange-500 text-white'
                : i === current
                  ? 'bg-orange-500 text-white ring-[3px] ring-orange-500/25 ring-offset-1 ring-offset-black'
                  : 'bg-zinc-900 border border-zinc-800 text-zinc-600'}
            `}>
              {i < current ? (
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : i + 1}
            </div>
            <span className={`text-[8px] font-semibold tracking-widest uppercase ${i <= current ? 'text-orange-400' : 'text-zinc-700'}`}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-px mb-4 mx-1 transition-all duration-500 ${i < current ? 'bg-orange-500/40' : 'bg-zinc-800'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-zinc-950 border border-zinc-800/70 rounded-2xl overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

function CardSection({ label, hint, children }) {
  return (
    <Card>
      <div className="px-5 pt-5 pb-1">
        <p className="text-xs font-bold tracking-widest uppercase text-zinc-500">{label}</p>
        {hint && <p className="text-xs text-zinc-600 mt-0.5">{hint}</p>}
      </div>
      <div className="p-5 pt-3">{children}</div>
    </Card>
  );
}

export default function ScanPage() {
  const [imageUrl,     setImageUrl]     = useState(null);
  const [isUploading,  setIsUploading]  = useState(false);
  const [pickedColor,  setPickedColor]  = useState(null);
  const [heightCm,     setHeightCm]     = useState(170);

  const [leftBoundary,  setLeftBoundary]  = useState(5);
  const [rightBoundary, setRightBoundary] = useState(95);

  const [isDetecting,   setIsDetecting]   = useState(false);
  const [detectedHolds, setDetectedHolds] = useState(null);
  const [wallTopY,      setWallTopY]      = useState(0);
  const [wallBottomY,   setWallBottomY]   = useState(100);

  const [startIndices, setStartIndices] = useState([]);
  const [endIndices,   setEndIndices]   = useState([]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis,    setAnalysis]    = useState(null);
  const [error,       setError]       = useState(null);

  const canDetect  = imageUrl && pickedColor && !isDetecting;
  const canAnalyze = detectedHolds && startIndices.length > 0 && endIndices.length > 0 && !isAnalyzing;
  const step       = getStepIndex({ imageUrl, pickedColor, detectedHolds, analysis });

  const handleDetect = async () => {
    setIsDetecting(true);
    setDetectedHolds(null);
    setStartIndices([]);
    setEndIndices([]);
    setAnalysis(null);
    setError(null);
    try {
      const result = await api.detectHolds({
        image_url:      imageUrl,
        hold_rgb:       `${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b}`,
        left_boundary:  leftBoundary,
        right_boundary: rightBoundary,
      });
      setDetectedHolds(result.holds);
      setWallTopY(result.wall_top_y);
      setWallBottomY(result.wall_bottom_y);
      if (result.holds.length === 0)
        setError("No holds detected. Try adjusting boundaries or re-tapping the hold color.");
    } catch (err) {
      setError('Hold detection failed: ' + err.message);
    } finally {
      setIsDetecting(false);
    }
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setAnalysis(null);
    setError(null);
    try {
      const result = await api.analyzeClimb({
        image_url:               imageUrl,
        hold_color:              pickedColor.label,
        hold_hex:                pickedColor.hex,
        hold_rgb:                `${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b}`,
        user_height_cm:          heightCm,
        holds:                   detectedHolds,
        wall_top_y:              wallTopY,
        wall_bottom_y:           wallBottomY,
        start_indices:           startIndices,
        end_indices:             endIndices,
        estimated_wall_height_m: 4.0,
      });
      setAnalysis(result);
      api.saveAnalysis({
        image_url: imageUrl, hold_color: pickedColor.label,
        user_height_cm: heightCm, v_grade: result.v_grade,
        estimated_wall_height_m: result.estimated_wall_height_m,
        move_description: result.move_description,
        hold_analysis: result.hold_analysis, tips: result.tips,
      }).catch(console.error);
    } catch (err) {
      setError('Analysis failed: ' + err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    setImageUrl(null); setPickedColor(null); setHeightCm(170);
    setLeftBoundary(5); setRightBoundary(95);
    setDetectedHolds(null); setStartIndices([]); setEndIndices([]);
    setAnalysis(null); setError(null);
  };

  const handleColorPicked = (c) => {
    setPickedColor(c);
    setDetectedHolds(null);
    setStartIndices([]); setEndIndices([]);
    setAnalysis(null);
  };

  return (
    <div className="min-h-screen bg-black text-white">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-lg mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-500 flex items-center justify-center shadow-[0_0_14px_rgba(249,115,22,0.45)]">
              <Mountain className="w-4 h-4 text-white" />
            </div>
            <span className="font-black text-[15px] tracking-tight">
              BOULDER<span className="text-orange-500"> AI</span>
            </span>
          </div>

          {(imageUrl || analysis) && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
            >
              <RotateCcw className="w-3 h-3" />
              New scan
            </button>
          )}
        </div>

        {imageUrl && (
          <div className="max-w-lg mx-auto">
            <StepBar current={step} />
          </div>
        )}
      </header>

      <main className="max-w-lg mx-auto px-5 py-8 space-y-5 pb-32">

        {/* ── Step 1: Upload ─────────────────────────────────────────── */}
        <AnimatePresence>
          {!imageUrl && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35 }}
            >
              <div className="text-center pt-6 pb-8">
                <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-orange-500 flex items-center justify-center shadow-[0_0_40px_rgba(249,115,22,0.35)]">
                  <Mountain className="w-8 h-8 text-white" />
                </div>
                <h1 className="text-3xl font-black tracking-tight">Grade Your Route</h1>
                <p className="text-zinc-500 text-sm mt-2">AI-powered V-scale grading from a photo</p>
              </div>
              <PhotoUploader
                imageUrl={imageUrl}
                onImageUploaded={(url) => { setImageUrl(url); setPickedColor(null); setDetectedHolds(null); setAnalysis(null); }}
                isUploading={isUploading}
                setIsUploading={setIsUploading}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Step 2: Color picker ────────────────────────────────────── */}
        <AnimatePresence>
          {imageUrl && !analysis && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <CardSection label="Route Color" hint="Tap any hold that belongs to your route">
                <ImageColorPicker imageUrl={imageUrl} onColorPicked={handleColorPicked} pickedColor={pickedColor} />
              </CardSection>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Step 3a: Boundaries ─────────────────────────────────────── */}
        <AnimatePresence>
          {imageUrl && pickedColor && !analysis && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <CardSection label="Wall Boundaries" hint="Drag handles to exclude other routes">
                <BoundarySelector
                  imageUrl={imageUrl}
                  leftBoundary={leftBoundary}
                  rightBoundary={rightBoundary}
                  onBoundaryChange={(l, r) => {
                    setLeftBoundary(l); setRightBoundary(r);
                    setDetectedHolds(null); setStartIndices([]); setEndIndices([]);
                  }}
                />
              </CardSection>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Step 3b: Height ─────────────────────────────────────────── */}
        <AnimatePresence>
          {imageUrl && pickedColor && !analysis && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <CardSection label="Climber Height" hint="Used to estimate real-world move distances">
                <HeightInput heightCm={heightCm} onHeightChange={setHeightCm} />
              </CardSection>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Detect button ───────────────────────────────────────────── */}
        <AnimatePresence>
          {imageUrl && pickedColor && !detectedHolds && !analysis && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <button
                onClick={handleDetect}
                disabled={!canDetect}
                className="w-full h-12 rounded-xl text-sm font-bold flex items-center justify-center gap-2.5 transition-all
                  bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800 text-white
                  disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {isDetecting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
                    Scanning wall...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 text-zinc-400" />
                    Find Holds on Wall
                    <ChevronRight className="w-4 h-4 text-zinc-600 ml-auto" />
                  </>
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Step 4: Mark start / finish ─────────────────────────────── */}
        <AnimatePresence>
          {detectedHolds && !analysis && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <CardSection
                label="Mark Route"
                hint={`${detectedHolds.length} holds detected — tap to set start (green) and finish (red)`}
              >
                <HoldSelector
                  imageUrl={imageUrl}
                  holds={detectedHolds}
                  wallTopY={wallTopY}
                  wallBottomY={wallBottomY}
                  startIndices={startIndices}
                  endIndices={endIndices}
                  onStartChange={setStartIndices}
                  onEndChange={setEndIndices}
                />
              </CardSection>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Error ───────────────────────────────────────────────────── */}
        {error && (
          <div className="flex gap-3 items-start bg-red-500/8 border border-red-500/25 rounded-xl px-4 py-3 text-sm text-red-400">
            <span className="text-red-500 font-bold mt-0.5">!</span>
            {error}
          </div>
        )}

        {/* ── Grade CTA ───────────────────────────────────────────────── */}
        <AnimatePresence>
          {detectedHolds && !analysis && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-2">
              <button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                className="w-full h-14 rounded-2xl text-base font-black flex items-center justify-center gap-3 transition-all
                  bg-orange-500 hover:bg-orange-400 text-white
                  shadow-[0_0_28px_rgba(249,115,22,0.4)] hover:shadow-[0_0_40px_rgba(249,115,22,0.55)]
                  disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none active:scale-[0.98]"
              >
                {isAnalyzing ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5" />
                    {!canAnalyze && detectedHolds
                      ? startIndices.length === 0 ? 'Set a start hold first'
                        : 'Set a finish hold first'
                      : 'Grade This Route'}
                  </>
                )}
              </button>

              {!canAnalyze && detectedHolds && (
                <p className="text-[11px] text-zinc-600 text-center">
                  Mark start and finish holds on the image above
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Results ─────────────────────────────────────────────────── */}
        <AnimatePresence>
          {analysis && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
              <AnalysisResults
                analysis={analysis}
                pickedColor={pickedColor}
                imageUrl={imageUrl}
                userHeightCm={heightCm}
                startIndices={startIndices}
                endIndices={endIndices}
              />
            </motion.div>
          )}
        </AnimatePresence>

      </main>
    </div>
  );
}
