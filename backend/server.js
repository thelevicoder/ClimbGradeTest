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
*/
const HOLD_SCORES = {
  jug:      1.0,
  pocket:   2.0,
  pinch:    3.0,
  sloper:   3.5,
  crimp:    4.0,
  foothold: 0.0,
  hold:     2.0,
};

const ANGLE_MULT = {
  slab:            0.75,
  vertical:        1.0,
  slight_overhang: 1.2,
  overhang:        1.5,
  steep:           1.9,
  roof:            2.4,
};

function reachDifficulty(reachRatio) {
  // reachRatio = move distance / median route move distance (normalized)
  // 1.0 = average move for this route
  if (reachRatio < 0.50) return { score: 0.3, label: 'close',      dynamic: false };
  if (reachRatio < 0.85) return { score: 1.0, label: 'moderate',   dynamic: false };
  if (reachRatio < 1.20) return { score: 2.0, label: 'normal',     dynamic: false };
  if (reachRatio < 1.60) return { score: 3.5, label: 'stretch',    dynamic: false };
  if (reachRatio < 2.00) return { score: 5.0, label: 'hard reach', dynamic: false };
  return                         { score: 7.0, label: 'dynamic',    dynamic: true  };
}

function lateralDifficulty(lateralRatio) {
  if (lateralRatio < 0.20) return 0;
  if (lateralRatio < 0.40) return 0.4;
  if (lateralRatio < 0.60) return 1.0;
  return 2.0;
}

/*
  V-GRADE MAPPING — recalibrated downward.
  Real gym routes with jugs = V0-V1.
  Moderate crimps, normal spacing = V2-V4.
  Hard crimps / big moves = V5+.
*/
function scoreToVGrade(score) {
  if (score <  2)  return 'V0';
  if (score <  4)  return 'V1';
  if (score <  7)  return 'V2';
  if (score < 11)  return 'V3';
  if (score < 16)  return 'V4';
  if (score < 22)  return 'V5';
  if (score < 29)  return 'V6';
  if (score < 37)  return 'V7';
  if (score < 46)  return 'V8';
  if (score < 56)  return 'V9';
  return 'V10+';
}

function computeGrade({ holds, start_indices, end_indices, user_height_cm, wall_top_y, wall_bottom_y, estimated_wall_height_m }) {

  const startIdx = start_indices[0] ?? 0;
  const endIdx   = end_indices[0]   ?? holds.length - 1;

  const climbHolds = holds
    .map((h, i) => ({ ...h, originalIndex: i }))
    .filter(h => h.type !== 'foothold')
    .sort((a, b) => b.y - a.y);

  const startPos = climbHolds.findIndex(h => h.originalIndex === startIdx);
  const endPos   = climbHolds.findIndex(h => h.originalIndex === endIdx);
  const routeStart = startPos >= 0 ? startPos : 0;
  const routeEnd   = endPos   >= 0 ? endPos   : climbHolds.length - 1;
  const routeHolds = climbHolds.slice(routeStart, routeEnd + 1);

  if (routeHolds.length < 2) {
    return { v_grade:'V0', numeric_score:0, grade_reasoning:'Not enough holds.', moves:[], breakdown:[] };
  }

  // Compute pixel distances between consecutive holds
  const rawDists = [];
  for (let i = 0; i < routeHolds.length - 1; i++) {
    const a = routeHolds[i], b = routeHolds[i+1];
    const dx = b.x - a.x, dy = b.y - a.y;
    rawDists.push(Math.sqrt(dx*dx + dy*dy));
  }

  // Median move distance on this specific route (% units)
  const sorted = [...rawDists].sort((a,b)=>a-b);
  const medianDist = sorted[Math.floor(sorted.length/2)] || 1;

  // ── Analyze each move ──────────────────────────────────────────────────────
  const moves = [];
  let totalScore = 0;

  for (let i = 0; i < routeHolds.length - 1; i++) {
    const from = routeHolds[i], to = routeHolds[i+1];
    const dxPct  = to.x - from.x, dyPct = to.y - from.y;
    const distPct = Math.sqrt(dxPct*dxPct + dyPct*dyPct);

    // Reach ratio: this move vs the median move on this route
    // 1.0 = average move, 2.0 = twice the average, etc.
    const reachRatio   = distPct / medianDist;
    const lateralRatio = Math.abs(dxPct) / (distPct || 1);

    const holdScore  = HOLD_SCORES[to.type] || 2;
    const angleScore = ANGLE_MULT[to.angle] || 1.0;
    const reach      = reachDifficulty(reachRatio);
    const lateral    = lateralDifficulty(lateralRatio);

    const moveScore = (holdScore * angleScore) + reach.score + lateral;
    totalScore += moveScore;

    moves.push({
      fromIndex:   from.originalIndex,
      toIndex:     to.originalIndex,
      fromHold:    from,
      toHold:      to,
      distPct:     Math.round(distPct * 10) / 10,
      reachRatio:  Math.round(reachRatio * 100) / 100,
      reachLabel:  reach.label,
      dynamic:     reach.dynamic,
      moveScore:   Math.round(moveScore * 10) / 10,
    });
  }

  const cruxMove  = moves.reduce((best, m) => m.moveScore > best.moveScore ? m : best, moves[0]);
  const cruxIdx   = moves.indexOf(cruxMove);

  // Weight: 60% cumulative + 40% crux × route length factor
  const cruxWeight = cruxMove ? cruxMove.moveScore * 0.4 * routeHolds.length : 0;
  const finalScore = (totalScore * 0.6) + cruxWeight;
  const vGrade     = scoreToVGrade(finalScore);

  const breakdown = moves.map((m, i) => ({
    move:    i + 1,
    from:    `Hold ${m.fromHold.originalIndex+1} (${m.fromHold.type})`,
    to:      `Hold ${m.toHold.originalIndex+1} (${m.toHold.type})`,
    distPct: m.distPct,
    reach:   m.reachLabel,
    dynamic: m.dynamic,
    score:   m.moveScore,
    isCrux:  m === cruxMove,
  }));

  const gradeReasoning =
    `${vGrade} from ${moves.length} moves. Score: ${Math.round(finalScore)}. ` +
    `Crux is Move ${cruxIdx+1}: ${cruxMove?.reachLabel||''} to a ${cruxMove?.toHold.type||''} ` +
    `(score ${cruxMove?.moveScore||0}). Avg move score: ${Math.round(totalScore/moves.length*10)/10}.`;

  return { v_grade:vGrade, numeric_score:Math.round(finalScore), grade_reasoning:gradeReasoning, moves, breakdown };
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
    // MIN: 0.00005 = tiny holds on wide walls still detected
    // MAX: 0.025  = allow larger jugs, volumes are still bigger than this
    if (area < imgArea*0.00005 || area > imgArea*0.025) continue;
    const bboxW = ((c.maxX-c.minX)/W)*100;
    const bboxH = ((c.maxY-c.minY)/H)*100;
    const ar    = bboxW/(bboxH||0.01);
    // Relaxed aspect ratio — some holds are quite elongated
    if (ar > 8 || ar < 0.12) continue;
    holds.push({
      x: Math.round(((c.minX+c.maxX)/2/W)*1000)/10,
      y: Math.round(((c.minY+c.maxY)/2/H)*1000)/10,
      width:  Math.round(Math.max(bboxW,1)*10)/10,
      height: Math.round(Math.max(bboxH,1)*10)/10,
      area,
    });
  }
  holds.sort((a,b) => b.y-a.y);
  return mergeOverlappingHolds(holds);
}

function mergeOverlappingHolds(inputHolds) {
  if (inputHolds.length === 0) return inputHolds;

  let boxes = inputHolds.map(h => ({
    x1: h.x - h.width/2,  y1: h.y - h.height/2,
    x2: h.x + h.width/2,  y2: h.y + h.height/2,
  }));

  // Only merge boxes that genuinely overlap (gap <= 0) OR are within
  // a very small overlap tolerance (1% of image) to join fragments of
  // the SAME hold split by a shadow line.
  // Do NOT merge boxes that are simply near each other — those are separate holds.
  const OVERLAP_TOLERANCE = 1.0; // % of image — only merge if gap < 1%

  let changed = true;
  while (changed) {
    changed = false;
    const out = [], used = new Set();
    for (let i = 0; i < boxes.length; i++) {
      if (used.has(i)) continue;
      let b = { ...boxes[i] }; used.add(i);
      for (let j = i + 1; j < boxes.length; j++) {
        if (used.has(j)) continue;
        const c = boxes[j];
        const gapX = Math.max(0, Math.max(b.x1, c.x1) - Math.min(b.x2, c.x2));
        const gapY = Math.max(0, Math.max(b.y1, c.y1) - Math.min(b.y2, c.y2));
        // Only merge if they overlap or nearly touch (within tolerance)
        // AND the merged result isn't so large it's clearly two separate holds
        const mergedW = Math.max(b.x2, c.x2) - Math.min(b.x1, c.x1);
        const mergedH = Math.max(b.y2, c.y2) - Math.min(b.y1, c.y1);
        if (gapX <= OVERLAP_TOLERANCE && gapY <= OVERLAP_TOLERANCE && mergedW < 15 && mergedH < 15) {
          b = { x1:Math.min(b.x1,c.x1), y1:Math.min(b.y1,c.y1), x2:Math.max(b.x2,c.x2), y2:Math.max(b.y2,c.y2) };
          used.add(j); changed = true;
        }
      }
      out.push(b);
    }
    boxes = out;
  }

  return boxes
    .filter(b => (b.x2-b.x1) < 20 && (b.y2-b.y1) < 20) // max 20% of image = real hold not volume
    .map(b => ({
      x:      Math.round((b.x1+b.x2)/2*10)/10,
      y:      Math.round((b.y1+b.y2)/2*10)/10,
      width:  Math.round((b.x2-b.x1)*10)/10,
      height: Math.round((b.y2-b.y1)*10)/10,
    }));
}

function colorMatches(r,g,b,tR,tG,tB,targetHsl,isLowSat) {
  const hsl = rgbToHsl(r,g,b);

  if (isLowSat) {
    // White/gray/black: match on lightness and saturation
    return Math.abs(hsl.l-targetHsl.l) < 0.15 && Math.abs(hsl.s-targetHsl.s) < 0.15;
  }

  // Colored holds: hue is the primary discriminator
  let dH = Math.abs(hsl.h - targetHsl.h);
  if (dH > 180) dH = 360 - dH;

  // Reject pixels with very low saturation (they're gray, not colored)
  if (hsl.s < 0.10) return false;

  // Hue tolerance: ±32 degrees (0.089 of 360)
  // Wider than before to catch same hold in different lighting
  if ((dH / 360) > 0.089) return false;

  // Saturation: allow ±0.40 — lighting changes saturation a lot
  if (Math.abs(hsl.s - targetHsl.s) > 0.40) return false;

  // Lightness: allow ±0.40 — holds in shadow vs highlight
  if (Math.abs(hsl.l - targetHsl.l) > 0.40) return false;

  return true;
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