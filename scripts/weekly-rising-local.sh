#!/bin/bash
# Weekly Rising Restaurants — runs locally Sundays
set -e
cd /Users/mauricedweck/Desktop/01-Projects/hot-restaurants-
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
LOG="data/weekly-rising.log"

echo "$(date) — Starting weekly rising check" >> "$LOG"

[ -f .env ] && export $(grep -v '^#' .env | xargs)

node scripts/enrichment/weekly-rising.js >> "$LOG" 2>&1

git add snapshots/ data/booking_lookup.json netlify/functions/booking_lookup.json new_and_rising.json netlify/functions/new_and_rising.json 2>/dev/null || true
git diff --staged --quiet || git commit -m "🔥 Weekly rising restaurant update $(date +%Y-%m-%d)"
git push >> "$LOG" 2>&1

echo "$(date) — Done!" >> "$LOG"
