const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const Jimp = require('jimp');
require('dotenv').config();

const app    = express();
const upload = multer({ storage: multer.memoryStorage() });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '20mb' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── 1. Upload ─────────────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const ext  = getExtension(file.mimetype);
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
    const { error } = await supabase.storage
      .from('climb-analysis')
      .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('climb-analysis').getPublicUrl(fileName);
    res.json({ file_url: publicUrl });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 2. Detect holds (pixel-based, no AI) ─────────────────────────────────────
app.post('/api/detect', async (req, res) => {
  try {
    const { image_url, hold_rgb, left_boundary = 0, right_boundary = 100 } = req.body;
    const [tR, tG, tB] = hold_rgb.split(',').map(v => parseInt(v.trim()));
    const imgResponse  = await fetch(image_url);
    const imgBuffer    = Buffer.from(await imgResponse.arrayBuffer());
    let holds = await detectHolds(imgBuffer, tR, tG, tB);
    holds = holds.filter(h => h.x >= left_boundary && h.x <= right_boundary);
    const ys = holds.map(h => h.y);
    const wallTopY    = ys.length ? Math.max(0,   Math.min(...ys) - 8) : 0;
    const wallBottomY = ys.length ? Math.min(100, Math.max(...ys) + 8) : 100;
    console.log(`Detected ${holds.length} holds`);
    res.json({ holds, wall_top_y: wallTopY, wall_bottom_y: wallBottomY });
  } catch (err) {
    console.error('Detect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 3. Analyze route ──────────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  try {
    const {
      image_url, hold_color, hold_hex, hold_rgb, user_height_cm,
      holds, wall_top_y, wall_bottom_y,
      start_indices, end_indices,
      estimated_wall_height_m = 4.0,
    } = req.body;

    // ── Step A: Ask Claude ONLY to identify hold types and describe each hold ──
    const imgResponse = await fetch(image_url);
    const imgBuffer   = Buffer.from(await imgResponse.arrayBuffer());
    const base64Image = imgBuffer.toString('base64');
    const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';

    const holdTypingPrompt = buildHoldTypingPrompt(hold_color, hold_hex, holds, wall_top_y, wall_bottom_y, start_indices, end_indices);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: contentType, data: base64Image } },
          { type: 'text',  text: holdTypingPrompt },
        ],
      }],
    });

    const cleaned   = message.content[0].text.replace(/```json|```/g, '').trim();
    const claudeOut = JSON.parse(cleaned);

    // ── Step B: Compute grade in code from real physics ───────────────────────
    const holdDetails = claudeOut.hold_details || [];

    // Merge Claude's hold types into our detected holds
    const mergedHolds = holds.map((hold, i) => {
      const d = holdDetails[i] || {};
      return {
        ...hold,
        type:              d.type              || 'crimp',
        angle:             d.angle             || 'vertical',
        texture:           d.texture           || 'smooth',
        size_estimate:     d.size_estimate     || 'small',
        description:       d.description       || '',
        position_in_route: d.position_in_route || positionFromY(hold.y, wall_top_y, wall_bottom_y),
        is_start: (start_indices || []).includes(i),
        is_end:   (end_indices   || []).includes(i),
      };
    });

    // Compute grade using our physics engine
    const gradeResult = computeGrade({
      holds:           mergedHolds,
      start_indices:   start_indices  || [],
      end_indices:     end_indices    || [],
      user_height_cm,
      wall_top_y,
      wall_bottom_y,
      estimated_wall_height_m,
    });

    // Build step-by-step beta from the move analysis
    const moveDescription = buildBetaText(gradeResult.moves, mergedHolds, user_height_cm);

    res.json({
      v_grade:                gradeResult.v_grade,
      numeric_score:          gradeResult.numeric_score,
      estimated_wall_height_m,
      hold_analysis:          claudeOut.hold_analysis || '',
      move_description:       moveDescription,
      tips:                   claudeOut.tips || '',
      grade_reasoning:        gradeResult.grade_reasoning,
      grade_breakdown:        gradeResult.breakdown,
      holds:                  mergedHolds,
      wall_top_y,
      wall_bottom_y,
    });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 4. Save ───────────────────────────────────────────────────────────────────
app.post('/api/save-analysis', async (req, res) => {
  try {
    const { data, error } = await supabase.from('climb_analyses').insert([req.body]).select();
    if (error) throw error;
    res.json({ id: data[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// PHYSICS-BASED GRADE ENGINE
// ═════════════════════════════════════════════════════════════════════════════

/*
  HOLD DIFFICULTY SCORES (0-10 scale)
  Based on contact surface area and friction demands.
  These are fixed physical properties — not opinions.
*/
const HOLD_SCORES = {
  jug:      1,   // Large positive edge, full hand wrap. Minimal finger force.
  pocket:   2,   // 2-3 finger hole. Moderate pulleys load.
  pinch:    3,   // Opposing thumb/finger force. High forearm recruitment.
  sloper:   4,   // No positive edge. Pure friction + body position dependent.
  crimp:    4,   // Small edge, high flexor + pulley load.
  foothold: 0,   // Foot only, not graded as hand move.
  hold:     2,   // Unknown — default moderate
};

/*
  ANGLE MULTIPLIERS
  Steeper wall = more body tension required = harder.
*/
const ANGLE_MULT = {
  slab:       0.8,   // Less than vertical — balance dependent
  vertical:   1.0,   // Reference
  slight_overhang: 1.3,
  overhang:   1.6,
  steep:      2.0,
  roof:       2.5,
};

/*
  REACH DIFFICULTY
  reach_ratio = distance_between_holds / climber_arm_span
  arm_span ≈ height (Vitruvian ratio)
*/
function reachDifficulty(reachRatio) {
  // 0-0.3  = very close, minimal difficulty
  // 0.3-0.5 = comfortable reach
  // 0.5-0.7 = moderate stretch
  // 0.7-0.85 = hard reach
  // 0.85-1.0 = near max reach
  // >1.0    = requires dynamic/deadpoint
  if (reachRatio < 0.30) return { score: 0.5, label: 'close',    dynamic: false };
  if (reachRatio < 0.50) return { score: 1.5, label: 'moderate', dynamic: false };
  if (reachRatio < 0.70) return { score: 3.0, label: 'stretch',  dynamic: false };
  if (reachRatio < 0.85) return { score: 5.0, label: 'hard reach', dynamic: false };
  if (reachRatio < 1.00) return { score: 7.0, label: 'near max', dynamic: false };
  return                         { score: 9.0, label: 'dynamic',  dynamic: true  };
}

/*
  LATERAL DIFFICULTY
  Large horizontal movement = hip rotation / flagging required
*/
function lateralDifficulty(lateralRatio) {
  if (lateralRatio < 0.15) return 0;
  if (lateralRatio < 0.30) return 0.5;
  if (lateralRatio < 0.50) return 1.5;
  return 3.0;
}

/*
  V-GRADE MAPPING
  Maps a numeric difficulty score to a V grade.
  Calibrated so that:
    - A route of all jugs close together = V0
    - All crimps at full reach = V6+
*/
function scoreToVGrade(score) {
  // score per move average × number of moves weighted
  if (score <  3)  return 'V0';
  if (score <  5)  return 'V1';
  if (score <  8)  return 'V2';
  if (score < 12)  return 'V3';
  if (score < 17)  return 'V4';
  if (score < 23)  return 'V5';
  if (score < 30)  return 'V6';
  if (score < 38)  return 'V7';
  if (score < 48)  return 'V8';
  if (score < 60)  return 'V9';
  return 'V10+';
}

function computeGrade({ holds, start_indices, end_indices, user_height_cm, wall_top_y, wall_bottom_y, estimated_wall_height_m }) {
  const armSpan = user_height_cm; // Vitruvian ratio: arm span ≈ height

  // Convert % coordinates to real-world cm
  // wall_height_px = (wall_bottom_y - wall_top_y)% of image
  // We know estimated_wall_height_m in real world
  const wallHeightPct = wall_bottom_y - wall_top_y; // % of image
  const cmPerPct = (estimated_wall_height_m * 100) / wallHeightPct; // cm per 1% of image

  // Build ordered sequence of holds from start to end
  // Sort holds by Y descending (bottom=start) — this is the natural climbing order
  const startIdx = start_indices[0] ?? 0;
  const endIdx   = end_indices[0]   ?? holds.length - 1;

  // Get all holds not counting footholds, ordered bottom to top
  const climbHolds = holds
    .map((h, i) => ({ ...h, originalIndex: i }))
    .filter(h => h.type !== 'foothold')
    .sort((a, b) => b.y - a.y); // bottom of wall first

  // Find start and end positions in the sequence
  const startPos = climbHolds.findIndex(h => h.originalIndex === startIdx);
  const endPos   = climbHolds.findIndex(h => h.originalIndex === endIdx);

  // Slice to just the route holds
  const routeStart = startPos >= 0 ? startPos : 0;
  const routeEnd   = endPos   >= 0 ? endPos   : climbHolds.length - 1;
  const routeHolds = climbHolds.slice(routeStart, routeEnd + 1);

  if (routeHolds.length < 2) {
    return {
      v_grade: 'V0',
      numeric_score: 0,
      grade_reasoning: 'Not enough holds to compute a grade.',
      moves: [],
      breakdown: [],
    };
  }

  // ── Analyze each move ──────────────────────────────────────────────────────
  const moves = [];
  let totalScore = 0;

  for (let i = 0; i < routeHolds.length - 1; i++) {
    const from = routeHolds[i];
    const to   = routeHolds[i + 1];

    // Real-world distance between hold centers
    const dxPct = to.x - from.x;
    const dyPct = to.y - from.y; // positive = moving down (toward start), negative = up
    const distPct = Math.sqrt(dxPct * dxPct + dyPct * dyPct);
    const distCm  = distPct * cmPerPct;

    // Vertical component (how high you're reaching up)
    const vertCm     = Math.abs(dyPct) * cmPerPct;
    const horizCm    = Math.abs(dxPct) * cmPerPct;

    // Reach ratio = vertical reach distance / arm span
    const reachRatio   = vertCm  / armSpan;
    const lateralRatio = horizCm / armSpan;

    // Hold score for the destination hold
    const holdScore = HOLD_SCORES[to.type] || 2;

    // Wall angle score (infer from hold size + position — steeper = holds further apart horizontally)
    const angleScore = ANGLE_MULT[to.angle] || 1.0;

    // Reach difficulty
    const reach = reachDifficulty(reachRatio);

    // Lateral difficulty
    const lateral = lateralDifficulty(lateralRatio);

    // Move score = hold difficulty × angle × reach factor + lateral
    const moveScore = (holdScore * angleScore) + reach.score + lateral;
    totalScore += moveScore;

    moves.push({
      fromIndex: from.originalIndex,
      toIndex:   to.originalIndex,
      fromHold:  from,
      toHold:    to,
      distCm:    Math.round(distCm),
      vertCm:    Math.round(vertCm),
      horizCm:   Math.round(horizCm),
      reachRatio: Math.round(reachRatio * 100) / 100,
      reachLabel: reach.label,
      dynamic:   reach.dynamic,
      moveScore: Math.round(moveScore * 10) / 10,
    });
  }

  // ── Crux identification ────────────────────────────────────────────────────
  const sortedMoves  = [...moves].sort((a,b) => b.moveScore - a.moveScore);
  const cruxMove     = sortedMoves[0];
  const cruxIndex    = moves.indexOf(cruxMove);

  // ── Final score ───────────────────────────────────────────────────────────
  // Weight: 60% total accumulated difficulty + 40% single hardest move
  // This mirrors real climbing: a route is as hard as its crux, but volume matters
  const cruxWeight  = cruxMove ? cruxMove.moveScore * 0.4 * routeHolds.length : 0;
  const finalScore  = (totalScore * 0.6) + cruxWeight;
  const vGrade      = scoreToVGrade(finalScore);

  // ── Grade breakdown ────────────────────────────────────────────────────────
  const breakdown = moves.map((m, i) => ({
    move:      i + 1,
    from:      `Hold ${m.fromHold.originalIndex + 1} (${m.fromHold.type})`,
    to:        `Hold ${m.toHold.originalIndex + 1} (${m.toHold.type})`,
    distCm:    m.distCm,
    reach:     m.reachLabel,
    dynamic:   m.dynamic,
    score:     m.moveScore,
    isCrux:    m === cruxMove,
  }));

  const gradeReasoning = `${vGrade} computed from ${moves.length} moves. ` +
    `Total difficulty score: ${Math.round(finalScore)}. ` +
    `Crux is Move ${cruxIndex + 1}: ${cruxMove?.reachLabel || ''} reach to a ${cruxMove?.toHold.type || ''} ` +
    `(${cruxMove?.distCm || 0}cm, score ${cruxMove?.moveScore || 0}). ` +
    `Average move score: ${Math.round(totalScore / moves.length * 10) / 10}.`;

  return { v_grade: vGrade, numeric_score: Math.round(finalScore), grade_reasoning: gradeReasoning, moves, breakdown };
}

/*
  Build step-by-step beta text from computed moves
*/
function buildBetaText(moves, holds, heightCm) {
  if (!moves || moves.length === 0) return '';

  const lines = [];
  const startHold = moves[0]?.fromHold;
  if (startHold) {
    const isTwo = holds.filter(h => h.is_start).length === 2;
    if (isTwo) {
      const starts = holds.filter(h => h.is_start);
      lines.push(`Move 1: Begin with left hand on Hold ${starts[0].originalIndex !== undefined ? starts[0].originalIndex + 1 : '?'} (${starts[0].type}) and right hand on Hold ${starts[1]?.originalIndex !== undefined ? starts[1].originalIndex + 1 : '?'} (${starts[1]?.type || 'hold'}) simultaneously — two-hand start.`);
    } else {
      lines.push(`Move 1: Begin standing below Hold ${startHold.originalIndex + 1}. Grab the ${startHold.type} with your preferred hand.`);
    }
  }

  moves.forEach((move, i) => {
    const hand   = i % 2 === 0 ? 'right' : 'left';
    const action = move.dynamic
      ? `Deadpoint or jump`
      : move.reachLabel === 'hard reach' || move.reachLabel === 'near max'
        ? `Make a long reach`
        : `Move`;
    const cruxNote = move.isCrux ? ' ← CRUX MOVE' : '';
    lines.push(
      `Move ${i + 2}: ${action} ${hand} hand to Hold ${move.toHold.originalIndex + 1} (${move.toHold.type}). ` +
      `Distance: ${move.distCm}cm (${move.reachLabel} reach${move.dynamic ? ', dynamic' : ''}).` +
      (move.horizCm > 20 ? ` Step or flag opposite foot for hip rotation.` : '') +
      cruxNote
    );
  });

  const endHold = moves[moves.length - 1]?.toHold;
  if (endHold) {
    lines.push(`Finish: Control the ${endHold.type} on Hold ${endHold.originalIndex + 1} and top out.`);
  }

  return lines.join('\n');
}

// ── Claude prompt (hold typing ONLY — no grading) ─────────────────────────────
function buildHoldTypingPrompt(holdColor, holdHex, holds, wallTopY, wallBottomY, startIndices, endIndices) {
  const holdList = holds.map((h, i) => {
    const tag = (startIndices||[]).includes(i) ? ' [START]' : (endIndices||[]).includes(i) ? ' [FINISH]' : '';
    return `  Hold ${i+1}: center (${h.x}%, ${h.y}%), size ${h.width}%w × ${h.height}%h${tag}`;
  }).join('\n');

  return `You are analyzing a photo of an indoor bouldering wall to classify holds. You will NOT grade the route — grading is done separately by our physics engine.

COLOR: ${holdColor} (hex: ${holdHex})
WALL: top=${wallTopY}%, bottom=${wallBottomY}% of image height

DETECTED HOLDS:
${holdList}

For each hold, look at the image at the given coordinates and identify:
- type: the grip type — ONLY one of: "jug", "crimp", "sloper", "pinch", "pocket", "foothold"
  - jug = large positive incut you can wrap your whole hand around
  - crimp = small ledge, 1-4 finger pads only
  - sloper = rounded, no positive edge, pure friction
  - pinch = you grip with thumb opposing fingers
  - pocket = hole in the wall, 1-3 fingers
  - foothold = only usable as a foot placement

- angle: the wall angle at this hold — "slab", "vertical", "slight_overhang", "overhang", "steep", "roof"

- texture: "smooth", "medium", "rough" — how much friction the hold has

- size_estimate: "tiny", "small", "medium", "large" — relative to a hand

- description: one sentence on how to grip this specific hold

- position_in_route: "start", "low", "mid", "high", "top"

Also provide:
- hold_analysis: one paragraph describing the overall hold quality on this route
- tips: 2-3 technique tips (NOT about grading — about movement and body position)

Return ONLY this JSON, no markdown:
{
  "hold_analysis": "...",
  "tips": "...",
  "hold_details": [
    {
      "type": "crimp",
      "angle": "vertical",
      "texture": "medium",
      "size_estimate": "small",
      "description": "Two-finger crimp pocket, index and middle finger.",
      "position_in_route": "mid"
    }
  ]
}

hold_details must have exactly ${holds.length} entries in the same order as the list above.`;
}

// ── Hold detection (pixel-based) ──────────────────────────────────────────────
async function detectHolds(imgBuffer, targetR, targetG, targetB) {
  const image = await Jimp.read(imgBuffer);
  const scale = Math.min(1, 800 / image.bitmap.width);
  const W = Math.round(image.bitmap.width  * scale);
  const H = Math.round(image.bitmap.height * scale);
  image.resize(W, H);

  const targetHsl = rgbToHsl(targetR, targetG, targetB);
  const isLowSat  = targetHsl.s < 0.15;
  const mask      = new Uint8Array(W * H);

  image.scan(0, 0, W, H, function(x, y, idx) {
    const r = this.bitmap.data[idx], g = this.bitmap.data[idx+1], b = this.bitmap.data[idx+2];
    if (colorMatches(r, g, b, targetR, targetG, targetB, targetHsl, isLowSat)) mask[y*W+x] = 1;
  });

  const labels = new Int32Array(W * H);
  let nextLabel = 1;
  const clusters = {};

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y*W+x;
      if (!mask[idx] || labels[idx]) continue;
      const label   = nextLabel++;
      const queue   = [idx];
      labels[idx]   = label;
      const cluster = { pixels:[], minX:x, maxX:x, minY:y, maxY:y };
      while (queue.length > 0) {
        const cur = queue.pop();
        const cx = cur%W, cy = Math.floor(cur/W);
        cluster.pixels.push(cur);
        if (cx<cluster.minX) cluster.minX=cx; if (cx>cluster.maxX) cluster.maxX=cx;
        if (cy<cluster.minY) cluster.minY=cy; if (cy>cluster.maxY) cluster.maxY=cy;
        for (const n of [cur-1,cur+1,cur-W,cur+W,cur-W-1,cur-W+1,cur+W-1,cur+W+1]) {
          if (n>=0 && n<W*H && mask[n] && !labels[n]) { labels[n]=label; queue.push(n); }
        }
      }
      clusters[label] = cluster;
    }
  }

  const imgArea = W*H;
  const holds   = [];
  for (const c of Object.values(clusters)) {
    const area  = c.pixels.length;
    if (area < imgArea*0.0001 || area > imgArea*0.015) continue;
    const bboxW = ((c.maxX-c.minX)/W)*100;
    const bboxH = ((c.maxY-c.minY)/H)*100;
    const ar    = bboxW/(bboxH||0.01);
    if (ar > 6 || ar < 0.17) continue;
    holds.push({
      x: Math.round(((c.minX+c.maxX)/2/W)*1000)/10,
      y: Math.round(((c.minY+c.maxY)/2/H)*1000)/10,
      width:  Math.round(Math.max(bboxW,1)*10)/10,
      height: Math.round(Math.max(bboxH,1)*10)/10,
      area,
    });
  }
  holds.sort((a,b) => b.y-a.y);
  return mergeNearbyHolds(holds);
}

function mergeNearbyHolds(holds) {
  const merged = [], used = new Set();
  for (let i = 0; i < holds.length; i++) {
    if (used.has(i)) continue;
    const group = [holds[i]]; used.add(i);
    for (let j = i+1; j < holds.length; j++) {
      if (used.has(j)) continue;
      const dx = holds[i].x-holds[j].x, dy = holds[i].y-holds[j].y;
      if (Math.sqrt(dx*dx+dy*dy) < 5) { group.push(holds[j]); used.add(j); }
    }
    const minX = Math.min(...group.map(h=>h.x-h.width/2));
    const maxX = Math.max(...group.map(h=>h.x+h.width/2));
    const minY = Math.min(...group.map(h=>h.y-h.height/2));
    const maxY = Math.max(...group.map(h=>h.y+h.height/2));
    merged.push({
      x: Math.round(group.reduce((s,h)=>s+h.x,0)/group.length*10)/10,
      y: Math.round(group.reduce((s,h)=>s+h.y,0)/group.length*10)/10,
      width:  Math.round((maxX-minX)*10)/10,
      height: Math.round((maxY-minY)*10)/10,
    });
  }
  return merged;
}

function colorMatches(r,g,b,tR,tG,tB,targetHsl,isLowSat) {
  const hsl = rgbToHsl(r,g,b);
  if (isLowSat) return Math.abs(hsl.l-targetHsl.l)<0.12 && Math.abs(hsl.s-targetHsl.s)<0.12;
  let dH = Math.abs(hsl.h-targetHsl.h); if (dH>180) dH=360-dH;
  if (hsl.s<0.15) return false;
  return (dH/360)<0.08 && Math.abs(hsl.s-targetHsl.s)<0.35 && Math.abs(hsl.l-targetHsl.l)<0.35;
}

function rgbToHsl(r,g,b) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h,s; const l=(max+min)/2;
  if (max===min) { h=s=0; }
  else {
    const d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}
  }
  return {h:h*360,s,l};
}

function positionFromY(y,wallTopY=0,wallBottomY=100) {
  const fromBottom = 1-(y-wallTopY)/(wallBottomY-wallTopY);
  if (fromBottom<0.2) return 'start';
  if (fromBottom<0.4) return 'low';
  if (fromBottom<0.6) return 'mid';
  if (fromBottom<0.8) return 'high';
  return 'top';
}

function getExtension(mimeType) {
  const map={'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp','image/heic':'.heic'};
  return map[mimeType]||'.jpg';
}

const PORT = process.env.PORT||3001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));