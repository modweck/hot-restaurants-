# OT Availability Console Check - Daily Refresh Instructions

## Script: `scripts/ot-check-console-final-2.js`

Checks all ~2,000 OT restaurants for tonight's availability across 3 time windows (early/prime/late). Takes ~10 minutes. Outputs `ot_avail_3window.json`.

---

## Steps

### 1. Turn OFF VPN
OT blocks VPN connections with 409 errors.

### 2. Open OT search page
Go to this URL in Chrome (not Safari):
```
https://www.opentable.com/s?dateTime=2026-04-14T19%3A00%3A00&covers=2&metroId=4
```
(Change the date to today's date)

### 3. Get CSRF token
Open DevTools (Cmd+Option+I) > Network tab > filter by `gql` > click any request > look at request headers for `x-csrf-token`. Copy that value.

### 4. Get GQL hash (if 409 errors)
In Network tab, find the `RestaurantsAvailability` request > click it > go to Payload > find `sha256Hash`. Copy that value.

If you don't see `RestaurantsAvailability`, scroll down the search results page to trigger it.

### 5. Update the script (if needed)
Open `scripts/ot-check-console-final-2.js` and update:
- `DATE` = today's date (line 2)
- `GQL_HASH` = new hash if it changed (line 4)

### 6. Run it
In the console, paste the CSRF first:
```js
window.OT_CSRF = 'YOUR-CSRF-TOKEN-HERE';
```
Then paste the entire script (Cmd+A, Cmd+C from the file, then Cmd+V in console).

### 7. Wait ~10 minutes
It checks early (5:45pm), prime (7:00pm), late (8:30pm) for all restaurants.
When done, it auto-downloads `ot_avail_3window.json`.

### 8. Move the file
Move the downloaded JSON to `data/ot_avail_3window.json` and update the live site files.

---

## Troubleshooting

### 409 Conflict
- **VPN is on** - turn it off
- **GQL hash changed** - OT rotates this periodically. Get the new one from Network tab (step 4)
- **CSRF expired** - get a fresh one from Network tab (step 3)

### "No CSRF" error
You forgot to paste `window.OT_CSRF = '...'` before the script.

### Key values (as of Apr 14, 2026)
- GQL Hash: `cbcf4838a9b399f742e3741785df64560a826d8d3cc2828aa01ab09a8455e29e`
- Token: `eyJ2IjoyLCJtIjoxLCJwIjowLCJzIjowLCJuIjowfQ` (this rarely changes)
- Page type: `multi-search`
- Timeout: `5500`

### If hash changes, update in script:
Line 4: `const GQL_HASH = 'NEW_HASH_HERE';`
