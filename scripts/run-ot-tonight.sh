#!/bin/bash
cd /Users/mauricedweck/Desktop/01-Projects/hot-restaurants-
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

TOMORROW=$(date -v+1d +%Y-%m-%d)
LOG1="data/ot-availability.log"
LOG2="data/ot-availability-half2.log"

echo "$(date) — Starting OT check for $TOMORROW (2 halves in parallel)"

# Half 1 and Half 2 in parallel
node netlify/functions/ot-tonight-check.js --all --date "$TOMORROW" --split 2 --half 1 > "$LOG1" 2>&1 &
PID1=$!
node netlify/functions/ot-tonight-check.js --all --date "$TOMORROW" --split 2 --half 2 > "$LOG2" 2>&1 &
PID2=$!

echo "Half 1 PID=$PID1 | Half 2 PID=$PID2"
wait $PID1
echo "$(date) — Half 1 done"
wait $PID2
echo "$(date) — Half 2 done"

# Merge into main
echo "$(date) — Merging OT into main availability..."
node -e "
const fs = require('fs');
const mainFile = 'netlify/functions/tonight_availability.json';
const otFile = 'netlify/functions/tonight_availability_ot.json';
const main = JSON.parse(fs.readFileSync(mainFile, 'utf8'));
const ot = JSON.parse(fs.readFileSync(otFile, 'utf8'));
let merged = 0;
for (const [key, val] of Object.entries(ot)) { main[key] = val; merged++; }
fs.writeFileSync(mainFile, JSON.stringify(main, null, 2));
console.log('Merged ' + merged + ' OT entries');
"

# Slim
node netlify/functions/slim-availability.js

# Commit + push
git add netlify/functions/tonight_availability.json netlify/functions/tonight_availability_slim.json netlify/functions/tonight_availability_ot.json
git diff --staged --quiet || git commit -m "🍽️ OT availability $(date +'%Y-%m-%d') for $TOMORROW"
git push

echo "$(date) — All done!"
