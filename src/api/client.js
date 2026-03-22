const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function post(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return response.json();
}

export const api = {
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE_URL}/api/upload`, { method: 'POST', body: formData });
    if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Upload failed'); }
    return response.json();
  },

  // Pixel-based detection with left/right boundaries
  async detectHolds({ image_url, hold_rgb, left_boundary, right_boundary }) {
    return post('/api/detect', { image_url, hold_rgb, left_boundary, right_boundary });
  },

  // AI grading + beta
  async analyzeClimb(body) {
    return post('/api/analyze', body);
  },

  async saveAnalysis(data) {
    return post('/api/save-analysis', data);
  },
};