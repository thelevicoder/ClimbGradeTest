const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const Jimp = require('jimp');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '20mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── 1. Upload image ───────────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const ext = getExtension(file.mimetype);
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
    const { error } = await supabase.storage
      .from('climb-analysis')
      .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('climb-analysis').getPublicUrl(fileName);
    res.json({ file_url: publicUrl });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── 2. Detect holds (pixel-based, no AI) ─────────────────────────────────────
app.post('/api/detect', async (req, res) => {
  try {
    const { image_url, hold_rgb } = req.body;
    const [tR, tG, tB] = hold_rgb.split(',').map(v => parseInt(v.trim()));

    const imgResponse = await fetch(image_url);
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

    const holds = await detectHolds(imgBuffer, tR, tG, tB);

    // Estimate wall boundaries from hold positions + padding
    const ys = holds.map(h => h.y);
    const wallTopY = ys.length ? Math.max(0, Math.min(...ys) - 8) : 0;
    const wallBottomY = ys.length ? Math.min(100, Math.max(...ys) + 8) : 100;

    console.log(`Detected ${holds.length} holds`);
    res.json({ holds, wall_top_y: wallTopY, wall_bottom_y: wallBottomY });
  } catch (error) {
    console.error('Detect error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── 3. Analyze route (AI grading + beta, coordinates already known) ───────────
app.post('/api/analyze', async (req, res) => {
  try {
    const {
      image_url, hold_color, hold_hex, hold_rgb, user_height_cm,
      holds, wall_top_y, wall_bottom_y,
      start_indices, end_indices,
    } = req.body;

    const imgResponse = await fetch(image_url);
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
    const base64Image = imgBuffer.toString('base64');
    const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: contentType, data: base64Image } },
          { type: 'text', text: buildPrompt(hold_color, hold_hex, hold_rgb, user_height_cm, holds, wall_top_y, wall_bottom_y, start_indices, end_indices) },
        ],
      }],
    });

    const cleaned = message.content[0].text.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(cleaned);

    // Merge pixel coords with Claude's descriptions
    const mergedHolds = holds.map((hold, i) => {
      const d = (analysis.hold_details || [])[i] || {};
      return {
        ...hold,
        type: d.type || 'hold',
        description: d.description || '',
        position_in_route: d.position_in_route || positionFromY(hold.y, wall_top_y, wall_bottom_y),
        is_start: (start_indices || []).includes(i),
        is_end: (end_indices || []).includes(i),
      };
    });

    res.json({ ...analysis, holds: mergedHolds, wall_top_y, wall_bottom_y });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── 4. Save analysis ──────────────────────────────────────────────────────────
app.post('/api/save-analysis', async (req, res) => {
  try {
    const { data, error } = await supabase.from('climb_analyses').insert([req.body]).select();
    if (error) throw error;
    res.json({ id: data[0].id });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Hold Detection ────────────────────────────────────────────────────────────
async function detectHolds(imgBuffer, targetR, targetG, targetB) {
  const image = await Jimp.read(imgBuffer);
  const fullW = image.bitmap.width;
  const fullH = image.bitmap.height;
  const scale = Math.min(1, 800 / fullW);
  const W = Math.round(fullW * scale);
  const H = Math.round(fullH * scale);
  image.resize(W, H);

  const targetHsl = rgbToHsl(targetR, targetG, targetB);
  const isLowSaturation = targetHsl.s < 0.15;

  const mask = new Uint8Array(W * H);
  image.scan(0, 0, W, H, function (x, y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    if (colorMatches(r, g, b, targetR, targetG, targetB, targetHsl, isLowSaturation)) {
      mask[y * W + x] = 1;
    }
  });

  const labels = new Int32Array(W * H);
  let nextLabel = 1;
  const clusters = {};

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!mask[idx] || labels[idx]) continue;
      const label = nextLabel++;
      const queue = [idx];
      labels[idx] = label;
      const cluster = { pixels: [], minX: x, maxX: x, minY: y, maxY: y };
      while (queue.length > 0) {
        const cur = queue.pop();
        const cx = cur % W;
        const cy = Math.floor(cur / W);
        cluster.pixels.push(cur);
        if (cx < cluster.minX) cluster.minX = cx;
        if (cx > cluster.maxX) cluster.maxX = cx;
        if (cy < cluster.minY) cluster.minY = cy;
        if (cy > cluster.maxY) cluster.maxY = cy;
        for (const n of [cur-1, cur+1, cur-W, cur+W, cur-W-1, cur-W+1, cur+W-1, cur+W+1]) {
          if (n >= 0 && n < W * H && mask[n] && !labels[n]) {
            labels[n] = label;
            queue.push(n);
          }
        }
      }
      clusters[label] = cluster;
    }
  }

  const imgArea = W * H;
  const MIN_AREA = imgArea * 0.0001;
  const MAX_AREA = imgArea * 0.015;
  const holds = [];

  for (const cluster of Object.values(clusters)) {
    const area = cluster.pixels.length;
    if (area < MIN_AREA || area > MAX_AREA) continue;
    const bboxW = ((cluster.maxX - cluster.minX) / W) * 100;
    const bboxH = ((cluster.maxY - cluster.minY) / H) * 100;
    const ar = bboxW / (bboxH || 0.01);
    if (ar > 6 || ar < 0.17) continue;
    holds.push({
      x: Math.round(((cluster.minX + cluster.maxX) / 2 / W) * 1000) / 10,
      y: Math.round(((cluster.minY + cluster.maxY) / 2 / H) * 1000) / 10,
      width: Math.round(Math.max(bboxW, 1) * 10) / 10,
      height: Math.round(Math.max(bboxH, 1) * 10) / 10,
      area,
    });
  }

  holds.sort((a, b) => b.y - a.y);
  return mergeNearbyHolds(holds);
}

function mergeNearbyHolds(holds) {
  const merged = [];
  const used = new Set();
  for (let i = 0; i < holds.length; i++) {
    if (used.has(i)) continue;
    const group = [holds[i]];
    used.add(i);
    for (let j = i + 1; j < holds.length; j++) {
      if (used.has(j)) continue;
      const dx = holds[i].x - holds[j].x;
      const dy = holds[i].y - holds[j].y;
      if (Math.sqrt(dx*dx + dy*dy) < 5) { group.push(holds[j]); used.add(j); }
    }
    const minX = Math.min(...group.map(h => h.x - h.width/2));
    const maxX = Math.max(...group.map(h => h.x + h.width/2));
    const minY = Math.min(...group.map(h => h.y - h.height/2));
    const maxY = Math.max(...group.map(h => h.y + h.height/2));
    merged.push({
      x: Math.round(group.reduce((s,h)=>s+h.x,0)/group.length*10)/10,
      y: Math.round(group.reduce((s,h)=>s+h.y,0)/group.length*10)/10,
      width: Math.round((maxX-minX)*10)/10,
      height: Math.round((maxY-minY)*10)/10,
    });
  }
  return merged;
}

function colorMatches(r, g, b, tR, tG, tB, targetHsl, isLowSat) {
  const hsl = rgbToHsl(r, g, b);
  if (isLowSat) {
    return Math.abs(hsl.l - targetHsl.l) < 0.12 && Math.abs(hsl.s - targetHsl.s) < 0.12;
  }
  let dH = Math.abs(hsl.h - targetHsl.h);
  if (dH > 180) dH = 360 - dH;
  if (hsl.s < 0.15) return false;
  return (dH/360) < 0.08 && Math.abs(hsl.s - targetHsl.s) < 0.35 && Math.abs(hsl.l - targetHsl.l) < 0.35;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s;
  const l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return { h: h*360, s, l };
}

function positionFromY(y, wallTopY=0, wallBottomY=100) {
  const fromBottom = 1 - (y - wallTopY) / (wallBottomY - wallTopY);
  if (fromBottom < 0.2) return 'start';
  if (fromBottom < 0.4) return 'low';
  if (fromBottom < 0.6) return 'mid';
  if (fromBottom < 0.8) return 'high';
  return 'top';
}

function buildPrompt(holdColor, holdHex, holdRgb, heightCm, holds, wallTopY, wallBottomY, startIndices, endIndices) {
  const feet = Math.floor(heightCm / 2.54 / 12);
  const inches = Math.round((heightCm / 2.54) % 12);

  const holdList = holds.map((h, i) => {
    const isStart = (startIndices||[]).includes(i);
    const isEnd = (endIndices||[]).includes(i);
    const tag = isStart ? ' ← START HOLD' : isEnd ? ' ← FINISH HOLD' : '';
    return `Hold ${i+1}: center (${h.x}%, ${h.y}%), size ${h.width}%x${h.height}%${tag}`;
  }).join('\n');

  const startHolds = (startIndices||[]).map(i => `Hold ${i+1}`).join(' and ') || 'unknown';
  const endHolds = (endIndices||[]).map(i => `Hold ${i+1}`).join(' and ') || 'unknown';
  const isTwoHandStart = (startIndices||[]).length === 2;
  const isTwoHandEnd = (endIndices||[]).length === 2;

  return `You are an expert bouldering coach analyzing a climbing wall photo.

Our pixel algorithm detected all ${holdColor} holds (hex: ${holdHex}). Coordinates are exact — do NOT second-guess them.

CLIMBER: ${heightCm}cm (${feet}'${inches}")
WALL: top at ${wallTopY}%, bottom at ${wallBottomY}% of image height

DETECTED HOLDS (${holds.length} total):
${holdList}

START: ${startHolds}${isTwoHandStart ? ' (TWO-HAND start — both hands begin on these holds simultaneously)' : ''}
FINISH: ${endHolds}${isTwoHandEnd ? ' (match finish — both hands must top out on these holds)' : ''}

YOUR TASKS:

1. DESCRIBE EACH HOLD
For all ${holds.length} holds in order, describe what you see at those coordinates:
- type: "jug" | "crimp" | "sloper" | "pinch" | "pocket" | "foothold"
- description: one sentence on the hold shape and how to grip it
- position_in_route: "start" | "low" | "mid" | "high" | "top"

2. DETAILED STEP-BY-STEP BETA
Write a complete move-by-move sequence for this route starting from ${startHolds} and finishing on ${endHolds}.
- Number each move (Move 1, Move 2, etc.)
- Say exactly which hold to move to and with which hand/foot
- Include body positioning, hip placement, foot beta
- Mention any crux moves specifically
- Write for a ${heightCm}cm climber — adjust reach advice accordingly
${isTwoHandStart ? '- The route starts with BOTH hands on the start holds simultaneously' : ''}

3. GRADE
Grade based on the hold sequence from start to finish.

Return ONLY this JSON, no markdown:
{
  "v_grade": "V3",
  "estimated_wall_height_m": 4.2,
  "hold_analysis": "Overview of hold types on this route",
  "move_description": "Move 1: Stand below the start holds. Place left hand on Hold 1 (jug) and right hand on Hold 2 (crimp). Move 2: Step up with right foot...",
  "tips": "2-3 tips specifically for a ${heightCm}cm climber on this route",
  "grade_reasoning": "One sentence explaining the grade",
  "hold_details": [
    { "type": "jug", "description": "Large positive jug, open hand grip.", "position_in_route": "start" }
  ]
}

The hold_details array must have exactly ${holds.length} entries in order.
The move_description must be a complete step-by-step numbered beta from start to finish.`;
}

function getExtension(mimeType) {
  const map = { 'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp','image/heic':'.heic' };
  return map[mimeType] || '.jpg';
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));