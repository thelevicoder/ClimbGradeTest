const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
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

    const imgResponse = await fetch(image_url);
    const imgBuffer   = Buffer.from(await imgResponse.arrayBuffer());

    let holds = await detectHolds(imgBuffer, tR, tG, tB);

    // Filter by left/right boundary
    holds = holds.filter(h => h.x >= left_boundary && h.x <= right_boundary);

    // Estimate wall boundaries from hold Y positions
    const ys = holds.map(h => h.y);
    const wallTopY    = ys.length ? Math.max(0,   Math.min(...ys) - 8) : 0;
    const wallBottomY = ys.length ? Math.min(100, Math.max(...ys) + 8) : 100;

    console.log(`Detected ${holds.length} holds within boundaries [${left_boundary}%, ${right_boundary}%]`);
    res.json({ holds, wall_top_y: wallTopY, wall_bottom_y: wallBottomY });
  } catch (err) {
    console.error('Detect error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── 3. Analyze (AI descriptions + grade + beta) ───────────────────────────────
app.post('/api/analyze', async (req, res) => {
  try {
    const {
      image_url, hold_color, hold_hex, hold_rgb, user_height_cm,
      holds, wall_top_y, wall_bottom_y,
      start_indices, end_indices,
    } = req.body;

    const imgResponse = await fetch(image_url);
    const imgBuffer   = Buffer.from(await imgResponse.arrayBuffer());
    const base64Image = imgBuffer.toString('base64');
    const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: contentType, data: base64Image } },
          { type: 'text',  text: buildPrompt(hold_color, hold_hex, hold_rgb, user_height_cm, holds, wall_top_y, wall_bottom_y, start_indices, end_indices) },
        ],
      }],
    });

    const cleaned  = message.content[0].text.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(cleaned);

    // Merge pixel coords with Claude descriptions
    const mergedHolds = holds.map((hold, i) => {
      const d = (analysis.hold_details || [])[i] || {};
      return {
        ...hold,
        type: d.type || 'hold',
        description: d.description || '',
        position_in_route: d.position_in_route || positionFromY(hold.y, wall_top_y, wall_bottom_y),
        is_start: (start_indices || []).includes(i),
        is_end:   (end_indices   || []).includes(i),
      };
    });

    res.json({ ...analysis, holds: mergedHolds, wall_top_y, wall_bottom_y });
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
    console.error('Save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Pixel-based hold detection ────────────────────────────────────────────────
async function detectHolds(imgBuffer, targetR, targetG, targetB) {
  const image = await Jimp.read(imgBuffer);
  const scale = Math.min(1, 800 / image.bitmap.width);
  const W = Math.round(image.bitmap.width  * scale);
  const H = Math.round(image.bitmap.height * scale);
  image.resize(W, H);

  const targetHsl    = rgbToHsl(targetR, targetG, targetB);
  const isLowSat     = targetHsl.s < 0.15;
  const mask         = new Uint8Array(W * H);

  image.scan(0, 0, W, H, function (x, y, idx) {
    const r = this.bitmap.data[idx], g = this.bitmap.data[idx+1], b = this.bitmap.data[idx+2];
    if (colorMatches(r, g, b, targetR, targetG, targetB, targetHsl, isLowSat)) mask[y*W+x] = 1;
  });

  // Connected-component labeling
  const labels   = new Int32Array(W * H);
  let nextLabel  = 1;
  const clusters = {};

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y*W+x;
      if (!mask[idx] || labels[idx]) continue;
      const label   = nextLabel++;
      const queue   = [idx];
      labels[idx]   = label;
      const cluster = { pixels: [], minX: x, maxX: x, minY: y, maxY: y };
      while (queue.length > 0) {
        const cur = queue.pop();
        const cx  = cur % W, cy = Math.floor(cur/W);
        cluster.pixels.push(cur);
        if (cx < cluster.minX) cluster.minX = cx;
        if (cx > cluster.maxX) cluster.maxX = cx;
        if (cy < cluster.minY) cluster.minY = cy;
        if (cy > cluster.maxY) cluster.maxY = cy;
        for (const n of [cur-1,cur+1,cur-W,cur+W,cur-W-1,cur-W+1,cur+W-1,cur+W+1]) {
          if (n>=0 && n<W*H && mask[n] && !labels[n]) { labels[n]=label; queue.push(n); }
        }
      }
      clusters[label] = cluster;
    }
  }

  const imgArea = W * H;
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
  holds.sort((a,b) => b.y - a.y);
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
  if (hsl.s < 0.15) return false;
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

function positionFromY(y, wallTopY=0, wallBottomY=100) {
  const fromBottom = 1-(y-wallTopY)/(wallBottomY-wallTopY);
  if (fromBottom<0.2) return 'start';
  if (fromBottom<0.4) return 'low';
  if (fromBottom<0.6) return 'mid';
  if (fromBottom<0.8) return 'high';
  return 'top';
}

// ── Claude prompt ─────────────────────────────────────────────────────────────
function buildPrompt(holdColor, holdHex, holdRgb, heightCm, holds, wallTopY, wallBottomY, startIndices, endIndices) {
  const feet   = Math.floor(heightCm/2.54/12);
  const inches = Math.round((heightCm/2.54)%12);

  // Build hold list with clear start/end markers
  const holdList = holds.map((h,i) => {
    const tag = (startIndices||[]).includes(i) ? ' *** THIS IS A START HOLD ***'
              : (endIndices||[]).includes(i)   ? ' *** THIS IS THE FINISH HOLD ***'
              : '';
    return `  Hold ${i+1}: center (${h.x}%, ${h.y}% from top of image), size ${h.width}%w x ${h.height}%h${tag}`;
  }).join('\n');

  const startHolds   = (startIndices||[]).map(i=>`Hold ${i+1} at position (${holds[i].x}%, ${holds[i].y}%)`).join(' AND ');
  const endHolds     = (endIndices||[]).map(i=>`Hold ${i+1} at position (${holds[i].x}%, ${holds[i].y}%)`).join(' AND ');
  const twoHandStart = (startIndices||[]).length === 2;
  const matchFinish  = (endIndices||[]).length   === 2;

  // Sort holds bottom-to-top so Claude can reason about sequence
  const holdsByHeight = holds
    .map((h,i) => ({ i, ...h }))
    .sort((a,b) => b.y - a.y); // higher y% = lower on wall = earlier in route

  const sequenceHint = holdsByHeight.map(h =>
    `Hold ${h.i+1} (${h.y<(wallTopY+wallBottomY)/2 ? 'upper wall' : 'lower wall'}, x=${h.x}%)`
  ).join(' → ');

  return `You are an expert bouldering coach. Our pixel detection algorithm found all ${holdColor} holds on this wall. The coordinates are mathematically exact — do not question or adjust them.

CLIMBER: ${heightCm}cm tall (${feet}'${inches}")
WALL: top at ${wallTopY}% of image height, bottom at ${wallBottomY}% of image height
COLOR: ${holdColor} (hex: ${holdHex}, RGB: ${holdRgb})

ALL DETECTED HOLDS (${holds.length} total):
${holdList}

══════════════════════════════════════════
MANDATORY START AND FINISH — DO NOT IGNORE
══════════════════════════════════════════
START: ${startHolds}${twoHandStart ? '\nThis is a TWO-HAND start. The climber begins with LEFT hand on one start hold and RIGHT hand on the other start hold simultaneously.' : ''}
FINISH: ${endHolds}${matchFinish ? '\nThis is a MATCH finish. The climber must get both hands onto the finish holds.' : ''}

The beta MUST begin with the climber's hands on the start hold(s) listed above.
The beta MUST end with the climber reaching the finish hold listed above.
Do NOT suggest starting or finishing on any other hold.

══════════════════════════════════════════
GRADING INSTRUCTIONS
══════════════════════════════════════════
Grade ONLY based on:
1. The number of moves between start and finish
2. The hold types (jugs = easier, crimps/slopers = harder)
3. The physical distance between consecutive holds relative to ${heightCm}cm reach
4. Body positioning complexity

Do NOT add difficulty based on assumptions. Grade conservatively. Most gym routes with jugs and moderate spacing are V0-V3.

Holds from bottom to top of wall: ${sequenceHint}

══════════════════════════════════════════
YOUR OUTPUT
══════════════════════════════════════════
Return ONLY this JSON, no markdown:
{
  "v_grade": "V2",
  "estimated_wall_height_m": 4.0,
  "hold_analysis": "Brief description of the hold types on this route",
  "move_description": "Move 1: Begin standing below the start hold(s). Place [left/right] hand on Hold X ([type]) at lower left. [If two-hand start: place left hand on Hold X and right hand on Hold Y simultaneously.] Move 2: Step right foot up to [position], then reach right hand to Hold Z ([type])... [continue for every move until] Final Move: Reach [left/right] hand to Hold ${(endIndices||[]).map(i=>i+1).join('/')} (finish hold) and match to top out.",
  "tips": "2-3 specific tips for a ${heightCm}cm climber on this exact route",
  "grade_reasoning": "One sentence: e.g. V2 because there are 6 moves with moderate crimps and one slightly reachy move at the crux",
  "hold_details": [
    { "type": "jug", "description": "Large positive jug, wrap full hand around it.", "position_in_route": "start" }
  ]
}

CRITICAL RULES:
- hold_details must have exactly ${holds.length} entries, one per hold in the same order as the list above
- move_description must start on ${startHolds} and end on ${endHolds}
- Every move must reference a specific hold number
- Grade must reflect the actual detected holds, not assumptions`;
}

function getExtension(mimeType) {
  const map = {'image/jpeg':'.jpg','image/png':'.png','image/gif':'.gif','image/webp':'.webp','image/heic':'.heic'};
  return map[mimeType]||'.jpg';
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));