#!/bin/bash
# Daily Resy Availability Check — runs at 3am
# Resy only. OT and Tock run separately via their own LaunchAgents.

cd /Users/mauricedweck/Desktop/01-Projects/hot-restaurants-

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
LOG="data/daily-availability.log"

echo "$(date) — Starting Resy availability check" >> "$LOG"

# ── Sync booking_lookup from BOOKING_MASTER ──
node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('netlify/functions/BOOKING_MASTER.json','utf8'));
const old=JSON.parse(fs.readFileSync('netlify/functions/booking_lookup.json','utf8'));
const n={};
for(const[name,v]of Object.entries(m)){if(!v.platform||!v.url)continue;const k=name.toLowerCase();n[k]={platform:v.platform,url:v.url};if(v.lat)n[k].lat=v.lat;if(v.lng)n[k].lng=v.lng;if(v.website)n[k].website=v.website;if(v.venue_id)n[k].venue_id=v.venue_id;const o=old[name]||old[k];if(o)for(const[k2,v2]of Object.entries(o))if(!(k2 in n[k]))n[k][k2]=v2;}
fs.writeFileSync('netlify/functions/booking_lookup.json',JSON.stringify(n,null,2));
console.log('booking_lookup synced:',Object.keys(n).length,'entries');
" >> "$LOG" 2>&1

# ── Resy tonight + future horizon ──
node netlify/functions/resy-tonight-check.js --all >> "$LOG" 2>&1

# ── Generate slim version ──
node netlify/functions/slim-availability.js >> "$LOG" 2>&1

# ── Commit and push ──
git add netlify/functions/tonight_availability.json netlify/functions/tonight_availability_slim.json
git diff --staged --quiet || git commit -m "resy availability update $(date +'%Y-%m-%d')"
git push >> "$LOG" 2>&1

echo "$(date) — Resy check done!" >> "$LOG"
