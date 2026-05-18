// Netlify function: get-maps-key
// Returns a random Google API key from the rotation pool to spread cost
// across multiple free quotas. Falls back to single key if pool not set.

exports.handler = async () => {
  // Pool comes from env var GOOGLE_API_KEYS (comma-separated)
  // Falls back to single key GOOGLE_PLACES_API_KEY
  const pool = (process.env.GOOGLE_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  const fallback = process.env.GOOGLE_PLACES_API_KEY || '';
  const keys = pool.length > 0 ? pool : (fallback ? [fallback] : []);
  const key = keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : '';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      // Don't cache so each page load gets a fresh random pick
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ key })
  };
};
