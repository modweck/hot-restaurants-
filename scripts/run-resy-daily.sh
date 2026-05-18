#!/bin/bash
# Daily Resy availability check — runs at 9:30 AM via launchd
cd /Users/mauricedweck/Desktop/hot-restaurants-/netlify/functions

# Run Resy check
node resy-tonight-check-final.js --all

# Commit and push if there are changes
cd /Users/mauricedweck/Desktop/hot-restaurants-
git add netlify/functions/tonight_availability.json
git diff --cached --quiet || git commit -m "Auto-update Resy availability $(date +%Y-%m-%d)"
git push
