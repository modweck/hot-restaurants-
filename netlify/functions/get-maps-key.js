// Netlify function: get-maps-key
// Returns a single Google Maps API key for the frontend.
//
// Defensive parsing: GOOGLE_PLACES_API_KEY has historically been set to
// a comma-separated list (paste error), which the browser can't use as
// a single key — it triggers "This page can't load Google Maps correctly".
// We split on commas, trim, and return the first plausible key.
// GOOGLE_API_KEYS is used as a secondary fallback if the primary var
// is empty or malformed.

function extractFirstKey(raw) {
  return (raw || '')
    .split(',')
    .map(k => k.trim())
    .find(k => /^AIzaSy[\w-]{30,}$/.test(k)) || '';
}

exports.handler = async () => {
  const key = extractFirstKey(process.env.GOOGLE_PLACES_API_KEY)
           || extractFirstKey(process.env.GOOGLE_API_KEYS)
           || '';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ key })
  };
};
