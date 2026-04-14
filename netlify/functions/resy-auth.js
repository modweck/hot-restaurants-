/**
 * resy-auth.js — Authenticate user with Resy, return token + payment method
 *
 * POST { email, password }
 * Returns { token, payment_method_id, first_name }
 *
 * Password is NEVER stored — only used to get the auth token from Resy.
 */

const API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { method, email, password, phone, code } = body;

    // Randomize User-Agent to avoid Imperva bot detection
    const UAS = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ];
    const HEADERS = {
      'Authorization': `ResyAPI api_key="${API_KEY}"`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UAS[Math.floor(Math.random() * UAS.length)],
      'Origin': 'https://resy.com',
      'Referer': 'https://resy.com/',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    };

    // ── Phone: Step 1 — send SMS code ──
    if (method === 'phone_send') {
      if (!phone) return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Phone number required' }) };
      const formatted = phone.replace(/\D/g, '');
      const intl = formatted.startsWith('1') ? '+' + formatted : '+1' + formatted;
      const resp = await fetch('https://api.resy.com/4/auth/mobile', {
        method: 'POST', headers: HEADERS,
        body: `mobile_number=${encodeURIComponent(intl)}`,
      });
      const data = await resp.json().catch(() => ({}));
      if (data.sent) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sent: true, phone: intl }) };
      }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: data.message || 'Failed to send code. Check your phone number.' }) };
    }

    // ── Phone: Step 2 — verify code (returns claim + challenge) ──
    if (method === 'phone_verify') {
      if (!phone || !code) return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Phone and code required' }) };
      const resp = await fetch('https://api.resy.com/4/auth/mobile', {
        method: 'POST', headers: HEADERS,
        body: `mobile_number=${encodeURIComponent(phone)}&code=${encodeURIComponent(code)}`,
      });
      const data = await resp.json().catch(() => ({}));
      if (data.token) {
        // Direct token (no challenge needed)
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: data.token, payment_method_id: data.payment_method_id || null, first_name: data.first_name || '' }) };
      }
      if (data.mobile_claim && data.challenge) {
        // Need to answer the challenge
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          challenge_required: true,
          claim_token: data.mobile_claim.claim_token,
          challenge_id: data.challenge.challenge_id,
          first_name: data.challenge.first_name || '',
          message: data.challenge.message || '',
          challenge_type: data.challenge.properties?.[0]?.type || 'email',
          challenge_prompt: data.challenge.properties?.[0]?.message || 'Enter your email'
        }) };
      }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: data?.data?.code || data.message || 'Invalid code. Please try again.' }) };
    }

    // ── Phone: Step 3 — answer the challenge with email ──
    if (method === 'phone_challenge') {
      const { claim_token, challenge_id, em_address } = body;
      if (!claim_token || !challenge_id || !em_address) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing challenge fields' }) };
      }
      const resp = await fetch('https://api.resy.com/4/auth/challenge', {
        method: 'POST', headers: HEADERS,
        body: `challenge_id=${encodeURIComponent(challenge_id)}&claim_token=${encodeURIComponent(claim_token)}&em_address=${encodeURIComponent(em_address)}`,
      });
      const data = await resp.json().catch(() => ({}));
      if (data.token) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: data.token, payment_method_id: data.payment_method_id || null, first_name: data.first_name || '' }) };
      }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: data?.message || 'Email did not match. Please try again.' }) };
    }

    // ── Email/password login ──
    if (!email || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email and password required' }) };
    }

    const authResp = await fetch('https://api.resy.com/3/auth/password', {
      method: 'POST', headers: HEADERS,
      body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    });

    if (!authResp.ok) {
      const errData = await authResp.json().catch(() => ({}));
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: errData.message || 'Invalid email or password. Please try again.' })
      };
    }

    const authData = await authResp.json();
    const token = authData.token;
    const firstName = authData.first_name || '';

    if (!token) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Authentication failed. Please check your credentials.' })
      };
    }

    // Step 2: Get payment methods
    let paymentMethodId = null;
    try {
      const payResp = await fetch('https://api.resy.com/2/user/payment_methods', {
        headers: {
          'Authorization': `ResyAPI api_key="${API_KEY}"`,
          'X-Resy-Auth-Token': token,
          'X-Resy-Universal-Auth': token,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Origin': 'https://resy.com',
          'Referer': 'https://resy.com/',
        },
      });
      if (payResp.ok) {
        const payData = await payResp.json();
        const methods = payData.payment_methods || payData.results || [];
        if (methods.length > 0) {
          paymentMethodId = methods[0].id;
        }
      }
    } catch {}

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        payment_method_id: paymentMethodId,
        first_name: firstName,
      })
    };

  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Something went wrong. Please try again.' })
    };
  }
};
