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
    const { email, password } = JSON.parse(event.body);
    if (!email || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Email and password required' }) };
    }

    // Step 1: Authenticate with Resy
    const authResp = await fetch('https://api.resy.com/3/auth/password', {
      method: 'POST',
      headers: {
        'Authorization': `ResyAPI api_key="${API_KEY}"`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': 'https://resy.com',
        'Referer': 'https://resy.com/',
      },
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
