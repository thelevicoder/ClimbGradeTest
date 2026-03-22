import React, { useState } from "react";
import { Mountain, Zap, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import { motion, AnimatePresence } from "framer-motion";

import PhotoUploader    from "../components/PhotoUploader";
import ImageColorPicker from "../components/ImageColorPicker";
import HeightInput      from "../components/HeightInput";
import BoundarySelector from "../components/Boundaryselector.jsx";
import HoldSelector     from "../components/HoldSelector";
import AnalysisResults  from "../components/AnalysistResults";

export default function ScanPage() {
  const [imageUrl,   setImageUrl]   = useState(null);
  const [isUploading,setIsUploading]= useState(false);
  const [pickedColor,setPickedColor]= useState(null);
  const [heightCm,   setHeightCm]   = useState(170);

  // Boundaries (% of image width)
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
      if (result.holds.length === 0) {
        setError("No holds detected. Try adjusting the boundaries or re-tapping the hold color.");
      }
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
        image_url:      imageUrl,
        hold_color:     pickedColor.label,
        hold_hex:       pickedColor.hex,
        hold_rgb:       `${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b}`,
        user_height_cm: heightCm,
        holds:          detectedHolds,
        wall_top_y:     wallTopY,
        wall_bottom_y:  wallBottomY,
        start_indices:  startIndices,
        end_indices:    endIndices,
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
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="sticky top-0 z-50 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800/50">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-rose-600 flex items-center justify-center">
              <Mountain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Boulder AI</h1>
              <p className="text-xs text-zinc-500 -mt-0.5">Route Grader</p>
            </div>
          </div>
          {(imageUrl || analysis) && (
            <Button variant="ghost" size="sm" onClick={handleReset} className="text-zinc-400 hover:text-white">
              <RotateCcw className="w-4 h-4 mr-1.5" />New Scan
            </Button>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-24">

        {/* Step 1: Upload */}
        {!imageUrl && (
          <section>
            <StepLabel number={1} label="Scan the Wall" />
            <PhotoUploader
              imageUrl={imageUrl}
              onImageUploaded={(url) => { setImageUrl(url); setPickedColor(null); setDetectedHolds(null); setAnalysis(null); }}
              isUploading={isUploading}
              setIsUploading={setIsUploading}
            />
          </section>
        )}

        {/* Step 2: Pick color */}
        <AnimatePresence>
          {imageUrl && !analysis && (
            <motion.section initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} transition={{ duration:0.3 }}>
              <StepLabel number={2} label="Tap a Hold to Identify the Route Color" />
              <ImageColorPicker imageUrl={imageUrl} onColorPicked={handleColorPicked} pickedColor={pickedColor} />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Step 3: Set boundaries */}
        <AnimatePresence>
          {imageUrl && pickedColor && !analysis && (
            <motion.section initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} transition={{ duration:0.3 }}>
              <StepLabel number={3} label="Set Left & Right Boundaries" />
              <BoundarySelector
                imageUrl={imageUrl}
                leftBoundary={leftBoundary}
                rightBoundary={rightBoundary}
                onBoundaryChange={(l, r) => {
                  setLeftBoundary(l);
                  setRightBoundary(r);
                  setDetectedHolds(null);
                  setStartIndices([]); setEndIndices([]);
                }}
              />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Step 4: Height */}
        <AnimatePresence>
          {imageUrl && pickedColor && !analysis && (
            <motion.section initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} transition={{ duration:0.3 }}>
              <StepLabel number={4} label="Your Height" />
              <HeightInput heightCm={heightCm} onHeightChange={setHeightCm} />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Find Holds button */}
        <AnimatePresence>
          {imageUrl && pickedColor && !detectedHolds && !analysis && (
            <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} transition={{ duration:0.3 }}>
              <Button
                onClick={handleDetect}
                disabled={!canDetect}
                className="w-full h-12 rounded-xl text-sm font-semibold bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-600 transition-all disabled:opacity-40"
              >
                {isDetecting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Finding holds...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4" />
                    Find Holds on Wall
                  </div>
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step 5: Select start / finish */}
        <AnimatePresence>
          {detectedHolds && !analysis && (
            <motion.section initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} transition={{ duration:0.3 }}>
              <StepLabel number={5} label={`Mark Start & Finish Holds  (${detectedHolds.length} holds found)`} />
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
            </motion.section>
          )}
        </AnimatePresence>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Grade button */}
        <AnimatePresence>
          {detectedHolds && !analysis && (
            <motion.div initial={{ opacity:0,y:12 }} animate={{ opacity:1,y:0 }} transition={{ duration:0.3 }}>
              <Button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                className="w-full h-14 rounded-xl text-base font-semibold bg-gradient-to-r from-orange-500 to-rose-600 hover:from-orange-600 hover:to-rose-700 text-white border-0 shadow-lg shadow-orange-500/20 transition-all disabled:opacity-40"
              >
                {isAnalyzing ? (
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Analyzing route...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    {!canAnalyze && detectedHolds
                      ? startIndices.length === 0 ? 'Set a start hold first'
                      : 'Set a finish hold first'
                      : 'Grade This Route'}
                  </div>
                )}
              </Button>
              {!canAnalyze && detectedHolds && (
                <p className="text-xs text-zinc-600 text-center mt-2">
                  Tap holds above to mark start (🟢) and finish (🔴) before grading
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        <AnimatePresence>
          {analysis && (
            <motion.section initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.4 }}>
              <AnalysisResults analysis={analysis} pickedColor={pickedColor} imageUrl={imageUrl} />
            </motion.section>
          )}
        </AnimatePresence>

      </main>
    </div>
  );
}

function StepLabel({ number, label }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs font-bold flex items-center justify-center flex-shrink-0">
        {number}
      </span>
      <span className="text-sm font-medium text-zinc-300">{label}</span>
    </div>
  );
}