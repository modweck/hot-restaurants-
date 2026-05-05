# OT Sniper — Don Angie

## Target
- **Restaurant**: Don Angie
- **RID**: 994474
- **Drop pattern**: 7 days in advance at 9:00 AM ET daily

## How to use (Thursday)

### At 8:55 AM ET:
1. Go to opentable.com, **log in** to your account
2. Open DevTools → Network tab → filter `gql`
3. Search for anything to trigger a request
4. Copy `x-csrf-token` from any request headers
5. Copy `sha256Hash` from RestaurantsAvailability payload (if changed)
6. In console paste: `window.OT_CSRF = 'YOUR_TOKEN';`
7. Paste the sniper script from `scripts/ot-sniper-don-angie.js`

### What it does:
- Waits until 9:00:00 AM ET
- Polls Don Angie availability every 2 seconds
- When a slot appears, auto-locks it
- Alerts you to complete the booking

## What to tell Claude:
- Date you want (7 days from Thursday = April 24)
- Time preference (7pm? 7:30pm? 8pm?)
- Party size (2?)
- Fresh CSRF token
- Fresh GQL hash (if 409 errors)

## Notes:
- CSRF token expires — must be fresh
- GQL hash may change — check if 409
- Must be logged in to your OT account
- VPN must be OFF
