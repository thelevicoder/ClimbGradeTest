import React, { useState } from "react";
import { Mountain, Zap, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";

import PhotoUploader from "../components/PhotoUploader";
import ImageColorPicker from "../components/ImageColorPicker";
import HeightInput from "../components/HeightInput";
import AnalysisResults from "../components/AnalysisResults";

export default function ScanPage() {
  const [imageUrl, setImageUrl] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pickedColor, setPickedColor] = useState(null);
  const [heightCm, setHeightCm] = useState(170);
  const [analysis, setAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const canAnalyze = imageUrl && pickedColor && !isAnalyzing;

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setAnalysis(null);

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert indoor bouldering route grader and climbing coach. Analyze this photo of an indoor bouldering wall.

The climber tapped on a specific hold in the image. That hold has the following sampled color:
- Hex: ${pickedColor.hex}
- RGB: (${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b})
- Approximate color label: ${pickedColor.label}

Use this sampled color to identify ALL holds that belong to this route. Important: account for lighting differences across the wall — holds of the same color may appear slightly different in darker or brighter areas of the wall. Look for holds with this hue range throughout the entire image.

The climber's height is ${heightCm}cm (${Math.floor(heightCm / 2.54 / 12)}'${Math.round((heightCm / 2.54) % 12)}").

Please analyze the route formed by these holds and respond with the following JSON fields:

1. v_grade: A single V-scale rating string like "V3" or "V5" or "V0". This MUST be a specific grade like V0, V1, V2, V3, V4, V5, V6, V7, V8, V9, V10, V11 etc. Do not leave this vague — commit to a specific grade.

2. estimated_wall_height_m: A number — the estimated wall height in meters based on holds, panels, and any visible reference points.

3. hold_analysis: A paragraph describing the types of holds you identified with this color (jugs, crimps, slopers, pinches, volumes etc.) and how they contribute to the difficulty.

4. move_description: A paragraph describing the likely move sequence / beta for this route, including body positioning, heel hooks, dynos, or any notable cruxes.

5. tips: 2–3 practical tips for someone of ${heightCm}cm height attempting this route.

6. grade_reasoning: A sentence explaining why you chose that specific V grade.

Be specific and decisive. Do not hedge the grade.`,
      file_urls: [imageUrl],
      response_json_schema: {
        type: "object",
        properties: {
          v_grade: { type: "string" },
          estimated_wall_height_m: { type: "number" },
          hold_analysis: { type: "string" },
          move_description: { type: "string" },
          tips: { type: "string" },
          grade_reasoning: { type: "string" }
        },
        required: ["v_grade", "estimated_wall_height_m", "hold_analysis", "move_description", "tips", "grade_reasoning"]
      },
      model: "claude_sonnet_4_6"
    });

    console.log("AI analysis result:", JSON.stringify(result));
    setAnalysis(result);

    await base44.entities.ClimbAnalysis.create({
      image_url: imageUrl,
      hold_color: pickedColor.label,
      user_height_cm: heightCm,
      v_grade: result.v_grade,
      estimated_wall_height_m: result.estimated_wall_height_m,
      move_description: result.move_description,
      hold_analysis: result.hold_analysis,
      tips: result.tips
    });

    setIsAnalyzing(false);
  };

  const handleReset = () => {
    setImageUrl(null);
    setPickedColor(null);
    setHeightCm(170);
    setAnalysis(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-zinc-400 hover:text-white"
            >
              <RotateCcw className="w-4 h-4 mr-1.5" />
              New Scan
            </Button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-24">

        {/* Step 1: Upload */}
        {!imageUrl && (
          <section>
            <StepLabel number={1} label="Scan the Wall" />
            <PhotoUploader
              imageUrl={imageUrl}
              onImageUploaded={(url) => { setImageUrl(url); setPickedColor(null); setAnalysis(null); }}
              isUploading={isUploading}
              setIsUploading={setIsUploading}
            />
          </section>
        )}

        {/* Step 2: Tap a hold to pick color */}
        <AnimatePresence>
          {imageUrl && !analysis && (
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <StepLabel number={2} label="Tap a Hold to Identify the Route" />
              <ImageColorPicker
                imageUrl={imageUrl}
                onColorPicked={setPickedColor}
                pickedColor={pickedColor}
              />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Step 3: Height */}
        <AnimatePresence>
          {imageUrl && pickedColor && !analysis && (
            <motion.section
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <StepLabel number={3} label="Your Height" />
              <HeightInput heightCm={heightCm} onHeightChange={setHeightCm} />
            </motion.section>
          )}
        </AnimatePresence>

        {/* Analyze Button */}
        <AnimatePresence>
          {imageUrl && pickedColor && !analysis && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
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
                    Grade This Route
                  </div>
                )}
              </Button>
              <p className="text-xs text-zinc-600 text-center mt-2">
                AI will find all matching holds and grade the route
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        <AnimatePresence>
          {analysis && (
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              <AnalysisResults analysis={analysis} pickedColor={pickedColor} />
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