const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── 1. Upload image to Supabase Storage ──────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const ext = getExtension(file.mimetype);
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;

    const { error } = await supabase.storage
      .from('climbing-images')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('climbing-images')
      .getPublicUrl(fileName);

    res.json({ file_url: publicUrl });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── 2. Analyze climbing route with Claude ────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  try {
    const { image_url, hold_color, hold_hex, hold_rgb, user_height_cm } = req.body;

    // Fetch the image and convert to base64 for Anthropic
    const imageResponse = await fetch(image_url);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: contentType,
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: buildPrompt(hold_color, hold_hex, hold_rgb, user_height_cm),
          },
        ],
      }],
    });

    const responseText = message.content[0].text;
    // Strip any accidental markdown fences
    const cleaned = responseText.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(cleaned);

    res.json(analysis);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── 3. Save analysis to Supabase database ────────────────────────────────────
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

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildPrompt(holdColor, holdHex, holdRgb, heightCm) {
  const feet = Math.floor(heightCm / 2.54 / 12);
  const inches = Math.round((heightCm / 2.54) % 12);
  const colorDesc = holdHex
    ? `"${holdColor}" — exact sampled color hex: ${holdHex}, RGB(${holdRgb})`
    : `"${holdColor}"`;
  return `You are a computer vision system analyzing a photo of an indoor bouldering wall. You must be extremely precise.

THE CLIMBER SELECTED COLOR: ${colorDesc}
The climber physically tapped on a hold in the image and we sampled its exact pixel color. Use the hex/RGB value as your ground truth for what color to look for.
CLIMBER HEIGHT: ${heightCm}cm (${feet}'${inches}")

════════════════════════════════════
TASK 1: FIND THE WALL BOUNDARIES
════════════════════════════════════
- wall_top_y: % of image height where the wall surface begins (ignore ceiling/lights/air above)
- wall_bottom_y: % of image height where the wall ends. Crash mats and foam pads at the bottom are NOT the wall. Find where the wall panels stop and the mats begin.

════════════════════════════════════
TASK 2: FIND ONLY "${holdColor.toUpperCase()}" COLORED HOLDS
════════════════════════════════════
STRICT COLOR RULE: Only mark holds matching hex ${holdHex || holdColor}.
- Do NOT mark holds of any other color.
- Gray, black, white volumes that look vaguely ${holdColor} are NOT ${holdColor} holds.
- When in doubt about whether a hold matches the color, skip it.

HOLD vs VOLUME:
- Volumes = large geometric shapes (triangles, wedges, faceted panels) that form the wall surface. SKIP ALL VOLUMES.
- Holds = small resin/plastic pieces (5-30cm real size) bolted to the wall that climbers grip. ONLY mark these.

For each ${holdColor} hold:
- x, y: CENTER of hold as % of FULL image (x: left=0 right=100, y: top=0 bottom=100)
- width, height: size as % of FULL image (holds are typically 2-7% wide, 1-5% tall)
- type: "jug" | "crimp" | "sloper" | "pinch" | "pocket" | "foothold"
- description: one sentence on how to use this hold
- position_in_route: "start" | "low" | "mid" | "high" | "top" (based on position on the wall)

Before including a hold verify: (1) it matches hex ${holdHex || holdColor}, (2) it is a small resin hold not a volume, (3) x,y points at its center.

════════════════════════════════════
TASK 3: GRADE THE ROUTE
════════════════════════════════════
Return ONLY this JSON, no markdown:

{
  "wall_top_y": 8.0,
  "wall_bottom_y": 82.0,
  "v_grade": "V3",
  "estimated_wall_height_m": 4.2,
  "hold_analysis": "...",
  "move_description": "...",
  "tips": "...",
  "grade_reasoning": "...",
  "holds": [
    {
      "x": 34.5,
      "y": 71.2,
      "width": 4.0,
      "height": 3.0,
      "type": "jug",
      "description": "Large positive jug, grip with full hand and pull through.",
      "position_in_route": "start"
    }
  ]
}`;
}

function getExtension(mimeType) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/heic': '.heic',
  };
  return map[mimeType] || '.jpg';
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));