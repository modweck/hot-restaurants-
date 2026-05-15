const Stripe = require('stripe');

exports.handler = async (event) => {
  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const body = JSON.parse(event.body || '{}');
    const { restaurant_name, customer_email } = body;

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'SeatWize Concierge — ' + (restaurant_name || 'Reservation Request'),
            description: 'You are only charged after we confirm your table.',
          },
          unit_amount: 2000,
        },
        quantity: 1,
      }],
      customer_email: customer_email || undefined,
      return_url: (process.env.URL || 'http://localhost:8888') + '/book.html?session_id={CHECKOUT_SESSION_ID}',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientSecret: session.client_secret }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
