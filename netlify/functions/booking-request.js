/**
 * booking-request.js — Store a booking request from a user
 *
 * Saves to booking_requests.json so you can see incoming requests
 * and run snipers manually.
 */

const fs = require('fs');
const path = require('path');

const REQUESTS_FILE = path.join(__dirname, 'booking_requests.json');

exports.handler = async (event) => {
  // GET — list requests (admin)
  if (event.httpMethod === 'GET') {
    let requests = [];
    try { requests = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8')); } catch {}
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { restaurant, date, party_size, time_pref, name, contact, resy_email, resy_token, resy_payment_id } = body;

    if (!restaurant || !date || !name || !contact || !resy_token) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Load existing requests
    let requests = [];
    try { requests = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8')); } catch {}

    // Add new request
    const request = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      restaurant,
      date,
      party_size: party_size || 2,
      time_pref: time_pref || 'any',
      name,
      contact,
      resy_email,
      resy_token,
      resy_payment_id,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    requests.push(request);
    fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id: request.id })
    };

  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to save request' })
    };
  }
};
