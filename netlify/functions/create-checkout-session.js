// No SDK - direct call to Stripe REST API to avoid Netlify bundler issues with the stripe npm package

exports.handler = async (event) => {
  try {
    const SECRET = process.env.STRIPE_SECRET_KEY;
    if (!SECRET) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing STRIPE_SECRET_KEY env var' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { restaurant_name, customer_email } = body;

    // Build form-encoded body for Stripe API
    const params = new URLSearchParams();
    params.append('ui_mode', 'embedded');
    params.append('mode', 'payment');
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', 'SeatWize Concierge — ' + (restaurant_name || 'Reservation Request'));
    params.append('line_items[0][price_data][product_data][description]', 'You are only charged after we confirm your table.');
    params.append('line_items[0][price_data][unit_amount]', '2000');
    params.append('line_items[0][quantity]', '1');
    if (customer_email) params.append('customer_email', customer_email);
    params.append('return_url', (process.env.URL || 'https://seatwize.com') + '/book.html?session_id={CHECKOUT_SESSION_ID}');

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SECRET,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await resp.json();
    if (!resp.ok || data.error) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: data.error?.message || 'Stripe error' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientSecret: data.client_secret }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
