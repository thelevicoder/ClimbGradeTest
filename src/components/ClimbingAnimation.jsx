import React, { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// BODY PROPORTIONS  (fraction of total figure height)
// ─────────────────────────────────────────────────────────────────────────────
const P = {
  headR:     0.072,
  neckLen:   0.04,
  torsoLen:  0.30,
  upperArm:  0.17,
  foreArm:   0.155,
  upperLeg:  0.245,
  lowerLeg:  0.235,
  shoulderW: 0.10,
  hipW:      0.075,
  footLen:   0.055,
};

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const lerp     = (a, b, t) => a + (b - a) * t;
const lerpPt   = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const dist     = (a, b) => Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);
const easeOut  = t => 1 - (1-t)**3;
const easeIn   = t => t**2;
const easeInOut= t => t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
// Smooth step — stays at endpoints
const smooth   = t => t*t*(3-2*t);

// Arc a limb mid-flight: hand/foot travels an arc (up then forward) rather than straight line
function arcLerp(from, to, t, arcHeight = 0) {
  const base = lerpPt(from, to, t);
  const arc  = Math.sin(Math.PI * t) * arcHeight;
  return { x: base.x, y: base.y - arc };  // arc upward (negative Y)
}

// Two-bone IK solver
function solveTwoBone(root, tip, upperLen, lowerLen, bendDir = 1) {
  const dx  = tip.x - root.x;
  const dy  = tip.y - root.y;
  const d   = Math.min(Math.sqrt(dx*dx + dy*dy), (upperLen + lowerLen) * 0.999);
  const cos = (upperLen**2 + d**2 - lowerLen**2) / (2 * upperLen * d);
  const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
  const base = Math.atan2(dy, dx);
  const j   = base + bendDir * ang;
  return { x: root.x + Math.cos(j) * upperLen, y: root.y + Math.sin(j) * upperLen };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE CACHE
// ─────────────────────────────────────────────────────────────────────────────
const imgCache = {};
function loadImage(url) {
  if (imgCache[url]) return Promise.resolve(imgCache[url]);
  return new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { imgCache[url] = img; res(img); };
    img.onerror = rej; img.src = url;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD KEYFRAME POSES
// Each pose = { lHand, rHand, lFoot, rFoot, hip, shoulders }
// ─────────────────────────────────────────────────────────────────────────────
function buildPoses(routeHolds, figH, CW, CH, wallTopY, wallBottomY, allHolds) {
  const span = wallBottomY - wallTopY;
  const toPx = h => ({ x: (h.x/100)*CW, y: ((h.y-wallTopY)/span)*CH });

  // Convert all holds to px for foothold searching
  const allPx = (allHolds || []).map(h => ({ ...h, px: toPx(h) }));

  // Find best foothold near a target position (within leg reach)
  const legReach = figH * (P.upperLeg + P.lowerLeg) * 0.92;
  function nearestFoothold(target, excludeY, preferSide) {
    // prefer real footholds, then use any small hold
    const candidates = allPx.filter(h => {
      if (h.px.y < target.y - 10) return false;         // must be at or below target
      if (h.px.y > target.y + legReach) return false;    // within leg reach
      if (Math.abs(h.px.y - excludeY) < figH * 0.05) return false; // not same height as other foot
      const d = dist(h.px, target);
      return d < legReach;
    });
    if (candidates.length === 0) return null;
    // Sort by: footholds first, then closest
    candidates.sort((a, b) => {
      const aScore = (a.type === 'foothold' ? 0 : 1) + dist(a.px, target) / legReach;
      const bScore = (b.type === 'foothold' ? 0 : 1) + dist(b.px, target) / legReach;
      return aScore - bScore;
    });
    return candidates[0].px;
  }

  const poses = [];

  // Track which limb each hand/foot is currently on
  let lHand, rHand, lFoot, rFoot;

  for (let i = 0; i < routeHolds.length; i++) {
    const hpx = toPx(routeHolds[i]);
    const movingHand = i % 2 === 0 ? 'right' : 'left';  // alternate hands

    // HAND POSITIONS
    if (i === 0) {
      // Start: both hands on start hold (or split if two-hand start)
      const startHolds = routeHolds.filter(h => h.is_start);
      if (startHolds.length >= 2) {
        const p0 = toPx(startHolds[0]), p1 = toPx(startHolds[1]);
        lHand = p0.x < p1.x ? p0 : p1;
        rHand = p0.x < p1.x ? p1 : p0;
      } else {
        lHand = { x: hpx.x - figH * P.shoulderW * 1.2, y: hpx.y };
        rHand = { x: hpx.x + figH * P.shoulderW * 1.2, y: hpx.y };
      }
    } else {
      // Move one hand to new hold, other stays
      if (movingHand === 'right') rHand = { ...hpx };
      else                        lHand = { ...hpx };
    }

    // HIP: sits below midpoint of hands, weighted by how far up the climb we are
    const handMid = lerpPt(lHand, rHand, 0.5);
    // Hips are roughly 50-60% of torso below hands
    const hipDrop = figH * (P.torsoLen * 0.85);
    const hip = {
      x: handMid.x + (rHand.x - lHand.x) * 0.05,  // slight sway toward moving hand
      y: handMid.y + hipDrop,
    };

    // FOOT PLACEMENT
    // After the first move, the trailing foot steps up
    if (i === 0) {
      // Start position: feet spread below hips, on wall
      const fY = Math.min(hip.y + figH * (P.upperLeg + P.lowerLeg) * 0.8, CH * 0.96);
      lFoot = nearestFoothold({ x: hip.x - figH*P.hipW*1.5, y: fY }, fY + 1, 'left')
           || { x: hip.x - figH*P.hipW*1.4, y: fY };
      rFoot = nearestFoothold({ x: hip.x + figH*P.hipW*1.5, y: fY }, lFoot.y, 'right')
           || { x: hip.x + figH*P.hipW*1.4, y: fY };
    } else {
      // The foot on the same side as the moving hand steps up
      // It targets a hold near the previous hand position (one hold below current)
      const prevHand = movingHand === 'right' ? (i >= 2 ? toPx(routeHolds[i-2]) : lHand) : rHand;
      const stepTarget = {
        x: hip.x + (movingHand === 'right' ? figH*P.hipW : -figH*P.hipW),
        y: Math.min(prevHand.y + figH * 0.1, hip.y + figH*(P.upperLeg+P.lowerLeg)*0.75),
      };
      const otherFoot = movingHand === 'right' ? lFoot : rFoot;
      const newFoot = nearestFoothold(stepTarget, otherFoot.y, movingHand)
                   || stepTarget;

      if (movingHand === 'right') {
        rFoot = newFoot;
        // Left foot stays, but nudge it if hip moved a lot
        const lFootNew = nearestFoothold(
          { x: hip.x - figH*P.hipW*1.3, y: Math.min(hip.y + figH*(P.upperLeg+P.lowerLeg)*0.8, CH*0.96) },
          rFoot.y, 'left'
        ) || lFoot;
        lFoot = lerpPt(lFoot, lFootNew, 0.3);  // left foot adjusts slightly
      } else {
        lFoot = newFoot;
        const rFootNew = nearestFoothold(
          { x: hip.x + figH*P.hipW*1.3, y: Math.min(hip.y + figH*(P.upperLeg+P.lowerLeg)*0.8, CH*0.96) },
          lFoot.y, 'right'
        ) || rFoot;
        rFoot = lerpPt(rFoot, rFootNew, 0.3);
      }
    }

    // Clamp feet to canvas
    lFoot = { x: lFoot.x, y: Math.min(lFoot.y, CH * 0.97) };
    rFoot = { x: rFoot.x, y: Math.min(rFoot.y, CH * 0.97) };

    poses.push({
      lHand: { ...lHand },
      rHand: { ...rHand },
      lFoot: { ...lFoot },
      rFoot: { ...rFoot },
      hip:   { ...hip },
      movingHand,
    });
  }

  return poses;
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAW FIGURE
// ─────────────────────────────────────────────────────────────────────────────
function drawFigure(ctx, pose, figH) {
  const { lHand, rHand, lFoot, rFoot, hip } = pose;

  const lW = Math.max(figH * 0.026, 3);
  ctx.lineCap = "round"; ctx.lineJoin = "round";

  // Derived skeleton points
  const shoulderY = hip.y - figH * P.torsoLen;
  const sL = { x: hip.x - figH * P.shoulderW, y: shoulderY };
  const sR = { x: hip.x + figH * P.shoulderW, y: shoulderY };
  const hL = { x: hip.x - figH * P.hipW,      y: hip.y };
  const hR = { x: hip.x + figH * P.hipW,      y: hip.y };
  const headY = shoulderY - figH * (P.neckLen + P.headR);

  // IK
  // Elbows: left bends left (-1), right bends right (+1)
  const elbL = solveTwoBone(sL, lHand, figH*P.upperArm, figH*P.foreArm, -1);
  const elbR = solveTwoBone(sR, rHand, figH*P.upperArm, figH*P.foreArm,  1);
  // Knees: both bend slightly forward on a vertical wall
  const kneeL = solveTwoBone(hL, lFoot, figH*P.upperLeg, figH*P.lowerLeg,  1);
  const kneeR = solveTwoBone(hR, rFoot, figH*P.upperLeg, figH*P.lowerLeg, -1);

  // ── Drop shadow ────────────────────────────────────────────────────────────
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur  = figH * 0.04;
  ctx.shadowOffsetX = figH * 0.012;
  ctx.shadowOffsetY = figH * 0.012;

  // ── LEGS ───────────────────────────────────────────────────────────────────
  // Pants (dark navy)
  const drawLimb = (a, mid, b, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(mid.x,mid.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  };
  drawLimb(hL, kneeL, lFoot, "#1c2340", lW * 1.15);
  drawLimb(hR, kneeR, rFoot, "#1c2340", lW * 1.15);

  // Kneecap dots
  [kneeL, kneeR].forEach(k => {
    ctx.fillStyle = "#252d52";
    ctx.beginPath(); ctx.arc(k.x, k.y, lW * 0.55, 0, Math.PI*2); ctx.fill();
  });

  // Climbing shoes — angled toward the wall (horizontal toe placement)
  [[lFoot, lFoot.x < hip.x ? -1 : 1, kneeL],
   [rFoot, rFoot.x < hip.x ? -1 : 1, kneeR]].forEach(([foot, side, knee]) => {
    const angle = Math.atan2(foot.y - knee.y, foot.x - knee.x);
    ctx.save();
    ctx.translate(foot.x, foot.y);
    ctx.rotate(angle + Math.PI * 0.08);  // slight toe-down angle
    // Sole
    ctx.fillStyle   = "#1a1a1a";
    ctx.strokeStyle = "#000";
    ctx.lineWidth   = lW * 0.2;
    ctx.beginPath();
    ctx.ellipse(figH*P.footLen*0.3, 0, figH*P.footLen*0.72, figH*0.016, 0, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
    // Upper shoe (red)
    ctx.fillStyle = "#c0392b";
    ctx.beginPath();
    ctx.ellipse(figH*P.footLen*0.2, -figH*0.015, figH*P.footLen*0.55, figH*0.022, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  });

  // ── TORSO ──────────────────────────────────────────────────────────────────
  ctx.shadowBlur = figH * 0.03;
  // Harness / pants waistband
  ctx.fillStyle   = "#e67e22";
  ctx.strokeStyle = "#d35400";
  ctx.lineWidth   = lW * 0.25;
  ctx.beginPath();
  ctx.moveTo(hL.x - lW, hL.y);
  ctx.lineTo(hR.x + lW, hR.y);
  ctx.lineTo(hR.x, hR.y - figH*0.022);
  ctx.lineTo(hL.x, hL.y - figH*0.022);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // Shirt body (climbing jersey - blue/teal gradient-ish)
  ctx.fillStyle   = "#2471a3";
  ctx.strokeStyle = "#1a5276";
  ctx.lineWidth   = lW * 0.3;
  ctx.beginPath();
  ctx.moveTo(sL.x - lW*0.5, sL.y);
  ctx.quadraticCurveTo(hip.x - figH*P.shoulderW*1.1, hip.y - figH*P.torsoLen*0.5, hL.x, hL.y);
  ctx.lineTo(hR.x, hR.y);
  ctx.quadraticCurveTo(hip.x + figH*P.shoulderW*1.1, hip.y - figH*P.torsoLen*0.5, sR.x + lW*0.5, sR.y);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // Jersey stripe
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth   = lW * 0.6;
  ctx.beginPath();
  ctx.moveTo(hip.x, shoulderY + figH*0.02);
  ctx.lineTo(hip.x, hip.y - figH*0.02);
  ctx.stroke();

  // ── ARMS ───────────────────────────────────────────────────────────────────
  // Upper arms (sleeve)
  drawLimb(sL, elbL, lHand, "#1a5276", lW * 1.05);
  drawLimb(sR, elbR, rHand, "#1a5276", lW * 1.05);

  // Elbow pads
  [elbL, elbR].forEach(e => {
    ctx.fillStyle = "#154360";
    ctx.beginPath(); ctx.arc(e.x, e.y, lW*0.6, 0, Math.PI*2); ctx.fill();
  });

  // Forearms (skin)
  ctx.strokeStyle = "#d4956a"; ctx.lineWidth = lW * 0.9;
  ctx.beginPath(); ctx.moveTo(elbL.x,elbL.y); ctx.lineTo(lHand.x,lHand.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(elbR.x,elbR.y); ctx.lineTo(rHand.x,rHand.y); ctx.stroke();

  // ── HANDS ──────────────────────────────────────────────────────────────────
  [[lHand, true], [rHand, true]].forEach(([hand]) => {
    // Chalk-dusted hand
    ctx.fillStyle   = "#e8c9a0";
    ctx.strokeStyle = "#9c6b3c";
    ctx.lineWidth   = lW * 0.25;
    ctx.beginPath(); ctx.arc(hand.x, hand.y, figH*0.030, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
    // Chalk dot
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath(); ctx.arc(hand.x - figH*0.008, hand.y - figH*0.008, figH*0.012, 0, Math.PI*2);
    ctx.fill();
  });

  // ── NECK ───────────────────────────────────────────────────────────────────
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#d4956a"; ctx.lineWidth = lW * 0.85;
  ctx.beginPath();
  ctx.moveTo(hip.x, shoulderY);
  ctx.lineTo(hip.x, shoulderY - figH*P.neckLen);
  ctx.stroke();

  // ── HEAD ───────────────────────────────────────────────────────────────────
  // Face
  ctx.fillStyle   = "#f0c080";
  ctx.strokeStyle = "#d4956a";
  ctx.lineWidth   = lW * 0.28;
  ctx.beginPath(); ctx.arc(hip.x, headY, figH*P.headR, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();

  // Hair (dark)
  ctx.fillStyle = "#2c1c0e";
  ctx.beginPath();
  ctx.arc(hip.x, headY, figH*P.headR*0.88, -Math.PI*0.1, Math.PI*1.1, true);
  ctx.fill();

  // Eyes
  const eyeOffY = headY - figH*0.008;
  ctx.fillStyle = "#1a1a2e";
  [-1,1].forEach(s => {
    ctx.beginPath();
    ctx.arc(hip.x + s*figH*0.028, eyeOffY, figH*0.011, 0, Math.PI*2);
    ctx.fill();
  });
  // Eye whites
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  [-1,1].forEach(s => {
    ctx.beginPath();
    ctx.arc(hip.x + s*figH*0.028 + figH*0.004, eyeOffY - figH*0.003, figH*0.005, 0, Math.PI*2);
    ctx.fill();
  });

  // Nose
  ctx.strokeStyle = "#c07850"; ctx.lineWidth = lW*0.2;
  ctx.beginPath();
  ctx.moveTo(hip.x, eyeOffY + figH*0.01);
  ctx.quadraticCurveTo(hip.x + figH*0.02, eyeOffY + figH*0.03, hip.x + figH*0.015, eyeOffY + figH*0.035);
  ctx.stroke();

  // ── HELMET ─────────────────────────────────────────────────────────────────
  ctx.fillStyle   = "#f39c12";
  ctx.strokeStyle = "#d68910";
  ctx.lineWidth   = lW * 0.3;
  ctx.beginPath();
  ctx.arc(hip.x, headY, figH*P.headR*1.06, Math.PI*0.8, Math.PI*2.2);
  ctx.fill(); ctx.stroke();
  // Helmet vent lines
  ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = lW*0.15;
  [-figH*0.025, 0, figH*0.025].forEach(dx => {
    ctx.beginPath();
    ctx.moveTo(hip.x+dx, headY - figH*P.headR*0.9);
    ctx.lineTo(hip.x+dx, headY - figH*P.headR*0.3);
    ctx.stroke();
  });
  // Chin strap
  ctx.strokeStyle = "#d68910"; ctx.lineWidth = lW*0.2;
  ctx.beginPath();
  ctx.arc(hip.x, headY, figH*P.headR*1.06, Math.PI*0.85, Math.PI*1.15);
  ctx.stroke();

  ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERPOLATE BETWEEN POSES WITH SUB-PHASES
// Phase 0.0–0.45: moving hand arcs to new hold, body stretches
// Phase 0.45–0.70: body shifts (hip rises, weight transfers)
// Phase 0.70–1.0:  trailing foot steps up to new hold
// ─────────────────────────────────────────────────────────────────────────────
function interpPose(from, to, t) {
  const movingHand = to.movingHand;

  let lHand, rHand, lFoot, rFoot, hip;

  if (t < 0.45) {
    // Phase 1: reach with hand
    const ph = easeOut(t / 0.45);
    const arcH = Math.abs(to.lHand.y - from.lHand.y + to.rHand.y - from.rHand.y) * 0.15 + 10;
    if (movingHand === 'right') {
      rHand = arcLerp(from.rHand, to.rHand, ph, arcH);
      lHand = { ...from.lHand };
    } else {
      lHand = arcLerp(from.lHand, to.lHand, ph, arcH);
      rHand = { ...from.rHand };
    }
    // Hip barely moves in phase 1 — body stretches
    hip   = lerpPt(from.hip, to.hip, easeIn(ph) * 0.3);
    lFoot = { ...from.lFoot };
    rFoot = { ...from.rFoot };
  } else if (t < 0.70) {
    // Phase 2: body shifts up, weight transfer
    const ph = smooth((t - 0.45) / 0.25);
    lHand = movingHand === 'right' ? lerpPt(from.lHand, to.lHand, ph) : { ...to.lHand };
    rHand = movingHand === 'left'  ? lerpPt(from.rHand, to.rHand, ph) : { ...to.rHand };
    hip   = lerpPt(from.hip, to.hip, easeInOut(ph));
    lFoot = { ...from.lFoot };
    rFoot = { ...from.rFoot };
  } else {
    // Phase 3: foot steps up
    const ph = easeOut((t - 0.70) / 0.30);
    lHand = { ...to.lHand };
    rHand = { ...to.rHand };
    hip   = { ...to.hip };
    // The foot on the same side as the moving hand steps
    const arcH = Math.abs(to.lFoot.y - from.lFoot.y + to.rFoot.y - from.rFoot.y) * 0.2 + 8;
    if (movingHand === 'right') {
      rFoot = arcLerp(from.rFoot, to.rFoot, ph, arcH);
      lFoot = lerpPt(from.lFoot, to.lFoot, ph * 0.4);  // other foot adjusts slightly
    } else {
      lFoot = arcLerp(from.lFoot, to.lFoot, ph, arcH);
      rFoot = lerpPt(from.rFoot, to.rFoot, ph * 0.4);
    }
  }

  return { lHand, rHand, lFoot, rFoot, hip, movingHand: to.movingHand };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ClimbingAnimation({
  imageUrl, holds, wallTopY, wallBottomY,
  startIndices, endIndices,
  userHeightCm, estimatedWallHeightM = 4.0,
  moves,
}) {
  const canvasRef  = useRef(null);
  const imgRef     = useRef(null);
  const animRef    = useRef(null);
  const posesRef   = useRef([]);
  const figHRef    = useRef(0);
  const poseIdxRef = useRef(0);

  const [aspect,    setAspect]    = useState(0.75);
  const [ready,     setReady]     = useState(false);
  const [playing,   setPlaying]   = useState(false);
  const [poseIndex, setPoseIndex] = useState(0);
  const [moveLabel, setMoveLabel] = useState('');

  // Build route hold sequence
  const routeHolds = (() => {
    if (!holds?.length || !startIndices?.length || !endIndices?.length) return [];
    const sorted = holds.map((h,i)=>({...h,oi:i}))
      .filter(h=>h.type!=='foothold')
      .sort((a,b)=>b.y-a.y);
    const startY = Math.max(...startIndices.map(i=>holds[i]?.y||0));
    const endY   = Math.min(...endIndices.map(i=>holds[i]?.y||100));
    const route  = sorted.filter(h=>h.y<=startY && h.y>=endY);
    return route;
  })();

  const moveDescriptions = (moves||[]).map((m,i)=>
    `Move ${i+1}: ${m.dynamic?'Dynamic':'Reach'} ${m.movingHand||''} hand to Hold ${(m.toIndex||0)+1} — ${m.distCm||0}cm (${m.reach||m.reachLabel||''})`
  );

  // ── Setup ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!imageUrl || routeHolds.length < 2) return;
    setReady(false);
    loadImage(imageUrl).then(img => {
      imgRef.current = img;
      const srcH  = img.naturalHeight * (wallBottomY - wallTopY) / 100;
      const ratio = srcH / img.naturalWidth;
      setAspect(ratio);

      const CW = Math.min(900, img.naturalWidth);
      const CH = Math.round(CW * ratio);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = CW; canvas.height = CH;

      // Figure height: user height as fraction of real wall height, mapped to canvas
      const wallPx   = CH;
      const figH     = (userHeightCm / (estimatedWallHeightM * 100)) * wallPx;
      figHRef.current = Math.max(figH, CW * 0.08);  // min 8% of width

      posesRef.current = buildPoses(routeHolds, figHRef.current, CW, CH, wallTopY, wallBottomY, holds);
      poseIdxRef.current = 0;
      setPoseIndex(0);
      setMoveLabel(moveDescriptions[0] || 'Start position');
      setReady(true);
    });
  }, [imageUrl, wallTopY, wallBottomY, userHeightCm, estimatedWallHeightM]);

  // ── Render frame ───────────────────────────────────────────────────────────
  const renderFrame = useCallback((pIdx, t) => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    const poses  = posesRef.current;
    if (!canvas || !img || poses.length < 2) return;

    const CW = canvas.width, CH = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,CW,CH);

    // Wall background
    const srcY = (wallTopY/100)*img.naturalHeight;
    const srcH = ((wallBottomY-wallTopY)/100)*img.naturalHeight;
    ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, 0, CW, CH);

    // Subtle vignette
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(0,0,CW,CH);

    // Route hold circles
    const span = wallBottomY - wallTopY;
    routeHolds.forEach((hold, i) => {
      const cx = (hold.x/100)*CW;
      const cy = ((hold.y-wallTopY)/span)*CH;
      const isNext    = i === pIdx + 1;
      const isCurrent = i === pIdx;
      const isStart   = hold.is_start;
      const isEnd     = hold.is_end;

      const r = figHRef.current * 0.04;
      ctx.strokeStyle = isStart  ? 'rgba(34,197,94,0.9)'
                      : isEnd    ? 'rgba(239,68,68,0.9)'
                      : isNext   ? 'rgba(255,200,50,0.95)'
                      : isCurrent? 'rgba(255,255,255,0.7)'
                      : 'rgba(251,146,60,0.45)';
      ctx.lineWidth = isNext || isCurrent ? 2.5 : 1.5;
      ctx.setLineDash(isNext || isCurrent ? [] : [4,3]);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);

      // Label on active holds
      if (isCurrent || isNext || isStart || isEnd) {
        ctx.fillStyle = isStart?'rgba(34,197,94,0.95)':isEnd?'rgba(239,68,68,0.95)':'rgba(255,255,255,0.9)';
        ctx.font = `bold ${Math.max(r*0.9,9)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(isStart?'S':isEnd?'F':String(i+1), cx + r + 8, cy);
      }
    });

    // Interpolate pose
    const fromPose = poses[Math.min(pIdx,   poses.length-1)];
    const toPose   = poses[Math.min(pIdx+1, poses.length-1)];
    const pose     = t <= 0 ? fromPose : t >= 1 ? toPose : interpPose(fromPose, toPose, t);

    drawFigure(ctx, pose, figHRef.current);

    // Move label
    const label = pIdx < moveDescriptions.length ? moveDescriptions[pIdx] : '🏆 Route complete!';
    const fH  = figHRef.current;
    const bH  = fH * 0.16, pad = fH * 0.04;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath(); ctx.roundRect(pad, CH-bH-pad, CW-pad*2, bH, 8); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font=`${Math.max(fH*0.052,10)}px sans-serif`;
    ctx.textAlign='left'; ctx.textBaseline='middle';
    const words = label.split(' '); let line='', lines=[];
    const maxW = CW - pad*4;
    for (const w of words) {
      const test = line+(line?' ':'')+w;
      if (ctx.measureText(test).width>maxW && line) {lines.push(line);line=w;}
      else line=test;
    }
    if (line) lines.push(line);
    lines.slice(0,2).forEach((l,i)=>
      ctx.fillText(l, pad*2, CH-bH-pad+pad+i*(fH*0.065)+fH*0.04)
    );
  }, [routeHolds, wallTopY, wallBottomY, moveDescriptions]);

  // ── Initial render ─────────────────────────────────────────────────────────
  useEffect(() => { if (ready) renderFrame(0,0); }, [ready, renderFrame]);

  useEffect(() => { poseIdxRef.current = poseIndex; }, [poseIndex]);

  // ── Animation loop ─────────────────────────────────────────────────────────
  const MOVE_DUR  = 2000; // ms per move
  const HOLD_PAUSE= 500;
  const TOTAL     = MOVE_DUR + HOLD_PAUSE;

  useEffect(() => {
    if (!playing || !ready) return;
    const poses = posesRef.current;
    if (poses.length < 2) return;
    const totalMoves = poses.length - 1;
    const offset = poseIdxRef.current * TOTAL;
    let startTime = null;

    const animate = (now) => {
      if (!startTime) startTime = now - offset;
      const elapsed = now - startTime;
      const total   = totalMoves * TOTAL;

      if (elapsed >= total) {
        setPlaying(false); setPoseIndex(totalMoves);
        renderFrame(totalMoves-1, 1); setMoveLabel('🏆 Route complete!'); return;
      }

      const moveIdx = Math.floor(elapsed / TOTAL);
      const moveT   = Math.min((elapsed % TOTAL) / MOVE_DUR, 1);
      renderFrame(moveIdx, moveT);
      setPoseIndex(moveIdx);
      poseIdxRef.current = moveIdx;
      setMoveLabel(moveIdx < moveDescriptions.length ? moveDescriptions[moveIdx] : '🏆 Route complete!');
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [playing, ready, renderFrame, moveDescriptions]);

  const handlePlay = () => {
    if (playing) { cancelAnimationFrame(animRef.current); setPlaying(false); }
    else setPlaying(true);
  };

  const handleReset = () => {
    cancelAnimationFrame(animRef.current); setPlaying(false);
    setPoseIndex(0); setMoveLabel(moveDescriptions[0]||'Start position'); renderFrame(0,0);
  };

  const handleStep = (dir) => {
    cancelAnimationFrame(animRef.current); setPlaying(false);
    const next = Math.max(0, Math.min(posesRef.current.length-2, poseIndex+dir));
    setPoseIndex(next); poseIdxRef.current = next;
    setMoveLabel(next < moveDescriptions.length ? moveDescriptions[next] : '🏆 Route complete!');
    renderFrame(next, dir > 0 ? 0 : 1);
  };

  if (!routeHolds || routeHolds.length < 2) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold">Route Animation</p>
        <span className="text-xs text-zinc-600">{poseIndex+1} / {posesRef.current.length||'—'} moves</span>
      </div>

      <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800"
           style={{ paddingBottom:`${(aspect*100).toFixed(2)}%` }}>
        <canvas ref={canvasRef} style={{position:'absolute',top:0,left:0,width:'100%',height:'100%'}}/>
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-zinc-600 border-t-orange-400 rounded-full animate-spin"/>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={()=>handleStep(-1)} disabled={poseIndex===0||!ready}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 transition-all">
          <ChevronLeft className="w-4 h-4"/>
        </button>
        <button onClick={handlePlay} disabled={!ready}
          className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-rose-600 hover:from-orange-600 hover:to-rose-700 text-white font-semibold text-sm disabled:opacity-40 transition-all">
          {playing ? <><Pause className="w-4 h-4"/>Pause</> : <><Play className="w-4 h-4"/>{poseIndex>0?'Resume':'Play Route'}</>}
        </button>
        <button onClick={()=>handleStep(1)} disabled={poseIndex>=(posesRef.current.length-2)||!ready}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 transition-all">
          <ChevronRight className="w-4 h-4"/>
        </button>
        <button onClick={handleReset} disabled={!ready}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-500 hover:bg-zinc-700 disabled:opacity-30 transition-all">
          <RotateCcw className="w-4 h-4"/>
        </button>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3">
        <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">Current Move</p>
        <p className="text-sm text-zinc-200 leading-relaxed">{moveLabel||'—'}</p>
      </div>

      {posesRef.current.length > 1 && (
        <div className="flex gap-1">
          {Array.from({length:posesRef.current.length-1}).map((_,i)=>(
            <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i<=poseIndex?'bg-orange-500':'bg-zinc-700'}`}/>
          ))}
        </div>
      )}
    </div>
  );
}