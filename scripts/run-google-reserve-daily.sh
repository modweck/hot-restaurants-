#!/bin/bash
# Daily Google Reserve availability check — runs at 11:00 AM via launchd
cd /Users/mauricedweck/Desktop/hot-restaurants-/scripts

# Run Google Reserve check
node google-reserve-node.js

# Commit and push if there are changes
cd /Users/mauricedweck/Desktop/hot-restaurants-
git add netlify/functions/tonight_availability_google.json
git diff --cached --quiet || git commit -m "Auto-update Google Reserve availability $(date +%Y-%m-%d)"
git push
