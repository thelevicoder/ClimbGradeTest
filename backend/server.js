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
    const { image_url, hold_color, user_height_cm } = req.body;

    // Fetch the image and convert to base64 for Anthropic
    const imageResponse = await fetch(image_url);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
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
            text: buildPrompt(hold_color, user_height_cm),
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
function buildPrompt(holdColor, heightCm) {
  const feet = Math.floor(heightCm / 2.54 / 12);
  const inches = Math.round((heightCm / 2.54) % 12);
  return `You are an expert indoor bouldering route grader with computer vision expertise. Analyze this photo of an indoor bouldering wall very carefully.

The climber's selected hold color is: ${holdColor}
The climber's height is ${heightCm}cm (${feet}'${inches}").

STEP 1 - FIND THE WALL BOUNDARIES:
Look at the image carefully. Identify:
- wall_top_y: The Y percentage where the actual climbing wall surface begins (ignore any ceiling, lighting rigs, or space above the wall). This is where the wall panels/texture starts.
- wall_bottom_y: The Y percentage where the wall ends at the bottom (ignore crash pads, floor mats, ground, and any space below the wall). This is where the last hold or wall panel ends.

STEP 2 - FIND HOLDS (NOT VOLUMES):
Volumes are large geometric shapes (triangles, boxes, wedges) bolted to the wall that create surface features. DO NOT include volumes.
Only identify actual holds: jugs, crimps, slopers, pinches, pockets, footholds — the smaller resin/plastic pieces bolted onto the wall or onto volumes.

For each hold of color "${holdColor}":
- Look at the ENTIRE wall surface carefully
- Account for lighting — the same color hold may look lighter/darker in different areas
- Be thorough — identify EVERY hold of this color, do not miss any
- The coordinates must be percentages of the FULL original image dimensions (0-100), not cropped

STEP 3 - GRADE THE ROUTE.

Respond with ONLY valid JSON, no markdown:

{
  "wall_top_y": 5.2,
  "wall_bottom_y": 88.4,
  "v_grade": "V3",
  "estimated_wall_height_m": 4.5,
  "hold_analysis": "description of hold types",
  "move_description": "description of moves and beta",
  "tips": "2-3 practical tips",
  "grade_reasoning": "one sentence explaining the grade",
  "holds": [
    {
      "x": 45.2,
      "y": 30.1,
      "width": 5.0,
      "height": 4.0,
      "type": "crimp",
      "description": "Small two-finger crimp. Pull hard and keep your elbow in.",
      "position_in_route": "mid"
    }
  ]
}

COORDINATE RULES — follow these exactly:
- x: horizontal center of the hold, as % of FULL image width (left=0, right=100)
- y: vertical center of the hold, as % of FULL image height (top=0, bottom=100)
- width: hold width as % of FULL image width (most holds are 3-10%)
- height: hold height as % of FULL image height (most holds are 2-8%)
- type: ONLY one of: "jug", "crimp", "sloper", "pinch", "pocket", "foothold" — NEVER "volume"
- position_in_route: "start", "low", "mid", "high", or "top" based on vertical position on wall
- description: exactly 1 sentence about technique for this specific hold

Be extremely thorough with hold detection. It is better to include too many holds than to miss any.
Do not include volumes. Commit to a specific V grade.`;
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