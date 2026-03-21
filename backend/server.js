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

// Health check
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

    const { data: { publicUrl } } = supabase.storage
      .from('climb-analysis')
      .getPublicUrl(fileName);

    res.json({ file_url: publicUrl });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── 2. Analyze route ──────────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  try {
    const { image_url, hold_color, hold_hex, hold_rgb, user_height_cm } = req.body;

    // Parse the sampled color
    const targetR = parseInt(hold_rgb.split(',')[0].trim());
    const targetG = parseInt(hold_rgb.split(',')[1].trim());
    const targetB = parseInt(hold_rgb.split(',')[2].trim());

    // Fetch image buffer
    const imgResponse = await fetch(image_url);
    const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

    // ── Step 1: Detect holds via pixel color matching ─────────────────────────
    const holds = await detectHolds(imgBuffer, targetR, targetG, targetB);
    console.log(`Detected ${holds.length} holds via pixel analysis`);

    // ── Step 2: Ask Claude only for descriptions + grade ─────────────────────
    const base64Image = imgBuffer.toString('base64');
    const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: contentType, data: base64Image },
          },
          {
            type: 'text',
            text: buildPrompt(hold_color, hold_hex, hold_rgb, user_height_cm, holds),
          },
        ],
      }],
    });

    const responseText = message.content[0].text;
    const cleaned = responseText.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(cleaned);

    // Merge our detected coordinates with Claude's descriptions
    const mergedHolds = holds.map((hold, i) => {
      const claudeHold = (analysis.hold_details || [])[i] || {};
      return {
        ...hold,
        type: claudeHold.type || 'hold',
        description: claudeHold.description || '',
        position_in_route: claudeHold.position_in_route || positionFromY(hold.y, analysis.wall_top_y, analysis.wall_bottom_y),
      };
    });

    res.json({ ...analysis, holds: mergedHolds });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── 3. Save analysis ──────────────────────────────────────────────────────────
app.post('/api/save-analysis', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('climb_analyses')
      .insert([req.body])
      .select();
    if (error) throw error;
    res.json({ id: data[0].id });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Hold Detection (pixel-based) ──────────────────────────────────────────────
async function detectHolds(imgBuffer, targetR, targetG, targetB) {
  const image = await Jimp.read(imgBuffer);
  const fullW = image.bitmap.width;
  const fullH = image.bitmap.height;

  // Work at reduced resolution for speed (max 800px wide)
  const scale = Math.min(1, 800 / fullW);
  const W = Math.round(fullW * scale);
  const H = Math.round(fullH * scale);
  image.resize(W, H);

  const targetHsl = rgbToHsl(targetR, targetG, targetB);
  const isLowSaturation = targetHsl.s < 0.15; // white, gray, black

  // Build a boolean mask: true = pixel matches target color
  const mask = new Uint8Array(W * H);
  image.scan(0, 0, W, H, function (x, y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    if (colorMatches(r, g, b, targetR, targetG, targetB, targetHsl, isLowSaturation)) {
      mask[y * W + x] = 1;
    }
  });

  // Connected-component labeling (flood fill) to find clusters
  const labels = new Int32Array(W * H);
  let nextLabel = 1;
  const clusters = {}; // label -> { pixels: [], minX, maxX, minY, maxY }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!mask[idx] || labels[idx]) continue;

      // BFS flood fill
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

        // Check 4-connected neighbors
        const neighbors = [
          cur - 1, cur + 1, cur - W, cur + W,
          // Also 8-connected for diagonal holds
          cur - W - 1, cur - W + 1, cur + W - 1, cur + W + 1,
        ];
        for (const n of neighbors) {
          if (n >= 0 && n < W * H && mask[n] && !labels[n]) {
            labels[n] = label;
            queue.push(n);
          }
        }
      }
      clusters[label] = cluster;
    }
  }

  // Convert clusters to hold objects, filtering by size
  // Min/max pixel area thresholds (relative to image area)
  const imgArea = W * H;
  const MIN_HOLD_AREA = imgArea * 0.0001;  // 0.01% of image — removes noise
  const MAX_HOLD_AREA = imgArea * 0.015;   // 1.5% of image — removes large volumes

  const holds = [];
  for (const cluster of Object.values(clusters)) {
    const area = cluster.pixels.length;
    if (area < MIN_HOLD_AREA || area > MAX_HOLD_AREA) continue;

    // Bounding box in % of FULL original image
    const centerX = ((cluster.minX + cluster.maxX) / 2 / W) * 100;
    const centerY = ((cluster.minY + cluster.maxY) / 2 / H) * 100;
    const bboxW = ((cluster.maxX - cluster.minX) / W) * 100;
    const bboxH = ((cluster.maxY - cluster.minY) / H) * 100;

    // Skip very elongated thin shapes (likely tape or markings, not holds)
    const aspectRatio = bboxW / (bboxH || 0.01);
    if (aspectRatio > 6 || aspectRatio < 0.17) continue;

    holds.push({
      x: Math.round(centerX * 10) / 10,
      y: Math.round(centerY * 10) / 10,
      width: Math.round(Math.max(bboxW, 1) * 10) / 10,
      height: Math.round(Math.max(bboxH, 1) * 10) / 10,
      area,
    });
  }

  // Sort by Y descending (bottom of wall first = start holds first)
  holds.sort((a, b) => b.y - a.y);

  // Merge holds that are very close together (same hold detected as multiple clusters)
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
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Merge if centers are within 5% of image size of each other
      if (dist < 5) {
        group.push(holds[j]);
        used.add(j);
      }
    }

    // Average the group into one hold
    const avgX = group.reduce((s, h) => s + h.x, 0) / group.length;
    const avgY = group.reduce((s, h) => s + h.y, 0) / group.length;
    const minX = Math.min(...group.map(h => h.x - h.width / 2));
    const maxX = Math.max(...group.map(h => h.x + h.width / 2));
    const minY = Math.min(...group.map(h => h.y - h.height / 2));
    const maxY = Math.max(...group.map(h => h.y + h.height / 2));

    merged.push({
      x: Math.round(avgX * 10) / 10,
      y: Math.round(avgY * 10) / 10,
      width: Math.round((maxX - minX) * 10) / 10,
      height: Math.round((maxY - minY) * 10) / 10,
    });
  }

  return merged;
}

// Color matching using HSL distance for perceptual accuracy
function colorMatches(r, g, b, tR, tG, tB, targetHsl, isLowSat) {
  const hsl = rgbToHsl(r, g, b);

  if (isLowSat) {
    // For white/gray/black: match on lightness + saturation only
    const dL = Math.abs(hsl.l - targetHsl.l);
    const dS = Math.abs(hsl.s - targetHsl.s);
    return dL < 0.12 && dS < 0.12;
  }

  // For colored holds: hue is the main discriminator
  // Hue distance is circular (0-360)
  let dH = Math.abs(hsl.h - targetHsl.h);
  if (dH > 180) dH = 360 - dH;
  dH = dH / 360; // normalize to 0-1

  // Also check saturation and lightness so we don't match washed-out or dark variants
  const dS = Math.abs(hsl.s - targetHsl.s);
  const dL = Math.abs(hsl.l - targetHsl.l);

  // Must be reasonably saturated to count as a colored hold
  if (hsl.s < 0.15) return false;

  return dH < 0.08 && dS < 0.35 && dL < 0.35;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, l };
}

function positionFromY(y, wallTopY = 0, wallBottomY = 100) {
  const relative = (y - wallTopY) / (wallBottomY - wallTopY);
  // Invert: low y% = high on wall
  const fromBottom = 1 - relative;
  if (fromBottom < 0.2) return 'start';
  if (fromBottom < 0.4) return 'low';
  if (fromBottom < 0.6) return 'mid';
  if (fromBottom < 0.8) return 'high';
  return 'top';
}

// ── Claude prompt (coordinates already known — just needs descriptions + grade)
function buildPrompt(holdColor, holdHex, holdRgb, heightCm, holds) {
  const feet = Math.floor(heightCm / 2.54 / 12);
  const inches = Math.round((heightCm / 2.54) % 12);

  const holdList = holds.map((h, i) =>
    `Hold ${i + 1}: center at (${h.x}%, ${h.y}%) of image, size ${h.width}% x ${h.height}%`
  ).join('\n');

  return `You are an expert indoor bouldering coach analyzing a climbing wall photo.

Our pixel detection algorithm has already found all the ${holdColor} holds on this wall (hex: ${holdHex}, RGB: ${holdRgb}). You do NOT need to find hold coordinates — they are provided below.

CLIMBER HEIGHT: ${heightCm}cm (${feet}'${inches}")

DETECTED ${holdColor.toUpperCase()} HOLDS (${holds.length} total):
${holdList}

YOUR TASKS:

1. WALL BOUNDARIES
Find where the actual wall starts and ends (excluding ceiling, lights, crash mats, floor):
- wall_top_y: % from top of image where wall begins
- wall_bottom_y: % from top of image where wall ends (where crash mats start)

2. DESCRIBE EACH HOLD
For each of the ${holds.length} holds listed above, provide in order:
- type: "jug" | "crimp" | "sloper" | "pinch" | "pocket" | "foothold"
- description: one sentence on technique
- position_in_route: "start" | "low" | "mid" | "high" | "top"

3. GRADE THE ROUTE
Based on the hold types, positions, and spacing.

Return ONLY this exact JSON structure, no markdown:
{
  "wall_top_y": 5.0,
  "wall_bottom_y": 88.0,
  "v_grade": "V3",
  "estimated_wall_height_m": 4.2,
  "hold_analysis": "Overall description of holds on this route",
  "move_description": "Key moves and beta for this route",
  "tips": "2-3 tips for a ${heightCm}cm climber",
  "grade_reasoning": "One sentence explaining the grade",
  "hold_details": [
    { "type": "jug", "description": "...", "position_in_route": "start" }
  ]
}

The hold_details array must have exactly ${holds.length} entries, one per detected hold, in the same order.`;
}

function getExtension(mimeType) {
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/heic': '.heic' };
  return map[mimeType] || '.jpg';
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));