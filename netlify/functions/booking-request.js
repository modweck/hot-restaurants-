/**
 * booking-request.js — Handle booking requests
 * Saves to Supabase + sends email notification via Resend
 */

const SUPABASE_URL = 'https://zdsolubfxzvrqiqvwjev.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpkc29sdWJmeHp2cnFpcXZ3amV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzMwODksImV4cCI6MjA5MDcwOTA4OX0.XOuZOh4yaYGf1bUJpIDl48F0MV-kjct-_nWtgs6MJPM';

exports.handler = async (event) => {
  // GET: list requests for admin
  if (event.httpMethod === 'GET') {
    try {
      const resp = await fetch(SUPABASE_URL + '/rest/v1/booking_requests?order=created_at.desc&limit=100', {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
      });
      const data = await resp.json();
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    } catch (e) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([]) };
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { restaurant, name, contact, resy_token } = body;
    const date = body.date || body.target_date;
    const party_size = body.party_size;
    const time_pref = body.time_pref;
    const resy_email = body.resy_email;
    const resy_payment_id = body.resy_payment_id;

    if (!restaurant || !name || !contact || !resy_token) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    const request = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      restaurant,
      venue_slug: body.venue_slug || null,
      venue_id: body.venue_id || null,
      drop_days: body.drop_days || null,
      drop_hour: body.drop_hour || null,
      date,
      target_dates: body.target_dates || [date],
      party_size: party_size || 2,
      time_pref: time_pref || 'any',
      name,
      contact,
      resy_email: resy_email || null,
      resy_token,
      resy_payment_id: resy_payment_id || null,
      created_at: new Date().toISOString(),
    };

    // Send notification email via Resend
    const RESEND_KEY = process.env.RESEND_API_KEY || 're_Xwd3gC5C_4rngRH8L2oeAdJ8gsjkzwYeW';
    const dateStr = request.target_dates.join(', ');
    const emailHtml = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h2 style="color:#1a1a2e">New SeatWize Booking Request</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Restaurant:</b></td><td style="padding:8px;border-bottom:1px solid #eee">${restaurant}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Dates:</b></td><td style="padding:8px;border-bottom:1px solid #eee">${dateStr}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Party Size:</b></td><td style="padding:8px;border-bottom:1px solid #eee">${party_size || 2}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Time Pref:</b></td><td style="padding:8px;border-bottom:1px solid #eee">${time_pref || 'any'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Customer:</b></td><td style="padding:8px;border-bottom:1px solid #eee">${name}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Contact:</b></td><td style="padding:8px;border-bottom:1px solid #eee">${contact}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Resy Account:</b></td><td style="padding:8px;border-bottom:1px solid #eee">${resy_email || 'phone login'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Payment ID:</b></td><td style="padding:8px;border-bottom:1px solid #eee">${resy_payment_id || 'none'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Venue Slug:</b></td><td style="padding:8px;border-bottom:1px solid #eee">${body.venue_slug || 'none'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Venue ID:</b></td><td style="padding:8px;border-bottom:1px solid #eee">${body.venue_id || 'none'}</td></tr>
        </table>
        <div style="margin-top:20px;padding:12px;background:#f5f5f5;border-radius:8px;word-break:break-all">
          <b style="font-size:12px;color:#888">RESY TOKEN:</b><br>
          <code style="font-size:11px">${resy_token}</code>
        </div>
        <p style="margin-top:20px;font-size:12px;color:#888">Request ID: ${request.id}<br>Submitted: ${request.created_at}</p>
      </div>
    `;

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'SeatWize <onboarding@resend.dev>',
        to: 'maurice@seatsnags.com',
        subject: 'New booking: ' + restaurant + ' for ' + name,
        html: emailHtml
      })
    });

    const emailResult = await emailResp.json();
    if (emailResult.error) {
      console.error('Resend error:', emailResult);
    }

    // Save to Supabase
    try {
      await fetch(SUPABASE_URL + '/rest/v1/booking_requests', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(request)
      });
    } catch (e) {
      console.error('Supabase save error:', e.message);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id: request.id })
    };

  } catch (e) {
    console.error('Booking request error:', e);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to save request' })
    };
  }
};
