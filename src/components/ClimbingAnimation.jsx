import React, { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// FIGURE PROPORTIONS  (all as fraction of total standing height)
// ─────────────────────────────────────────────────────────────────────────────
const P = {
  headR:      0.075,   // head radius
  shoulderY:  0.18,    // shoulder Y below top of head
  hipY:       0.52,    // hip Y below top of head
  upperArm:   0.18,    // upper arm length
  foreArm:    0.16,    // forearm length
  upperLeg:   0.26,    // upper leg length
  lowerLeg:   0.25,    // lower leg length
  shoulderW:  0.11,    // half shoulder width
  hipW:       0.08,    // half hip width
};

const imageCache = {};
function loadImage(url) {
  if (imageCache[url]) return Promise.resolve(imageCache[url]);
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imageCache[url] = img; res(img); };
    img.onerror = rej;
    img.src = url;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// IK: two-bone chain — solve elbow/knee position
// given root, tip, upper-length, lower-length
// ─────────────────────────────────────────────────────────────────────────────
function solveTwoBone(root, tip, upperLen, lowerLen, bendDir = 1) {
  const dx = tip.x - root.x;
  const dy = tip.y - root.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxReach = upperLen + lowerLen;
  const d = Math.min(dist, maxReach * 0.98);

  // law of cosines
  const cosA = (upperLen * upperLen + d * d - lowerLen * lowerLen) / (2 * upperLen * d);
  const angleA = Math.acos(Math.max(-1, Math.min(1, cosA)));

  const baseAngle = Math.atan2(dy, dx);
  const jointAngle = baseAngle + bendDir * angleA;

  return {
    x: root.x + Math.cos(jointAngle) * upperLen,
    y: root.y + Math.sin(jointAngle) * upperLen,
  };
}

// Lerp helpers
const lerp    = (a, b, t) => a + (b - a) * t;
const lerpPt  = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const easeInOut = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// ─────────────────────────────────────────────────────────────────────────────
// Build poses from route holds
// ─────────────────────────────────────────────────────────────────────────────
function buildPoses(routeHolds, figH, canvasW, canvasH, wallTopY, wallBottomY) {
  const wallSpan = wallBottomY - wallTopY;

  // Convert hold % coords → canvas pixels
  const toPx = (hold) => ({
    x: (hold.x / 100) * canvasW,
    y: ((hold.y - wallTopY) / wallSpan) * canvasH,
  });

  const poses = [];

  for (let i = 0; i < routeHolds.length; i++) {
    const curr = toPx(routeHolds[i]);

    // Determine which hand is on this hold (alternate L/R, start hold = both or R)
    const isStart = routeHolds[i].is_start;
    const isEnd   = routeHolds[i].is_end;

    // Hand assignment: bottom hold (start) = right hand, alternate up
    const handSide = i % 2 === 0 ? "right" : "left";

    // Previous hold for other hand
    const prevPx = i > 0 ? toPx(routeHolds[i - 1]) : null;

    // Right hand and left hand positions
    let rHand, lHand;
    if (isStart && routeHolds.filter(h => h.is_start).length > 1) {
      // Two-hand start: find both start holds
      const starts = routeHolds.filter(h => h.is_start);
      const s0 = toPx(starts[0]), s1 = toPx(starts[1]);
      rHand = s0.x < s1.x ? s0 : s1; // left-most = left hand
      lHand = s0.x < s1.x ? s1 : s0;
    } else if (handSide === "right") {
      rHand = curr;
      lHand = prevPx || { x: curr.x - figH * P.shoulderW * 2, y: curr.y + figH * 0.1 };
    } else {
      lHand = curr;
      rHand = prevPx || { x: curr.x + figH * P.shoulderW * 2, y: curr.y + figH * 0.1 };
    }

    // Body position: hips below the midpoint of hands, weighted toward wall
    const handMid = lerpPt(lHand, rHand, 0.5);
    const hipY    = handMid.y + figH * (P.hipY - P.shoulderY) * 0.9;
    const hipX    = handMid.x;

    const hip = { x: hipX, y: hipY };

    // Feet: look for footholds nearby, else estimate
    const footL = { x: hip.x - figH * P.hipW * 1.2, y: hip.y + figH * (P.upperLeg + P.lowerLeg) * 0.85 };
    const footR = { x: hip.x + figH * P.hipW * 1.2, y: hip.y + figH * (P.upperLeg + P.lowerLeg) * 0.85 };

    // Clamp feet to canvas
    footL.y = Math.min(footL.y, canvasH * 0.97);
    footR.y = Math.min(footR.y, canvasH * 0.97);

    poses.push({ rHand, lHand, hip, footL, footR, holdPx: curr, handSide, isStart, isEnd });
  }

  return poses;
}

// ─────────────────────────────────────────────────────────────────────────────
// Draw figure at an interpolated pose
// ─────────────────────────────────────────────────────────────────────────────
function drawFigure(ctx, pose, figH, alpha = 1) {
  const { rHand, lHand, hip, footL, footR } = pose;

  // Shoulders
  const sY = hip.y - figH * (P.hipY - P.shoulderY);
  const sL = { x: hip.x - figH * P.shoulderW, y: sY };
  const sR = { x: hip.x + figH * P.shoulderW, y: sY };
  const hL = { x: hip.x - figH * P.hipW, y: hip.y };
  const hR = { x: hip.x + figH * P.hipW, y: hip.y };

  // Head
  const headCY = sY - figH * P.headR * 1.1;

  // Solve arm IK — elbows bend outward
  const elbowL = solveTwoBone(sL, lHand, figH * P.upperArm, figH * P.foreArm, -1);
  const elbowR = solveTwoBone(sR, rHand, figH * P.upperArm, figH * P.foreArm, 1);

  // Solve leg IK — knees bend forward (positive Y = toward viewer = outward)
  const kneeL = solveTwoBone(hL, footL, figH * P.upperLeg, figH * P.lowerLeg, 1);
  const kneeR = solveTwoBone(hR, footR, figH * P.upperLeg, figH * P.lowerLeg, -1);

  const lineW = Math.max(figH * 0.028, 3);
  ctx.globalAlpha = alpha;
  ctx.lineCap  = "round";
  ctx.lineJoin = "round";

  // ── Shadow ────────────────────────────────────────────────────────────────
  ctx.shadowColor   = "rgba(0,0,0,0.45)";
  ctx.shadowBlur    = figH * 0.05;
  ctx.shadowOffsetX = figH * 0.01;
  ctx.shadowOffsetY = figH * 0.01;

  // ── Legs ──────────────────────────────────────────────────────────────────
  const legColor = "#1a1a2e";
  ctx.strokeStyle = legColor;
  ctx.lineWidth   = lineW * 1.1;

  // Left leg
  ctx.beginPath(); ctx.moveTo(hL.x, hL.y); ctx.lineTo(kneeL.x, kneeL.y); ctx.lineTo(footL.x, footL.y); ctx.stroke();
  // Right leg
  ctx.beginPath(); ctx.moveTo(hR.x, hR.y); ctx.lineTo(kneeR.x, kneeR.y); ctx.lineTo(footR.x, footR.y); ctx.stroke();

  // Shoes
  [[footL, -1], [footR, 1]].forEach(([foot, side]) => {
    ctx.fillStyle = "#e74c3c";
    ctx.beginPath();
    ctx.ellipse(foot.x + side * figH * 0.025, foot.y, figH * 0.055, figH * 0.022, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // ── Torso ─────────────────────────────────────────────────────────────────
  ctx.fillStyle   = "#2980b9";
  ctx.strokeStyle = "#1a5276";
  ctx.lineWidth   = lineW * 0.4;

  // Draw torso as a tapered shape
  ctx.beginPath();
  ctx.moveTo(sL.x, sL.y);
  ctx.lineTo(sR.x, sR.y);
  ctx.lineTo(hR.x, hR.y);
  ctx.lineTo(hL.x, hL.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // ── Arms ──────────────────────────────────────────────────────────────────
  ctx.lineWidth = lineW;

  // Upper arms
  ctx.strokeStyle = "#1a1a2e";
  ctx.beginPath(); ctx.moveTo(sL.x, sL.y); ctx.lineTo(elbowL.x, elbowL.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sR.x, sR.y); ctx.lineTo(elbowR.x, elbowR.y); ctx.stroke();

  // Forearms
  ctx.strokeStyle = "#d4a877";
  ctx.lineWidth = lineW * 0.85;
  ctx.beginPath(); ctx.moveTo(elbowL.x, elbowL.y); ctx.lineTo(lHand.x, lHand.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(elbowR.x, elbowR.y); ctx.lineTo(rHand.x, rHand.y); ctx.stroke();

  // ── Hands on holds ────────────────────────────────────────────────────────
  [[lHand, "#e8c49a"], [rHand, "#e8c49a"]].forEach(([hand, col]) => {
    ctx.fillStyle   = col;
    ctx.strokeStyle = "#8b6914";
    ctx.lineWidth   = lineW * 0.3;
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, figH * 0.032, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  });

  // ── Head ──────────────────────────────────────────────────────────────────
  ctx.shadowBlur = 0;

  // Neck
  ctx.strokeStyle = "#d4a877";
  ctx.lineWidth   = lineW * 0.7;
  ctx.beginPath(); ctx.moveTo(hip.x, sY); ctx.lineTo(hip.x, headCY + figH * P.headR); ctx.stroke();

  // Head fill
  ctx.fillStyle   = "#f5cba7";
  ctx.strokeStyle = "#d4a877";
  ctx.lineWidth   = lineW * 0.3;
  ctx.beginPath();
  ctx.arc(hip.x, headCY, figH * P.headR, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // Hair
  ctx.fillStyle = "#2c1810";
  ctx.beginPath();
  ctx.arc(hip.x, headCY - figH * 0.01, figH * P.headR * 0.85, Math.PI, 2 * Math.PI);
  ctx.fill();

  // Eyes
  const eyeY = headCY - figH * 0.005;
  const eyeX = figH * 0.028;
  ctx.fillStyle = "#2c3e50";
  [-1, 1].forEach(side => {
    ctx.beginPath();
    ctx.arc(hip.x + side * eyeX, eyeY, figH * 0.012, 0, Math.PI * 2);
    ctx.fill();
  });

  // ── Helmet ────────────────────────────────────────────────────────────────
  ctx.fillStyle   = "#f39c12";
  ctx.strokeStyle = "#e67e22";
  ctx.lineWidth   = lineW * 0.3;
  ctx.beginPath();
  ctx.arc(hip.x, headCY, figH * P.headR * 1.05, Math.PI * 0.85, Math.PI * 2.15);
  ctx.fill(); ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function ClimbingAnimation({
  imageUrl, holds, wallTopY, wallBottomY,
  startIndices, endIndices,
  userHeightCm, estimatedWallHeightM = 4.0,
  moves,
}) {
  const canvasRef   = useRef(null);
  const imgRef      = useRef(null);
  const animRef     = useRef(null);
  const stateRef    = useRef({ t: 0, pose: 0, playing: false });

  const [aspect,     setAspect]     = useState(0.75);
  const [ready,      setReady]      = useState(false);
  const [playing,    setPlaying]    = useState(false);
  const [poseIndex,  setPoseIndex]  = useState(0);
  const [moveLabel,  setMoveLabel]  = useState('');
  const posesRef    = useRef([]);
  const figHRef     = useRef(0);

  // ── Build route hold sequence ─────────────────────────────────────────────
  const routeHolds = (() => {
    if (!holds || holds.length === 0) return [];
    // Find start hold(s)
    const starts = (startIndices || []).map(i => holds[i]).filter(Boolean);
    const end    = (endIndices   || []).map(i => holds[i]).filter(Boolean)[0];
    if (!starts.length || !end) return [];

    // All holds sorted bottom-to-top (high Y = bottom of wall = start)
    const sorted = holds
      .map((h, i) => ({ ...h, originalIndex: i }))
      .filter(h => h.type !== 'foothold')
      .sort((a, b) => b.y - a.y);

    // Slice from start to end
    const startY  = Math.max(...starts.map(h => h.y));
    const endY    = end.y;
    const route   = sorted.filter(h => h.y <= startY && h.y >= endY);

    // Make sure start and end are included
    if (!route.find(h => h.originalIndex === (startIndices[0]))) {
      route.unshift({ ...holds[startIndices[0]], originalIndex: startIndices[0] });
    }
    if (!route.find(h => h.originalIndex === (endIndices[0]))) {
      route.push({ ...holds[endIndices[0]], originalIndex: endIndices[0] });
    }

    return route;
  })();

  // Move descriptions array
  const moveDescriptions = (() => {
    if (!moves || moves.length === 0) return [];
    return moves.map((m, i) => `Move ${i + 1}: ${m.reachLabel} reach to ${m.toHold?.type || 'hold'} — ${m.distCm}cm`);
  })();

  // ── Load image and set up ─────────────────────────────────────────────────
  useEffect(() => {
    if (!imageUrl || routeHolds.length < 2) return;
    setReady(false);

    loadImage(imageUrl).then(img => {
      imgRef.current = img;

      const srcH  = img.naturalHeight * (wallBottomY - wallTopY) / 100;
      const ratio = srcH / img.naturalWidth;
      setAspect(ratio);

      // Compute canvas intrinsic resolution
      const CW = Math.min(900, img.naturalWidth);
      const CH = Math.round(CW * ratio);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = CW;
      canvas.height = CH;

      // Figure height in canvas pixels
      const wallHeightPx = CH;
      const figH = (userHeightCm / (estimatedWallHeightM * 100)) * wallHeightPx;
      figHRef.current = figH;

      // Build poses
      posesRef.current = buildPoses(routeHolds, figH, CW, CH, wallTopY, wallBottomY);
      stateRef.current = { t: 0, pose: 0, playing: false };
      setPoseIndex(0);
      setMoveLabel(moveDescriptions[0] || 'Start position');
      setReady(true);
    });
  }, [imageUrl, holds, wallTopY, wallBottomY, userHeightCm, estimatedWallHeightM]);

  // ── Render a single frame ─────────────────────────────────────────────────
  const renderFrame = useCallback((pIdx, t) => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    const poses  = posesRef.current;
    if (!canvas || !img || poses.length < 2) return;

    const CW = canvas.width, CH = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CW, CH);

    // Draw wall background
    const srcY  = (wallTopY  / 100) * img.naturalHeight;
    const srcH  = ((wallBottomY - wallTopY) / 100) * img.naturalHeight;
    ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, 0, CW, CH);

    // Dim background slightly so figure pops
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, CW, CH);

    // Draw hold circles for route holds
    const wallSpan = wallBottomY - wallTopY;
    routeHolds.forEach((hold, i) => {
      const cx = (hold.x / 100) * CW;
      const cy = ((hold.y - wallTopY) / wallSpan) * CH;
      const isActive = i === pIdx || i === pIdx + 1;
      const isStart  = hold.is_start;
      const isEnd    = hold.is_end;

      ctx.strokeStyle = isActive
        ? 'rgba(255,255,255,0.95)'
        : isStart ? 'rgba(34,197,94,0.8)'
        : isEnd   ? 'rgba(239,68,68,0.8)'
        : 'rgba(251,146,60,0.5)';
      ctx.lineWidth = isActive ? 2.5 : 1.5;
      ctx.setLineDash(isActive ? [] : [4, 3]);
      ctx.beginPath();
      ctx.arc(cx, cy, figHRef.current * 0.045, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Hold number
      if (isActive) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `bold ${Math.max(figHRef.current * 0.045, 10)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), cx, cy);
      }
    });

    // Interpolate between current and next pose
    const fromPose = poses[Math.min(pIdx, poses.length - 1)];
    const toPose   = poses[Math.min(pIdx + 1, poses.length - 1)];
    const ease     = easeInOut(Math.max(0, Math.min(1, t)));

    const interpPose = {
      rHand: lerpPt(fromPose.rHand, toPose.rHand, ease),
      lHand: lerpPt(fromPose.lHand, toPose.lHand, ease),
      hip:   lerpPt(fromPose.hip,   toPose.hip,   ease),
      footL: lerpPt(fromPose.footL, toPose.footL, ease),
      footR: lerpPt(fromPose.footR, toPose.footR, ease),
    };

    drawFigure(ctx, interpPose, figHRef.current);

    // Move label overlay at bottom
    const label = pIdx < moveDescriptions.length ? moveDescriptions[pIdx] : 'Route complete!';
    const boxH  = figHRef.current * 0.18;
    const pad   = figHRef.current * 0.04;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(pad, CH - boxH - pad, CW - pad * 2, boxH, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(figHRef.current * 0.055, 11)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // Wrap text
    const maxW = CW - pad * 4;
    const words = label.split(' ');
    let line = '', lines = [];
    for (const w of words) {
      const test = line + (line ? ' ' : '') + w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    lines.slice(0, 2).forEach((l, i) =>
      ctx.fillText(l, pad * 2, CH - boxH - pad + pad + i * (figHRef.current * 0.07) + figHRef.current * 0.04)
    );
  }, [routeHolds, wallTopY, wallBottomY, moveDescriptions]);

  // ── Animation loop ────────────────────────────────────────────────────────
  const MOVE_DURATION = 1800; // ms per move
  const HOLD_PAUSE    = 600;  // ms pause at each hold
  const TOTAL_PER_MOVE = MOVE_DURATION + HOLD_PAUSE;

  useEffect(() => {
    if (!ready) return;
    renderFrame(0, 0);
  }, [ready, renderFrame]);

  // Track poseIndex in a ref so the animation loop can read it without re-subscribing
  const poseIndexRef = useRef(0);
  useEffect(() => { poseIndexRef.current = poseIndex; }, [poseIndex]);

  useEffect(() => {
    if (!playing || !ready) return;
    const poses = posesRef.current;
    if (poses.length < 2) return;

    const totalMoves = poses.length - 1;
    // Start elapsed time at the current pose so resuming mid-route works
    const startOffset = poseIndexRef.current * TOTAL_PER_MOVE;
    let startTime = null;

    const animate = (now) => {
      if (!startTime) startTime = now - startOffset;
      const elapsed   = now - startTime;
      const totalTime = totalMoves * TOTAL_PER_MOVE;

      if (elapsed >= totalTime) {
        stateRef.current.playing = false;
        setPlaying(false);
        setPoseIndex(totalMoves);
        renderFrame(totalMoves - 1, 1);
        setMoveLabel('Route complete! 🏆');
        return;
      }

      const moveTime = elapsed % TOTAL_PER_MOVE;
      const moveIdx  = Math.floor(elapsed / TOTAL_PER_MOVE);
      const t        = Math.min(moveTime / MOVE_DURATION, 1);

      renderFrame(moveIdx, t);
      setPoseIndex(moveIdx);
      poseIndexRef.current = moveIdx;
      setMoveLabel(moveIdx < moveDescriptions.length ? moveDescriptions[moveIdx] : 'Route complete!');

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [playing, ready, renderFrame, moveDescriptions]);

  const handlePlay = () => {
    if (playing) {
      cancelAnimationFrame(animRef.current);
      setPlaying(false);
    } else {
      setPlaying(true);
    }
  };

  const handleReset = () => {
    cancelAnimationFrame(animRef.current);
    setPlaying(false);
    setPoseIndex(0);
    setMoveLabel(moveDescriptions[0] || 'Start position');
    renderFrame(0, 0);
  };

  const handleStep = (dir) => {
    cancelAnimationFrame(animRef.current);
    setPlaying(false);
    const poses = posesRef.current;
    const next  = Math.max(0, Math.min(poses.length - 2, poseIndex + dir));
    setPoseIndex(next);
    setMoveLabel(next < moveDescriptions.length ? moveDescriptions[next] : 'Route complete!');
    renderFrame(next, dir > 0 ? 0 : 1);
  };

  if (!routeHolds || routeHolds.length < 2) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Route Animation</p>
        <span className="text-xs text-zinc-600">
          {poseIndex + 1} / {posesRef.current.length || '—'} moves
        </span>
      </div>

      {/* Canvas wrapper — aspect-ratio preserved */}
      <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800"
           style={{ paddingBottom: `${(aspect * 100).toFixed(2)}%` }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin"/>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button onClick={() => handleStep(-1)} disabled={poseIndex === 0 || !ready}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 transition-all">
          <ChevronLeft className="w-4 h-4"/>
        </button>

        <button onClick={handlePlay} disabled={!ready}
          className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-600 hover:from-orange-600 hover:to-rose-700 text-white font-semibold text-sm disabled:opacity-40 transition-all">
          {playing ? <><Pause className="w-4 h-4"/> Pause</> : <><Play className="w-4 h-4"/> {poseIndex > 0 ? 'Resume' : 'Play Route'}</>}
        </button>

        <button onClick={() => handleStep(1)}
          disabled={poseIndex >= (posesRef.current.length - 2) || !ready}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 transition-all">
          <ChevronRight className="w-4 h-4"/>
        </button>

        <button onClick={handleReset} disabled={!ready}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-500 hover:bg-zinc-700 disabled:opacity-30 transition-all">
          <RotateCcw className="w-4 h-4"/>
        </button>
      </div>

      {/* Move label */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3">
        <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">Current Move</p>
        <p className="text-sm text-zinc-200 leading-relaxed">{moveLabel || '—'}</p>
      </div>

      {/* Progress bar */}
      {posesRef.current.length > 1 && (
        <div className="flex gap-1">
          {Array.from({ length: posesRef.current.length - 1 }).map((_, i) => (
            <div key={i}
              className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= poseIndex ? 'bg-orange-500' : 'bg-zinc-700'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}