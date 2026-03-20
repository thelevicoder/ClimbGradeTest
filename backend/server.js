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
      .from('climb analysis')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('climb analysis')
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
  return `You are an expert indoor bouldering route grader and climbing coach. Analyze this photo of an indoor bouldering wall.

The climber's selected hold color is: ${holdColor}

Use this color to identify ALL holds that belong to this route. Important: account for lighting differences across the wall — holds of the same color may appear slightly different in darker or brighter areas.

The climber's height is ${heightCm}cm (${feet}'${inches}").

Respond with ONLY a valid JSON object — no markdown, no extra text, just the JSON:

{
  "v_grade": "V3",
  "estimated_wall_height_m": 4.5,
  "hold_analysis": "description of hold types and how they contribute to difficulty",
  "move_description": "description of the move sequence and beta",
  "tips": "2-3 practical tips for someone of this height",
  "grade_reasoning": "one sentence explaining the grade choice"
}

Commit to a specific V grade. Do not hedge.`;
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
