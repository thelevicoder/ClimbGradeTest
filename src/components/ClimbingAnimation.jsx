import React, { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// BODY PROPORTIONS  (fraction of total figure height)
// ─────────────────────────────────────────────────────────────────────────────
const P = {
  headR:     0.070,
  neckLen:   0.042,
  torsoLen:  0.295,
  upperArm:  0.168,
  foreArm:   0.152,
  upperLeg:  0.248,
  lowerLeg:  0.238,
  shoulderW: 0.105,
  hipW:      0.072,
  footLen:   0.058,
  // Limb thicknesses (radius of capsule)
  thighR:    0.038,
  shinR:     0.026,
  upperArmR: 0.028,
  foreArmR:  0.022,
  neckR:     0.025,
};

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const lerp      = (a, b, t) => a + (b - a) * t;
const lerpPt    = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const dist      = (a, b) => Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);
const easeOut   = t => 1 - (1-t)**3;
const easeIn    = t => t**2;
const easeInOut = t => t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
const smooth    = t => t*t*(3-2*t);

function arcLerp(from, to, t, arcHeight = 0) {
  const base = lerpPt(from, to, t);
  return { x: base.x, y: base.y - Math.sin(Math.PI * t) * arcHeight };
}

function solveTwoBone(root, tip, upperLen, lowerLen, bendDir = 1) {
  const dx  = tip.x - root.x, dy = tip.y - root.y;
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
// ─────────────────────────────────────────────────────────────────────────────
function buildPoses(routeHolds, figH, CW, CH, wallTopY, wallBottomY, allHolds) {
  const span = wallBottomY - wallTopY;
  const toPx = h => ({ x: (h.x/100)*CW, y: ((h.y-wallTopY)/span)*CH });
  const allPx = (allHolds||[]).map(h => ({ ...h, px: toPx(h) }));
  const legReach = figH * (P.upperLeg + P.lowerLeg) * 0.92;

  function nearestFoothold(target, excludeY) {
    const candidates = allPx.filter(h => {
      if (h.px.y < target.y - 10) return false;
      if (h.px.y > target.y + legReach) return false;
      if (Math.abs(h.px.y - excludeY) < figH * 0.05) return false;
      return dist(h.px, target) < legReach;
    });
    if (!candidates.length) return null;
    candidates.sort((a,b) => (a.type==='foothold'?0:1)+dist(a.px,target)/legReach - ((b.type==='foothold'?0:1)+dist(b.px,target)/legReach));
    return candidates[0].px;
  }

  const poses = [];
  let lHand, rHand, lFoot, rFoot;

  for (let i = 0; i < routeHolds.length; i++) {
    const hpx = toPx(routeHolds[i]);
    const movingHand = i % 2 === 0 ? 'right' : 'left';

    if (i === 0) {
      const starts = routeHolds.filter(h => h.is_start);
      if (starts.length >= 2) {
        const p0=toPx(starts[0]), p1=toPx(starts[1]);
        lHand = p0.x<p1.x?p0:p1; rHand = p0.x<p1.x?p1:p0;
      } else {
        lHand = {x:hpx.x-figH*P.shoulderW*1.2, y:hpx.y};
        rHand = {x:hpx.x+figH*P.shoulderW*1.2, y:hpx.y};
      }
    } else {
      if (movingHand==='right') rHand={...hpx}; else lHand={...hpx};
    }

    const handMid = lerpPt(lHand, rHand, 0.5);
    const hip = { x: handMid.x+(rHand.x-lHand.x)*0.05, y: handMid.y+figH*P.torsoLen*0.85 };

    if (i === 0) {
      const fY = Math.min(hip.y+figH*(P.upperLeg+P.lowerLeg)*0.8, CH*0.96);
      lFoot = nearestFoothold({x:hip.x-figH*P.hipW*1.5,y:fY}, fY+1) || {x:hip.x-figH*P.hipW*1.4,y:fY};
      rFoot = nearestFoothold({x:hip.x+figH*P.hipW*1.5,y:fY}, lFoot.y) || {x:hip.x+figH*P.hipW*1.4,y:fY};
    } else {
      const prevHand = movingHand==='right' ? (i>=2?toPx(routeHolds[i-2]):lHand) : rHand;
      const stepTgt  = { x:hip.x+(movingHand==='right'?figH*P.hipW:-figH*P.hipW), y:Math.min(prevHand.y+figH*0.1, hip.y+figH*(P.upperLeg+P.lowerLeg)*0.75) };
      const other    = movingHand==='right' ? lFoot : rFoot;
      const newFoot  = nearestFoothold(stepTgt, other.y) || stepTgt;
      if (movingHand==='right') {
        rFoot=newFoot;
        lFoot=lerpPt(lFoot, nearestFoothold({x:hip.x-figH*P.hipW*1.3,y:Math.min(hip.y+figH*(P.upperLeg+P.lowerLeg)*0.8,CH*0.96)},rFoot.y)||lFoot, 0.3);
      } else {
        lFoot=newFoot;
        rFoot=lerpPt(rFoot, nearestFoothold({x:hip.x+figH*P.hipW*1.3,y:Math.min(hip.y+figH*(P.upperLeg+P.lowerLeg)*0.8,CH*0.96)},lFoot.y)||rFoot, 0.3);
      }
    }
    lFoot={x:lFoot.x,y:Math.min(lFoot.y,CH*0.97)};
    rFoot={x:rFoot.x,y:Math.min(rFoot.y,CH*0.97)};
    poses.push({lHand:{...lHand},rHand:{...rHand},lFoot:{...lFoot},rFoot:{...rFoot},hip:{...hip},movingHand});
  }
  return poses;
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAWING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Draw a thick rounded limb (capsule) from point a to b with given radius and colors
function drawCapsule(ctx, a, b, r, fillColor, shadowColor) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const cos = Math.cos(angle + Math.PI/2);
  const sin = Math.sin(angle + Math.PI/2);
  ctx.beginPath();
  ctx.moveTo(a.x + cos*r, a.y + sin*r);
  ctx.lineTo(b.x + cos*r, b.y + sin*r);
  ctx.arc(b.x, b.y, r, angle + Math.PI/2, angle - Math.PI/2, false);
  ctx.lineTo(a.x - cos*r, a.y - sin*r);
  ctx.arc(a.x, a.y, r, angle - Math.PI/2, angle + Math.PI/2, false);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  // Edge darkening
  if (shadowColor) {
    ctx.strokeStyle = shadowColor;
    ctx.lineWidth   = Math.max(r * 0.18, 1);
    ctx.stroke();
  }
}

// Draw a capsule with a linear gradient (lit from upper-left)
function drawCapsuleGrad(ctx, a, b, r, lightColor, darkColor, edgeColor) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const cos = Math.cos(angle + Math.PI/2);
  const sin = Math.sin(angle + Math.PI/2);

  ctx.beginPath();
  ctx.moveTo(a.x + cos*r, a.y + sin*r);
  ctx.lineTo(b.x + cos*r, b.y + sin*r);
  ctx.arc(b.x, b.y, r, angle + Math.PI/2, angle - Math.PI/2, false);
  ctx.lineTo(a.x - cos*r, a.y - sin*r);
  ctx.arc(a.x, a.y, r, angle - Math.PI/2, angle + Math.PI/2, false);
  ctx.closePath();

  const mid = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
  const grd = ctx.createLinearGradient(mid.x - cos*r, mid.y - sin*r, mid.x + cos*r, mid.y + sin*r);
  grd.addColorStop(0,   lightColor);
  grd.addColorStop(0.45, lightColor);
  grd.addColorStop(1,   darkColor);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.strokeStyle = edgeColor || darkColor;
  ctx.lineWidth   = Math.max(r * 0.12, 0.8);
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAW FIGURE — volumetric, shaded, realistic
// ─────────────────────────────────────────────────────────────────────────────
function drawFigure(ctx, pose, figH) {
  const { lHand, rHand, lFoot, rFoot, hip } = pose;

  ctx.lineCap  = "round";
  ctx.lineJoin = "round";
  ctx.save();

  // ── Skeleton derived points ────────────────────────────────────────────────
  const shoulderY = hip.y - figH * P.torsoLen;
  const sL  = { x: hip.x - figH*P.shoulderW, y: shoulderY };
  const sR  = { x: hip.x + figH*P.shoulderW, y: shoulderY };
  const hL  = { x: hip.x - figH*P.hipW,      y: hip.y     };
  const hR  = { x: hip.x + figH*P.hipW,      y: hip.y     };
  const neckBase = { x: hip.x, y: shoulderY };
  const neckTop  = { x: hip.x, y: shoulderY - figH*P.neckLen };
  const headCY   = neckTop.y - figH*P.headR*0.85;

  // IK
  const elbL  = solveTwoBone(sL, lHand, figH*P.upperArm, figH*P.foreArm, -1);
  const elbR  = solveTwoBone(sR, rHand, figH*P.upperArm, figH*P.foreArm,  1);
  const kneeL = solveTwoBone(hL, lFoot, figH*P.upperLeg, figH*P.lowerLeg,  1);
  const kneeR = solveTwoBone(hR, rFoot, figH*P.upperLeg, figH*P.lowerLeg, -1);

  // Thickness values
  const thighR    = figH * P.thighR;
  const shinR     = figH * P.shinR;
  const uArmR     = figH * P.upperArmR;
  const fArmR     = figH * P.foreArmR;
  const neckR     = figH * P.neckR;

  // ── Overall drop shadow pass ───────────────────────────────────────────────
  ctx.shadowColor   = "rgba(0,0,0,0.55)";
  ctx.shadowBlur    = figH * 0.045;
  ctx.shadowOffsetX = figH * 0.015;
  ctx.shadowOffsetY = figH * 0.018;

  // ── LEGS — draw back leg first (slightly darker) ───────────────────────────
  // Determine which leg is "back" based on foot position relative to hip
  const lIsBack = lFoot.x > hip.x;

  const drawLeg = (hip_, knee, foot, isBack, knee2) => {
    const dimFactor = isBack ? 0.72 : 1.0;
    const lightenFactor = isBack ? 0.72 : 1.0;
    const dim = (hex) => {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `rgb(${Math.round(r*dimFactor)},${Math.round(g*dimFactor)},${Math.round(b*dimFactor)})`;
    };
    // Thigh
    drawCapsuleGrad(ctx, hip_, knee,
      Math.max(thighR * (isBack ? 0.88 : 1), 4),
      isBack ? "#2a3260" : "#3a4a8a",
      isBack ? "#141828" : "#1c2340",
      isBack ? "#0e1020" : "#141828"
    );
    // Shin
    drawCapsuleGrad(ctx, knee, foot,
      Math.max(shinR * (isBack ? 0.85 : 1), 3),
      isBack ? "#222840" : "#2e3d70",
      isBack ? "#10141e" : "#1a2038",
      isBack ? "#0a0c12" : "#10141e"
    );
    // Kneecap
    const kr = Math.max(shinR * 1.05 * (isBack ? 0.85 : 1), 3);
    ctx.beginPath();
    ctx.arc(knee.x, knee.y, kr, 0, Math.PI*2);
    ctx.fillStyle = isBack ? "#232a50" : "#3a4a7a";
    ctx.fill();
    ctx.strokeStyle = isBack ? "#10141e" : "#1a2038";
    ctx.lineWidth = Math.max(kr*0.15, 0.8);
    ctx.stroke();
  };

  // Draw back leg first
  if (lIsBack) {
    drawLeg(hL, kneeL, lFoot, true);
    drawLeg(hR, kneeR, rFoot, false);
  } else {
    drawLeg(hR, kneeR, rFoot, true);
    drawLeg(hL, kneeL, lFoot, false);
  }

  // ── CLIMBING SHOES ─────────────────────────────────────────────────────────
  [[lFoot, kneeL, lIsBack], [rFoot, kneeR, !lIsBack]].forEach(([foot, knee, isBack]) => {
    const angle = Math.atan2(foot.y - knee.y, foot.x - knee.x);
    ctx.save();
    ctx.translate(foot.x, foot.y);
    ctx.rotate(angle + 0.15);
    const fl = figH * P.footLen;
    const dim = isBack ? 0.7 : 1;

    // Rubber sole (thick black)
    ctx.beginPath();
    ctx.ellipse(fl*0.28, fl*0.04, fl*0.75, fl*0.19, 0, 0, Math.PI*2);
    ctx.fillStyle = `rgb(${Math.round(22*dim)},${Math.round(22*dim)},${Math.round(22*dim)})`;
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = fl * 0.04;
    ctx.stroke();

    // Shoe upper — red climbing shoe
    const shoeGrad = ctx.createLinearGradient(-fl*0.1, -fl*0.22, fl*0.5, fl*0.1);
    shoeGrad.addColorStop(0,   `rgb(${Math.round(210*dim)},${Math.round(55*dim)},${Math.round(55*dim)})`);
    shoeGrad.addColorStop(0.6, `rgb(${Math.round(175*dim)},${Math.round(35*dim)},${Math.round(35*dim)})`);
    shoeGrad.addColorStop(1,   `rgb(${Math.round(120*dim)},${Math.round(20*dim)},${Math.round(20*dim)})`);
    ctx.beginPath();
    ctx.moveTo(-fl*0.08, -fl*0.05);
    ctx.quadraticCurveTo(-fl*0.12, -fl*0.28, fl*0.18, -fl*0.28);
    ctx.quadraticCurveTo(fl*0.62, -fl*0.26, fl*0.68, fl*0.0);
    ctx.quadraticCurveTo(fl*0.62, fl*0.06, fl*0.28, fl*0.02);
    ctx.quadraticCurveTo(fl*0.0, fl*0.06, -fl*0.08, -fl*0.05);
    ctx.closePath();
    ctx.fillStyle = shoeGrad;
    ctx.fill();
    ctx.strokeStyle = `rgb(${Math.round(90*dim)},${Math.round(15*dim)},${Math.round(15*dim)})`;
    ctx.lineWidth = fl * 0.03;
    ctx.stroke();

    // Lace line
    ctx.strokeStyle = `rgba(255,255,255,${isBack?0.2:0.45})`;
    ctx.lineWidth = fl * 0.025;
    ctx.beginPath();
    ctx.moveTo(fl*0.05, -fl*0.16); ctx.lineTo(fl*0.45, -fl*0.20);
    ctx.stroke();

    // Rand line (edge of rubber)
    ctx.strokeStyle = `rgba(0,0,0,${isBack?0.3:0.5})`;
    ctx.lineWidth = fl * 0.03;
    ctx.beginPath();
    ctx.moveTo(-fl*0.08, -fl*0.02);
    ctx.quadraticCurveTo(fl*0.28, fl*0.02, fl*0.65, fl*0.0);
    ctx.stroke();

    ctx.restore();
  });

  ctx.shadowBlur = figH * 0.03;

  // ── TORSO ──────────────────────────────────────────────────────────────────
  // Main torso shape — tapered, athletic
  const torsoGrad = ctx.createLinearGradient(sL.x, shoulderY, sR.x, shoulderY);
  torsoGrad.addColorStop(0,    "#1e6fa0");
  torsoGrad.addColorStop(0.35, "#2980b9");
  torsoGrad.addColorStop(0.65, "#2474aa");
  torsoGrad.addColorStop(1,    "#1a5c8a");
  ctx.beginPath();
  ctx.moveTo(sL.x, sL.y);
  ctx.bezierCurveTo(
    sL.x - figH*0.02, hip.y - figH*P.torsoLen*0.6,
    hL.x  - figH*0.01, hip.y,
    hL.x, hip.y
  );
  ctx.lineTo(hR.x, hip.y);
  ctx.bezierCurveTo(
    hR.x  + figH*0.01, hip.y,
    sR.x  + figH*0.02, hip.y - figH*P.torsoLen*0.6,
    sR.x, sR.y
  );
  ctx.closePath();
  ctx.fillStyle = torsoGrad;
  ctx.fill();
  ctx.strokeStyle = "#154360";
  ctx.lineWidth   = Math.max(figH*0.008, 1);
  ctx.stroke();

  // Chest muscle definition lines
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth   = Math.max(figH*0.007, 0.8);
  const midX = hip.x;
  const chestY = shoulderY + figH*P.torsoLen*0.3;
  ctx.beginPath();
  ctx.moveTo(midX, shoulderY + figH*0.015);
  ctx.lineTo(midX, hip.y - figH*0.02);
  ctx.stroke();
  // Horizontal chest line
  ctx.beginPath();
  ctx.moveTo(sL.x + figH*0.04, chestY);
  ctx.quadraticCurveTo(midX, chestY + figH*0.01, sR.x - figH*0.04, chestY);
  ctx.stroke();

  // Collar / neckline
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth   = Math.max(figH*0.010, 1);
  ctx.beginPath();
  ctx.arc(hip.x, shoulderY, figH*P.shoulderW*0.38, Math.PI*0.65, Math.PI*2.35);
  ctx.stroke();

  // ── HARNESS ────────────────────────────────────────────────────────────────
  // Waist belt
  const harnessGrad = ctx.createLinearGradient(hL.x, hip.y, hR.x, hip.y);
  harnessGrad.addColorStop(0,   "#cc6a10");
  harnessGrad.addColorStop(0.5, "#e67e22");
  harnessGrad.addColorStop(1,   "#cc6a10");
  ctx.beginPath();
  ctx.roundRect(hL.x - figH*0.008, hip.y - figH*0.028, (hR.x-hL.x) + figH*0.016, figH*0.038, figH*0.012);
  ctx.fillStyle = harnessGrad;
  ctx.fill();
  ctx.strokeStyle = "#a04f0a";
  ctx.lineWidth   = Math.max(figH*0.007, 0.8);
  ctx.stroke();
  // Buckle
  ctx.fillStyle   = "#c0c0c0";
  ctx.strokeStyle = "#888";
  ctx.lineWidth   = Math.max(figH*0.005, 0.6);
  ctx.beginPath();
  ctx.roundRect(hip.x - figH*0.025, hip.y - figH*0.022, figH*0.05, figH*0.026, figH*0.006);
  ctx.fill(); ctx.stroke();
  // Leg loops (visible as diagonal straps)
  ctx.strokeStyle = "#e67e22";
  ctx.lineWidth   = Math.max(figH*0.014, 2);
  ctx.beginPath();
  ctx.moveTo(hL.x, hip.y - figH*0.01);
  ctx.quadraticCurveTo(hL.x - figH*0.04, hip.y + figH*0.06, hL.x - figH*0.01, hip.y + figH*0.08);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hR.x, hip.y - figH*0.01);
  ctx.quadraticCurveTo(hR.x + figH*0.04, hip.y + figH*0.06, hR.x + figH*0.01, hip.y + figH*0.08);
  ctx.stroke();
  // Chalk bag (small pouch at back)
  ctx.fillStyle   = "#7d6608";
  ctx.strokeStyle = "#5a4a04";
  ctx.lineWidth   = Math.max(figH*0.006, 0.7);
  ctx.beginPath();
  ctx.roundRect(hip.x + figH*0.08, hip.y - figH*0.03, figH*0.055, figH*0.06, figH*0.01);
  ctx.fill(); ctx.stroke();

  // ── UPPER ARMS ─────────────────────────────────────────────────────────────
  // Back arm first (slightly dimmed)
  const lArmIsBack = lHand.x > hip.x;
  [[sL, elbL, lHand, lArmIsBack], [sR, elbR, rHand, !lArmIsBack]]
    .sort((a,b)=> a[3] ? -1 : 1)  // back arm drawn first
    .forEach(([shoulder, elbow, hand, isBack]) => {
      const dim = isBack ? 0.75 : 1;
      const r = uArmR * (isBack ? 0.88 : 1);
      // Upper arm (sleeve)
      drawCapsuleGrad(ctx, shoulder, elbow, Math.max(r,3),
        `rgb(${Math.round(36*dim)},${Math.round(130*dim)},${Math.round(185*dim)})`,
        `rgb(${Math.round(20*dim)},${Math.round(75*dim)},${Math.round(108*dim)})`,
        `rgb(${Math.round(15*dim)},${Math.round(55*dim)},${Math.round(80*dim)})`
      );
      // Forearm (skin)
      drawCapsuleGrad(ctx, elbow, hand, Math.max(fArmR*(isBack?0.85:1), 2.5),
        `rgb(${Math.round(220*dim)},${Math.round(160*dim)},${Math.round(110*dim)})`,
        `rgb(${Math.round(180*dim)},${Math.round(120*dim)},${Math.round(80*dim)})`,
        `rgb(${Math.round(140*dim)},${Math.round(90*dim)},${Math.round(55*dim)})`
      );
      // Elbow joint
      ctx.beginPath();
      ctx.arc(elbow.x, elbow.y, Math.max(r*0.85, 3), 0, Math.PI*2);
      ctx.fillStyle = `rgb(${Math.round(25*dim)},${Math.round(90*dim)},${Math.round(130*dim)})`;
      ctx.fill();
    });

  // ── HANDS ──────────────────────────────────────────────────────────────────
  [lHand, rHand].forEach((hand, hi) => {
    const r = figH * 0.028;
    // Chalk glow
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, r * 1.5, 0, Math.PI*2);
    const chalkGlow = ctx.createRadialGradient(hand.x, hand.y, 0, hand.x, hand.y, r*1.5);
    chalkGlow.addColorStop(0,   "rgba(255,255,240,0.35)");
    chalkGlow.addColorStop(0.5, "rgba(255,255,240,0.12)");
    chalkGlow.addColorStop(1,   "rgba(255,255,240,0)");
    ctx.fillStyle = chalkGlow;
    ctx.fill();

    // Hand base
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, r, 0, Math.PI*2);
    const handGrad = ctx.createRadialGradient(
      hand.x - r*0.3, hand.y - r*0.3, 0,
      hand.x, hand.y, r
    );
    handGrad.addColorStop(0,   "#f5d5a0");
    handGrad.addColorStop(0.6, "#e0b87a");
    handGrad.addColorStop(1,   "#c08844");
    ctx.fillStyle = handGrad;
    ctx.fill();
    ctx.strokeStyle = "#9a6025";
    ctx.lineWidth   = Math.max(figH*0.007, 0.8);
    ctx.stroke();

    // Finger lines
    ctx.strokeStyle = "rgba(80,40,10,0.5)";
    ctx.lineWidth   = Math.max(figH*0.005, 0.5);
    for (let f = -1; f <= 1; f++) {
      ctx.beginPath();
      ctx.moveTo(hand.x + f*r*0.35, hand.y - r*0.2);
      ctx.lineTo(hand.x + f*r*0.35, hand.y + r*0.6);
      ctx.stroke();
    }
    // Thumb
    ctx.beginPath();
    ctx.moveTo(hand.x + r*0.6, hand.y - r*0.1);
    ctx.quadraticCurveTo(hand.x + r*1.1, hand.y, hand.x + r*0.9, hand.y + r*0.5);
    ctx.strokeStyle = "#e0b87a";
    ctx.lineWidth   = Math.max(figH*0.014, 2);
    ctx.stroke();
    ctx.strokeStyle = "#9a6025";
    ctx.lineWidth   = Math.max(figH*0.005, 0.5);
    ctx.stroke();
  });

  // ── NECK ───────────────────────────────────────────────────────────────────
  ctx.shadowBlur = figH * 0.02;
  drawCapsuleGrad(ctx, neckBase, neckTop, Math.max(neckR, 3),
    "#e0b070", "#c08848", "#9a6025");

  // ── HEAD ───────────────────────────────────────────────────────────────────
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur  = figH * 0.035;

  // Head sphere — subsurface scattering-like gradient
  const headGrad = ctx.createRadialGradient(
    hip.x - figH*P.headR*0.3, headCY - figH*P.headR*0.4, 0,
    hip.x, headCY, figH*P.headR
  );
  headGrad.addColorStop(0,    "#fce4b8");
  headGrad.addColorStop(0.5,  "#f0c080");
  headGrad.addColorStop(0.85, "#d4956a");
  headGrad.addColorStop(1,    "#b87040");
  ctx.beginPath();
  ctx.arc(hip.x, headCY, figH*P.headR, 0, Math.PI*2);
  ctx.fillStyle = headGrad;
  ctx.fill();
  ctx.strokeStyle = "#a86030";
  ctx.lineWidth   = Math.max(figH*0.008, 0.8);
  ctx.stroke();

  // Jaw definition
  ctx.beginPath();
  ctx.arc(hip.x, headCY, figH*P.headR*0.92, Math.PI*0.1, Math.PI*0.9);
  ctx.strokeStyle = "rgba(140,70,30,0.25)";
  ctx.lineWidth   = Math.max(figH*0.010, 1);
  ctx.stroke();

  ctx.shadowBlur = 0;

  // Hair
  ctx.beginPath();
  ctx.arc(hip.x, headCY, figH*P.headR*0.97, -Math.PI*0.08, Math.PI*1.08, true);
  ctx.quadraticCurveTo(hip.x, headCY - figH*P.headR*1.4, hip.x, headCY - figH*P.headR*0.97);
  ctx.closePath();
  const hairGrad = ctx.createRadialGradient(hip.x, headCY - figH*P.headR*0.5, 0, hip.x, headCY, figH*P.headR);
  hairGrad.addColorStop(0,   "#4a2c10");
  hairGrad.addColorStop(0.7, "#2c1808");
  hairGrad.addColorStop(1,   "#180e04");
  ctx.fillStyle = hairGrad;
  ctx.fill();

  // Eyebrows
  ctx.strokeStyle = "#2c1808";
  ctx.lineWidth   = Math.max(figH*0.014, 1.5);
  ctx.lineCap     = "round";
  [[-1,1],[1,-1]].forEach(([side, tilt]) => {
    ctx.beginPath();
    ctx.moveTo(hip.x + side*(figH*P.headR*0.18), headCY - figH*P.headR*0.32);
    ctx.quadraticCurveTo(
      hip.x + side*(figH*P.headR*0.5), headCY - figH*P.headR*(0.35 + tilt*0.04),
      hip.x + side*(figH*P.headR*0.62), headCY - figH*P.headR*0.28
    );
    ctx.stroke();
  });

  // Eye whites
  [-1,1].forEach(side => {
    const ex = hip.x + side * figH*P.headR*0.35;
    const ey = headCY - figH*P.headR*0.12;
    ctx.beginPath();
    ctx.ellipse(ex, ey, figH*P.headR*0.22, figH*P.headR*0.15, 0, 0, Math.PI*2);
    ctx.fillStyle = "#f0e8d8";
    ctx.fill();
    ctx.strokeStyle = "rgba(100,50,20,0.4)";
    ctx.lineWidth   = Math.max(figH*0.006, 0.7);
    ctx.stroke();

    // Iris
    ctx.beginPath();
    ctx.ellipse(ex + figH*P.headR*0.03, ey, figH*P.headR*0.13, figH*P.headR*0.13, 0, 0, Math.PI*2);
    const irisGrad = ctx.createRadialGradient(ex+figH*P.headR*0.03, ey, 0, ex+figH*P.headR*0.03, ey, figH*P.headR*0.13);
    irisGrad.addColorStop(0,   "#1a3a60");
    irisGrad.addColorStop(0.6, "#1a2840");
    irisGrad.addColorStop(1,   "#0a1020");
    ctx.fillStyle = irisGrad;
    ctx.fill();

    // Pupil
    ctx.beginPath();
    ctx.arc(ex + figH*P.headR*0.03, ey, figH*P.headR*0.06, 0, Math.PI*2);
    ctx.fillStyle = "#050810";
    ctx.fill();

    // Eye highlight
    ctx.beginPath();
    ctx.arc(ex + figH*P.headR*0.08, ey - figH*P.headR*0.06, figH*P.headR*0.04, 0, Math.PI*2);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fill();
  });

  // Nose
  ctx.strokeStyle = "rgba(140,80,40,0.6)";
  ctx.lineWidth   = Math.max(figH*0.012, 1.2);
  ctx.beginPath();
  ctx.moveTo(hip.x, headCY - figH*P.headR*0.06);
  ctx.quadraticCurveTo(hip.x + figH*P.headR*0.28, headCY + figH*P.headR*0.18, hip.x + figH*P.headR*0.22, headCY + figH*P.headR*0.26);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hip.x + figH*P.headR*0.15, headCY + figH*P.headR*0.28, figH*P.headR*0.09, 0, Math.PI*2);
  ctx.fillStyle = "rgba(140,80,40,0.25)";
  ctx.fill();

  // Mouth (slight determined expression)
  ctx.strokeStyle = "rgba(160,80,50,0.7)";
  ctx.lineWidth   = Math.max(figH*0.012, 1.2);
  ctx.beginPath();
  ctx.moveTo(hip.x - figH*P.headR*0.28, headCY + figH*P.headR*0.45);
  ctx.quadraticCurveTo(hip.x, headCY + figH*P.headR*0.50, hip.x + figH*P.headR*0.28, headCY + figH*P.headR*0.45);
  ctx.stroke();

  // ── HELMET ─────────────────────────────────────────────────────────────────
  const hR2 = figH * P.headR;
  const helmetGrad = ctx.createRadialGradient(
    hip.x - hR2*0.3, headCY - hR2*0.8, 0,
    hip.x, headCY, hR2*1.1
  );
  helmetGrad.addColorStop(0,    "#ffd040");
  helmetGrad.addColorStop(0.45, "#f39c12");
  helmetGrad.addColorStop(0.85, "#d68910");
  helmetGrad.addColorStop(1,    "#b5770d");

  ctx.beginPath();
  ctx.arc(hip.x, headCY, hR2*1.07, Math.PI*0.82, Math.PI*2.18);
  ctx.fillStyle = helmetGrad;
  ctx.fill();
  ctx.strokeStyle = "#a06008";
  ctx.lineWidth   = Math.max(figH*0.008, 0.8);
  ctx.stroke();

  // Helmet brim
  ctx.beginPath();
  ctx.moveTo(hip.x - hR2*1.05, headCY + hR2*0.12);
  ctx.quadraticCurveTo(hip.x, headCY + hR2*0.32, hip.x + hR2*1.05, headCY + hR2*0.12);
  ctx.strokeStyle = "#a06008";
  ctx.lineWidth   = Math.max(figH*0.014, 1.5);
  ctx.stroke();

  // Helmet vents
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth   = Math.max(figH*0.012, 1.2);
  [-hR2*0.3, 0, hR2*0.3].forEach(dx => {
    ctx.beginPath();
    ctx.moveTo(hip.x + dx, headCY - hR2*0.92);
    ctx.lineTo(hip.x + dx, headCY - hR2*0.42);
    ctx.stroke();
  });

  // Helmet highlight
  ctx.beginPath();
  ctx.arc(hip.x - hR2*0.2, headCY - hR2*0.6, hR2*0.32, 0, Math.PI*2);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();

  // Chin strap
  ctx.strokeStyle = "#b5770d";
  ctx.lineWidth   = Math.max(figH*0.014, 1.5);
  ctx.beginPath();
  ctx.arc(hip.x, headCY, hR2*1.07, Math.PI*0.88, Math.PI*1.12);
  ctx.stroke();

  ctx.restore();
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