const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = {
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE_URL}/api/upload`, { method: 'POST', body: formData });
    if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Upload failed'); }
    return response.json();
  },

  // Step 1: pixel-based hold detection (fast, no AI)
  async detectHolds({ image_url, hold_rgb }) {
    const response = await fetch(`${API_BASE_URL}/api/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url, hold_rgb }),
    });
    if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Detection failed'); }
    return response.json();
  },

  // Step 2: AI grading + beta with known start/end holds
  async analyzeClimb({ image_url, hold_color, hold_hex, hold_rgb, user_height_cm, holds, wall_top_y, wall_bottom_y, start_indices, end_indices }) {
    const response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url, hold_color, hold_hex, hold_rgb, user_height_cm, holds, wall_top_y, wall_bottom_y, start_indices, end_indices }),
    });
    if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Analysis failed'); }
    return response.json();
  },

  async saveAnalysis(data) {
    const response = await fetch(`${API_BASE_URL}/api/save-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Save failed'); }
    return response.json();
  },
};