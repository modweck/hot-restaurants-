/**
 * resy-proxy.js — Local proxy for Resy auth API
 *
 * Runs on your Mac Mini, forwards Resy auth requests from Netlify
 * to avoid IP blocking. Netlify function calls this proxy instead
 * of Resy directly.
 *
 * RUN: node scripts/resy-proxy.js
 * Then update PROXY_URL env var in Netlify to point to your public IP/ngrok
 */

const http = require('http');

const API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const PORT = 3456;

const RESY_HEADERS = {
  'Authorization': `ResyAPI api_key="${API_KEY}"`,
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Origin': 'https://resy.com',
  'Referer': 'https://resy.com/',
  'Accept': 'application/json, text/plain, */*',
};

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end('Method not allowed'); return; }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { endpoint, formBody } = data;

      // Only allow specific Resy auth endpoints
      const allowed = [
        'https://api.resy.com/4/auth/mobile',
        'https://api.resy.com/4/auth/challenge',
        'https://api.resy.com/3/auth/password',
        'https://api.resy.com/2/user/payment_methods',
      ];

      if (!allowed.some(a => endpoint.startsWith(a))) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Endpoint not allowed' }));
        return;
      }

      // For payment methods, need auth token in header
      const headers = { ...RESY_HEADERS };
      if (data.authToken) {
        headers['X-Resy-Auth-Token'] = data.authToken;
        headers['X-Resy-Universal-Auth'] = data.authToken;
      }
      if (endpoint.includes('payment_methods')) {
        delete headers['Content-Type'];
      }

      const method = endpoint.includes('payment_methods') ? 'GET' : 'POST';
      const fetchOpts = { method, headers };
      if (method === 'POST' && formBody) fetchOpts.body = formBody;

      console.log(`[${new Date().toLocaleTimeString()}] ${method} ${endpoint}`);

      const resp = await fetch(endpoint, fetchOpts);
      const text = await resp.text();

      console.log(`  → ${resp.status} ${text.slice(0, 200)}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: resp.status, body: text }));
    } catch (e) {
      console.log('Error:', e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Resy proxy running on port ${PORT}`);
  console.log('Now expose this with: ngrok http ' + PORT);
});
