const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const api = {
  // Upload an image file — returns { file_url }
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/api/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Upload failed');
    }
    return response.json();
  },

  // Analyze a climbing route — returns the AI analysis object
  async analyzeClimb({ image_url, hold_color, user_height_cm }) {
    const response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url, hold_color, user_height_cm }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Analysis failed');
    }
    return response.json();
  },

  // Save analysis to the database — returns { id }
  async saveAnalysis(data) {
    const response = await fetch(`${API_BASE_URL}/api/save-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Save failed');
    }
    return response.json();
  },
};
