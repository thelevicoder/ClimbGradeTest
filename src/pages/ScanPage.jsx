import React, { useState } from "react";
import { Search, Zap, RotateCcw } from "lucide-react";
import { api } from "@/api/client";
import { motion, AnimatePresence } from "framer-motion";

import PhotoUploader    from "../components/PhotoUploader";
import ImageColorPicker from "../components/ImageColorPicker";
import HeightInput      from "../components/HeightInput";
import BoundarySelector from "../components/BoundarySelector";
import HoldSelector     from "../components/HoldSelector";
import AnalysisResults  from "../components/AnalysistResults";

const STEP_DESC = {
  1: 'Step 1: Upload your climbing wall image.',
  2: 'Step 2: Identify route color, set boundaries & height, then detect holds.',
  3: 'Step 3: Mark start & finish holds, then submit for grading.',
};

// Dark-teal card container
function TealCard({ children, className = '' }) {
  return (
    <div className={`bg-[#3d6b5e] rounded-3xl p-5 ${className}`}>
      {children}
    </div>
  );
}

// Section heading inside a teal card
function CardHeading({ children }) {
  return (
    <p className="text-white font-bold text-base mb-4">{children}</p>
  );
}

// Pill-style step label bar
function StepBar({ step }) {
  const desc = STEP_DESC[step];
  if (!desc) return null;
  return (
    <div className="bg-[#2e5148] rounded-2xl px-5 py-3 text-center mb-5">
      <p className="text-white text-sm font-semibold">{desc}</p>
    </div>
  );
}

// Cyan primary button
function CyanBtn({ onClick, disabled, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        bg-[#4ec9d6] hover:bg-[#3ab9c6] active:bg-[#32aab8] text-white font-bold
        rounded-full px-8 py-3 uppercase tracking-widest text-sm transition-all
        disabled:opacity-40 disabled:cursor-not-allowed
        ${className}
      `}
    >
      {children}
    </button>
  );
}

// Red reset button
function RedBtn({ onClick, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`
        bg-[#c94a4a] hover:bg-[#b83f3f] active:bg-[#a83636] text-white font-bold
        rounded-full px-8 py-3 uppercase tracking-widest text-sm transition-all
        ${className}
      `}
    >
      {children}
    </button>
  );
}

export default function ScanPage() {
  const [imageUrl,      setImageUrl]      = useState(null);
  const [isUploading,   setIsUploading]   = useState(false);
  const [pickedColor,   setPickedColor]   = useState(null);
  const [heightCm,      setHeightCm]      = useState(170);

  const [leftBoundary,  setLeftBoundary]  = useState(5);
  const [rightBoundary, setRightBoundary] = useState(95);

  const [isDetecting,   setIsDetecting]   = useState(false);
  const [detectedHolds, setDetectedHolds] = useState(null);
  const [wallTopY,      setWallTopY]      = useState(0);
  const [wallBottomY,   setWallBottomY]   = useState(100);

  const [startIndices,  setStartIndices]  = useState([]);
  const [endIndices,    setEndIndices]    = useState([]);

  const [isAnalyzing,   setIsAnalyzing]   = useState(false);
  const [analysis,      setAnalysis]      = useState(null);
  const [error,         setError]         = useState(null);

  const canDetect  = imageUrl && pickedColor && !isDetecting;
  const canAnalyze = detectedHolds && startIndices.length > 0 && endIndices.length > 0 && !isAnalyzing;

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
        setError('No holds detected. Try adjusting boundaries or re-tapping the hold color.');
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
    <div className="min-h-screen bg-[#f0ece2]">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="pt-7 pb-5 text-center">
        <div className="flex items-center justify-center gap-3">
          <span className="text-4xl select-none">🧗</span>
          <h1 className="text-2xl font-black text-[#1e3a30] tracking-tight">
            BOULDER AI: Route Grader
          </h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-5 pb-20 space-y-5">

        {/* ── Step 1: No image yet ────────────────────────────────── */}
        <AnimatePresence>
          {!imageUrl && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
            >
              <TealCard>
                <div className="bg-[#2e5148] rounded-2xl px-5 py-3 text-center mb-6">
                  <p className="text-white text-sm font-semibold">
                    Step 1: Upload your climbing wall image.
                  </p>
                </div>
                <PhotoUploader
                  imageUrl={imageUrl}
                  onImageUploaded={(url) => {
                    setImageUrl(url);
                    setPickedColor(null);
                    setDetectedHolds(null);
                    setAnalysis(null);
                  }}
                  isUploading={isUploading}
                  setIsUploading={setIsUploading}
                />
              </TealCard>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Step 2: Setup (color, boundaries, height, detect) ──── */}
        <AnimatePresence>
          {imageUrl && !detectedHolds && !analysis && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <StepBar step={2} />

              {/* Color picker */}
              <TealCard>
                <CardHeading>Tap a hold to identify the route color:</CardHeading>
                <ImageColorPicker
                  imageUrl={imageUrl}
                  onColorPicked={handleColorPicked}
                  pickedColor={pickedColor}
                />
              </TealCard>

              {/* Boundaries */}
              {pickedColor && (
                <TealCard>
                  <CardHeading>Set left & right wall boundaries:</CardHeading>
                  <BoundarySelector
                    imageUrl={imageUrl}
                    leftBoundary={leftBoundary}
                    rightBoundary={rightBoundary}
                    onBoundaryChange={(l, r) => {
                      setLeftBoundary(l); setRightBoundary(r);
                      setDetectedHolds(null); setStartIndices([]); setEndIndices([]);
                    }}
                  />
                </TealCard>
              )}

              {/* Height */}
              {pickedColor && (
                <TealCard>
                  <CardHeading>Your height:</CardHeading>
                  <HeightInput heightCm={heightCm} onHeightChange={setHeightCm} />
                </TealCard>
              )}

              {/* Detect button */}
              {pickedColor && (
                <div className="flex justify-center pt-1">
                  <CyanBtn
                    onClick={handleDetect}
                    disabled={!canDetect}
                    className="w-full"
                  >
                    {isDetecting ? (
                      <span className="flex items-center justify-center gap-2.5">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                        Scanning wall...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <Search className="w-4 h-4" />
                        Find Holds on Wall
                      </span>
                    )}
                  </CyanBtn>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Step 3: Mark holds & grade ─────────────────────────── */}
        <AnimatePresence>
          {detectedHolds && !analysis && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <StepBar step={3} />

              {/* Hold selector */}
              <TealCard>
                <CardHeading>
                  Mark start & finish holds ({detectedHolds.length} holds found):
                </CardHeading>
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
              </TealCard>

              {/* Review summary */}
              <TealCard>
                <CardHeading>Review your selections:</CardHeading>
                <ul className="space-y-2 text-white/90 text-sm mb-5">
                  <li>
                    <span className="font-semibold text-white/60">Route color: </span>
                    {pickedColor ? (
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-full border border-white/30"
                          style={{ backgroundColor: pickedColor.hex }}
                        />
                        <span className="capitalize">{pickedColor.label}</span>
                      </span>
                    ) : '—'}
                  </li>
                  <li>
                    <span className="font-semibold text-white/60">Start hold: </span>
                    {startIndices.length === 0 ? (
                      <span className="text-[#f8c96a]">Not set</span>
                    ) : startIndices.map(i => (
                      <span key={i} className="inline-block bg-[#2e5148] rounded-full px-3 py-0.5 text-xs mr-1.5">
                        Hold {i + 1}
                      </span>
                    ))}
                  </li>
                  <li>
                    <span className="font-semibold text-white/60">Finish hold: </span>
                    {endIndices.length === 0 ? (
                      <span className="text-[#f8c96a]">Not set</span>
                    ) : endIndices.map(i => (
                      <span key={i} className="inline-block bg-[#2e5148] rounded-full px-3 py-0.5 text-xs mr-1.5">
                        Hold {i + 1}
                      </span>
                    ))}
                  </li>
                  <li>
                    <span className="font-semibold text-white/60">Height: </span>
                    {heightCm} cm
                  </li>
                </ul>

                <div className="flex gap-3">
                  <RedBtn onClick={handleReset}>Reset</RedBtn>
                  <CyanBtn
                    onClick={handleAnalyze}
                    disabled={!canAnalyze}
                    className="flex-1"
                  >
                    {isAnalyzing ? (
                      <span className="flex items-center justify-center gap-2.5">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                        Grading...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <Zap className="w-4 h-4" />
                        Submit for Grading
                      </span>
                    )}
                  </CyanBtn>
                </div>

                {!canAnalyze && detectedHolds && (
                  <p className="text-white/40 text-xs text-center mt-3">
                    {startIndices.length === 0
                      ? 'Tap a start hold on the image above first'
                      : 'Tap a finish hold on the image above first'}
                  </p>
                )}
              </TealCard>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Error ──────────────────────────────────────────────── */}
        {error && (
          <div className="bg-[#c94a4a]/20 border border-[#c94a4a]/40 rounded-2xl px-5 py-3 text-[#f8a0a0] text-sm">
            {error}
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────── */}
        <AnimatePresence>
          {analysis && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              {/* New scan button */}
              <div className="flex justify-center mb-5">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 text-[#2d5a4e] font-semibold text-sm hover:text-[#1e3a30] transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Grade a new route
                </button>
              </div>

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
