// Netlify function: get-maps-key
// Returns the single trusted Google Maps API key (GOOGLE_PLACES_API_KEY).
// The rotation pool (GOOGLE_API_KEYS) is intentionally bypassed because
// random keys in the pool were missing the Maps JavaScript API / had
// referrer restrictions, causing intermittent "Do you own this website?"
// popups on the frontend. Switch back to pooled rotation once each pool
// key is verified to have Maps JS API enabled + seatwize.com allowed.

exports.handler = async () => {
  const key = process.env.GOOGLE_PLACES_API_KEY || '';

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ key })
  };
};
