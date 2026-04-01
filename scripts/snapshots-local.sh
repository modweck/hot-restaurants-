#!/bin/bash
# Review Snapshots + Likelihood — runs locally every 3 days
set -e
cd /Users/mauricedweck/Desktop/01-Projects/hot-restaurants-
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
LOG="data/snapshots.log"

echo "$(date) — Starting snapshot + likelihood update" >> "$LOG"

# Load API keys from .env if it exists
[ -f .env ] && export $(grep -v '^#' .env | xargs)

node netlify/functions/snapshot-collector.js >> "$LOG" 2>&1
node netlify/functions/likelihood-collector.js >> "$LOG" 2>&1

# Commit and push
git add netlify/functions/review_snapshots.json netlify/functions/reservation_likelihood.json
git diff --staged --quiet || git commit -m "Auto-update snapshots + likelihood $(date +%Y-%m-%d)"
git push >> "$LOG" 2>&1

echo "$(date) — Done!" >> "$LOG"
