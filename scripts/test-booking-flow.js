// Test FULL booking flow on Uva — will make a REAL reservation
const { execSync } = require('child_process');

const AUTH = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJleHAiOjE3NzgyNjg5NTksInVpZCI6NjM5ODUyMDYsImd0IjoiY29uc3VtZXIiLCJncyI6W10sImxhbmciOiJlbi11cyIsImV4dHJhIjp7Imd1ZXN0X2lkIjoxOTE0MTU2MTd9fQ.AOmR1uzP1ooGFufA8QSk2wU4we5YI_NKYbXoHZcIhD6oCFDma3cKXqkF7ZWLfarDply3tN_SzHmUeKg6Og-8i1-pAHUO9ai-DOWmHklbfQtll4VMh7b9DRSxNXamp1MAtvhcakwb576Q-AS7X_-FLTVAt5anOpeHaF6RPh9EwPKaiNle';
const KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5';
const VENUE_ID = 89241;
const DAY = '2026-03-27';

function curl(url, opts = '') {
  const cmd = `curl -s "${url}" -H "Authorization: ResyAPI api_key=\\"${KEY}\\"" -H "X-Resy-Auth-Token: ${AUTH}" -H "X-Resy-Universal-Auth: ${AUTH}" -H "Origin: https://resy.com" ${opts}`;
  return JSON.parse(execSync(cmd).toString());
}

// Step 1: Find slots
const findData = curl(`https://api.resy.com/4/find?lat=40.7128&long=-74.006&day=${DAY}&party_size=2&venue_id=${VENUE_ID}`);
const slots = findData.results?.venues?.[0]?.slots || [];
console.log('Slots found:', slots.length);
if (!slots.length) { console.log('No slots!'); process.exit(1); }

const slot = slots[slots.length - 1]; // latest slot
console.log('Using slot:', slot.date?.start);

// Step 2: Get book token
const body = JSON.stringify({ config_id: slot.config.token, day: DAY, party_size: 2 });
const detCmd = `-X POST -H "Content-Type: application/json" -d '${body}'`;
const details = curl('https://api.resy.com/3/details', detCmd);

const bookToken = details.book_token?.value;
const paymentId = details.user?.payment_methods?.[0]?.id;
console.log('Book token:', bookToken ? 'YES' : 'NO');
console.log('Payment ID:', paymentId);

if (!bookToken) { console.log('❌ Cannot proceed'); process.exit(1); }

// Step 3: BOOK IT
console.log('\n🔥 BOOKING NOW...');
const bookCmd = `-X POST -H "Content-Type: application/x-www-form-urlencoded" --data-urlencode "book_token=${bookToken}" --data-urlencode "struct_payment_method={\\"id\\":${paymentId}}" --data-urlencode "source_id=resy.com-venue-details"`;
const bookResult = curl('https://api.resy.com/3/book', bookCmd);

if (bookResult.reservation_id || bookResult.resy_token) {
  console.log('\n🎉 BOOKED! Reservation ID:', bookResult.reservation_id || bookResult.resy_token);
  console.log('⚠️ Go cancel this on Resy — just a test!');
} else {
  console.log('❌ Book failed:', JSON.stringify(bookResult).slice(0, 300));
}
