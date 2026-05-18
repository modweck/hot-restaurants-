#!/bin/bash
# Daily Tock availability check — runs at 10 AM via launchd
cd /Users/mauricedweck/Desktop/hot-restaurants-/netlify/functions

# Run Tock check
node tock-tonight-check.js --all

# Commit and push if there are changes
cd /Users/mauricedweck/Desktop/hot-restaurants-
git add netlify/functions/tonight_availability_tock.json
git diff --cached --quiet || git commit -m "Auto-update Tock availability $(date +%Y-%m-%d)"
git push
